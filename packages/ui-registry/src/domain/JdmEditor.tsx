import type { BaseComponentProps } from '@json-render/react';
import { lazy, Suspense, useEffect, useState } from 'react';
import type { z } from 'zod';
import { useHost } from '../host';
import type { domainSchemas } from './schemas';
import { errorText, stableStringify, useAsync } from './util';

type Props = z.output<typeof domainSchemas.JdmEditor.props>;
type Graph = { nodes: unknown[]; edges: unknown[] };
interface Loaded {
  version: number | null;
  status: string | null;
  content: Graph;
}

// The GoRules editor (antd, Monaco, React Flow) is large: load it only when an editor renders.
const EditorCanvas = lazy(() => import('./JdmEditorCanvas'));

export function JdmEditor({ props }: BaseComponentProps<Props>) {
  const host = useHost();
  const requestKey = `${props.app}/${props.decisionRef}/${props.versionId ?? 'draft'}`;
  const [result, setResult] = useState<{ key: string; data: Loaded } | null>(null);
  const [graph, setGraph] = useState<Graph | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [comment, setComment] = useState('');
  const save = useAsync<{ version: number }>();

  useEffect(() => {
    let alive = true;
    host
      .callAction<Loaded>('rules', 'loadVersion', {
        app: props.app,
        decision: props.decisionRef,
        ...(props.versionId ? { version: props.versionId } : { draft: true }),
      })
      .then(
        (data) => {
          if (!alive) return;
          setResult({ key: requestKey, data });
          setGraph(data.content);
        },
        (e) => alive && setLoadError(errorText(e)),
      );
    return () => {
      alive = false;
    };
  }, [host, props.app, props.decisionRef, props.versionId, requestKey]);

  const loaded = result?.key === requestKey ? result.data : null;

  const editable = !props.readOnly && props.canSave;
  const dirty = !!graph && !!loaded && stableStringify(graph) !== stableStringify(loaded.content);

  const onSave = async () => {
    if (!graph) return;
    const res = await save.run(() =>
      host.callAction<{ version: number }>('rules', 'saveVersion', {
        app: props.app,
        decision: props.decisionRef,
        content: graph,
        comment: comment || undefined,
      }),
    );
    if (res) {
      host.toast(`Saved as draft version ${res.version}`, 'success');
      host.navigate(`/rules/${props.decisionRef}?version=${res.version}`);
    }
  };

  if (loadError) return <div className="rr-error">Could not load the decision graph: {loadError}</div>;
  if (!loaded || !graph) return <p className="rr-muted">Loading decision graph…</p>;

  return (
    <div data-testid="jdm-editor" style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
      <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
        <span className="rr-muted">
          {loaded.version ? `Version ${loaded.version} (${loaded.status})` : 'New graph'}
          {props.readOnly && ' · read-only'}
          {dirty && ' · unsaved changes'}
        </span>
        {editable && (
          <>
            <input className="rr-input" placeholder="Change comment" value={comment} onChange={(e) => setComment(e.target.value)} style={{ flex: '1 1 200px' }} aria-label="Change comment" />
            <button type="button" className="rr-btn primary" disabled={!dirty || save.running} onClick={onSave} data-testid="save-draft">
              {save.running ? 'Saving…' : 'Save as new draft'}
            </button>
          </>
        )}
      </div>
      {save.error && <div className="rr-error">{save.error}</div>}
      <Suspense fallback={<p className="rr-muted">Loading editor…</p>}>
        <EditorCanvas value={graph} readOnly={!editable} onChange={(g) => setGraph(g as Graph)} />
      </Suspense>
    </div>
  );
}
