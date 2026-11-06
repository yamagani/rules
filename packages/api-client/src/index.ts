/**
 * Typed client for rules-service, generated from its OpenAPI document
 * (`pnpm --filter @rules/api-client generate`). Only the BFF uses it: the browser never
 * talks to rules-service directly.
 */
import createClient, { type Middleware } from 'openapi-fetch';
import type { components, paths } from './schema';

export type { components, paths };
export type Schemas = components['schemas'];

export interface RulesClientOptions {
  baseUrl: string;
  /** Bearer token forwarded from the user's request. */
  token?: string;
  requestId?: string;
  fetch?: typeof fetch;
}

export function createRulesClient({ baseUrl, token, requestId, fetch: fetchImpl }: RulesClientOptions) {
  const client = createClient<paths>({ baseUrl, fetch: fetchImpl });
  const headers: Middleware = {
    onRequest({ request }) {
      if (token) request.headers.set('Authorization', `Bearer ${token}`);
      if (requestId) request.headers.set('X-Request-Id', requestId);
      return request;
    },
  };
  client.use(headers);
  return client;
}

export type RulesClient = ReturnType<typeof createRulesClient>;
