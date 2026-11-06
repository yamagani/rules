import { describe, expect, it } from 'vitest';
import { actionSchemas, fieldErrors } from './actions';

describe('action schemas', () => {
  it('coerce numeric strings bound from inputs', () => {
    const parsed = actionSchemas.releases.setAlias.parse({ app: 'loan-origination', decision: 'eligibility', alias: 'beta', version: '5' });
    expect(parsed.version).toBe(5);
  });

  it('report field errors', () => {
    const res = actionSchemas.releases.setAlias.safeParse({ app: 'Loan Origination', decision: 'eligibility', alias: 'Beta!', version: 0 });
    expect(res.success).toBe(false);
    if (!res.success) expect(Object.keys(fieldErrors(res.error)).sort()).toEqual(['alias', 'app', 'version']);
  });

  it('refuse raw API keys as provider key references', () => {
    const res = actionSchemas.admin.createProvider.safeParse({ app: 'a', name: 'x', type: 'anthropic', model: 'm', apiKeyRef: 'sk-abc' });
    expect(res.success).toBe(false);
  });
});
