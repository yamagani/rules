import { hasPermission } from '@rules/auth';
import type { Session } from '@rules/schemas';
import { login, logout, useBrowserLocation, useSessionLoader, type RemoteAppProps } from '@rules/sdui-runtime';
import { ensureStyles } from '@rules/ui-registry/react';
import { useEffect, useMemo, useState, type ComponentType } from 'react';
import { RemoteBoundary } from './RemoteBoundary';
import { loadManifest, loadRemoteApp, type RemoteDescriptor } from './remotes';

ensureStyles();
const CONFIG = { bffBase: '' };

type LoadState = { status: 'loading' } | { status: 'ready'; Component: ComponentType<RemoteAppProps> } | { status: 'failed'; error: Error };

/** Loads one remote. A load failure is re-thrown during render so RemoteBoundary contains it. */
function RemoteLoader({ remote, attempt, props }: { remote: RemoteDescriptor; attempt: number; props: RemoteAppProps }) {
  const [state, setState] = useState<{ key: string; value: LoadState }>({ key: '', value: { status: 'loading' } });
  const key = `${remote.name}#${attempt}`;
  useEffect(() => {
    let alive = true;
    loadRemoteApp(remote).then(
      (Component) => alive && setState({ key, value: { status: 'ready', Component } }),
      (error: Error) => alive && setState({ key, value: { status: 'failed', error } }),
    );
    return () => {
      alive = false;
    };
  }, [remote, key]);
  const value = state.key === key ? state.value : { status: 'loading' as const };
  if (value.status === 'failed') throw value.error;
  if (value.status === 'loading') return <p className="rr-muted">Loading {remote.label}…</p>;
  const { Component } = value;
  return <Component {...props} />;
}

function RemoteSlot({ remote, props }: { remote: RemoteDescriptor; props: RemoteAppProps }) {
  const [attempt, setAttempt] = useState(0);
  return (
    <RemoteBoundary key={`${remote.name}-${attempt}`} name={remote.label} onRetry={() => setAttempt((a) => a + 1)}>
      <RemoteLoader remote={remote} attempt={attempt} props={props} />
    </RemoteBoundary>
  );
}

function DemoLogin({ session, onDone }: { session: Session; onDone: () => void }) {
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  if (!session.demoMode) {
    return (
      <div className="rr-card">
        <h2 style={{ marginTop: 0 }}>Sign in</h2>
        <p>This deployment uses your organisation's identity provider (OIDC). Sign in there to continue.</p>
      </div>
    );
  }
  return (
    <div className="rr-card" data-testid="demo-login" style={{ maxWidth: 560 }}>
      <h2 style={{ marginTop: 0 }}>Choose a demo user</h2>
      <p className="rr-muted">Demo mode: tokens are minted for seeded users only.</p>
      <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
        {session.demoUsers.map((u) => (
          <button
            key={u.username}
            type="button"
            className="rr-btn"
            style={{ textAlign: 'left', whiteSpace: 'normal' }}
            disabled={busy !== null}
            data-testid={`login-${u.username}`}
            onClick={() => {
              setBusy(u.username);
              login(CONFIG, u.username).then(onDone, (e: Error) => {
                setError(e.message);
                setBusy(null);
              });
            }}
          >
            <strong>{u.username}</strong> · {u.description}
          </button>
        ))}
      </div>
      {error && <p className="rr-danger">{error}</p>}
    </div>
  );
}

export default function App() {
  const [remotes, setRemotes] = useState<RemoteDescriptor[] | null>(null);
  const [manifestError, setManifestError] = useState<string | null>(null);
  const { session, error: sessionError, reload } = useSessionLoader(CONFIG);
  const [location, navigate] = useBrowserLocation();

  useEffect(() => {
    loadManifest().then(setRemotes, (e: Error) => setManifestError(e.message));
  }, []);

  const visible = useMemo(() => remotes?.filter((r) => session && hasPermission(session, session.app, r.permission)) ?? [], [remotes, session]);
  const active = visible.find((r) => location.pathname.startsWith(r.basePath));

  useEffect(() => {
    if (session?.authenticated && visible.length && !active) navigate(visible[0]!.basePath);
  }, [session, visible, active, navigate]);

  return (
    <div className="rr-page" style={{ maxWidth: 1240, margin: '0 auto', padding: '0 16px 32px' }}>
      {session?.demoMode && (
        <div data-testid="demo-banner" role="note" style={{ background: '#fff4d6', color: '#5c4400', padding: '6px 12px', fontSize: 13, borderRadius: '0 0 8px 8px', marginBottom: 8 }}>
          <strong>Demo mode</strong>: demo logins are enabled. Never use this configuration for production data.
        </div>
      )}
      <header style={{ display: 'flex', gap: 16, alignItems: 'center', flexWrap: 'wrap', borderBottom: '1px solid var(--rr-border)', padding: '12px 0', marginBottom: 16 }}>
        <strong style={{ fontSize: 16 }}>Rules Platform</strong>
        <nav style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }} aria-label="Main">
          {visible.map((r) => (
            <a
              key={r.name}
              href={r.basePath}
              className="rr-btn ghost"
              aria-current={active?.name === r.name ? 'page' : undefined}
              style={{ fontWeight: active?.name === r.name ? 700 : 400, textDecoration: 'none' }}
              data-testid={`nav-${r.label.toLowerCase()}`}
              onClick={(e) => {
                e.preventDefault();
                navigate(r.basePath);
              }}
            >
              {r.label}
            </a>
          ))}
        </nav>
        <span style={{ flex: 1 }} />
        {session?.authenticated && (
          <span style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
            <span data-testid="current-user">
              {session.user?.subject}
              {session.user?.roles.length ? <span className="rr-muted"> ({session.user.roles.join(', ')})</span> : null}
            </span>
            <button type="button" className="rr-btn" data-testid="logout" onClick={() => logout(CONFIG).then(reload)}>
              Sign out
            </button>
          </span>
        )}
      </header>
      <main>
        {(manifestError || sessionError) && (
          <div className="rr-error" role="alert">
            {manifestError && <p>Could not load the remote manifest: {manifestError}</p>}
            {sessionError && <p>Could not reach the BFF: {sessionError}</p>}
          </div>
        )}
        {session && !session.authenticated && <DemoLogin session={session} onDone={reload} />}
        {session?.authenticated && active && (
          <RemoteSlot key={active.name} remote={active} props={{ basePath: active.basePath, location, navigate, session }} />
        )}
        {session?.authenticated && remotes && visible.length === 0 && (
          <div className="rr-empty">Your account has no access to {session.app}. Ask an admin for a grant.</div>
        )}
      </main>
    </div>
  );
}
