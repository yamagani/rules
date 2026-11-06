import { useEffect, useState, type ComponentType } from 'react';
import { loadManifest, loadRemoteApp, type RemoteAppProps, type RemoteDescriptor } from './remotes';
import { RemoteBoundary } from './RemoteBoundary';

function usePath(): [string, (p: string) => void] {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onPop = () => setPath(window.location.pathname);
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  const navigate = (p: string) => {
    window.history.pushState({}, '', p);
    setPath(p);
  };
  return [path, navigate];
}

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; Component: ComponentType<RemoteAppProps> }
  | { status: 'failed'; error: Error };

/** Loads one remote. A load failure is re-thrown during render so RemoteBoundary contains it. */
function RemoteLoader({ remote }: { remote: RemoteDescriptor }) {
  const [state, setState] = useState<LoadState>({ status: 'loading' });
  useEffect(() => {
    let alive = true;
    loadRemoteApp(remote).then(
      (mod) => alive && setState({ status: 'ready', Component: mod.default }),
      (error: Error) => alive && setState({ status: 'failed', error }),
    );
    return () => {
      alive = false;
    };
  }, [remote]);
  if (state.status === 'failed') throw state.error;
  if (state.status === 'loading') return <p>Loading {remote.label}…</p>;
  const { Component } = state;
  return <Component basePath={remote.basePath} />;
}

function RemoteSlot({ remote }: { remote: RemoteDescriptor }) {
  return (
    <RemoteBoundary name={remote.label}>
      <RemoteLoader remote={remote} />
    </RemoteBoundary>
  );
}

export default function App() {
  const [remotes, setRemotes] = useState<RemoteDescriptor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [path, navigate] = usePath();

  useEffect(() => {
    loadManifest().then(setRemotes, (e: Error) => setError(e.message));
  }, []);

  const active = remotes?.find((r) => path.startsWith(r.basePath)) ?? remotes?.[0];

  return (
    <div style={{ fontFamily: 'system-ui, sans-serif', maxWidth: 1200, margin: '0 auto', padding: 16 }}>
      <header style={{ display: 'flex', gap: 16, alignItems: 'center', borderBottom: '1px solid #ddd', paddingBottom: 8 }}>
        <strong>Rules Platform</strong>
        <nav style={{ display: 'flex', gap: 12 }}>
          {remotes?.map((r) => (
            <a key={r.name} href={r.basePath} onClick={(e) => { e.preventDefault(); navigate(r.basePath); }}>
              {r.label}
            </a>
          ))}
        </nav>
      </header>
      <main style={{ paddingTop: 16 }}>
        {error && <p role="alert">Could not load the remote manifest: {error}</p>}
        {active && <RemoteSlot key={active.name} remote={active} />}
      </main>
    </div>
  );
}
