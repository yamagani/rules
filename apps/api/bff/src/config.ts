export interface BffConfig {
  rulesServiceUrl: string;
  /** Application the UI is scoped to when a request does not name one. */
  defaultApp: string;
  /** Mark the session cookie Secure (true behind HTTPS, e.g. on Vercel). */
  secureCookies: boolean;
  /** Vercel "Protection Bypass for Automation" secret for a protected rules-service preview. */
  rulesServiceBypassSecret?: string;
  fetch?: typeof fetch;
}

/** fetch for rules-service calls: adds the deployment-protection bypass header when configured. */
export function rulesServiceFetch(config: BffConfig): typeof fetch {
  const base = config.fetch ?? fetch;
  const secret = config.rulesServiceBypassSecret;
  if (!secret) return base;
  return (input, init) => {
    const req = new Request(input, init);
    req.headers.set('x-vercel-protection-bypass', secret);
    return base(req);
  };
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): BffConfig {
  return {
    rulesServiceUrl: (env.RULES_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, ''),
    defaultApp: env.DEFAULT_APP ?? 'loan-origination',
    secureCookies: env.VERCEL === '1' || env.SECURE_COOKIES === 'true',
    rulesServiceBypassSecret: env.RULES_SERVICE_BYPASS_SECRET || undefined,
  };
}
