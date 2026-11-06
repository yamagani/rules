/**
 * Edge function: /bff/* → the BFF deployment named by BFF_URL. vercel.json rewrites cannot
 * read environment variables, and each preview shell must reach its own preview BFF, so the
 * shell proxies instead. The browser only ever talks to the shell's origin: no CORS, and the
 * session cookie stays first-party.
 */
export default async function handler(request) {
  const bff = process.env.BFF_URL;
  if (!bff) return Response.json({ title: 'BFF_URL is not configured', status: 502 }, { status: 502 });
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
