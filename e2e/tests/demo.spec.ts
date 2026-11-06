/**
 * The scripted demo from docs/DEMO.md, end to end. Needs a freshly seeded database
 * (`pnpm db:seed`, or the CI job's reset step).
 */
import { expect, test, type APIRequestContext, type Page } from '@playwright/test';
import { expectToast, loginAs, openScreen, rowAction } from './helpers';

const RULES_SERVICE = process.env.E2E_RULES_SERVICE_URL ?? 'http://localhost:8000';
// Vercel previews: the request fixture inherits extraHTTPHeaders (bypass secret) from the config.
const APP = '/v1/apps/loan-origination/decisions';
const ADULT_78 = { applicant: { age: 78, creditScore: 700 }, loan: { amount: 100000 } };

test.describe.configure({ mode: 'serial' });

async function svcToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${RULES_SERVICE}/v1/dev/token`, { data: { username: 'svc-loan' } });
  expect(res.ok()).toBeTruthy();
  return ((await res.json()) as { access_token: string }).access_token;
}

async function evaluate(request: APIRequestContext, token: string, decision: string, query = '', body: object = ADULT_78) {
  return request.post(`${RULES_SERVICE}${APP}/${decision}/evaluate${query}`, { data: body, headers: { Authorization: `Bearer ${token}` } });
}

/** Edit one decision-table cell in the GoRules editor, identified by its current text. */
async function editCell(page: Page, nodeName: string, from: string, to: string) {
  await page.locator('.react-flow__node', { hasText: nodeName }).getByText('Edit Table').click();
  const cell = page.locator('.cm-content', { hasText: from }).first();
  await cell.click();
  await page.keyboard.press('ControlOrMeta+A');
  await page.keyboard.type(to);
  await page.keyboard.press('Tab');
}

test('precondition: the database is freshly seeded', async ({ request }) => {
  const admin = ((await (await request.post(`${RULES_SERVICE}/v1/dev/token`, { data: { username: 'alice' } })).json()) as { access_token: string }).access_token;
  const detail = await request.get(`${RULES_SERVICE}${APP}/eligibility`, { headers: { Authorization: `Bearer ${admin}` } });
  expect(((await detail.json()) as { versions: unknown[] }).versions, 'run `pnpm db:seed` before the demo e2e').toHaveLength(5);
  expect((await request.get(`${RULES_SERVICE}${APP}/fraud-flag`, { headers: { Authorization: `Bearer ${admin}` } })).status()).toBe(404);
  const token = await svcToken(request);
  const res = await evaluate(request, token, 'eligibility', '?version=5');
  expect(res.status(), 'run `pnpm db:seed` before the demo e2e').toBe(403); // v5 is a draft
  expect((await evaluate(request, token, 'eligibility')).headers()['x-rule-version']).toBe('3');
});

test('1-2. carol edits the eligibility draft and tests it', async ({ page }) => {
  await loginAs(page, 'carol');
  await page.goto('/rules/eligibility');
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await expect(page.getByTestId('jdm-editor')).toContainText('Version 5 (draft)');
  await editCell(page, 'Eligibility', '> 75', '> 80');
  await page.getByLabel('Change comment').fill('Raise maximum age to 80');
  await page.getByTestId('save-draft').click();
  await expectToast(page, 'Saved as draft version 6');
  await expect(page).toHaveURL(/\/rules\/eligibility\?version=6/);

  await page.getByRole('tab', { name: 'Test', exact: true }).click();
  await expect(page.getByTestId('test-target')).toHaveValue('draft');
  await page.getByTestId('test-input').fill(JSON.stringify(ADULT_78));
  await page.getByTestId('test-evaluate').click();
  await expect(page.getByTestId('test-result-version')).toHaveText('6');
  await expect(page.getByTestId('test-output')).toContainText('"eligible": true');
});

test('3. carol cannot activate: the controls are not in her screens', async ({ page }) => {
  await loginAs(page, 'carol');
  await openScreen(page, '/rules/eligibility', 'jdm-editor');
  await expect(page.getByTestId('activate-draft')).toHaveCount(0);
  await openScreen(page, '/releases/eligibility', 'versions-table');
  await expect(page.getByTestId('versions-table').getByRole('button')).toHaveCount(0);
  await expect(page.getByTestId('open-activate')).toHaveCount(0);
  await expect(page.getByTestId('alias-submit')).toHaveCount(0);
});

test('4. bob diffs v5 against v3, activates v5 and points beta at it', async ({ page }) => {
  await loginAs(page, 'bob');
  await openScreen(page, '/releases/eligibility?from=3&to=5', 'versions-table');
  await expect(page.getByLabel('From version')).toHaveValue('3');
  await expect(page.getByLabel('To version')).toHaveValue('5');
  await expect(page.getByTestId('diff-changes')).toContainText('rule-');

  await page.getByTestId('open-activate').click();
  await page.getByTestId('activate-version').selectOption('5');
  await page.getByTestId('activate-alias').selectOption('beta');
  await page.getByTestId('activate-submit').click();
  await expectToast(page, /v5 activated \(3\/3 tests passed\)/);

  const row = (v: number) => page.getByTestId('versions-table').getByTestId(`row-${v}`);
  await expect(row(5)).toContainText('active');
  await expect(row(5)).toContainText('beta');
  await expect(row(4)).toContainText('active');
  await expect(row(3)).toContainText('active');
  await expect(row(3)).toContainText('default');
});

test('5. svc-loan evaluates by default, alias, deprecated and disabled versions', async ({ request }) => {
  const token = await svcToken(request);
  const byDefault = await evaluate(request, token, 'eligibility');
  expect(byDefault.headers()['x-rule-version']).toBe('3');
  expect(((await byDefault.json()) as { meta: { version: number } }).meta.version).toBe(3);

  const beta = await evaluate(request, token, 'eligibility', '?alias=beta');
  expect(((await beta.json()) as { meta: { version: number } }).meta.version).toBe(5);

  const deprecated = await evaluate(request, token, 'eligibility', '?version=2');
  expect(deprecated.status()).toBe(200);
  expect(deprecated.headers()['deprecation']).toBe('true');
  expect(deprecated.headers()['sunset']).toMatch(/GMT$/);

  const disabled = await evaluate(request, token, 'eligibility', '?version=1');
  expect(disabled.status()).toBe(410);
  expect(disabled.headers()['content-type']).toContain('application/problem+json');
  const alternatives = ((await disabled.json()) as { alternatives: { version: number }[] }).alternatives.map((a) => a.version);
  expect(alternatives).toEqual(expect.arrayContaining([2, 3, 4, 5]));
});

test('6. bob sees v2 has (almost) no traffic and disables it', async ({ page }) => {
  await loginAs(page, 'bob');
  await openScreen(page, '/releases/eligibility', 'usage-table');
  await expect(page.getByTestId('usage-table').getByTestId('row-2')).toContainText('deprecated');
  await expect(page.getByTestId('usage-table').getByTestId('row-2').locator('td').nth(2)).toHaveText('1'); // only the demo call from step 5
  await rowAction(page, 'versions-table', 2, 'Disable');
  await expectToast(page, 'v2 disabled');
  await expect(page.getByTestId('versions-table').getByTestId('row-2')).toContainText('disabled');
  // aliased versions never offer Disable
  await expect(page.getByTestId('versions-table').getByTestId('row-3').getByRole('button', { name: 'Disable' })).toHaveCount(0);
});

test('7. bob promotes default to v5, then rolls it back to v3', async ({ page, request }) => {
  const token = await svcToken(request);
  await loginAs(page, 'bob');
  await openScreen(page, '/releases/eligibility', 'aliases-table');
  await page.getByTestId('alias-name').selectOption('default');
  await page.getByTestId('alias-version').selectOption('5');
  await page.getByTestId('alias-submit').click();
  await expectToast(page, 'default → v5');
  await expect.poll(async () => (await evaluate(request, token, 'eligibility')).headers()['x-rule-version'], { timeout: 15_000 }).toBe('5');

  await page.getByTestId('alias-name').selectOption('default');
  await page.getByTestId('alias-version').selectOption('3');
  await page.getByTestId('alias-submit').click();
  await expectToast(page, 'default → v3');
  await expect(page.getByTestId('aliases-table').getByTestId('row-default')).toContainText('v3');
  await expect.poll(async () => (await evaluate(request, token, 'eligibility')).headers()['x-rule-version'], { timeout: 15_000 }).toBe('3');
});

test('8. carol generates fraud-flag with AI, tweaks a cell and saves another draft', async ({ page }) => {
  await loginAs(page, 'carol');
  await openScreen(page, '/rules', 'decisions-table');
  await page.getByTestId('new-decision').click();
  await page.getByTestId('create-key').fill('fraud-flag');
  await page.getByTestId('create-name').fill('Fraud flag');
  await page.getByTestId('create-submit').click();
  await expect(page).toHaveURL(/\/rules\/fraud-flag/);

  await page.getByRole('tab', { name: 'Generate with AI', exact: true }).click();
  await page.getByTestId('ai-prompt').fill(
    'Flag suspicious transactions as fraud risk: amounts above 10,000 are flagged; on accounts younger than 30 days the risk is high, otherwise medium. Everything else is low risk and not flagged.',
  );
  await page.getByText('Structured context (optional)').click();
  await page.getByTestId('ai-examples-input').fill(
    JSON.stringify([
      { input: { transaction: { amount: 15000 }, customer: { accountAgeDays: 10 } }, expected: { flag: true, risk: 'high' } },
      { input: { transaction: { amount: 200 }, customer: { accountAgeDays: 400 } }, expected: { flag: false, risk: 'low' } },
    ]),
  );
  await page.getByTestId('ai-generate').click();
  await expect(page.getByTestId('ai-result')).toContainText('Draft version 1');
  await expect(page.getByTestId('ai-report')).toContainText('Validation: passed');
  await expect(page.getByTestId('ai-examples')).toContainText('✓ example 1');
  await expect(page.getByTestId('ai-examples')).toContainText('✓ example 2');

  await page.getByTestId('ai-open-draft').click();
  await expect(page).toHaveURL(/\/rules\/fraud-flag\?version=1/);
  await expect(page.locator('.react-flow__node').first()).toBeVisible();
  await expect(page.getByTestId('jdm-editor')).toContainText('Version 1 (draft)');
  await editCell(page, 'Fraud flag', "'Large amount'", "'Large amount on an established account'");
  await page.getByLabel('Change comment').fill('Clarify the medium-risk reason');
  await page.getByTestId('save-draft').click();
  await expectToast(page, 'Saved as draft version 2');

  // A stored test case, so the activation gate has something to check.
  await page.getByRole('tab', { name: /Stored tests/ }).click();
  await page.getByLabel('Name').fill('large amount on a new account is high risk');
  await page.getByLabel('Input', { exact: true }).fill(JSON.stringify({ transaction: { amount: 20000 }, customer: { accountAgeDays: 5 } }));
  await page.getByLabel('Expected (subset of the output)').fill(JSON.stringify({ flag: true, risk: 'high' }));
  await page.getByRole('button', { name: 'Add test case' }).click();
  await expectToast(page, 'Test case "large amount on a new account is high risk" added');
});

test('9. bob activates the generated draft through the same test gate', async ({ page, request }) => {
  await loginAs(page, 'bob');
  await openScreen(page, '/releases/fraud-flag', 'versions-table');
  await expect(page.getByTestId('versions-table').getByTestId('row-1')).toContainText('ai:mock/');
  await rowAction(page, 'versions-table', 2, 'Activate');
  await expectToast(page, /v2 activated \(1\/1 tests passed\)/);
  await expect(page.getByTestId('aliases-table').getByTestId('row-default')).toContainText('v2');

  const token = await svcToken(request);
  const res = await evaluate(request, token, 'fraud-flag', '', { transaction: { amount: 50000 }, customer: { accountAgeDays: 400 } });
  expect(await res.json()).toMatchObject({ result: { flag: true, risk: 'medium', reason: 'Large amount on an established account' }, meta: { version: 2 } });
});

test('10. alice reviews the audit log and AI usage', async ({ page }) => {
  await loginAs(page, 'alice');
  await openScreen(page, '/admin?tab=audit', 'audit-timeline');
  await expect(page.getByTestId('audit-ai.generated').first()).toContainText('Generated draft v1 with mock/');
  await expect(page.getByTestId('audit-alias.moved').first()).toContainText('Alias "default" moved from v5 to v3');
  await expect(page.getByTestId('audit-version.disabled').first()).toContainText('v2: deprecated → disabled');

  await openScreen(page, '/admin?tab=usage', 'ai-usage-users');
  await expect(page.getByTestId('ai-usage-users').getByTestId('row-carol')).toContainText('1');
  await openScreen(page, '/admin?tab=ai', 'provider-settings');
  await expect(page.getByTestId('provider-anthropic')).toContainText('env:ANTHROPIC_API_KEY');
  await expect(page.getByTestId('provider-anthropic')).toContainText('disabled');
});
