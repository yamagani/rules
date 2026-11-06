import type { ScreenSpec as Spec } from '@rules/ui-registry/catalog';
import type { MfeName } from '@rules/schemas';
import { validateScreenSpec, type ComponentName, type ComponentProps } from '@rules/ui-registry/catalog';
import type { Context } from 'hono';
import type { Env } from './context';
import { log } from './log';

type Binding = { action: string; params?: Record<string, unknown> };
interface ElementExtra {
  on?: Record<string, Binding | Binding[]>;
  visible?: unknown;
}

/** Builds a flat json-render spec with typed props and generated element ids. */
export class SpecBuilder {
  private readonly elements: Spec['elements'] = {};
  private counter = 0;
  readonly state: Record<string, unknown> = {};

  el<N extends ComponentName>(type: N, props: ComponentProps<N>, children: (string | null | false | undefined)[] = [], extra: ElementExtra = {}): string {
    const id = `${type.charAt(0).toLowerCase()}${type.slice(1)}-${++this.counter}`;
    this.elements[id] = {
      type,
      props: props as Record<string, unknown>,
      children: children.filter((c): c is string => typeof c === 'string'),
      ...extra,
    } as Spec['elements'][string];
    return id;
  }

  build(root: string): Spec {
    return { root, elements: this.elements, state: this.state };
  }
}

// --- action binding helpers ------------------------------------------------------------
export const nav = (to: string): Binding => ({ action: 'navigate', params: { to } });
export const openModal = (id: string): Binding => ({ action: 'openModal', params: { id } });
export const submit = (
  mfe: MfeName,
  action: string,
  payload: Record<string, unknown>,
  opts: { successMessage?: string; closeModal?: boolean } = {},
): Binding => ({ action: 'submit', params: { mfe, action, payload, ...opts } });

export const state = (path: string) => ({ $state: path });
export const bind = (path: string) => ({ $bindState: path });

/** Validate against the Zod catalog before responding; a bad spec is a server bug (500). */
export function sendSpec(c: Context<Env>, spec: Spec) {
  const result = validateScreenSpec(spec);
  if (!result.ok) {
    log('error', 'invalid_screen_spec', { requestId: c.get('requestId'), path: c.req.path, issues: result.issues });
    return c.json(
      { type: 'https://rules.dev/problems/invalid-spec', title: 'Invalid screen spec', status: 500, issues: result.issues, requestId: c.get('requestId') },
      500,
    );
  }
  return c.json(result.spec);
}
