/**
 * The json-render catalog: every component the BFF may put in a screen spec, with Zod prop
 * schemas. Safe to import on the server (no React). The BFF validates every spec against
 * `catalog` before responding, and the browser validates again before rendering.
 */
import { defineCatalog, type Spec } from '@json-render/core';
import { schema } from '@json-render/react/schema';
import { z } from 'zod';
import { bindable } from './bindable';
import { domainSchemas } from './domain/schemas';

const Gap = z.enum(['none', 'sm', 'md', 'lg']);
const Tone = z.enum(['neutral', 'info', 'success', 'warning', 'danger']);
const Scalar = z.union([z.string(), z.number(), z.boolean(), z.null()]);
const Binding = z.object({ action: z.string(), params: z.record(z.string(), z.unknown()).optional() });

export const genericSchemas = {
  // --- layout -------------------------------------------------------------------------
  Page: {
    props: z.object({
      title: z.string(),
      subtitle: z.string().optional(),
      breadcrumbs: z.array(z.object({ label: z.string(), href: z.string().optional() })).default([]),
    }),
    description: 'Top-level screen with a title',
  },
  Stack: {
    props: z.object({
      direction: z.enum(['vertical', 'horizontal']).default('vertical'),
      gap: Gap.default('md'),
      align: z.enum(['start', 'center', 'end', 'stretch']).optional(),
      wrap: z.boolean().optional(),
    }),
    description: 'Lays out children in a row or column',
  },
  Grid: {
    props: z.object({ columns: z.number().int().min(1).max(4), gap: Gap.default('md') }),
    description: 'Responsive grid; collapses to one column on narrow screens',
  },
  Card: {
    props: z.object({ title: z.string().optional(), subtitle: z.string().optional() }),
    description: 'Bordered container',
  },
  Tabs: {
    props: z.object({
      tabs: z.array(z.object({ id: z.string(), label: z.string() })).min(1),
      defaultTab: z.string().optional(),
    }),
    description: 'Tabbed container; child N is the content of tab N',
  },
  Toolbar: {
    props: z.object({ align: z.enum(['start', 'end', 'between']).default('start') }),
    description: 'Horizontal row of actions',
  },
  Modal: {
    props: z.object({ id: z.string(), title: z.string() }),
    description: 'Dialog shown while state /ui/modal equals its id (opened by the openModal action)',
  },
  // --- data -----------------------------------------------------------------------------
  DataTable: {
    props: z.object({
      columns: z
        .array(z.object({ key: z.string(), label: z.string(), kind: z.enum(['text', 'code', 'badge', 'date', 'tags']).default('text') }))
        .min(1),
      rows: z.array(
        z
          .object({
            id: z.union([z.string(), z.number()]),
            cells: z.record(z.string(), z.union([Scalar, z.array(z.string()), z.object({ label: z.string(), tone: Tone })])),
            /** Actions offered on this row; the BFF only includes the ones the user may take. */
            actions: z
              .array(z.object({ label: z.string(), variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).default('secondary'), on: Binding }))
              .default([]),
            href: z.string().optional(),
          })
          .strict(),
      ),
      emptyText: z.string().default('Nothing here yet'),
      testId: z.string().optional(),
    }),
    description: 'Table with per-row actions',
  },
  KeyValue: {
    props: z.object({ items: z.array(z.object({ label: z.string(), value: Scalar, mono: z.boolean().optional() })) }),
    description: 'Label/value list',
  },
  Badge: {
    props: z.object({ label: z.string(), tone: Tone.default('neutral') }),
    description: 'Small status pill',
  },
  EmptyState: {
    props: z.object({ title: z.string(), description: z.string().optional() }),
    description: 'Placeholder for empty content',
  },
  Text: {
    props: z.object({ text: z.string(), tone: z.enum(['default', 'muted', 'danger']).default('default') }),
    description: 'A paragraph of text',
  },
  // --- forms ------------------------------------------------------------------------------
  Form: {
    props: z.object({ id: z.string(), title: z.string().optional() }),
    description: 'Groups fields; submit with a Button bound to the submit action',
  },
  TextField: {
    props: z.object({
      label: z.string(),
      value: bindable(z.string()),
      placeholder: z.string().optional(),
      multiline: z.boolean().optional(),
      required: z.boolean().optional(),
      type: z.enum(['text', 'number', 'datetime-local', 'date']).default('text'),
      testId: z.string().optional(),
    }),
    description: 'Text input bound to state with $bindState',
  },
  Select: {
    props: z.object({
      label: z.string(),
      value: bindable(z.string()),
      options: z.array(z.object({ value: z.string(), label: z.string() })),
      testId: z.string().optional(),
    }),
    description: 'Dropdown bound to state',
  },
  JsonField: {
    props: z.object({ label: z.string(), value: bindable(z.string()), rows: z.number().int().min(2).max(40).default(8) }),
    description: 'JSON text area; validates JSON as you type',
  },
  Button: {
    props: z.object({
      label: z.string(),
      variant: z.enum(['primary', 'secondary', 'danger', 'ghost']).default('secondary'),
      disabled: z.boolean().optional(),
      testId: z.string().optional(),
    }),
    description: 'Button; bind an action with the element-level `on: { press: { action, params } }`',
  },
  // --- guard ---------------------------------------------------------------------------
  Can: {
    props: z.object({
      permission: z.enum(['view', 'edit', 'publish', 'evaluate', 'admin']),
      app: z.string().optional(),
    }),
    description: 'Renders children only when the session has the permission (UI shaping, not security)',
  },
} as const;

export const actionSchemas = {
  navigate: { params: z.object({ to: z.string() }), description: 'Navigate within the shell' },
  submit: {
    params: z.object({
      mfe: z.enum(['rules', 'releases', 'admin']).optional(),
      action: z.string(),
      payload: z.record(z.string(), z.unknown()).default({}),
      successMessage: z.string().optional(),
      closeModal: z.boolean().optional(),
    }),
    description: 'POST /bff/<mfe>/actions/<action> with the payload, then refresh the screen',
  },
  refresh: { params: z.object({}), description: 'Refetch the current screen spec' },
  openModal: { params: z.object({ id: z.string() }), description: 'Open the Modal with this id' },
  closeModal: { params: z.object({}), description: 'Close the open Modal' },
  toast: {
    params: z.object({ message: z.string(), tone: Tone.default('info') }),
    description: 'Show a transient message',
  },
} as const;

/** Actions json-render's React schema handles itself. */
const BUILT_IN_ACTIONS = new Set(['setState', 'pushState', 'removeState', 'validateForm']);

export const componentSchemas = { ...genericSchemas, ...domainSchemas };
export type ComponentName = keyof typeof componentSchemas;
export const componentNames = Object.keys(componentSchemas) as ComponentName[];

export const catalog = defineCatalog(schema, { components: componentSchemas, actions: actionSchemas });

export type ScreenSpec = Spec;
export type ComponentProps<N extends ComponentName> = z.input<(typeof componentSchemas)[N]['props']>;

export interface SpecIssue {
  path: string;
  message: string;
}

/**
 * Validate a screen spec: structure (via the catalog's Zod schema) plus every element's
 * props against its component schema. Used by the BFF before responding and by the runtime
 * before rendering.
 */
export function validateScreenSpec(spec: unknown): { ok: true; spec: Spec } | { ok: false; issues: SpecIssue[] } {
  const issues: SpecIssue[] = [];
  const structural = catalog.validate(spec);
  if (!structural.success) {
    const err = (structural as { error?: z.ZodError }).error;
    for (const issue of err?.issues ?? [{ path: [], message: 'invalid spec' }]) {
      issues.push({ path: issue.path.join('.'), message: issue.message });
    }
    return { ok: false, issues };
  }
  const s = spec as Spec;
  // The returned spec carries Zod-parsed props (defaults applied), so components always
  // receive normalized props. Event bindings (`on`), visibility and state pass through.
  const normalized: Spec = { ...s, elements: {} };
  if (!s.elements[s.root]) issues.push({ path: 'root', message: `root element '${s.root}' is not defined` });
  for (const [id, element] of Object.entries(s.elements)) {
    normalized.elements[id] = element;
    const def = componentSchemas[element.type as ComponentName];
    if (!def) {
      issues.push({ path: `elements.${id}.type`, message: `unknown component '${element.type}'` });
      continue;
    }
    const res = def.props.safeParse(element.props ?? {});
    if (res.success) normalized.elements[id] = { ...element, props: res.data as Record<string, unknown> };
    else {
      for (const issue of res.error.issues) {
        issues.push({ path: `elements.${id}.props.${issue.path.join('.')}`, message: issue.message });
      }
    }
    const events = (element as { on?: Record<string, unknown> }).on ?? {};
    for (const [event, value] of Object.entries(events)) {
      for (const binding of Array.isArray(value) ? value : [value]) {
        const name = (binding as { action?: string })?.action;
        if (!name || !(name in actionSchemas || BUILT_IN_ACTIONS.has(name))) {
          issues.push({ path: `elements.${id}.on.${event}`, message: `unknown action '${String(name)}'` });
        }
      }
    }
    for (const child of element.children ?? []) {
      if (!s.elements[child]) issues.push({ path: `elements.${id}.children`, message: `child '${child}' is not defined` });
    }
  }
  return issues.length ? { ok: false, issues } : { ok: true, spec: normalized };
}
