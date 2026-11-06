import { anonymousSession } from '@rules/auth';
import { LoginRequest, fieldErrors, type Session } from '@rules/schemas';
import { Hono } from 'hono';
import { deleteCookie, setCookie } from 'hono/cookie';
import { appParam, call, rules, SESSION_COOKIE, userToken, type Env } from '../context';
import { problem } from '../errors';
import { demoMode, toSession } from '../session';

export const sessionRouter = new Hono<Env>();

async function demoUsers(c: Parameters<typeof rules>[0]): Promise<Session['demoUsers']> {
  const { data } = await call(rules(c).GET('/v1/dev/users'));
  return data.filter((u) => u.kind === 'user' || u.kind === 'service').map((u) => ({ username: u.username, displayName: u.display_name, description: u.description }));
}

sessionRouter.get('/', async (c) => {
  const app = appParam(c);
  const demo = await demoMode(c);
  const users = demo ? await demoUsers(c) : [];
  if (!userToken(c)) return c.json({ ...anonymousSession(app, demo), demoUsers: users } satisfies Session);
  const res = await rules(c).GET('/v1/me');
  if (!res.response.ok) {
    if (res.response.status === 401) {
      deleteCookie(c, SESSION_COOKIE, { path: '/' });
      return c.json({ ...anonymousSession(app, demo), demoUsers: users } satisfies Session);
    }
    await call(Promise.resolve(res));
  }
  return c.json(toSession(res.data!, app, demo, users));
});

/** Demo login: mints a token with the rules-service dev issuer (only exists in local/demo). */
sessionRouter.post('/login', async (c) => {
  if (!(await demoMode(c))) throw problem(404, 'Not Found', 'Demo login is not available; sign in with your identity provider');
  const parsed = LoginRequest.safeParse(await c.req.json().catch(() => ({})));
  if (!parsed.success) throw problem(400, 'Bad Request', 'Invalid login', { fieldErrors: fieldErrors(parsed.error) });
  const { data } = await call(rules(c).POST('/v1/dev/token', { body: { username: parsed.data.username } }));
  setCookie(c, SESSION_COOKIE, data.access_token, {
    httpOnly: true,
    sameSite: 'Lax',
    secure: c.get('config').secureCookies,
    path: '/',
    maxAge: 8 * 3600,
  });
  return c.json({ ok: true, user: data.user.username });
});

sessionRouter.post('/logout', (c) => {
  deleteCookie(c, SESSION_COOKIE, { path: '/' });
  return c.json({ ok: true });
});
