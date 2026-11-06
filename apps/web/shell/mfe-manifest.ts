import type { Plugin } from 'vite';

/**
 * Runtime remote manifest. Remote URLs are never hardcoded in the bundle: the shell fetches
 * /mfe-manifest.json at startup. The file is generated from VITE_REMOTE_*_URL at build time
 * (and served from memory in dev), so a deployment can point at preview or production remotes.
 */
export interface MfeManifestEntry {
  name: string;
  entry: string;
  module: string;
  basePath: string;
  label: string;
  /** Permission needed to see the nav entry (shaping only; rules-service enforces). */
  permission: 'view' | 'admin';
}

const DEFAULTS = {
  rules: 'http://localhost:5174',
  releases: 'http://localhost:5175',
  admin: 'http://localhost:5176',
};

function url(envValue: string | undefined, fallback: string): string {
  const base = (envValue && envValue.trim()) || fallback;
  return `${base.replace(/\/$/, '')}/remoteEntry.js`;
}

export function buildManifest(env: Record<string, string | undefined>): { remotes: MfeManifestEntry[] } {
  return {
    remotes: [
      { name: 'mfe_rules', entry: url(env.VITE_REMOTE_RULES_URL, DEFAULTS.rules), module: './RulesApp', basePath: '/rules', label: 'Rules', permission: 'view' },
      { name: 'mfe_releases', entry: url(env.VITE_REMOTE_RELEASES_URL, DEFAULTS.releases), module: './ReleasesApp', basePath: '/releases', label: 'Releases', permission: 'view' },
      { name: 'mfe_admin', entry: url(env.VITE_REMOTE_ADMIN_URL, DEFAULTS.admin), module: './AdminApp', basePath: '/admin', label: 'Admin', permission: 'admin' },
    ],
  };
}

export function mfeManifestPlugin(env: Record<string, string | undefined>): Plugin {
  const json = () => JSON.stringify(buildManifest(env), null, 2);
  return {
    name: 'rules-mfe-manifest',
    configureServer(server) {
      server.middlewares.use('/mfe-manifest.json', (_req, res) => {
        res.setHeader('Content-Type', 'application/json');
        res.setHeader('Cache-Control', 'no-cache');
        res.end(json());
      });
    },
    generateBundle() {
      this.emitFile({ type: 'asset', fileName: 'mfe-manifest.json', source: json() });
    },
  };
}
