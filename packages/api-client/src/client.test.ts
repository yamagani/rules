import { describe, expect, it, vi } from 'vitest';
import { createRulesClient } from './index';

describe('createRulesClient', () => {
  it('forwards the bearer token and request id', async () => {
    const fetchMock = vi.fn(async (_req: Request) => new Response(JSON.stringify([]), { headers: { 'Content-Type': 'application/json' } }));
    const client = createRulesClient({ baseUrl: 'http://rules', token: 'tok', requestId: 'rid', fetch: fetchMock as unknown as typeof fetch });
    const { data } = await client.GET('/v1/apps/{app}/decisions', { params: { path: { app: 'loan-origination' } } });
    expect(data).toEqual([]);
    const req = fetchMock.mock.calls[0]![0];
    expect(req.url).toBe('http://rules/v1/apps/loan-origination/decisions');
    expect(req.headers.get('authorization')).toBe('Bearer tok');
    expect(req.headers.get('x-request-id')).toBe('rid');
  });
});
