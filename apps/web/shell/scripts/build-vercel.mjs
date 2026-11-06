/**
 * Vercel Build Output API (v3) for the `rules-web` project: the shell **and** the three
 * remotes in one deployment. Remotes are served from the same origin under /_mfe/<name>/,
 * so there is no CORS, no extra Vercel projects and no cross-project protection to manage.
 *
 * Output:
 *   static/                 shell build
 *   static/_mfe/<name>/     remote builds (built with base /_mfe/<name>/)
 *   functions/bff-proxy     edge function: /bff/* → the BFF deployment (see bff-proxy.js)
 */
import { execSync } from 'node:child_process';
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const shell = join(dirname(fileURLToPath(import.meta.url)), '..');
const web = join(shell, '..');
const out = join(shell, '.vercel', 'output');
const remotes = { rules: 'mfe-rules', releases: 'mfe-releases', admin: 'mfe-admin' };

const run = (cmd, cwd, env = {}) => execSync(cmd, { cwd, stdio: 'inherit', env: { ...process.env, ...env } });

for (const [name, dir] of Object.entries(remotes)) {
  run('pnpm exec vite build', join(web, dir), { VITE_PUBLIC_BASE: `/_mfe/${name}/` });
}
run('pnpm exec vite build', shell, {
  VITE_REMOTE_RULES_URL: '/_mfe/rules',
  VITE_REMOTE_RELEASES_URL: '/_mfe/releases',
  VITE_REMOTE_ADMIN_URL: '/_mfe/admin',
});

rmSync(out, { recursive: true, force: true });
cpSync(join(shell, 'dist'), join(out, 'static'), { recursive: true });
for (const [name, dir] of Object.entries(remotes)) {
  cpSync(join(web, dir, 'dist'), join(out, 'static', '_mfe', name), { recursive: true });
}

const fn = join(out, 'functions', 'bff-proxy.func');
mkdirSync(fn, { recursive: true });
cpSync(join(shell, 'scripts', 'bff-proxy.js'), join(fn, 'index.js'));
writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'edge', entrypoint: 'index.js' }, null, 2));

const immutable = { 'cache-control': 'public, max-age=31536000, immutable' };
const noCache = { 'cache-control': 'no-cache' };
writeFileSync(
  join(out, 'config.json'),
  JSON.stringify(
    {
      version: 3,
      routes: [
        { src: '^/bff/(.*)$', dest: '/bff-proxy?path=$1' },
        { src: '^/(_mfe/[^/]+/)?assets/(.*)$', headers: immutable, continue: true },
        { src: '^/(_mfe/[^/]+/)?(remoteEntry[^/]*\\.js|mf-manifest\\.json|mfe-manifest\\.json|index\\.html)?$', headers: noCache, continue: true },
        { handle: 'filesystem' },
        { src: '^/_mfe/', status: 404 },
        { src: '^/(.*)$', dest: '/index.html' },
      ],
    },
    null,
    2,
  ),
);
console.log(`Build Output written to ${out}`);
