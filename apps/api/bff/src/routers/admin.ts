import { Hono } from 'hono';
import { actionRouter } from '../actions';
import { call, rules, type Env } from '../context';
import { problem } from '../errors';
import { auditSummary, shortDate } from '../format';
import { perms } from '../session';
import { bind, sendSpec, SpecBuilder, state, submit } from '../spec';

export const adminRouter = new Hono<Env>();

adminRouter.get('/screens/overview', async (c) => {
  const p = await perms(c);
  if (!p.can('admin')) throw problem(403, 'Forbidden', `Admin screens need the 'admin' permission on ${p.app}`);
  const client = rules(c);
  const appPath = { params: { path: { app: p.app } } };
  const globalAdmin = p.session.permissions.global.includes('admin');
  const [{ data: grants }, { data: audit }, { data: settings }, { data: usage }, providers] = await Promise.all([
    call(client.GET('/v1/apps/{app}/grants', appPath)),
    call(client.GET('/v1/apps/{app}/audit', { params: { path: { app: p.app }, query: { limit: 100 } } })),
    call(client.GET('/v1/apps/{app}/ai/settings', appPath)),
    call(client.GET('/v1/apps/{app}/ai/usage', { params: { path: { app: p.app }, query: { days: 30 } } })),
    // Provider configuration is global: only global admins see the full list.
    globalAdmin ? call(client.GET('/v1/ai/providers')).then((r) => r.data) : Promise.resolve([]),
  ]);

  const s = new SpecBuilder();
  s.state.grant = { subject: '', subjectType: 'user', permission: 'view' };

  const grantsPane = s.el('Stack', { gap: 'md' }, [
    s.el('DataTable', {
      testId: 'grants-table',
      columns: [
        { key: 'subject', label: 'Subject' },
        { key: 'type', label: 'Type' },
        { key: 'permission', label: 'Permission', kind: 'badge' },
        { key: 'scope', label: 'Scope' },
      ],
      rows: grants.map((g) => ({
        id: g.id,
        cells: { subject: g.subject, type: g.subject_type, permission: { label: g.permission, tone: g.permission === 'admin' ? 'danger' : 'info' }, scope: g.app ?? 'all applications' },
        actions:
          g.app || globalAdmin
            ? [{ label: 'Revoke', variant: 'danger' as const, on: submit('admin', 'deleteGrant', { app: p.app, grantId: g.id }, { successMessage: 'Grant revoked' }) }]
            : [],
      })),
    }),
    s.el('Form', { id: 'add-grant', title: `Grant a permission on ${p.app}` }, [
      s.el('Stack', { direction: 'horizontal', gap: 'sm', align: 'end', wrap: true }, [
        s.el('TextField', { label: 'User or group', value: bind('/grant/subject'), placeholder: 'erin' }),
        s.el('Select', { label: 'Type', value: bind('/grant/subjectType'), options: [{ value: 'user', label: 'user' }, { value: 'group', label: 'group' }] }),
        s.el('Select', { label: 'Permission', value: bind('/grant/permission'), options: ['view', 'edit', 'publish', 'evaluate', 'admin'].map((x) => ({ value: x, label: x })) }),
        s.el('Button', { label: 'Grant', variant: 'primary' }, [], {
          on: { press: submit('admin', 'addGrant', { app: p.app, subject: state('/grant/subject'), subjectType: state('/grant/subjectType'), permission: state('/grant/permission') }, { successMessage: 'Permission granted' }) },
        }),
      ]),
    ]),
  ]);

  const auditPane = s.el('AuditTimeline', {
    entries: audit.map((e) => ({ id: e.id, actor: e.actor, action: e.action, at: e.created_at, summary: auditSummary(e), decision: e.decision ?? null, version: e.version ?? null })),
  });

  const providerList = globalAdmin ? providers : [settings.provider, settings.fallback_provider].filter((x) => !!x);
  const providersPane = s.el('Stack', { gap: 'md' }, [
    s.el('KeyValue', {
      items: [
        { label: 'AI generation', value: settings.enabled ? 'enabled' : 'disabled' },
        { label: 'Provider', value: settings.provider ? `${settings.provider.name} (${settings.provider.model})` : null },
        { label: 'Fallback', value: settings.fallback_provider ? `${settings.fallback_provider.name} (${settings.fallback_provider.model})` : null },
      ],
    }),
    s.el('ProviderSettings', {
      app: p.app,
      canEdit: globalAdmin,
      providers: providerList.map((x) => ({
        id: x!.id,
        name: x!.name,
        type: x!.type,
        model: x!.model,
        baseUrl: x!.base_url ?? null,
        apiKeyRef: x!.api_key_ref ?? null,
        keyConfigured: x!.key_configured ?? false,
        enabled: x!.enabled,
        monthlyTokenBudget: x!.monthly_token_budget ?? null,
        tokensThisMonth: x!.tokens_this_month ?? 0,
      })),
      appProviderId: settings.provider?.id ?? null,
      appFallbackProviderId: settings.fallback_provider?.id ?? null,
    }),
  ]);

  const bucketTable = (testId: string, label: string, rows: typeof usage.by_provider) =>
    s.el('DataTable', {
      testId,
      columns: [
        { key: 'key', label },
        { key: 'runs', label: 'Runs' },
        { key: 'ok', label: 'Succeeded' },
        { key: 'failed', label: 'Failed' },
        { key: 'tokens', label: 'Tokens (in / out)' },
      ],
      rows: rows.map((b) => ({ id: b.key, cells: { key: b.key, runs: b.runs, ok: b.succeeded, failed: b.failed, tokens: `${b.input_tokens} / ${b.output_tokens}` }, actions: [] })),
      emptyText: 'No AI runs in the last 30 days',
    });
  const usagePane = s.el('Stack', { gap: 'md' }, [
    s.el('Grid', { columns: 2 }, [
      s.el('Card', { title: 'By provider' }, [bucketTable('ai-usage-providers', 'Provider', usage.by_provider)]),
      s.el('Card', { title: 'By user' }, [bucketTable('ai-usage-users', 'User', usage.by_user)]),
    ]),
    s.el('Card', { title: 'Recent runs' }, [
      s.el('DataTable', {
        testId: 'ai-runs',
        columns: [
          { key: 'id', label: 'Run' },
          { key: 'kind', label: 'Kind' },
          { key: 'status', label: 'Status', kind: 'badge' },
          { key: 'user', label: 'User' },
          { key: 'provider', label: 'Provider / model' },
          { key: 'attempts', label: 'Attempts' },
          { key: 'latency', label: 'Latency' },
          { key: 'at', label: 'When' },
        ],
        rows: usage.recent_runs.map((r) => ({
          id: Number(r.id),
          cells: {
            id: `#${String(r.id)}`,
            kind: String(r.kind),
            status: { label: String(r.status), tone: r.status === 'succeeded' ? 'success' : 'danger' },
            user: String(r.requested_by),
            provider: `${String(r.provider ?? '—')} / ${String(r.model ?? '—')}`,
            attempts: Number(r.attempts),
            latency: `${String(r.latency_ms)} ms`,
            at: shortDate(String(r.created_at)),
          },
          actions: [],
        })),
        emptyText: 'No AI runs yet',
      }),
    ]),
  ]);

  const root = s.el('Page', { title: 'Administration', subtitle: p.app }, [
    s.el('Tabs', {
      tabs: [
        { id: 'grants', label: 'Access' },
        { id: 'audit', label: 'Audit log' },
        { id: 'ai', label: 'AI providers' },
        { id: 'usage', label: 'AI usage' },
      ],
      defaultTab: c.req.query('tab') ?? 'grants',
    }, [grantsPane, s.el('Card', {}, [auditPane]), providersPane, usagePane]),
  ]);
  return sendSpec(c, s.build(root));
});

// --- actions -----------------------------------------------------------------------------
adminRouter.route(
  '/',
  actionRouter('admin', {
    async addGrant(c, p) {
      await call(rules(c).POST('/v1/apps/{app}/grants', { params: { path: { app: p.app } }, body: { subject: p.subject, subject_type: p.subjectType, permission: p.permission, global: p.global ?? false } }));
      return { message: `${p.permission} granted to ${p.subject}` };
    },
    async deleteGrant(c, p) {
      await call(rules(c).DELETE('/v1/apps/{app}/grants/{grant_id}', { params: { path: { app: p.app, grant_id: p.grantId } } }));
      return { message: 'Grant revoked' };
    },
    async createProvider(c, p) {
      const { data } = await call(
        rules(c).POST('/v1/ai/providers', {
          body: {
            name: p.name,
            type: p.type,
            model: p.model,
            base_url: p.baseUrl ?? null,
            api_key_ref: p.apiKeyRef ?? null,
            enabled: p.enabled ?? false,
            monthly_token_budget: p.monthlyTokenBudget ?? null,
            max_tokens: 8000,
            temperature: 0,
            timeout_s: 60,
            options: {},
          },
        }),
      );
      return { data, message: `Provider ${p.name} added` };
    },
    async updateProvider(c, p) {
      const body: Record<string, unknown> = {};
      if (p.model !== undefined) body.model = p.model;
      if (p.apiKeyRef !== undefined) body.api_key_ref = p.apiKeyRef;
      if (p.enabled !== undefined) body.enabled = p.enabled;
      if (p.monthlyTokenBudget !== undefined) body.monthly_token_budget = p.monthlyTokenBudget;
      const { data } = await call(rules(c).PATCH('/v1/ai/providers/{provider_id}', { params: { path: { provider_id: p.providerId } }, body }));
      return { data, message: `Provider ${data.name} updated` };
    },
    async testProvider(c, p) {
      const { data } = await call(rules(c).POST('/v1/ai/providers/{provider_id}/test', { params: { path: { provider_id: p.providerId } } }));
      return { data, refresh: false };
    },
    async setAppAi(c, p) {
      const { data } = await call(rules(c).PUT('/v1/apps/{app}/ai/settings', { params: { path: { app: p.app } }, body: { provider_id: p.providerId ?? null, fallback_provider_id: p.fallbackProviderId ?? null } }));
      return { data, message: 'AI provider for this application updated' };
    },
    async disableAppAi(c, p) {
      await call(rules(c).DELETE('/v1/apps/{app}/ai/settings', { params: { path: { app: p.app } } }));
      return { message: 'AI generation disabled for this application' };
    },
  }),
);
