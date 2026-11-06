import { describe, expect, it } from 'vitest';
import { createApp } from './app';

describe('bff', () => {
  it('reports health', async () => {
    const res = await createApp().request('/health');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ok', service: 'bff' });
  });
});
