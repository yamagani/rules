import { Hono } from 'hono';

export function createApp() {
  const app = new Hono();
  app.get('/health', (c) => c.json({ status: 'ok', service: 'bff' }));
  app.get('/bff/health', (c) => c.json({ status: 'ok', service: 'bff' }));
  return app;
}
