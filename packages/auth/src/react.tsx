import { createContext, useContext, type ReactNode } from 'react';
import type { Permission, Session } from '@rules/schemas';
import { hasPermission } from './index';

const SessionContext = createContext<Session | null>(null);

export function SessionProvider({ session, children }: { session: Session | null; children: ReactNode }) {
  return <SessionContext.Provider value={session}>{children}</SessionContext.Provider>;
}

export function useSession(): Session | null {
  return useContext(SessionContext);
}

export function usePermission(perm: Permission, app?: string): boolean {
  const session = useSession();
  return hasPermission(session, app ?? session?.app, perm);
}

export interface CanProps {
  permission: Permission;
  /** Defaults to the session's current application. */
  app?: string;
  fallback?: ReactNode;
  children: ReactNode;
}

/** Renders children only when the session has the permission. UI shaping only. */
export function Can({ permission, app, fallback = null, children }: CanProps) {
  return usePermission(permission, app) ? <>{children}</> : <>{fallback}</>;
}
