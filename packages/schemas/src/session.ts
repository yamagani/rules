import { z } from 'zod';
import { Permission } from './domain';

export const SessionUser = z.object({
  subject: z.string(),
  displayName: z.string(),
  roles: z.array(z.string()),
});

/** What the browser knows about the signed-in user. The token itself stays in an HttpOnly cookie. */
export const Session = z.object({
  authenticated: z.boolean(),
  user: SessionUser.nullable(),
  permissions: z.object({
    global: z.array(Permission),
    apps: z.record(z.string(), z.array(Permission)),
  }),
  /** Dev token issuer active: every screen shows a "Demo mode" banner. */
  demoMode: z.boolean(),
  demoUsers: z
    .array(z.object({ username: z.string(), displayName: z.string(), description: z.string() }))
    .default([]),
  /** The application the UI is scoped to. */
  app: z.string(),
});
export type Session = z.infer<typeof Session>;

export const LoginRequest = z.object({ username: z.string().min(1) });
