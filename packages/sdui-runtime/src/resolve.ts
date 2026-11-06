import type { StateStore } from '@json-render/core';

/**
 * Resolve state references anywhere inside an action payload:
 * - `{ "$state": "/path" }` → the value at that path
 * - `{ "$json": "/path" }`  → JSON.parse of the string at that path (for JsonField inputs)
 * - `{ "$number": "/path" }` → Number(...) of the value at that path
 * Throws a readable error for invalid JSON so the user sees which field is wrong.
 */
export function resolveDeep(value: unknown, store: Pick<StateStore, 'get'>): unknown {
  if (Array.isArray(value)) return value.map((v) => resolveDeep(v, store));
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    const keys = Object.keys(obj);
    if (keys.length === 1) {
      if (typeof obj.$state === 'string') return store.get(obj.$state);
      if (typeof obj.$json === 'string') {
        const raw = store.get(obj.$json);
        if (raw === undefined || raw === null || raw === '') return undefined;
        if (typeof raw !== 'string') return raw;
        try {
          return JSON.parse(raw);
        } catch (e) {
          throw new Error(`${obj.$json.split('/').pop()}: invalid JSON (${(e as Error).message})`);
        }
      }
      if (typeof obj.$number === 'string') {
        const raw = store.get(obj.$number);
        return raw === '' || raw === undefined || raw === null ? undefined : Number(raw);
      }
    }
    return Object.fromEntries(Object.entries(obj).map(([k, v]) => [k, resolveDeep(v, store)]));
  }
  return value;
}
