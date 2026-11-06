import { createRulesClient, type RulesClient } from '@rules/api-client';
import type { Context } from 'hono';
import { getCookie } from 'hono/cookie';
import type { BffConfig } from './config';
import { HttpProblem, problem } from './errors';

export const SESSION_COOKIE = 'rules_session';

export type Env = { Variables: { requestId: string; config: BffConfig } };

/** The caller's bearer token: the HttpOnly session cookie, or an Authorization header (OIDC SPAs). */
export function userToken(c: Context<Env>): string | undefined {
  const header = c.req.header('authorization');
  if (header?.toLowerCase().startsWith('bearer ')) return header.slice(7).trim();
  return getCookie(c, SESSION_COOKIE);
}

/** rules-service client that forwards the user's token. The BFF holds no rule state. */
export function rules(c: Context<Env>): RulesClient {
  const config = c.get('config');
  return createRulesClient({
    baseUrl: config.rulesServiceUrl,
    token: userToken(c),
    requestId: c.get('requestId'),
    fetch: config.fetch,
  });
}

export function requireToken(c: Context<Env>): string {
  const token = userToken(c);
  if (!token) throw problem(401, 'Unauthorized', 'Sign in to continue');
  return token;
}

/** Unwrap an openapi-fetch result; upstream problem+json errors pass through with their status. */
export async function call<T>(promise: Promise<{ data?: T; error?: unknown; response: Response }>): Promise<{ data: T; response: Response }> {
  let result: { data?: T; error?: unknown; response: Response };
  try {
    result = await promise;
  } catch (e) {
    throw problem(502, 'Bad Gateway', `rules-service is unreachable: ${(e as Error).message}`);
  }
  if (result.error !== undefined || !result.response.ok) {
    const body = (typeof result.error === 'object' && result.error !== null ? result.error : {}) as Record<string, unknown>;
    const status = result.response.status;
    throw new HttpProblem(status, {
      title: String(body.title ?? result.response.statusText ?? 'Error'),
      status,
      detail: typeof body.detail === 'string' ? body.detail : undefined,
      ...body,
    });
  }
  return { data: result.data as T, response: result.response };
}

export function appParam(c: Context<Env>): string {
  return c.req.query('app') || c.get('config').defaultApp;
}
