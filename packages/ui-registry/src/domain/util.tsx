import { useCallback, useState } from 'react';
import { ActionError } from '../host';

export function pretty(value: unknown): string {
  return JSON.stringify(value, null, 2);
}

/** JSON with object keys sorted, so documents compare equal regardless of key order
 * (Postgres JSONB does not preserve it). */
export function stableStringify(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableStringify).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>)
      .filter(([, v]) => v !== undefined)
      .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
    return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${stableStringify(v)}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export function parseJson(text: string, label: string): { ok: true; value: unknown } | { ok: false; error: string } {
  if (!text.trim()) return { ok: true, value: undefined };
  try {
    return { ok: true, value: JSON.parse(text) };
  } catch (e) {
    return { ok: false, error: `${label}: ${(e as Error).message}` };
  }
}

export function errorText(e: unknown): string {
  if (e instanceof ActionError) {
    const fields = e.body.fieldErrors as Record<string, string[]> | undefined;
    if (fields) return `${e.message}: ${Object.entries(fields).map(([k, v]) => `${k} ${v.join(', ')}`).join('; ')}`;
    return e.message;
  }
  return e instanceof Error ? e.message : String(e);
}

/** Tracks one async call: running flag, error text, and the last result. */
export function useAsync<T>() {
  const [state, setState] = useState<{ running: boolean; error: string | null; data: T | null; raw: unknown }>({
    running: false,
    error: null,
    data: null,
    raw: null,
  });
  const run = useCallback(async (fn: () => Promise<T>) => {
    setState((s) => ({ ...s, running: true, error: null }));
    try {
      const data = await fn();
      setState({ running: false, error: null, data, raw: null });
      return data;
    } catch (e) {
      setState({ running: false, error: errorText(e), data: null, raw: e instanceof ActionError ? e.body : null });
      return null;
    }
  }, []);
  return { ...state, run };
}

export function Pre({ value, testId }: { value: unknown; testId?: string }) {
  return (
    <pre className="rr-pre" data-testid={testId}>
      {typeof value === 'string' ? value : pretty(value)}
    </pre>
  );
}
