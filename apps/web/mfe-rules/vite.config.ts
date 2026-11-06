import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import { federation } from '@module-federation/vite';
import { sharedDeps } from './federation.shared.ts';

const port = 5174;

export default defineConfig({
  base: process.env.VITE_PUBLIC_BASE ?? '/',
  plugins: [
    react(),
    federation({
      name: 'mfe_rules',
      filename: 'remoteEntry.js',
      exposes: { './RulesApp': './src/RulesApp.tsx' },
      shared: sharedDeps,
      manifest: true,
      dts: false,
    }),
  ],
  server: { port, origin: `http://localhost:${port}`, cors: true },
  preview: { port, cors: true },
  build: { target: 'es2022' },
});
