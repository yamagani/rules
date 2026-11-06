import type { BaseComponentProps } from '@json-render/react';
import { useState } from 'react';
import type { z } from 'zod';
import { useHost } from '../host';
import type { domainSchemas } from './schemas';
import { errorText } from './util';

type Props = z.output<typeof domainSchemas.ProviderSettings.props>;
const TYPES = ['anthropic', 'openai', 'azure_openai', 'openai_compatible', 'mock'] as const;

/** Provider admin. Shows key *references* only; raw keys are never displayed or accepted. */
export function ProviderSettings({ props }: BaseComponentProps<Props>) {
  const host = useHost();
  const [results, setResults] = useState<Record<number, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ name: '', type: 'anthropic', model: '', baseUrl: '', apiKeyRef: 'env:ANTHROPIC_API_KEY' });

  const call = async (key: string, action: string, payload: Record<string, unknown>, after?: (data: unknown) => void) => {
    setBusy(key);
    setError(null);
    try {
      const data = await host.callAction('admin', action, { app: props.app, ...payload });
      after?.(data);
      if (action !== 'testProvider') host.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  };

  return (
    <div data-testid="provider-settings" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {error && <div className="rr-error">{error}</div>}
      <div className="rr-table-wrap">
        <table className="rr-table">
          <thead>
            <tr>
              <th>Provider</th>
              <th>Model</th>
              <th>Key reference</th>
              <th>Usage this month</th>
              <th>Status</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {props.providers.map((p) => (
              <tr key={p.id} data-testid={`provider-${p.name}`}>
                <td>
                  <strong>{p.name}</strong>
                  <div className="rr-muted">{p.type}{p.baseUrl ? ` · ${p.baseUrl}` : ''}</div>
                </td>
                <td><code className="rr-code">{p.model}</code></td>
                <td>
                  {p.apiKeyRef ? <code className="rr-code">{p.apiKeyRef}</code> : <span className="rr-muted">none</span>}
                  <div className={p.keyConfigured ? 'rr-muted' : 'rr-danger'}>{p.keyConfigured ? 'resolvable' : 'not set'}</div>
                </td>
                <td>
                  {p.tokensThisMonth.toLocaleString()} tokens
                  {p.monthlyTokenBudget !== null && <div className="rr-muted">budget {p.monthlyTokenBudget.toLocaleString()}</div>}
                </td>
                <td>
                  <span className={`rr-badge ${p.enabled ? 'success' : 'neutral'}`}>{p.enabled ? 'enabled' : 'disabled'}</span>
                  {props.appProviderId === p.id && <div><span className="rr-badge info">this app</span></div>}
                  {props.appFallbackProviderId === p.id && <div><span className="rr-badge neutral">fallback</span></div>}
                </td>
                <td>
                  <div className="rr-actions">
                    <button type="button" className="rr-btn" disabled={busy !== null} onClick={() => call(`test-${p.id}`, 'testProvider', { providerId: p.id }, (d) => {
                      const r = d as { ok: boolean; latency_ms: number; error?: string | null };
                      setResults((s) => ({ ...s, [p.id]: r.ok ? `OK in ${r.latency_ms} ms` : `Failed: ${r.error}` }));
                    })} data-testid={`test-${p.name}`}>
                      {busy === `test-${p.id}` ? 'Testing…' : 'Test connection'}
                    </button>
                    {props.canEdit && (
                      <>
                        <button type="button" className="rr-btn" disabled={busy !== null} onClick={() => call(`toggle-${p.id}`, 'updateProvider', { providerId: p.id, enabled: !p.enabled })} data-testid={`toggle-${p.name}`}>
                          {p.enabled ? 'Disable' : 'Enable'}
                        </button>
                        {p.enabled && props.appProviderId !== p.id && (
                          <button type="button" className="rr-btn" disabled={busy !== null} onClick={() => call(`use-${p.id}`, 'setAppAi', { providerId: p.id, fallbackProviderId: props.appProviderId ?? undefined })} data-testid={`use-${p.name}`}>
                            Use for this app
                          </button>
                        )}
                      </>
                    )}
                  </div>
                  {results[p.id] && <small className={results[p.id]!.startsWith('OK') ? 'rr-muted' : 'rr-danger'}>{results[p.id]}</small>}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {props.canEdit && (
        <form
          onSubmit={(e) => {
            e.preventDefault();
            void call('create', 'createProvider', { ...form, enabled: false });
          }}
          style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-end' }}
        >
          <div className="rr-field"><label htmlFor="pv-name">Name</label><input id="pv-name" className="rr-input" required value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></div>
          <div className="rr-field"><label htmlFor="pv-type">Type</label>
            <select id="pv-type" className="rr-input" value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => <option key={t} value={t}>{t}</option>)}
            </select>
          </div>
          <div className="rr-field"><label htmlFor="pv-model">Model</label><input id="pv-model" className="rr-input" required value={form.model} onChange={(e) => setForm({ ...form, model: e.target.value })} /></div>
          <div className="rr-field"><label htmlFor="pv-url">Base URL</label><input id="pv-url" className="rr-input" placeholder="optional" value={form.baseUrl} onChange={(e) => setForm({ ...form, baseUrl: e.target.value })} /></div>
          <div className="rr-field"><label htmlFor="pv-ref">Key reference</label><input id="pv-ref" className="rr-input mono" placeholder="env:NAME or aws-sm:NAME" value={form.apiKeyRef} onChange={(e) => setForm({ ...form, apiKeyRef: e.target.value })} autoComplete="off" /></div>
          <button type="submit" className="rr-btn primary" disabled={busy !== null}>Add provider</button>
        </form>
      )}
      <small className="rr-muted">Keys are stored in the deployment's secret store and referenced here; this screen never shows or accepts a key value.</small>
    </div>
  );
}
