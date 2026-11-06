import { loadRemote, registerRemotes } from '@module-federation/runtime';
import type { RemoteAppProps } from '@rules/sdui-runtime';
import type { ComponentType } from 'react';

export interface RemoteDescriptor {
  name: string;
  entry: string;
  module: string;
  basePath: string;
  label: string;
  permission: 'view' | 'admin';
}

let manifestPromise: Promise<RemoteDescriptor[]> | undefined;

/** Fetches the runtime manifest once and registers every remote with the MF runtime. */
export function loadManifest(): Promise<RemoteDescriptor[]> {
  manifestPromise ??= fetch('/mfe-manifest.json', { cache: 'no-cache' })
    .then((r) => {
      if (!r.ok) throw new Error(`mfe-manifest.json: HTTP ${r.status}`);
      return r.json() as Promise<{ remotes: RemoteDescriptor[] }>;
    })
    .then(({ remotes }) => {
      registerRemotes(remotes.map((r) => ({ name: r.name, entry: r.entry, type: 'module' })));
      return remotes;
    });
  return manifestPromise;
}

const cache = new Map<string, Promise<ComponentType<RemoteAppProps>>>();

export function loadRemoteApp(remote: RemoteDescriptor): Promise<ComponentType<RemoteAppProps>> {
  const id = `${remote.name}/${remote.module.replace(/^\.\//, '')}`;
  let pending = cache.get(id);
  if (!pending) {
    pending = loadRemote<{ default: ComponentType<RemoteAppProps> }>(id).then((mod) => {
      if (!mod?.default) throw new Error(`Remote ${id} did not export a default component`);
      return mod.default;
    });
    // Do not cache failures: a retry after the remote comes back should work.
    pending.catch(() => cache.delete(id));
    cache.set(id, pending);
  }
  return pending;
}
