import { createApp } from '../src/app';
import { resetDemoModeCache } from '../src/session';
import { fakeRulesService } from './fakeRulesService';

export type SpecJson = {
  root: string;
  elements: Record<string, { type: string; props: Record<string, unknown>; children: string[]; on?: Record<string, { action: string; params?: Record<string, unknown> }> }>;
};

export function setup() {
  resetDemoModeCache();
  const rs = fakeRulesService();
  const app = createApp({ rulesServiceUrl: 'http://rules.test', defaultApp: 'loan-origination', secureCookies: false, fetch: rs.fetch });
  const as = (user: string) => ({
    get: (path: string) => app.request(path, { headers: { Cookie: `rules_session=token-${user}` } }),
    post: (path: string, body: unknown) =>
      app.request(path, { method: 'POST', headers: { Cookie: `rules_session=token-${user}`, 'Content-Type': 'application/json' }, body: JSON.stringify(body) }),
  });
  return { app, rs, as };
}

export async function spec(res: Response): Promise<SpecJson> {
  if (res.status !== 200) throw new Error(`expected 200, got ${res.status}: ${await res.text()}`);
  return (await res.json()) as SpecJson;
}

export const byTestId = (s: SpecJson, testId: string) => Object.values(s.elements).find((e) => e.props.testId === testId);

/** Every action a spec can trigger: element `on` bindings plus DataTable row actions. */
export function boundActions(s: SpecJson): string[] {
  const out: string[] = [];
  const visit = (b: { action: string; params?: Record<string, unknown> }) =>
    out.push(b.action === 'submit' ? `submit:${String(b.params?.action)}` : b.action);
  for (const e of Object.values(s.elements)) {
    for (const b of Object.values(e.on ?? {})) visit(b);
    if (e.type === 'DataTable') for (const row of e.props.rows as { actions: { on: { action: string; params?: Record<string, unknown> } }[] }[]) for (const a of row.actions) visit(a.on);
  }
  return out;
}
