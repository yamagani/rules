import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { sharedDeps } from './federation.shared.ts';
import { mfeManifestPlugin } from './mfe-manifest.ts';

export default defineConfig(({ mode }) => {
  const env = { ...loadEnv(mode, process.cwd(), 'VITE_'), ...process.env };
  const bffTarget = env.BFF_URL ?? 'http://localhost:8787';
  return {
    plugins: [
      react(),
      federation({
        name: 'shell',
        // Remotes are registered at runtime from /mfe-manifest.json (see src/remotes.ts).
        remotes: {},
        shared: sharedDeps,
        dts: false,
      }),
      mfeManifestPlugin(env),
    ],
    server: {
      port: 5173,
      // Same-origin BFF in dev, mirroring the Vercel rewrite in production.
      proxy: { '/bff': { target: bffTarget, changeOrigin: true } },
    },
    preview: { port: 5173, proxy: { '/bff': { target: bffTarget, changeOrigin: true } } },
    build: { target: 'es2022' },
  };
});
