/**
 * Vercel Build Output API (v3) for the shell: the Vite build as static files, an edge
 * function proxying /bff/* to BFF_URL, SPA fallback, and cache headers (immutable hashed
 * assets; no-cache for HTML and the federation manifests).
 */
import { cpSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const out = join(root, '.vercel', 'output');
rmSync(out, { recursive: true, force: true });
cpSync(join(root, 'dist'), join(out, 'static'), { recursive: true });

const fn = join(out, 'functions', 'bff-proxy.func');
mkdirSync(fn, { recursive: true });
cpSync(join(root, 'scripts', 'bff-proxy.js'), join(fn, 'index.js'));
writeFileSync(join(fn, '.vc-config.json'), JSON.stringify({ runtime: 'edge', entrypoint: 'index.js' }, null, 2));

const noCache = { 'cache-control': 'no-cache' };
const config = {
  version: 3,
  routes: [
    { src: '^/bff/(.*)$', dest: '/bff-proxy?path=$1' },
    { src: '^/assets/(.*)$', headers: { 'cache-control': 'public, max-age=31536000, immutable' }, continue: true },
    { src: '^/(remoteEntry[^/]*\\.js|mf-manifest\\.json|mfe-manifest\\.json|index\\.html)?$', headers: noCache, continue: true },
    { handle: 'filesystem' },
    { src: '^/(.*)$', dest: '/index.html' },
  ],
};
writeFileSync(join(out, 'config.json'), JSON.stringify(config, null, 2));
console.log(`Build Output written to ${out}`);
