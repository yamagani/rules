export interface BffConfig {
  rulesServiceUrl: string;
  /** Application the UI is scoped to when a request does not name one. */
  defaultApp: string;
  /** Mark the session cookie Secure (true behind HTTPS, e.g. on Vercel). */
  secureCookies: boolean;
  fetch?: typeof fetch;
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): BffConfig {
  return {
    rulesServiceUrl: (env.RULES_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    defaultApp: env.DEFAULT_APP ?? 'loan-origination',
    secureCookies: env.VERCEL === '1' || env.SECURE_COOKIES === 'true',
  };
}
