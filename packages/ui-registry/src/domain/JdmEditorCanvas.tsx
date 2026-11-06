import '@gorules/jdm-editor/dist/style.css';
import { DecisionGraph, JdmConfigProvider, type DecisionGraphType } from '@gorules/jdm-editor';

export interface JdmEditorCanvasProps {
  value: unknown;
  readOnly: boolean;
  onChange: (graph: DecisionGraphType) => void;
}

/** The GoRules editor itself. Its output *is* the JDM JSON stored by rules-service. */
export default function JdmEditorCanvas({ value, readOnly, onChange }: JdmEditorCanvasProps) {
  const dark = typeof window !== 'undefined' && window.matchMedia?.('(prefers-color-scheme: dark)').matches;
  return (
    <div style={{ height: 560, border: '1px solid var(--rr-border)', borderRadius: 8, overflow: 'hidden' }}>
      <JdmConfigProvider theme={dark ? { mode: 'dark' } : undefined}>
        <DecisionGraph value={value as DecisionGraphType} disabled={readOnly} onChange={onChange} />
      </JdmConfigProvider>
    </div>
  );
}
