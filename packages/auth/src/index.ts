/**
 * Permission helpers shared by the BFF and the browser. These only *shape* screens; the
 * security boundary is rules-service, which checks every request again.
 */
import type { Permission, Session } from '@rules/schemas';

export const PERMISSIONS = {
  view: 'view',
  edit: 'edit',
  publish: 'publish',
  evaluate: 'evaluate',
  admin: 'admin',
} as const satisfies Record<Permission, Permission>;

/** Mirrors rules-service: admin implies everything; edit and publish imply view. */
const IMPLIED_BY: Record<Permission, Permission[]> = {
  view: ['view', 'edit', 'publish', 'admin'],
  edit: ['edit', 'admin'],
  publish: ['publish', 'admin'],
  evaluate: ['evaluate', 'admin'],
  admin: ['admin'],
};

export type PermissionSource = Pick<Session, 'permissions'> | null | undefined;

export function grantedPermissions(session: PermissionSource, app?: string | null): Set<Permission> {
  if (!session) return new Set();
  const granted = new Set<Permission>(session.permissions.global);
  if (app) for (const p of session.permissions.apps[app] ?? []) granted.add(p);
  return granted;
}

export function hasPermission(session: PermissionSource, app: string | null | undefined, perm: Permission): boolean {
  const granted = grantedPermissions(session, app);
  return IMPLIED_BY[perm].some((p) => granted.has(p));
}

export function anonymousSession(app: string, demoMode = false): Session {
  return { authenticated: false, user: null, permissions: { global: [], apps: {} }, demoMode, demoUsers: [], app };
}
