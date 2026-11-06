import { expect, test } from '@playwright/test';
import { loginAs, openScreen } from './helpers';

const standalone = !process.env.E2E_BASE_URL; // standalone remote dev servers only exist locally

test.describe('micro-frontends', () => {
  test('the shell loads every remote and filters nav by permission', async ({ page }) => {
    await loginAs(page, 'alice');
    await expect(page.getByTestId('demo-banner')).toBeVisible();
    await expect(page.locator('nav a')).toHaveText(['Rules', 'Releases', 'Admin']);
    await openScreen(page, '/rules', 'decisions-table');
    await openScreen(page, '/releases/eligibility', 'versions-table');
    await openScreen(page, '/admin', 'grants-table');

    await loginAs(page, 'carol');
    await expect(page.locator('nav a')).toHaveText(['Rules', 'Releases']);
  });

  test('a failing remote does not break the shell', async ({ page }) => {
    // The admin remote lives at :5176 locally and under /_mfe/admin/ on Vercel.
    await page.route('**/remoteEntry.js', (route) => (/5176|mfe-admin|\/_mfe\/admin\//.test(route.request().url()) ? route.abort() : route.continue()));
    await loginAs(page, 'alice');
    await page.goto('/admin');
    await expect(page.getByTestId('remote-error')).toContainText('Admin is unavailable');
    await expect(page.getByTestId('current-user')).toBeVisible();
    await page.getByTestId('nav-releases').click();
    await expect(page.getByTestId('releases-table')).toBeVisible();
    await page.getByTestId('nav-rules').click();
    await expect(page.getByTestId('decisions-table')).toBeVisible();
  });

  test('a screen with an invalid spec shows an error state, not a crash', async ({ page }) => {
    await loginAs(page, 'bob');
    await page.route('**/bff/releases/screens/list**', (route) =>
      route.fulfill({ json: { root: 'p', elements: { p: { type: 'Page', props: { title: 123 }, children: [] } } } }),
    );
    await page.goto('/releases');
    await expect(page.getByTestId('screen-error')).toContainText('elements.p.props.title');
    await expect(page.getByTestId('current-user')).toBeVisible();
  });

  for (const [port, path, testId, user] of [
    [5174, '/rules/pricing', 'jdm-editor', 'carol'],
    [5175, '/releases/eligibility', 'versions-table', 'bob'],
    [5176, '/admin', 'grants-table', 'alice'],
  ] as const) {
    test(`remote on :${port} runs standalone with a mock session`, async ({ page }) => {
      test.skip(!standalone, 'standalone dev servers are local only');
      await page.goto(`http://localhost:${port}${path}`);
      await expect(page.getByTestId('standalone-banner')).toContainText(user);
      await expect(page.getByTestId(testId)).toBeVisible();
    });
  }
});
