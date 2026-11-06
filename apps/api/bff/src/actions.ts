import { actionSchemas, fieldErrors, type ActionResult, type MfeName } from '@rules/schemas';
import { Hono, type Context } from 'hono';
import type { z } from 'zod';
import type { Env } from './context';
import { problem } from './errors';

type Schemas<M extends MfeName> = (typeof actionSchemas)[M];
type Handler<M extends MfeName, A extends keyof Schemas<M>> = (
  c: Context<Env>,
  payload: z.output<Schemas<M>[A] & z.ZodType>,
) => Promise<Omit<ActionResult, 'ok'>>;

/**
 * POST /actions/:action for one MFE. Every payload is validated with the shared Zod schema
 * from @rules/schemas; invalid payloads get 400 with field errors.
 */
export function actionRouter<M extends MfeName>(mfe: M, handlers: { [A in keyof Schemas<M>]: Handler<M, A> }) {
  const router = new Hono<Env>();
  router.post('/actions/:action', async (c) => {
    const name = c.req.param('action') as keyof Schemas<M> & string;
    const schema = (actionSchemas[mfe] as Record<string, z.ZodType>)[name];
    const handler = (handlers as Record<string, Handler<M, keyof Schemas<M>>>)[name];
    if (!schema || !handler) throw problem(404, 'Not Found', `Unknown action '${name}' for ${mfe}`);
    let body: unknown;
    try {
      body = await c.req.json();
    } catch {
      throw problem(400, 'Bad Request', 'Body must be JSON', { fieldErrors: { _: ['invalid JSON'] } });
    }
    const parsed = schema.safeParse(body);
    if (!parsed.success) {
      throw problem(400, 'Bad Request', `Invalid payload for '${name}'`, { fieldErrors: fieldErrors(parsed.error) });
    }
    const result = await handler(c, parsed.data as never);
    return c.json({ ok: true, ...result } satisfies ActionResult);
  });
  return router;
}
