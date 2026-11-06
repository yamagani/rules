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

/**
 * Where rules-service lives. On Vercel, `relatedProjects` in vercel.json makes Vercel inject
 * VERCEL_RELATED_PROJECTS: previews use the API preview from the same git branch, production
 * uses the API's production domain (same rules as @vercel/related-projects). Otherwise
 * RULES_SERVICE_URL.
 */
export function rulesServiceUrlFromEnv(env: Record<string, string | undefined>): string {
  const name = env.API_PROJECT_NAME || 'rules-api';
  try {
    const projects = JSON.parse(env.VERCEL_RELATED_PROJECTS || '[]') as {
      project?: { name?: string };
      preview?: { branch?: string; customEnvironment?: string };
      production?: { alias?: string; url?: string };
    }[];
    const p = projects.find((x) => x.project?.name === name);
    if (p && env.VERCEL_ENV === 'preview') {
      const host = p.preview?.customEnvironment ?? p.preview?.branch;
      if (host) return `https://${host}`;
    }
    if (p && env.VERCEL_ENV === 'production') {
      const host = p.production?.alias ?? p.production?.url;
      if (host) return `https://${host}`;
    }
  } catch {
    // fall back to RULES_SERVICE_URL
  }
  return (env.RULES_SERVICE_URL ?? 'http://localhost:8000').replace(/\/$/, '');
}

export function configFromEnv(env: Record<string, string | undefined> = process.env): BffConfig {
  return {
    rulesServiceUrl: rulesServiceUrlFromEnv(env),
    defaultApp: env.DEFAULT_APP ?? 'loan-origination',
    secureCookies: env.VERCEL === '1' || env.SECURE_COOKIES === 'true',
    rulesServiceBypassSecret: env.RULES_SERVICE_BYPASS_SECRET || undefined,
  };
}
