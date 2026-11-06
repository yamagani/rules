/**
 * Services the hosting runtime provides to registry components (implemented by
 * @rules/sdui-runtime). Components never call fetch directly: data flows through BFF actions.
 */
import { createContext, useContext, type ReactNode } from 'react';

export type MfeName = 'rules' | 'releases' | 'admin';

export class ActionError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly body: Record<string, unknown>,
  ) {
    super(message);
  }
}

export interface HostServices {
  /** POST /bff/<mfe>/actions/<action>. Resolves to the action's `data`; rejects with ActionError. */
  callAction<T = unknown>(mfe: MfeName, action: string, payload: Record<string, unknown>): Promise<T>;
  navigate(to: string): void;
  refresh(): void;
  toast(message: string, tone?: 'neutral' | 'info' | 'success' | 'warning' | 'danger'): void;
}

const unavailable = (): never => {
  throw new Error('HostServices not provided: render inside <ScreenRenderer/> or <HostProvider/>');
};

const HostContext = createContext<HostServices>({
  callAction: unavailable,
  navigate: unavailable,
  refresh: unavailable,
  toast: unavailable,
});

export function HostProvider({ services, children }: { services: HostServices; children: ReactNode }) {
  return <HostContext.Provider value={services}>{children}</HostContext.Provider>;
}

export function useHost(): HostServices {
  return useContext(HostContext);
}
