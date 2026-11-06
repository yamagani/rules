import type { Schemas } from '@rules/api-client';
import { Hono } from 'hono';
import { actionRouter } from '../actions';
import { call, rules, type Env } from '../context';
import { problem } from '../errors';
import { shortDate, statusBadge } from '../format';
import { perms } from '../session';
import { bind, nav, openModal, sendSpec, SpecBuilder, state, submit } from '../spec';

export const releasesRouter = new Hono<Env>();

const SERVABLE = new Set(['active', 'deprecated']);
type Version = Schemas['VersionSummary'];

releasesRouter.get('/screens/list', async (c) => {
  const p = await perms(c);
  const { data: decisions } = await call(rules(c).GET('/v1/apps/{app}/decisions', { params: { path: { app: p.app } } }));
  const s = new SpecBuilder();
  const table = s.el('DataTable', {
    testId: 'releases-table',
    columns: [
      { key: 'key', label: 'Decision', kind: 'code' },
      { key: 'default', label: 'Default' },
      { key: 'active', label: 'Active versions', kind: 'tags' },
      { key: 'latest', label: 'Latest' },
    ],
    rows: decisions.map((d) => ({
      id: d.key,
      href: `/releases/${d.key}`,
      cells: {
        key: d.key,
        default: d.default_version ? `v${d.default_version}` : null,
        active: (d.active_versions ?? []).map((v) => `v${v}`),
        latest: d.latest_version ? `v${d.latest_version}` : null,
      },
      actions: [{ label: 'Manage releases', variant: 'primary', on: nav(`/releases/${d.key}`) }],
    })),
    emptyText: 'No decisions yet',
  });
  return sendSpec(c, s.build(s.el('Page', { title: 'Releases', subtitle: 'Versions, aliases and rollout per decision' }, [s.el('Card', {}, [table])])));
});

/** The lifecycle actions offered for one version, given the caller's permissions. */
export function versionActions(app: string, decision: string, v: Version, canPublish: boolean) {
  const actions: { label: string; variant: 'primary' | 'secondary' | 'danger' | 'ghost'; on: { action: string; params?: Record<string, unknown> } }[] = [];
  if (!canPublish) return actions;
  const base = { app, decision, version: v.version };
  if (v.status === 'draft') {
    actions.push({ label: 'Activate', variant: 'primary', on: submit('releases', 'activate', base, { successMessage: `v${v.version} activated` }) });
  }
  if (SERVABLE.has(v.status)) {
    actions.push({ label: 'Point alias…', variant: 'secondary', on: { action: 'setState', params: { statePath: '/alias/version', value: String(v.version) } } });
  }
  if (v.status === 'active') {
    actions.push({ label: 'Deprecate', variant: 'secondary', on: submit('releases', 'deprecate', base, { successMessage: `v${v.version} deprecated` }) });
  }
  // A version an alias points at cannot be disabled: don't offer it (rules-service also returns 409).
  if (SERVABLE.has(v.status) && v.aliases.length === 0) {
    actions.push({ label: 'Disable', variant: 'danger', on: submit('releases', 'disable', base, { successMessage: `v${v.version} disabled` }) });
  }
  if (v.status === 'disabled') {
    actions.push({ label: 'Enable', variant: 'secondary', on: submit('releases', 'enable', base, { successMessage: `v${v.version} re-enabled` }) });
  }
  return actions;
}

releasesRouter.get('/screens/versions', async (c) => {
  const p = await perms(c);
  const key = c.req.query('decision');
  if (!key) throw problem(400, 'Bad Request', 'decision is required');
  const client = rules(c);
  const pathParams = { params: { path: { app: p.app, key } } };
  const [{ data: detail }, { data: usage }] = await Promise.all([
    call(client.GET('/v1/apps/{app}/decisions/{key}', pathParams)),
    call(client.GET('/v1/apps/{app}/decisions/{key}/usage', { params: { path: { app: p.app, key }, query: { days: 30 } } })),
  ]);
  const canPublish = p.can('publish');
  const s = new SpecBuilder();
  const servable = detail.versions.filter((v) => SERVABLE.has(v.status));
  const usageByVersion = new Map(usage.versions.map((u) => [u.version, u]));

  // Versions with status badges, aliases and usage; per-row lifecycle actions.
  const versions = s.el('DataTable', {
    testId: 'versions-table',
    columns: [
      { key: 'version', label: 'Version' },
      { key: 'status', label: 'Status', kind: 'badge' },
      { key: 'aliases', label: 'Aliases', kind: 'tags' },
      { key: 'calls', label: 'Calls (30 days)' },
      { key: 'sunset', label: 'Sunset' },
      { key: 'author', label: 'Author' },
      { key: 'comment', label: 'Comment' },
    ],
    rows: detail.versions.map((v) => ({
      id: v.version,
      cells: {
        version: `v${v.version}`,
        status: statusBadge(v.status),
        aliases: v.aliases,
        calls: v.status === 'draft' ? null : (usageByVersion.get(v.version)?.total ?? 0),
        sunset: shortDate(v.sunset_at),
        author: v.author,
        comment: v.comment ?? null,
      },
      actions: versionActions(p.app, key, v, canPublish),
    })),
  });

  // Alias map. Rollback = move `default` back to an older active version.
  const aliasTable = s.el('DataTable', {
    testId: 'aliases-table',
    columns: [
      { key: 'alias', label: 'Alias', kind: 'code' },
      { key: 'version', label: 'Version' },
      { key: 'by', label: 'Updated by' },
      { key: 'at', label: 'Updated' },
    ],
    rows: detail.aliases.map((a) => ({
      id: a.alias,
      cells: { alias: a.alias, version: `v${a.version}`, by: a.updated_by, at: shortDate(a.updated_at) },
      actions:
        canPublish && a.alias !== 'default'
          ? [{ label: 'Delete', variant: 'danger' as const, on: submit('releases', 'deleteAlias', { app: p.app, decision: key, alias: a.alias }, { successMessage: `Alias ${a.alias} deleted` }) }]
          : [],
    })),
    emptyText: 'No aliases: activate a version to create the default alias',
  });

  const aliasCardChildren: string[] = [aliasTable];
  if (canPublish && servable.length) {
    s.state.alias = { name: 'default', version: String(detail.default_version ?? servable[0]!.version) };
    const aliasNames = [...new Set(['default', 'stable', 'beta', ...detail.aliases.map((a) => a.alias)])];
    aliasCardChildren.push(
      s.el('Form', { id: 'move-alias', title: 'Point an alias' }, [
        s.el('Stack', { direction: 'horizontal', gap: 'sm', align: 'end', wrap: true }, [
          s.el('Select', { label: 'Alias', value: bind('/alias/name'), options: aliasNames.map((n) => ({ value: n, label: n })), testId: 'alias-name' }),
          s.el('Select', {
            label: 'Version',
            value: bind('/alias/version'),
            options: servable.map((v) => ({ value: String(v.version), label: `v${v.version} (${v.status})` })),
            testId: 'alias-version',
          }),
          s.el('Button', { label: 'Move alias', variant: 'primary', testId: 'alias-submit' }, [], {
            on: { press: submit('releases', 'setAlias', { app: p.app, decision: key, alias: state('/alias/name'), version: { $number: '/alias/version' } }, { successMessage: 'Alias updated' }) },
          }),
        ]),
      ]),
    );
  }

  const children: string[] = [];
  if (canPublish) {
    const drafts = detail.versions.filter((v) => v.status === 'draft');
    if (drafts.length) {
      s.state.activate = { version: String(drafts[0]!.version), alias: '' };
      children.push(
        s.el('Toolbar', { align: 'end' }, [
          s.el('Button', { label: 'Activate a draft…', variant: 'primary', testId: 'open-activate' }, [], { on: { press: openModal('activate') } }),
        ]),
        s.el('Modal', { id: 'activate', title: 'Activate a draft' }, [
          s.el('Form', { id: 'activate-form' }, [
            s.el('Select', { label: 'Draft', value: bind('/activate/version'), options: drafts.map((v) => ({ value: String(v.version), label: `v${v.version}: ${v.comment ?? ''}` })), testId: 'activate-version' }),
            s.el('Select', {
              label: 'Also point alias',
              value: bind('/activate/alias'),
              options: [{ value: '', label: '(none)' }, ...['beta', 'stable', 'default', ...detail.aliases.map((a) => a.alias)].filter((v, i, a) => a.indexOf(v) === i).map((n) => ({ value: n, label: n }))],
              testId: 'activate-alias',
            }),
            s.el('Text', { text: 'Stored test cases run first; activation is blocked if any fail. Other active versions are not touched.', tone: 'muted' }),
            s.el('Button', { label: 'Activate', variant: 'primary', testId: 'activate-submit' }, [], {
              on: {
                press: submit('releases', 'activate', { app: p.app, decision: key, version: { $number: '/activate/version' }, aliases: [state('/activate/alias')] }, { successMessage: 'Version activated', closeModal: true }),
              },
            }),
          ]),
        ]),
      );
    }
  }

  const versionsList = detail.versions.map((v) => v.version).sort((a, b) => a - b);
  const diffFrom = Number(c.req.query('from')) || detail.default_version || versionsList[0];
  const diffTo = Number(c.req.query('to')) || detail.latest_draft?.version || detail.latest_version || versionsList[versionsList.length - 1];

  children.push(
    s.el('Card', { title: 'Versions', subtitle: 'Any number of versions can be active; callers pin a version or use an alias' }, [versions]),
    s.el('Grid', { columns: 2 }, [
      s.el('Card', { title: 'Aliases', subtitle: 'Rollback = move "default" back to an older active version' }, aliasCardChildren),
      s.el('Card', { title: 'Usage (last 30 days)', subtitle: 'Deprecated versions with no calls can be disabled safely' }, [
        s.el('DataTable', {
          testId: 'usage-table',
          columns: [
            { key: 'version', label: 'Version' },
            { key: 'status', label: 'Status', kind: 'badge' },
            { key: 'total', label: 'Calls' },
            { key: 'last', label: 'Last used' },
          ],
          rows: usage.versions.map((u) => ({ id: u.version, cells: { version: `v${u.version}`, status: statusBadge(u.status), total: u.total, last: u.last_used ?? null }, actions: [] })),
        }),
      ]),
    ]),
  );
  if (diffFrom && diffTo && versionsList.length > 1) {
    children.push(s.el('Card', { title: 'Diff' }, [s.el('VersionDiff', { app: p.app, decision: key, from: diffFrom, to: diffTo, versions: versionsList })]));
  }

  const root = s.el('Page', { title: `${detail.name}: releases`, breadcrumbs: [{ label: 'Releases', href: '/releases' }, { label: key }] }, children);
  return sendSpec(c, s.build(root));
});

// --- actions -----------------------------------------------------------------------------
const vpath = (app: string, key: string, version: number) => ({ params: { path: { app, key, version } } });

releasesRouter.route(
  '/',
  actionRouter('releases', {
    async activate(c, p) {
      const { data } = await call(
        rules(c).POST('/v1/apps/{app}/decisions/{key}/versions/{version}/activate', { ...vpath(p.app, p.decision, p.version), body: { aliases: p.aliases ?? [], force: p.force ?? false } }),
      );
      return { data, message: `v${p.version} activated (${data.tests?.passed ?? 0}/${data.tests?.total ?? 0} tests passed)` };
    },
    async deprecate(c, p) {
      const { data } = await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/versions/{version}/deprecate', { ...vpath(p.app, p.decision, p.version), body: { sunset_at: p.sunsetAt ?? null } }));
      return { data, message: `v${p.version} deprecated` };
    },
    async disable(c, p) {
      const { data } = await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/versions/{version}/disable', vpath(p.app, p.decision, p.version)));
      return { data, message: `v${p.version} disabled` };
    },
    async enable(c, p) {
      const { data } = await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/versions/{version}/enable', { ...vpath(p.app, p.decision, p.version), body: { force: p.force ?? false } }));
      return { data, message: `v${p.version} re-enabled` };
    },
    async setAlias(c, p) {
      const { data } = await call(rules(c).PUT('/v1/apps/{app}/decisions/{key}/aliases/{alias}', { params: { path: { app: p.app, key: p.decision, alias: p.alias } }, body: { version: p.version } }));
      return { data, message: `${p.alias} → v${p.version}` };
    },
    async deleteAlias(c, p) {
      const { data } = await call(rules(c).DELETE('/v1/apps/{app}/decisions/{key}/aliases/{alias}', { params: { path: { app: p.app, key: p.decision, alias: p.alias } } }));
      return { data, message: `Alias ${p.alias} deleted` };
    },
    async diff(c, p) {
      const { data } = await call(rules(c).GET('/v1/apps/{app}/decisions/{key}/diff', { params: { path: { app: p.app, key: p.decision }, query: { from: p.from, to: p.to } } }));
      return { data, refresh: false };
    },
  }),
);
