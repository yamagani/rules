import { Hono } from 'hono';
import { requestId } from 'hono/request-id';
import { configFromEnv, type BffConfig } from './config';
import type { Env } from './context';
import { HttpProblem } from './errors';
import { log } from './log';
import { adminRouter } from './routers/admin';
import { releasesRouter } from './routers/releases';
import { rulesRouter } from './routers/rules';
import { sessionRouter } from './routers/session';

export function createApp(config: BffConfig = configFromEnv()) {
  const app = new Hono<Env>();

  app.use('*', requestId({ headerName: 'X-Request-Id' }));
  app.use('*', async (c, next) => {
    c.set('config', config);
    const started = Date.now();
    await next();
    log(c.res.status >= 500 ? 'error' : 'info', 'request', {
      requestId: c.get('requestId'),
      method: c.req.method,
      path: c.req.path,
      status: c.res.status,
      ms: Date.now() - started,
    });
  });

  app.onError((err, c) => {
    const rid = c.get('requestId');
    if (err instanceof HttpProblem) {
      return c.json({ ...err.body, requestId: rid }, err.status as 400);
    }
    log('error', 'unhandled_error', { requestId: rid, error: err.message, stack: err.stack });
    return c.json({ type: 'about:blank', title: 'Internal Server Error', status: 500, requestId: rid }, 500);
  });
  app.notFound((c) => c.json({ type: 'about:blank', title: 'Not Found', status: 404, detail: `No route for ${c.req.path}` }, 404));

  const health = { status: 'ok', service: 'bff' };
  app.get('/health', (c) => c.json(health));
  app.get('/bff/health', (c) => c.json(health));
  app.route('/bff/session', sessionRouter);
  app.route('/bff/rules', rulesRouter);
  app.route('/bff/releases', releasesRouter);
  app.route('/bff/admin', adminRouter);
  return app;
}
