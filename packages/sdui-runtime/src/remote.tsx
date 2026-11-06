/**
 * Contract between the shell and its remotes, plus a standalone host so each remote can run
 * on its own during development.
 */
import { anonymousSession } from '@rules/auth';
import { SessionProvider } from '@rules/auth/react';
import { Session as SessionSchema, type Session } from '@rules/schemas';
import type { MfeName } from '@rules/ui-registry/host';
import { useCallback, useEffect, useMemo, useState, type ComponentType, type ReactNode } from 'react';
import type { RuntimeConfig } from './client';
import { ScreenRenderer } from './ScreenRenderer';

export interface RemoteLocation {
  pathname: string;
  search: string;
}

/** Props the shell passes to every remote's root component. */
export interface RemoteAppProps {
  basePath: string;
  location: RemoteLocation;
  navigate: (to: string) => void;
  session: Session;
  config?: RuntimeConfig;
}

export interface ScreenRoute {
  screen: string;
  params: Record<string, string | undefined>;
}

/** Sub-path segments under the remote's base path, e.g. "/rules/eligibility" → ["eligibility"]. */
export function subpath(basePath: string, location: RemoteLocation): string[] {
  const rest = location.pathname.startsWith(basePath) ? location.pathname.slice(basePath.length) : '';
  return rest.split('/').filter(Boolean).map(decodeURIComponent);
}

export function query(location: RemoteLocation): Record<string, string> {
  return Object.fromEntries(new URLSearchParams(location.search));
}

const DEFAULT_CONFIG: RuntimeConfig = { bffBase: '' };

/** Renders one BFF screen for a remote, inside the session the shell provides. */
export function RemoteFrame({ mfe, route, props }: { mfe: MfeName; route: ScreenRoute; props: RemoteAppProps }) {
  const params = useMemo(() => ({ app: props.session.app, ...route.params }), [props.session.app, route.params]);
  return (
    <SessionProvider session={props.session}>
      <ScreenRenderer key={`${route.screen}:${JSON.stringify(params)}`} config={props.config ?? DEFAULT_CONFIG} mfe={mfe} screen={route.screen} params={params} navigate={props.navigate} />
    </SessionProvider>
  );
}

async function fetchSession(config: RuntimeConfig): Promise<Session> {
  const res = await (config.fetch ?? fetch)(`${config.bffBase}/bff/session`, { credentials: 'include' });
  if (!res.ok) throw new Error(`session: HTTP ${res.status}`);
  return SessionSchema.parse(await res.json());
}

export async function login(config: RuntimeConfig, username: string): Promise<void> {
  const res = await (config.fetch ?? fetch)(`${config.bffBase}/bff/session/login`, {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username }),
  });
  if (!res.ok) throw new Error(`login failed: HTTP ${res.status}`);
}

export async function logout(config: RuntimeConfig): Promise<void> {
  await (config.fetch ?? fetch)(`${config.bffBase}/bff/session/logout`, { method: 'POST', credentials: 'include' });
}

export function useSessionLoader(config: RuntimeConfig) {
  const [session, setSession] = useState<Session | null>(null);
  const [error, setError] = useState<string | null>(null);
  const reload = useCallback(() => {
    fetchSession(config).then(setSession, (e: Error) => setError(e.message));
  }, [config]);
  useEffect(reload, [reload]);
  return { session, error, reload };
}

export function useBrowserLocation(): [RemoteLocation, (to: string) => void] {
  const read = () => ({ pathname: window.location.pathname, search: window.location.search });
  const [location, setLocation] = useState<RemoteLocation>(read);
  useEffect(() => {
    const onPop = () => setLocation(read());
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = useCallback((to: string) => {
    window.history.pushState({}, '', to);
    setLocation(read());
    window.scrollTo?.(0, 0);
  }, []);
  return [location, navigate];
}

/**
 * Runs a remote without the shell: loads the session from the BFF and, when demo login is
 * available and nobody is signed in, signs in as a mock user (VITE_MOCK_USER, default bob).
 */
export function StandaloneHost({ App, basePath, mockUser, config = DEFAULT_CONFIG }: { App: ComponentType<RemoteAppProps>; basePath: string; mockUser: string; config?: RuntimeConfig }) {
  const { session, error, reload } = useSessionLoader(config);
  const [location, navigate] = useBrowserLocation();
  const [loginError, setLoginError] = useState<string | null>(null);

  useEffect(() => {
    if (session && !session.authenticated && session.demoMode) {
      login(config, mockUser).then(reload, (e: Error) => setLoginError(e.message));
    }
  }, [session, config, mockUser, reload]);

  useEffect(() => {
    if (!location.pathname.startsWith(basePath)) navigate(basePath);
  }, [location.pathname, basePath, navigate]);

  let body: ReactNode;
  if (error || loginError) body = <div className="rr-error">Standalone mode needs the BFF at /bff (pnpm dev): {error ?? loginError}</div>;
  else if (!session?.authenticated) body = <p className="rr-muted">Signing in as {mockUser}…</p>;
  else body = <App basePath={basePath} location={location} navigate={navigate} session={session} config={config} />;

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <div style={{ fontSize: 12, padding: '4px 8px', marginBottom: 12, borderRadius: 6, background: '#fff4d6', color: '#5c4400' }} data-testid="standalone-banner">
        Standalone remote · mock session: {session?.user?.subject ?? mockUser}
      </div>
      {body}
    </div>
  );
}

export { anonymousSession };
