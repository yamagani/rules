import type { Schemas } from '@rules/api-client';
import { hasPermission } from '@rules/auth';
import type { Permission, Session } from '@rules/schemas';
import type { Context } from 'hono';
import { appParam, call, rules, userToken, type Env } from './context';

let demoModeCache: { value: boolean; at: number } | undefined;

/** Whether rules-service runs its dev token issuer (cached briefly; it is deployment config). */
export async function demoMode(c: Context<Env>): Promise<boolean> {
  if (demoModeCache && Date.now() - demoModeCache.at < 60_000) return demoModeCache.value;
  try {
    const res = await (c.get('config').fetch ?? fetch)(`${c.get('config').rulesServiceUrl}/health`);
    const body = (await res.json()) as { demo_auth?: string };
    demoModeCache = { value: body.demo_auth === 'true', at: Date.now() };
  } catch {
    return false;
  }
  return demoModeCache.value;
}

export function resetDemoModeCache(): void {
  demoModeCache = undefined;
}

export function toSession(me: Schemas['MeOut'], app: string, demo: boolean, demoUsers: Session['demoUsers']): Session {
  return {
    authenticated: true,
    user: { subject: me.subject, displayName: me.subject, roles: me.roles },
    permissions: { global: me.global_permissions as Permission[], apps: me.apps as Record<string, Permission[]> },
    demoMode: demo,
    demoUsers,
    app,
  };
}

/** Load the caller's identity and permissions from rules-service (used to shape screens). */
export async function loadSession(c: Context<Env>): Promise<Session> {
  const app = appParam(c);
  const demo = await demoMode(c);
  const { data: me } = await call(rules(c).GET('/v1/me'));
  return toSession(me, app, demo, []);
}

export interface Perms {
  session: Session;
  app: string;
  can: (perm: Permission) => boolean;
}

export async function perms(c: Context<Env>): Promise<Perms> {
  const session = await loadSession(c);
  return { session, app: session.app, can: (perm) => hasPermission(session, session.app, perm) };
}

export { userToken };
