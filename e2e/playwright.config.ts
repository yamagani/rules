import { defineConfig, devices } from '@playwright/test';

/**
 * E2E against a running stack. Locally: `docker compose -f infra/docker-compose.yml up` (or
 * `pnpm dev`), then `pnpm e2e`. Against a Vercel preview: E2E_BASE_URL=https://… pnpm e2e.
 */
export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: { timeout: 20_000 },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? [['list'], ['html', { open: 'never' }]] : 'list',
  use: {
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:5173',
    trace: 'off',
    screenshot: 'only-on-failure',
    viewport: { width: 1360, height: 900 },
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'], viewport: { width: 1360, height: 900 } } }],
});
