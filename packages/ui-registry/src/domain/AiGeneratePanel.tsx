import type { BaseComponentProps } from '@json-render/react';
import type { GenerateResult, ValidationReport } from '@rules/schemas';
import { useEffect, useState } from 'react';
import type { z } from 'zod';
import { useHost } from '../host';
import type { domainSchemas } from './schemas';
import { parseJson, Pre } from './util';
import { ActionError } from '../host';

type Props = z.output<typeof domainSchemas.AiGeneratePanel.props>;

const EXAMPLES_PLACEHOLDER = `[
  { "input": { "transaction": { "amount": 15000 } }, "expected": { "flag": true } }
]`;

function Report({ report }: { report: ValidationReport }) {
  return (
    <div data-testid="ai-report" style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      <strong>
        Validation: {report.ok ? 'passed' : 'failed'} after {report.attempts.length} attempt(s) · examples {report.passed}/{report.passed + report.failed}
      </strong>
      <ul style={{ margin: 0, paddingLeft: 18 }}>
        {report.attempts.map((a) => (
          <li key={a.attempt} className={a.ok ? undefined : 'rr-danger'}>
            Attempt {a.attempt} ({a.provider}/{a.model}): {a.ok ? 'valid' : `failed at ${a.stage}`}
            {a.errors.length > 0 && ` — ${a.errors.slice(0, 3).join('; ')}`}
          </li>
        ))}
      </ul>
      {report.examples.length > 0 && (
        <ul style={{ margin: 0, paddingLeft: 18 }} data-testid="ai-examples">
          {report.examples.map((e) => (
            <li key={e.name} className={e.passed ? undefined : 'rr-danger'}>
              {e.passed ? '✓' : '✗'} {e.name} ({e.source}){e.mismatches.length > 0 && ` — ${e.mismatches.join('; ')}`}
              {e.error && ` — ${e.error}`}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export function AiGeneratePanel({ props }: BaseComponentProps<Props>) {
  const host = useHost();
  const [prompt, setPrompt] = useState('');
  const [schema, setSchema] = useState('');
  const [examples, setExamples] = useState('');
  const [context, setContext] = useState('');
  const [baseVersion, setBaseVersion] = useState('');
  const [providerId, setProviderId] = useState(props.providers[0] ? String(props.providers[0].id) : '');
  const [running, setRunning] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [result, setResult] = useState<GenerateResult | null>(null);
  const [failure, setFailure] = useState<{ message: string; report?: ValidationReport; lastOutput?: string } | null>(null);

  useEffect(() => {
    if (!running) return;
    const started = Date.now();
    const t = setInterval(() => setElapsed(Math.round((Date.now() - started) / 1000)), 500);
    return () => clearInterval(t);
  }, [running]);

  if (!props.enabled) {
    return (
      <div className="rr-empty" data-testid="ai-disabled">
        <strong>AI generation is not enabled for this application.</strong>
        <p style={{ margin: '4px 0 0' }}>{props.disabledReason ?? 'An admin can enable a provider under Admin → AI providers.'}</p>
      </div>
    );
  }

  const schemaJson = parseJson(schema, 'Input schema');
  const examplesJson = parseJson(examples, 'Examples');
  const inputsValid = schemaJson.ok && examplesJson.ok && prompt.trim().length > 0;

  const generate = async () => {
    if (!schemaJson.ok || !examplesJson.ok) return;
    setRunning(true);
    setElapsed(0);
    setResult(null);
    setFailure(null);
    try {
      const data = await host.callAction<GenerateResult>('rules', 'generate', {
        app: props.app,
        decision: props.decision,
        prompt,
        inputSchema: schemaJson.value,
        examples: examplesJson.value,
        contextText: context || undefined,
        baseVersion: baseVersion ? Number(baseVersion) : undefined,
        providerId: providerId ? Number(providerId) : undefined,
      });
      setResult(data);
      host.toast(`Draft version ${data.version} created`, 'success');
    } catch (e) {
      if (e instanceof ActionError) {
        setFailure({
          message: e.message,
          report: e.body.validation_report as ValidationReport | undefined,
          lastOutput: e.body.last_output as string | undefined,
        });
      } else setFailure({ message: (e as Error).message });
    } finally {
      setRunning(false);
    }
  };

  return (
    <div data-testid="ai-panel" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div className="rr-field">
        <label htmlFor="ai-prompt">Describe the rule *</label>
        <textarea id="ai-prompt" className="rr-input" rows={4} value={prompt} onChange={(e) => setPrompt(e.target.value)} placeholder="Flag transactions above 10,000 on accounts younger than 30 days as high risk…" data-testid="ai-prompt" />
      </div>
      <details>
        <summary>Structured context (optional)</summary>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12, marginTop: 8 }}>
          <div className="rr-field">
            <label htmlFor="ai-examples">Examples: [{'{'} input, expected {'}'}]</label>
            <textarea id="ai-examples" className="rr-input mono" rows={6} value={examples} onChange={(e) => setExamples(e.target.value)} placeholder={EXAMPLES_PLACEHOLDER} data-testid="ai-examples-input" />
            {!examplesJson.ok && <small className="rr-danger">{examplesJson.error}</small>}
          </div>
          <div className="rr-field">
            <label htmlFor="ai-schema">Input JSON Schema</label>
            <textarea id="ai-schema" className="rr-input mono" rows={4} value={schema} onChange={(e) => setSchema(e.target.value)} />
            {!schemaJson.ok && <small className="rr-danger">{schemaJson.error}</small>}
          </div>
          <div className="rr-field">
            <label htmlFor="ai-context">Policy text (treated as data, not instructions)</label>
            <textarea id="ai-context" className="rr-input" rows={4} value={context} onChange={(e) => setContext(e.target.value)} />
          </div>
        </div>
      </details>
      <div style={{ display: 'flex', gap: 12, flexWrap: 'wrap' }}>
        {props.baseVersions.length > 0 && (
          <div className="rr-field">
            <label htmlFor="ai-base">Start from</label>
            <select id="ai-base" className="rr-input" value={baseVersion} onChange={(e) => setBaseVersion(e.target.value)}>
              <option value="">Scratch</option>
              {props.baseVersions.map((v) => (
                <option key={v} value={v}>
                  Version {v}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="rr-field">
          <label htmlFor="ai-provider">Provider</label>
          <select id="ai-provider" className="rr-input" value={providerId} onChange={(e) => setProviderId(e.target.value)}>
            {props.providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name} ({p.model})
              </option>
            ))}
          </select>
        </div>
      </div>
      <button type="button" className="rr-btn primary" onClick={generate} disabled={!inputsValid || running} style={{ alignSelf: 'flex-start' }} data-testid="ai-generate">
        {running ? `Generating… ${elapsed}s` : 'Generate draft'}
      </button>
      {running && <p className="rr-muted">The model writes the rule, then it is validated against the engine, your examples and the stored tests.</p>}
      {result && (
        <div className="rr-card" data-testid="ai-result">
          <p style={{ marginTop: 0 }}>
            <strong>Draft version {result.version}</strong>: {result.summary}
          </p>
          <p>{result.explanation}</p>
          <Report report={result.validation_report} />
          <button type="button" className="rr-btn primary" style={{ marginTop: 8 }} onClick={() => host.navigate(`/rules/${props.decision}?version=${result.version}`)} data-testid="ai-open-draft">
            Open draft v{result.version} in the editor
          </button>
        </div>
      )}
      {failure && (
        <div className="rr-error" data-testid="ai-failure">
          <p style={{ marginTop: 0 }}>{failure.message}</p>
          {failure.report && <Report report={failure.report} />}
          {failure.lastOutput && (
            <details>
              <summary>Last output (fix it by hand in the editor)</summary>
              <Pre value={failure.lastOutput} />
            </details>
          )}
        </div>
      )}
    </div>
  );
}
