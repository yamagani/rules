import { describe, expect, it } from 'vitest';
import { validateScreenSpec } from '@rules/ui-registry/catalog';
import { boundActions, byTestId, setup, spec } from './helpers';

const LIFECYCLE = ['submit:activate', 'submit:deprecate', 'submit:disable', 'submit:enable', 'submit:setAlias', 'submit:deleteAlias'];
const VERSIONS = '/bff/releases/screens/versions?decision=eligibility';

type Row = { id: number; cells: Record<string, unknown>; actions: { label: string; on: { params?: Record<string, unknown> } }[] };
const rows = (s: Awaited<ReturnType<typeof spec>>) => byTestId(s, 'versions-table')!.props.rows as Row[];

describe('screen specs are shaped by permissions', () => {
  it('omits lifecycle and alias actions for carol and includes them for bob', async () => {
    const { as } = setup();
    const carol = await spec(await as('carol').get(VERSIONS));
    const bob = await spec(await as('bob').get(VERSIONS));
    expect(boundActions(carol).filter((a) => LIFECYCLE.includes(a))).toEqual([]);
    expect(rows(carol).every((r) => r.actions.length === 0)).toBe(true);
    expect(byTestId(carol, 'alias-submit')).toBeUndefined();

    const bobActions = new Set(boundActions(bob));
    for (const action of ['submit:activate', 'submit:deprecate', 'submit:disable', 'submit:enable', 'submit:setAlias']) {
      expect(bobActions.has(action), action).toBe(true);
    }
    expect(byTestId(bob, 'alias-submit')).toBeDefined();
  });

  it('hides the publish shortcut on the rules screen from carol', async () => {
    const { as } = setup();
    const carol = await spec(await as('carol').get('/bff/rules/screens/decision?decision=eligibility'));
    const bob = await spec(await as('bob').get('/bff/rules/screens/decision?decision=eligibility'));
    expect(byTestId(carol, 'activate-draft')).toBeUndefined();
    expect(byTestId(bob, 'activate-draft')).toBeDefined();
    // carol can still edit and generate
    expect(Object.values(carol.elements).find((e) => e.type === 'JdmEditor')?.props).toMatchObject({ canSave: true, readOnly: false });
    expect(Object.values(carol.elements).some((e) => e.type === 'AiGeneratePanel')).toBe(true);
  });

  it('gives dave a read-only editor and no AI panel', async () => {
    const { as } = setup();
    const dave = await spec(await as('dave').get('/bff/rules/screens/decision?decision=eligibility'));
    expect(Object.values(dave.elements).find((e) => e.type === 'JdmEditor')?.props).toMatchObject({ canSave: false, readOnly: true });
    expect(Object.values(dave.elements).some((e) => e.type === 'AiGeneratePanel')).toBe(false);
    expect(boundActions(dave).filter((a) => a.startsWith('submit:'))).toEqual([]);
  });

  it('serves admin screens only to admins', async () => {
    const { as } = setup();
    expect((await as('bob').get('/bff/admin/screens/overview')).status).toBe(403);
    const alice = await spec(await as('alice').get('/bff/admin/screens/overview'));
    const types = new Set(Object.values(alice.elements).map((e) => e.type));
    expect([...types]).toEqual(expect.arrayContaining(['AuditTimeline', 'ProviderSettings']));
  });
});

describe('versions screen', () => {
  it('shows each version status and the aliases pointing at it', async () => {
    const { as } = setup();
    const s = await spec(await as('dave').get(VERSIONS));
    const byVersion = Object.fromEntries(rows(s).map((r) => [r.id, r.cells]));
    expect(Object.fromEntries(Object.entries(byVersion).map(([v, c]) => [v, (c.status as { label: string }).label]))).toEqual({
      1: 'disabled',
      2: 'deprecated',
      3: 'active',
      4: 'active',
      5: 'draft',
    });
    expect(byVersion[3]!.aliases).toEqual(['default', 'stable']);
    expect(byVersion[4]!.aliases).toEqual(['beta']);
    expect(byVersion[2]!.aliases).toEqual([]);
    const aliases = byTestId(s, 'aliases-table')!.props.rows as { id: string; cells: { version: string } }[];
    expect(Object.fromEntries(aliases.map((a) => [a.id, a.cells.version]))).toEqual({ beta: 'v4', default: 'v3', stable: 'v3' });
  });

  it('does not offer disable for a version an alias points at', async () => {
    const { as } = setup();
    const s = await spec(await as('bob').get(VERSIONS));
    const labels = Object.fromEntries(rows(s).map((r) => [r.id, r.actions.map((a) => a.label)]));
    expect(labels[3]).not.toContain('Disable'); // default + stable
    expect(labels[4]).not.toContain('Disable'); // beta
    expect(labels[2]).toContain('Disable'); // deprecated, unaliased
    expect(labels[1]).toEqual(['Enable']);
    expect(labels[5]).toEqual(['Activate']);
  });

  it('emits specs that pass the shared catalog validation', async () => {
    const { as } = setup();
    for (const [user, path] of [
      ['bob', VERSIONS],
      ['bob', '/bff/rules/screens/decision?decision=pricing'],
      ['carol', '/bff/rules/screens/list'],
      ['dave', '/bff/releases/screens/list'],
      ['alice', '/bff/admin/screens/overview'],
    ] as const) {
      expect(validateScreenSpec(await spec(await as(user).get(path))).ok, `${user} ${path}`).toBe(true);
    }
  });
});

describe('actions', () => {
  it('rejects invalid payloads with 400 and field errors', async () => {
    const { as, rs } = setup();
    const res = await as('bob').post('/bff/releases/actions/setAlias', { app: 'loan-origination', decision: 'eligibility', alias: 'Not Valid', version: 'x' });
    expect(res.status).toBe(400);
    const body = (await res.json()) as { fieldErrors: Record<string, string[]>; requestId: string };
    expect(Object.keys(body.fieldErrors).sort()).toEqual(['alias', 'version']);
    expect(body.requestId).toBeTruthy();
    expect(rs.calls.filter((c) => c.method !== 'GET')).toEqual([]);

    const missing = await as('bob').post('/bff/rules/actions/generate', { app: 'loan-origination', decision: 'fraud-flag' });
    expect(((await missing.json()) as { fieldErrors: Record<string, string[]> }).fieldErrors.prompt).toBeDefined();
    expect((await as('bob').post('/bff/rules/actions/nope', {})).status).toBe(404);
  });

  it('forwards the user token and request id to rules-service', async () => {
    const { as, rs } = setup();
    const res = await as('bob').post('/bff/releases/actions/setAlias', { app: 'loan-origination', decision: 'eligibility', alias: 'beta', version: '5' });
    expect(res.status).toBe(200);
    const put = rs.calls.find((c) => c.method === 'PUT')!;
    expect(put.path).toBe('/v1/apps/loan-origination/decisions/eligibility/aliases/beta');
    expect(put.authorization).toBe('Bearer token-bob');
    expect(put.body).toEqual({ version: 5 });
    expect(put.requestId).toBe(res.headers.get('x-request-id'));
  });

  it('maps camelCase payloads to the rules-service API', async () => {
    const { as, rs } = setup();
    await as('bob').post('/bff/releases/actions/activate', { app: 'loan-origination', decision: 'eligibility', version: 5, aliases: ['beta', ''] });
    const post = rs.calls.find((c) => c.method === 'POST')!;
    expect(post.path).toBe('/v1/apps/loan-origination/decisions/eligibility/versions/5/activate');
    expect(post.body).toEqual({ aliases: ['beta'], force: false });
  });
});

describe('session', () => {
  it('logs in through the dev issuer and sets an HttpOnly cookie', async () => {
    const { app } = setup();
    const res = await app.request('/bff/session/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ username: 'carol' }) });
    expect(res.status).toBe(200);
    const cookie = res.headers.get('set-cookie')!;
    expect(cookie).toContain('rules_session=token-carol');
    expect(cookie).toContain('HttpOnly');
    const session = (await (await app.request('/bff/session', { headers: { Cookie: 'rules_session=token-carol' } })).json()) as { permissions: unknown; demoMode: boolean };
    expect(session).toMatchObject({ authenticated: true, demoMode: true, permissions: { apps: { 'loan-origination': ['edit', 'view'] } } });
  });

  it('reports an anonymous session without a cookie', async () => {
    const { app } = setup();
    const session = (await (await app.request('/bff/session')).json()) as { authenticated: boolean; demoUsers: unknown[] };
    expect(session.authenticated).toBe(false);
    expect(session.demoUsers.length).toBeGreaterThan(0);
  });
});

describe('spec validation failures', () => {
  it('returns a structured 500 when a builder emits an invalid spec', async () => {
    const { Hono } = await import('hono');
    const { sendSpec } = await import('../src/spec');
    const app = new Hono<{ Variables: { requestId: string } }>();
    app.get('/broken', (c) => {
      c.set('requestId', 'rid-1');
      return sendSpec(c as never, { root: 'p', elements: { p: { type: 'Page', props: { title: 42 }, children: [] } } } as never);
    });
    const res = await app.request('/broken');
    expect(res.status).toBe(500);
    const body = (await res.json()) as { title: string; issues: { path: string }[] };
    expect(body.title).toBe('Invalid screen spec');
    expect(body.issues[0]!.path).toBe('elements.p.props.title');
  });
});

describe('health', () => {
  it('reports ok', async () => {
    const { app } = setup();
    expect(await (await app.request('/health')).json()).toEqual({ status: 'ok', service: 'bff' });
  });
});
