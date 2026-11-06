import { createStateStore, type StateStore } from '@json-render/core';
import { JSONUIProvider, Renderer } from '@json-render/react';
import { ActionError, HostProvider, registry, type HostServices, type MfeName } from '@rules/ui-registry/react';
import { useMemo, type ReactNode } from 'react';
import { postAction, type RuntimeConfig } from './client';
import { resolveDeep } from './resolve';
import { ToastStack, useToasts, type Tone } from './Toasts';
import { useScreen, type ScreenError } from './useScreen';

export interface ScreenRendererProps {
  config: RuntimeConfig;
  mfe: MfeName;
  screen: string;
  params?: Record<string, string | undefined>;
  navigate: (to: string) => void;
}

export function ScreenErrorView({ error, onRetry }: { error: ScreenError; onRetry: () => void }): ReactNode {
  const title =
    error.kind === 'invalid-spec'
      ? 'This screen could not be displayed'
      : error.status === 401
        ? 'Please sign in'
        : error.status === 403
          ? 'You do not have access to this screen'
          : 'This screen failed to load';
  return (
    <div className="rr-error" role="alert" data-testid="screen-error">
      <strong>{title}</strong>
      <p style={{ margin: '4px 0' }}>{error.message}</p>
      {error.issues && error.issues.length > 0 && (
        <ul style={{ margin: '4px 0', paddingLeft: 18 }}>
          {error.issues.slice(0, 10).map((i) => (
            <li key={i.path + i.message}>
              <code>{i.path}</code>: {i.message}
            </li>
          ))}
        </ul>
      )}
      <button type="button" className="rr-btn" onClick={onRetry}>
        Retry
      </button>
    </div>
  );
}

/**
 * Fetch → validate → render a BFF screen, and dispatch its actions:
 * navigate, submit (POST to the BFF), refresh, openModal/closeModal, toast.
 */
export function ScreenRenderer({ config, mfe, screen, params = {}, navigate }: ScreenRendererProps) {
  const state = useScreen(config, mfe, screen, params);
  const { toasts, push } = useToasts();
  const { refresh } = state;

  // A fresh store per spec revision: refetching a screen resets its local form state.
  const store: StateStore | null = useMemo(
    () => (state.spec ? createStateStore({ ui: { modal: null }, ...(state.spec.state ?? {}) }) : null),
    [state.spec],
  );

  const services: HostServices = useMemo(
    () => ({
      async callAction<T>(target: MfeName, action: string, payload: Record<string, unknown>) {
        const res = await postAction<T>(config, target, action, payload);
        return res.data;
      },
      navigate,
      refresh,
      toast: (message: string, tone?: Tone) => push(message, tone ?? 'info'),
    }),
    [config, navigate, refresh, push],
  );

  const handlers = useMemo((): Record<string, (p: Record<string, unknown>) => Promise<unknown>> => {
    if (!store) return {};
    return {
      navigate: async (p: Record<string, unknown>) => navigate(String(p.to)),
      refresh: async () => refresh(),
      openModal: async (p: Record<string, unknown>) => store.set('/ui/modal', String(p.id)),
      closeModal: async () => store.set('/ui/modal', null),
      toast: async (p: Record<string, unknown>) => push(String(p.message), (p.tone as Tone) ?? 'info'),
      submit: async (p: Record<string, unknown>) => {
        try {
          const payload = resolveDeep(p.payload ?? {}, store) as Record<string, unknown>;
          const res = await postAction(config, (p.mfe as MfeName) ?? mfe, String(p.action), payload);
          // Prefer the BFF's message (it carries results such as test counts).
          push(String(res.message ?? p.successMessage ?? 'Done'), 'success');
          if (p.closeModal) store.set('/ui/modal', null);
          if (res.navigate) navigate(res.navigate);
          else if (res.refresh !== false) refresh();
        } catch (e) {
          const fields = e instanceof ActionError ? (e.body.fieldErrors as Record<string, string[]> | undefined) : undefined;
          const detail = fields ? ` (${Object.entries(fields).map(([k, v]) => `${k}: ${v.join(', ')}`).join('; ')})` : '';
          push(`${(e as Error).message}${detail}`, 'danger');
        }
      },
    };
  }, [store, config, mfe, navigate, refresh, push]);

  let body: ReactNode;
  if (state.status === 'loading') body = <p className="rr-muted" data-testid="screen-loading">Loading…</p>;
  else if (state.status === 'error') body = <ScreenErrorView error={state.error} onRetry={refresh} />;
  else
    body = (
      <JSONUIProvider key={state.revision} registry={registry} store={store ?? undefined} handlers={handlers} navigate={navigate}>
        <Renderer spec={state.spec} registry={registry} />
      </JSONUIProvider>
    );

  return (
    <HostProvider services={services}>
      {body}
      <ToastStack toasts={toasts} />
    </HostProvider>
  );
}
