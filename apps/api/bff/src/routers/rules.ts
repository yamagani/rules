import type { Schemas } from '@rules/api-client';
import { Hono } from 'hono';
import { actionRouter } from '../actions';
import { call, rules, type Env } from '../context';
import { problem } from '../errors';
import { shortDate, statusBadge } from '../format';
import { perms } from '../session';
import { bind, nav, openModal, sendSpec, SpecBuilder, state, submit } from '../spec';

export const rulesRouter = new Hono<Env>();

const path = (app: string, decision: string) => ({ params: { path: { app, key: decision } } });

// --- screens -----------------------------------------------------------------------------
rulesRouter.get('/screens/list', async (c) => {
  const p = await perms(c);
  const { data: decisions } = await call(rules(c).GET('/v1/apps/{app}/decisions', { params: { path: { app: p.app } } }));
  const s = new SpecBuilder();
  s.state.create = { key: '', name: '', description: '' };

  const table = s.el('DataTable', {
    testId: 'decisions-table',
    columns: [
      { key: 'key', label: 'Decision', kind: 'code' },
      { key: 'name', label: 'Name' },
      { key: 'default', label: 'Default' },
      { key: 'active', label: 'Active versions', kind: 'tags' },
      { key: 'drafts', label: 'Drafts' },
    ],
    rows: decisions.map((d) => ({
      id: d.key,
      href: `/rules/${d.key}`,
      cells: {
        key: d.key,
        name: d.name,
        default: d.default_version ? `v${d.default_version}` : null,
        active: (d.active_versions ?? []).map((v) => `v${v}`),
        drafts: d.draft_count ?? 0,
      },
      actions: [
        { label: 'Open', variant: 'primary', on: nav(`/rules/${d.key}`) },
        { label: 'Releases', variant: 'secondary', on: nav(`/releases/${d.key}`) },
      ],
    })),
    emptyText: 'No decisions yet',
  });

  const children = [table];
  if (p.can('edit')) {
    const form = s.el('Form', { id: 'create-decision' }, [
      s.el('TextField', { label: 'Key', value: bind('/create/key'), placeholder: 'fraud-flag', required: true, testId: 'create-key' }),
      s.el('TextField', { label: 'Name', value: bind('/create/name'), placeholder: 'Fraud flag', required: true, testId: 'create-name' }),
      s.el('TextField', { label: 'Description', value: bind('/create/description'), multiline: true }),
      s.el('Button', { label: 'Create decision', variant: 'primary', testId: 'create-submit' }, [], {
        on: {
          press: submit('rules', 'createDecision', { app: p.app, key: state('/create/key'), name: state('/create/name'), description: state('/create/description') }, { closeModal: true }),
        },
      }),
    ]);
    const toolbar = s.el('Toolbar', { align: 'end' }, [
      s.el('Button', { label: 'New decision', variant: 'primary', testId: 'new-decision' }, [], { on: { press: openModal('create-decision') } }),
    ]);
    children.unshift(toolbar);
    children.push(s.el('Modal', { id: 'create-decision', title: 'New decision' }, [form]));
  }
  const root = s.el('Page', { title: 'Rules', subtitle: `Decisions in ${p.app}` }, [s.el('Card', {}, children)]);
  return sendSpec(c, s.build(root));
});

function testTargets(detail: Schemas['DecisionDetail'], canEdit: boolean) {
  const targets: { value: string; label: string }[] = [];
  if (canEdit && detail.latest_draft) targets.push({ value: 'draft', label: `Latest draft (v${detail.latest_draft.version})` });
  if (detail.default_version) targets.push({ value: 'default', label: `default alias (v${detail.default_version})` });
  for (const a of detail.aliases) if (a.alias !== 'default') targets.push({ value: `alias:${a.alias}`, label: `${a.alias} alias (v${a.version})` });
  for (const v of detail.versions) {
    if (v.status === 'active' || v.status === 'deprecated' || (canEdit && v.status === 'draft')) {
      targets.push({ value: `version:${v.version}`, label: `v${v.version} (${v.status})` });
    }
  }
  return targets.length ? targets : [{ value: 'draft', label: 'Latest draft' }];
}

rulesRouter.get('/screens/decision', async (c) => {
  const p = await perms(c);
  const key = c.req.query('decision');
  if (!key) throw problem(400, 'Bad Request', 'decision is required');
  const client = rules(c);
  const { data: detail } = await call(client.GET('/v1/apps/{app}/decisions/{key}', path(p.app, key)));
  const canEdit = p.can('edit');
  const canPublish = p.can('publish');
  const requested = Number(c.req.query('version')) || null;
  const openVersion = requested ?? detail.latest_draft?.version ?? detail.default_version ?? detail.latest_version ?? null;
  const opened = detail.versions.find((v) => v.version === openVersion);

  const s = new SpecBuilder();
  const summary = s.el('KeyValue', {
    items: [
      { label: 'Default version', value: detail.default_version ? `v${detail.default_version}` : 'none yet' },
      { label: 'Aliases', value: detail.aliases.map((a) => `${a.alias} → v${a.version}`).join(', ') || 'none' },
      { label: 'Latest draft', value: detail.latest_draft ? `v${detail.latest_draft.version} by ${detail.latest_draft.author}` : 'none' },
      { label: 'Description', value: detail.description ?? null },
    ],
  });

  const versionRows = detail.versions.map((v) => ({
    id: v.version,
    cells: { version: `v${v.version}`, status: statusBadge(v.status), aliases: v.aliases, author: v.author, comment: v.comment ?? null, created: shortDate(v.created_at) },
    actions: [{ label: v.version === openVersion ? 'Open (current)' : 'Open in editor', variant: 'ghost' as const, on: nav(`/rules/${key}?version=${v.version}`) }],
  }));

  // Editor tab: any version can be the starting point; saving always creates a new draft.
  const editorTab = s.el('Stack', { gap: 'md' }, [
    opened && opened.status !== 'draft' && canEdit
      ? s.el('Text', { text: `v${opened.version} is ${opened.status}. Edits are saved as a new draft; the published version never changes.`, tone: 'muted' })
      : null,
    s.el('JdmEditor', { app: p.app, decisionRef: key, versionId: openVersion, readOnly: !canEdit, canSave: canEdit }),
    s.el('DataTable', {
      testId: 'editor-versions',
      columns: [
        { key: 'version', label: 'Version' },
        { key: 'status', label: 'Status', kind: 'badge' },
        { key: 'aliases', label: 'Aliases', kind: 'tags' },
        { key: 'author', label: 'Author' },
        { key: 'comment', label: 'Comment' },
        { key: 'created', label: 'Created' },
      ],
      rows: versionRows,
      emptyText: 'No versions yet: build a graph and save it, or generate one with AI',
    }),
  ]);

  const { data: cases } = await call(client.GET('/v1/apps/{app}/decisions/{key}/tests', path(p.app, key)));
  const sampleInput = (cases[0]?.input as Record<string, unknown> | undefined) ?? {};
  const testTab = s.el('TestPanel', {
    app: p.app,
    decision: key,
    targets: testTargets(detail, canEdit),
    defaultTarget: canEdit && detail.latest_draft ? 'draft' : 'default',
    sampleInput,
    canRunStoredTests: canEdit,
  });

  // Publishing lives in the Releases MFE; the shortcut is only in the spec for publishers.
  const publishCard =
    canPublish && detail.latest_draft
      ? s.el('Card', { title: 'Publish', subtitle: 'Runs the stored tests first' }, [
          s.el('Toolbar', {}, [
            s.el('Button', { label: `Activate draft v${detail.latest_draft.version}`, variant: 'primary', testId: 'activate-draft' }, [], {
              on: { press: submit('releases', 'activate', { app: p.app, decision: key, version: detail.latest_draft.version }, { successMessage: `v${detail.latest_draft.version} activated` }) },
            }),
            s.el('Button', { label: 'Open releases', variant: 'ghost' }, [], { on: { press: nav(`/releases/${key}`) } }),
          ]),
        ])
      : null;

  const tabs: { id: string; label: string }[] = [
    { id: 'editor', label: canEdit ? 'Editor' : 'Graph' },
    { id: 'test', label: 'Test' },
  ];
  const panes = [editorTab, testTab];

  if (canEdit) {
    const { data: settings } = await call(client.GET('/v1/apps/{app}/ai/settings', { params: { path: { app: p.app } } }));
    const providers = [settings.provider, settings.fallback_provider].filter((x): x is Schemas['ProviderOut'] => !!x && x.enabled);
    tabs.push({ id: 'ai', label: 'Generate with AI' });
    panes.push(
      s.el('AiGeneratePanel', {
        app: p.app,
        decision: key,
        enabled: settings.enabled && providers.length > 0,
        disabledReason: settings.enabled ? undefined : 'An admin must enable an AI provider for this application (Admin → AI providers).',
        providers: providers.map((x) => ({ id: x.id, name: x.name, model: x.model })),
        baseVersions: detail.versions.map((v) => v.version),
      }),
    );
  }

  s.state.test = { name: '', input: '{\n  \n}', expected: '{\n  \n}' };
  tabs.push({ id: 'cases', label: `Stored tests (${cases.length})` });
  panes.push(
    s.el('Stack', { gap: 'md' }, [
      s.el('DataTable', {
        testId: 'test-cases',
        columns: [
          { key: 'name', label: 'Name' },
          { key: 'input', label: 'Input', kind: 'code' },
          { key: 'expected', label: 'Expected', kind: 'code' },
        ],
        rows: cases.map((t) => ({ id: t.id, cells: { name: t.name, input: JSON.stringify(t.input), expected: JSON.stringify(t.expected) }, actions: [] })),
        emptyText: 'No stored test cases. Activation runs these, so add a few.',
      }),
      canEdit
        ? s.el('Form', { id: 'add-test', title: 'Add test case' }, [
            s.el('TextField', { label: 'Name', value: bind('/test/name') }),
            s.el('Grid', { columns: 2 }, [
              s.el('JsonField', { label: 'Input', value: bind('/test/input'), rows: 5 }),
              s.el('JsonField', { label: 'Expected (subset of the output)', value: bind('/test/expected'), rows: 5 }),
            ]),
            s.el('Button', { label: 'Add test case', variant: 'primary' }, [], {
              on: { press: submit('rules', 'addTestCase', { app: p.app, decision: key, name: state('/test/name'), input: { $json: '/test/input' }, expected: { $json: '/test/expected' } }) },
            }),
          ])
        : null,
    ]),
  );

  const root = s.el(
    'Page',
    { title: detail.name, subtitle: detail.description ?? undefined, breadcrumbs: [{ label: 'Rules', href: '/rules' }, { label: key }] },
    [s.el('Card', {}, [summary]), publishCard, s.el('Tabs', { tabs, defaultTab: c.req.query('tab') ?? 'editor' }, panes)],
  );
  return sendSpec(c, s.build(root));
});

// --- actions -----------------------------------------------------------------------------
rulesRouter.route(
  '/',
  actionRouter('rules', {
    async createDecision(c, p) {
      await call(rules(c).POST('/v1/apps/{app}/decisions', { params: { path: { app: p.app } }, body: { key: p.key, name: p.name, description: p.description } }));
      return { message: `Decision ${p.key} created`, navigate: `/rules/${p.key}` };
    },
    async loadVersion(c, p) {
      const client = rules(c);
      let version = p.version;
      if (!version) {
        const { data: detail } = await call(client.GET('/v1/apps/{app}/decisions/{key}', path(p.app, p.decision)));
        version = detail.latest_draft?.version ?? detail.default_version ?? detail.latest_version ?? undefined;
      }
      if (!version) return { data: { version: null, status: null, content: { nodes: [], edges: [] } } };
      const { data } = await call(client.GET('/v1/apps/{app}/decisions/{key}/versions/{version}', { params: { path: { app: p.app, key: p.decision, version } } }));
      return { data: { version: data.version, status: data.status, content: data.content } };
    },
    async saveVersion(c, p) {
      const { data } = await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/versions', { ...path(p.app, p.decision), body: { content: p.content, comment: p.comment } }));
      return { data: { version: data.version }, message: `Saved draft v${data.version}` };
    },
    async evaluate(c, p) {
      const { data, response } = await call(
        rules(c).POST('/v1/apps/{app}/decisions/{key}/evaluate', {
          params: { path: { app: p.app, key: p.decision }, query: { version: p.version, alias: p.alias, draft: p.draft, trace: p.trace } },
          body: p.context,
        }),
      );
      return { data: { ...data, headers: { deprecation: response.headers.get('deprecation'), sunset: response.headers.get('sunset'), version: response.headers.get('x-rule-version') } } };
    },
    async runTests(c, p) {
      const { data } = await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/versions/{version}/run-tests', { params: { path: { app: p.app, key: p.decision, version: p.version } } }));
      return { data };
    },
    async addTestCase(c, p) {
      await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/tests', { ...path(p.app, p.decision), body: { name: p.name, input: p.input, expected: p.expected } }));
      return { message: `Test case "${p.name}" added` };
    },
    async generate(c, p) {
      const { data } = await call(
        rules(c).POST('/v1/apps/{app}/decisions/{key}/generate', {
          ...path(p.app, p.decision),
          body: {
            prompt: p.prompt,
            input_schema: p.inputSchema ?? null,
            examples: p.examples ?? [],
            context_text: p.contextText ?? null,
            base_version: p.baseVersion ?? null,
            provider_id: p.providerId ?? null,
          },
        }),
      );
      return { data, refresh: false };
    },
    async explain(c, p) {
      const { data } = await call(rules(c).POST('/v1/apps/{app}/decisions/{key}/versions/{version}/explain', { params: { path: { app: p.app, key: p.decision, version: p.version } } }));
      return { data };
    },
  }),
);
