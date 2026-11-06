import type { BaseComponentProps } from '@json-render/react';
import type { EvaluateResult, TestReport } from '@rules/schemas';
import { useState } from 'react';
import type { z } from 'zod';
import { useHost } from '../host';
import type { domainSchemas } from './schemas';
import { parseJson, Pre, pretty, useAsync } from './util';

type Props = z.output<typeof domainSchemas.TestPanel.props>;

/** Target values: "draft", "default", "version:3", "alias:beta". */
function targetParams(target: string): Record<string, unknown> {
  if (target === 'draft') return { draft: true };
  if (target.startsWith('version:')) return { version: Number(target.slice(8)) };
  if (target.startsWith('alias:')) return { alias: target.slice(6) };
  return {};
}

export function TestPanel({ props }: BaseComponentProps<Props>) {
  const host = useHost();
  const [input, setInput] = useState(pretty(props.sampleInput));
  const [target, setTarget] = useState(props.defaultTarget);
  const [showTrace, setShowTrace] = useState(false);
  const evaluation = useAsync<EvaluateResult>();
  const tests = useAsync<TestReport>();
  const parsed = parseJson(input, 'Input');

  const evaluate = () => {
    if (!parsed.ok) return;
    void evaluation.run(() =>
      host.callAction<EvaluateResult>('rules', 'evaluate', {
        app: props.app,
        decision: props.decision,
        context: (parsed.value as Record<string, unknown>) ?? {},
        trace: true,
        ...targetParams(target),
      }),
    );
  };

  const runStored = () => {
    const version = evaluation.data?.meta.version ?? Number(target.replace('version:', ''));
    if (!version) return;
    void tests.run(() => host.callAction<TestReport>('rules', 'runTests', { app: props.app, decision: props.decision, version }));
  };

  return (
    <div data-testid="test-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="rr-field">
        <label htmlFor="tp-target">Evaluate</label>
        <select id="tp-target" className="rr-input" value={target} onChange={(e) => setTarget(e.target.value)} data-testid="test-target">
          {props.targets.map((t) => (
            <option key={t.value} value={t.value}>
              {t.label}
            </option>
          ))}
        </select>
      </div>
      <div className="rr-field">
        <label htmlFor="tp-input">Input JSON</label>
        <textarea id="tp-input" className="rr-input mono" rows={8} value={input} onChange={(e) => setInput(e.target.value)} spellCheck={false} data-testid="test-input" />
        {!parsed.ok && <small className="rr-danger">{parsed.error}</small>}
      </div>
      <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
        <button type="button" className="rr-btn primary" onClick={evaluate} disabled={!parsed.ok || evaluation.running} data-testid="test-evaluate">
          {evaluation.running ? 'Evaluating…' : 'Evaluate'}
        </button>
        {props.canRunStoredTests && (
          <button type="button" className="rr-btn" onClick={runStored} disabled={tests.running || (!evaluation.data && !target.startsWith('version:'))}>
            Run stored tests
          </button>
        )}
      </div>
      {evaluation.error && <div className="rr-error">{evaluation.error}</div>}
      {evaluation.data && (
        <div data-testid="test-result" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
          <div className="rr-muted">
            Ran version <strong data-testid="test-result-version">{evaluation.data.meta.version}</strong> ({evaluation.data.meta.status}, resolved by{' '}
            {evaluation.data.meta.resolved_by}) in {evaluation.data.meta.performance}
          </div>
          <Pre value={evaluation.data.result} testId="test-output" />
          <button type="button" className="rr-btn ghost" onClick={() => setShowTrace((s) => !s)} style={{ alignSelf: 'flex-start' }}>
            {showTrace ? 'Hide trace' : 'Show trace'}
          </button>
          {showTrace && <Pre value={evaluation.data.trace ?? {}} />}
        </div>
      )}
      {tests.error && <div className="rr-error">{tests.error}</div>}
      {tests.data && (
        <div>
          <strong>
            Stored tests on v{tests.data.version}: {tests.data.passed}/{tests.data.total} passed
          </strong>
          <ul style={{ margin: '4px 0 0', paddingLeft: 18 }}>
            {tests.data.results.map((r) => (
              <li key={r.name} className={r.passed ? undefined : 'rr-danger'}>
                {r.passed ? '✓' : '✗'} {r.name}
                {r.mismatches.length > 0 && ` — ${r.mismatches.join('; ')}`}
                {r.error && ` — ${r.error}`}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}
