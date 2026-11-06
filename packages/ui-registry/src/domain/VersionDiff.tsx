import type { BaseComponentProps } from '@json-render/react';
import type { DiffResult } from '@rules/schemas';
import { useEffect, useMemo, useState } from 'react';
import type { z } from 'zod';
import { useHost } from '../host';
import type { domainSchemas } from './schemas';
import { pretty, useAsync } from './util';

type Props = z.output<typeof domainSchemas.VersionDiff.props>;
type Line = { text: string; kind: 'same' | 'add' | 'del' | 'pad' };

/** Line diff (LCS) for two pretty-printed JSON documents, aligned side by side. */
export function sideBySide(a: string, b: string): [Line[], Line[]] {
  const x = a.split('\n');
  const y = b.split('\n');
  const n = x.length;
  const m = y.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array<number>(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--)
    for (let j = m - 1; j >= 0; j--) dp[i]![j] = x[i] === y[j] ? dp[i + 1]![j + 1]! + 1 : Math.max(dp[i + 1]![j]!, dp[i]![j + 1]!);
  const left: Line[] = [];
  const right: Line[] = [];
  let i = 0;
  let j = 0;
  while (i < n || j < m) {
    if (i < n && j < m && x[i] === y[j]) {
      left.push({ text: x[i++]!, kind: 'same' });
      right.push({ text: y[j++]!, kind: 'same' });
    } else if (j < m && (i >= n || dp[i]![j + 1]! >= dp[i + 1]![j]!)) {
      left.push({ text: '', kind: 'pad' });
      right.push({ text: y[j++]!, kind: 'add' });
    } else {
      left.push({ text: x[i++]!, kind: 'del' });
      right.push({ text: '', kind: 'pad' });
    }
  }
  return [left, right];
}

export function VersionDiff({ props }: BaseComponentProps<Props>) {
  const host = useHost();
  const [from, setFrom] = useState(props.from);
  const [to, setTo] = useState(props.to);
  const diff = useAsync<DiffResult>();
  const { run } = diff;

  useEffect(() => {
    void run(() => host.callAction<DiffResult>('releases', 'diff', { app: props.app, decision: props.decision, from, to }));
  }, [host, run, props.app, props.decision, from, to]);

  const columns = useMemo(
    () => (diff.data ? sideBySide(pretty(diff.data.from_content), pretty(diff.data.to_content)) : null),
    [diff.data],
  );
  const versions = props.versions.length ? props.versions : [props.from, props.to];

  return (
    <div data-testid="version-diff" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <label className="rr-muted">
          From{' '}
          <select className="rr-input" value={from} onChange={(e) => setFrom(Number(e.target.value))} aria-label="From version">
            {versions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
        </label>
        <label className="rr-muted">
          To{' '}
          <select className="rr-input" value={to} onChange={(e) => setTo(Number(e.target.value))} aria-label="To version">
            {versions.map((v) => (
              <option key={v} value={v}>
                v{v}
              </option>
            ))}
          </select>
        </label>
        {diff.data && (
          <span className="rr-muted" data-testid="diff-summary">
            {diff.data.summary.changed ?? 0} changed · {diff.data.summary.added ?? 0} added · {diff.data.summary.removed ?? 0} removed
          </span>
        )}
      </div>
      {diff.running && <p className="rr-muted">Loading diff…</p>}
      {diff.error && <div className="rr-error">{diff.error}</div>}
      {diff.data && (
        <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="diff-changes">
          {diff.data.changes.slice(0, 50).map((c) => (
            <li key={c.path + c.kind}>
              <code className="rr-code">{c.path}</code> <span className={`rr-badge ${c.kind === 'added' ? 'success' : c.kind === 'removed' ? 'danger' : 'warning'}`}>{c.kind}</span>{' '}
              {c.kind === 'changed' && (
                <span className="rr-code">
                  {JSON.stringify(c.before)} → {JSON.stringify(c.after)}
                </span>
              )}
            </li>
          ))}
          {diff.data.changes.length === 0 && <li className="rr-muted">The versions are identical.</li>}
        </ul>
      )}
      {columns && (
        <div className="rr-diff">
          {columns.map((col, side) => (
            <pre key={side} className="rr-pre" aria-label={side === 0 ? `Version ${from}` : `Version ${to}`}>
              {col.map((l, idx) => (
                <div key={idx} className={`rr-diff-line ${l.kind}`}>
                  {l.text || ' '}
                </div>
              ))}
            </pre>
          ))}
        </div>
      )}
    </div>
  );
}
