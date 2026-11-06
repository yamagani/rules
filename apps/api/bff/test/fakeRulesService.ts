/**
 * In-process stand-in for rules-service, answering from fixtures captured from a seeded
 * instance (test/capture-fixtures.sh). Tokens look like "token-<user>".
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = join(import.meta.dirname, 'fixtures');
const fixture = (name: string) => JSON.parse(readFileSync(join(dir, `${name}.json`), 'utf8')) as unknown;

export interface Recorded {
  method: string;
  path: string;
  authorization: string | null;
  requestId: string | null;
  body: unknown;
}

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

export function fakeRulesService() {
  const calls: Recorded[] = [];
  const handler = async (input: Request | string | URL, init?: RequestInit): Promise<Response> => {
    const req = input instanceof Request ? input : new Request(input, init);
    const url = new URL(req.url);
    const path = url.pathname;
    const auth = req.headers.get('authorization');
    const user = auth?.replace('Bearer token-', '') ?? null;
    const text = req.method === 'GET' ? '' : await req.text();
    calls.push({ method: req.method, path, authorization: auth, requestId: req.headers.get('x-request-id'), body: text ? JSON.parse(text) : null });

    if (path === '/health') return json(fixture('health'));
    if (path === '/v1/dev/users') return json(fixture('dev-users'));
    if (path === '/v1/dev/token') {
      const { username } = JSON.parse(text) as { username: string };
      return json({ access_token: `token-${username}`, token_type: 'Bearer', user: { username } });
    }
    if (!user) return json({ title: 'Unauthorized', status: 401 }, 401);
    if (path === '/v1/me') return json(fixture(`me.${user}`));
    const app = '/v1/apps/loan-origination';
    if (req.method === 'GET') {
      if (path === `${app}/decisions`) return json(fixture('decisions'));
      const m = path.match(/^\/v1\/apps\/loan-origination\/decisions\/([a-z-]+)(\/usage|\/tests)?$/);
      if (m) return json(fixture(`${m[2] ? m[2].slice(1) : 'decision'}.${m[1]}`));
      if (path === `${app}/audit`) return json(fixture('audit'));
      if (path === `${app}/grants`) return json(fixture('grants'));
      if (path === `${app}/ai/settings`) return json(fixture('ai-settings'));
      if (path === `${app}/ai/usage`) return json(fixture('ai-usage'));
      if (path === '/v1/ai/providers') return json(fixture('providers'));
    }
    // Mutations: echo a minimal success body.
    return json({ version: { version: 5 }, tests: { passed: 3, total: 3, failed: 0, results: [] }, aliases: [] });
  };
  return { fetch: handler as typeof fetch, calls };
}
