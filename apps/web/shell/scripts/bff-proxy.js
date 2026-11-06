/**
 * Edge function: /bff/* → the BFF deployment. The browser only talks to the web origin
 * (no CORS, first-party session cookie).
 *
 * BFF host resolution (same rules as @vercel/related-projects):
 * - with `relatedProjects` configured in vercel.json, Vercel injects VERCEL_RELATED_PROJECTS:
 *   a preview uses the BFF preview built from the same git branch, production uses the BFF's
 *   production domain;
 * - otherwise BFF_URL.
 */
const BFF_PROJECT = process.env.BFF_PROJECT_NAME || 'rules-bff';

export function bffHost(env = process.env) {
  try {
    const projects = JSON.parse(env.VERCEL_RELATED_PROJECTS || '[]');
    const p = projects.find((x) => x?.project?.name === BFF_PROJECT);
    if (p) {
      if (env.VERCEL_ENV === 'preview') {
        const host = p.preview?.customEnvironment ?? p.preview?.branch;
        if (host) return `https://${host}`;
      }
      if (env.VERCEL_ENV === 'production') {
        const host = p.production?.alias ?? p.production?.url;
        if (host) return `https://${host}`;
      }
    }
  } catch {
    // fall through to BFF_URL
  }
  return env.BFF_URL;
}

export default async function handler(request) {
  const bff = bffHost();
  if (!bff) return Response.json({ title: 'BFF location is not configured (relatedProjects or BFF_URL)', status: 502 }, { status: 502 });
  const incoming = new URL(request.url);
  const path = incoming.searchParams.get('path') ?? '';
  incoming.searchParams.delete('path');
  const target = new URL(`/bff/${path}${incoming.search}`, bff);

  const headers = new Headers(request.headers);
  headers.delete('host');
  headers.set('x-forwarded-host', incoming.host);
  if (process.env.BFF_BYPASS_SECRET) headers.set('x-vercel-protection-bypass', process.env.BFF_BYPASS_SECRET);

  const upstream = await fetch(target, {
    method: request.method,
    headers,
    body: ['GET', 'HEAD'].includes(request.method) ? undefined : request.body,
    redirect: 'manual',
    duplex: 'half',
  });
  const responseHeaders = new Headers(upstream.headers);
  responseHeaders.delete('content-encoding');
  responseHeaders.delete('content-length');
  return new Response(upstream.body, { status: upstream.status, headers: responseHeaders });
}
