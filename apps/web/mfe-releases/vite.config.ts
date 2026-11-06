import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { sharedDeps } from './federation.shared.ts';

const port = 5175;
const bff = process.env.BFF_URL ?? 'http://localhost:8787';

export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE ?? '/',
  plugins: [
    react(),
    federation({
      name: 'mfe_releases',
      filename: 'remoteEntry.js',
      exposes: { './ReleasesApp': './src/ReleasesApp.tsx' },
      shared: sharedDeps,
      manifest: true,
      dts: false,
    }),
  ],
  // Standalone mode talks to the BFF through the same /bff path the shell uses.
  server: { port, origin: `http://localhost:${port}`, cors: true, proxy: { '/bff': { target: bff, changeOrigin: true } } },
  preview: { port, cors: true, proxy: { '/bff': { target: bff, changeOrigin: true } } },
  build: { target: 'es2022' },
});
