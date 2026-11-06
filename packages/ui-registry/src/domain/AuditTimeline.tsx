import type { BaseComponentProps } from '@json-render/react';
import type { z } from 'zod';
import type { domainSchemas } from './schemas';

type Props = z.output<typeof domainSchemas.AuditTimeline.props>;

export function AuditTimeline({ props }: BaseComponentProps<Props>) {
  if (props.entries.length === 0) return <div className="rr-empty">No audit entries yet</div>;
  return (
    <ol className="rr-timeline" data-testid="audit-timeline">
      {props.entries.map((e) => (
        <li key={e.id} data-testid={`audit-${e.action}`}>
          <div>
            <strong>{e.actor}</strong> <code className="rr-code">{e.action}</code>
            {e.decision && (
              <span className="rr-muted">
                {' '}
                on {e.decision}
                {e.version ? ` v${e.version}` : ''}
              </span>
            )}
          </div>
          <div>{e.summary}</div>
          <small className="rr-muted">{new Date(e.at).toLocaleString()}</small>
        </li>
      ))}
    </ol>
  );
}
