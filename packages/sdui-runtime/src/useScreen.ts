import type { Spec } from '@json-render/core';
import { validateScreenSpec } from '@rules/ui-registry/catalog';
import { ActionError } from '@rules/ui-registry/host';
import { useCallback, useEffect, useState } from 'react';
import { fetchScreen, type RuntimeConfig } from './client';

export type ScreenState =
  | { status: 'loading'; spec: null; error: null; revision: number }
  | { status: 'ready'; spec: Spec; error: null; revision: number }
  | { status: 'error'; spec: null; error: ScreenError; revision: number };

export interface ScreenError {
  kind: 'http' | 'invalid-spec' | 'network';
  message: string;
  status?: number;
  issues?: { path: string; message: string }[];
}

/** Fetch a screen spec from the BFF and validate it against the same Zod catalog the BFF used. */
export function useScreen(config: RuntimeConfig, mfe: string, screen: string, params: Record<string, string | undefined>) {
  const [state, setState] = useState<ScreenState>({ status: 'loading', spec: null, error: null, revision: 0 });
  const [nonce, setNonce] = useState(0);
  const key = JSON.stringify(params);

  useEffect(() => {
    let alive = true;
    fetchScreen(config, mfe, screen, JSON.parse(key) as Record<string, string | undefined>).then(
      (body) => {
        if (!alive) return;
        const result = validateScreenSpec(body);
        setState((s) =>
          result.ok
            ? { status: 'ready', spec: result.spec, error: null, revision: s.revision + 1 }
            : {
                status: 'error',
                spec: null,
                error: { kind: 'invalid-spec', message: 'The screen description from the server is invalid', issues: result.issues },
                revision: s.revision + 1,
              },
        );
      },
      (e: unknown) => {
        if (!alive) return;
        const error: ScreenError =
          e instanceof ActionError
            ? { kind: 'http', message: e.message, status: e.status, issues: e.body.issues as ScreenError['issues'] }
            : { kind: 'network', message: (e as Error).message };
        setState((s) => ({ status: 'error', spec: null, error, revision: s.revision + 1 }));
      },
    );
    return () => {
      alive = false;
    };
  }, [config, mfe, screen, key, nonce]);

  const refresh = useCallback(() => setNonce((n) => n + 1), []);
  return { ...state, refresh };
}
