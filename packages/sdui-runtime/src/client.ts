import { ActionError, type MfeName } from '@rules/ui-registry/host';

export interface RuntimeConfig {
  /** Prefix for BFF calls. '' means same origin (the shell rewrites /bff/* to the BFF). */
  bffBase: string;
  fetch?: typeof fetch;
}

async function readBody(res: Response): Promise<Record<string, unknown>> {
  const text = await res.text();
  if (!text) return {};
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return { detail: text };
  }
}

export async function fetchScreen(config: RuntimeConfig, mfe: string, screen: string, params: Record<string, string | undefined>) {
  const qs = new URLSearchParams(Object.entries(params).filter((e): e is [string, string] => e[1] !== undefined && e[1] !== ''));
  const url = `${config.bffBase}/bff/${mfe}/screens/${screen}${qs.size ? `?${qs}` : ''}`;
  const res = await (config.fetch ?? fetch)(url, { credentials: 'include', headers: { Accept: 'application/json' } });
  const body = await readBody(res);
  if (!res.ok) throw new ActionError(String(body.detail ?? body.title ?? `HTTP ${res.status}`), res.status, body);
  return body;
}

export async function postAction<T>(config: RuntimeConfig, mfe: MfeName, action: string, payload: Record<string, unknown>): Promise<{
  data: T;
  message?: string;
  refresh?: boolean;
  navigate?: string;
}> {
  const res = await (config.fetch ?? fetch)(`${config.bffBase}/bff/${mfe}/actions/${action}`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
    body: JSON.stringify(payload),
  });
  const body = await readBody(res);
  if (!res.ok) throw new ActionError(String(body.detail ?? body.title ?? `HTTP ${res.status}`), res.status, body);
  return body as { data: T; message?: string; refresh?: boolean; navigate?: string };
}
