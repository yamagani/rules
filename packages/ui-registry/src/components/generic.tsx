import { useActions, useBoundProp, useStateStore, useStateValue, type BaseComponentProps } from '@json-render/react';
import { Can as CanGuard } from '@rules/auth/react';
import { Children, useState, type ReactNode } from 'react';
import type { z } from 'zod';
import type { genericSchemas } from '../catalog';
import { gapPx } from './styles';

type P<N extends keyof typeof genericSchemas> = BaseComponentProps<z.output<(typeof genericSchemas)[N]['props']>>;

const testId = (id?: string) => (id ? { 'data-testid': id } : {});

export function Page({ props, children }: P<'Page'>) {
  return (
    <div className="rr-page">
      {props.breadcrumbs.length > 0 && (
        <nav className="rr-crumbs" aria-label="Breadcrumb">
          {props.breadcrumbs.map((b, i) => (
            <span key={i}>
              {i > 0 && ' / '}
              {b.href ? <a href={b.href}>{b.label}</a> : b.label}
            </span>
          ))}
        </nav>
      )}
      <h1>{props.title}</h1>
      {props.subtitle && <p className="rr-sub">{props.subtitle}</p>}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>{children}</div>
    </div>
  );
}

export function Stack({ props, children }: P<'Stack'>) {
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: props.direction === 'horizontal' ? 'row' : 'column',
        gap: gapPx[props.gap],
        alignItems: props.align,
        flexWrap: props.wrap ? 'wrap' : undefined,
        minWidth: 0,
      }}
    >
      {children}
    </div>
  );
}

export function Grid({ props, children }: P<'Grid'>) {
  return (
    <div className="rr-grid" style={{ gridTemplateColumns: `repeat(${props.columns}, minmax(0, 1fr))`, gap: gapPx[props.gap] }}>
      {children}
    </div>
  );
}

export function Card({ props, children }: P<'Card'>) {
  return (
    <section className="rr-card">
      {props.title && <h3>{props.title}</h3>}
      {props.subtitle && <p className="rr-sub">{props.subtitle}</p>}
      {children}
    </section>
  );
}

export function Tabs({ props, children }: P<'Tabs'>) {
  const [active, setActive] = useState(props.defaultTab ?? props.tabs[0]?.id);
  const panes = Children.toArray(children);
  const index = Math.max(0, props.tabs.findIndex((t) => t.id === active));
  return (
    <div>
      <div className="rr-tabs" role="tablist">
        {props.tabs.map((t) => (
          <button key={t.id} type="button" role="tab" className="rr-tab" aria-selected={t.id === props.tabs[index]?.id} onClick={() => setActive(t.id)}>
            {t.label}
          </button>
        ))}
      </div>
      <div role="tabpanel">{panes[index]}</div>
    </div>
  );
}

export function Toolbar({ props, children }: P<'Toolbar'>) {
  const justify = { start: 'flex-start', end: 'flex-end', between: 'space-between' }[props.align];
  return <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', justifyContent: justify, alignItems: 'center' }}>{children}</div>;
}

export function Modal({ props, children }: P<'Modal'>) {
  const open = useStateValue<string | null>('/ui/modal') === props.id;
  const { set } = useStateStore();
  if (!open) return null;
  return (
    <div className="rr-overlay" role="presentation" onClick={() => set('/ui/modal', null)}>
      <div className="rr-modal" role="dialog" aria-modal="true" aria-label={props.title} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 }}>
          <strong>{props.title}</strong>
          <button type="button" className="rr-btn ghost" aria-label="Close" onClick={() => set('/ui/modal', null)}>
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

type Cell = z.output<(typeof genericSchemas)['DataTable']['props']>['rows'][number]['cells'][string];

function renderCell(value: Cell | undefined, kind: string): ReactNode {
  if (value === null || value === undefined || value === '') return <span className="rr-muted">—</span>;
  if (Array.isArray(value)) {
    return (
      <span style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
        {value.map((v) => (
          <span key={v} className="rr-badge info">
            {v}
          </span>
        ))}
      </span>
    );
  }
  if (typeof value === 'object') return <span className={`rr-badge ${value.tone}`}>{value.label}</span>;
  if (kind === 'code') return <code className="rr-code">{String(value)}</code>;
  if (kind === 'date' && typeof value === 'string') return new Date(value).toLocaleString();
  return String(value);
}

export function DataTable({ props }: P<'DataTable'>) {
  const { execute } = useActions();
  if (props.rows.length === 0) return <div className="rr-empty">{props.emptyText}</div>;
  const hasActions = props.rows.some((r) => r.actions.length > 0);
  return (
    <div className="rr-table-wrap">
      <table className="rr-table" {...testId(props.testId)}>
        <thead>
          <tr>
            {props.columns.map((c) => (
              <th key={c.key}>{c.label}</th>
            ))}
            {hasActions && <th>Actions</th>}
          </tr>
        </thead>
        <tbody>
          {props.rows.map((row) => (
            <tr key={row.id} data-testid={`row-${row.id}`}>
              {props.columns.map((c, i) => (
                <td key={c.key}>
                  {i === 0 && row.href ? <a href={row.href}>{renderCell(row.cells[c.key], c.kind)}</a> : renderCell(row.cells[c.key], c.kind)}
                </td>
              ))}
              {hasActions && (
                <td>
                  <div className="rr-actions">
                    {row.actions.map((a) => (
                      <button key={a.label} type="button" className={`rr-btn ${a.variant}`} onClick={() => void execute(a.on as never)}>
                        {a.label}
                      </button>
                    ))}
                  </div>
                </td>
              )}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function KeyValue({ props }: P<'KeyValue'>) {
  return (
    <dl className="rr-kv">
      {props.items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt>{item.label}</dt>
          <dd className={item.mono ? 'rr-code' : undefined}>{item.value === null ? '—' : String(item.value)}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Badge({ props }: P<'Badge'>) {
  return <span className={`rr-badge ${props.tone}`}>{props.label}</span>;
}

export function EmptyState({ props }: P<'EmptyState'>) {
  return (
    <div className="rr-empty">
      <strong>{props.title}</strong>
      {props.description && <p style={{ margin: '4px 0 0' }}>{props.description}</p>}
    </div>
  );
}

export function Text({ props }: P<'Text'>) {
  const cls = props.tone === 'muted' ? 'rr-muted' : props.tone === 'danger' ? 'rr-danger' : undefined;
  return <p className={cls} style={{ margin: 0 }}>{props.text}</p>;
}

export function Form({ props, children }: P<'Form'>) {
  return (
    <form id={props.id} onSubmit={(e) => e.preventDefault()} style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      {props.title && <strong>{props.title}</strong>}
      {children}
    </form>
  );
}

export function TextField({ props, bindings }: P<'TextField'>) {
  const [value, setValue] = useBoundProp<string>(props.value as string, bindings?.value);
  const id = `f-${bindings?.value ?? props.label}`;
  return (
    <div className="rr-field">
      <label htmlFor={id}>
        {props.label}
        {props.required && ' *'}
      </label>
      {props.multiline ? (
        <textarea id={id} className="rr-input" rows={3} value={value ?? ''} placeholder={props.placeholder} onChange={(e) => setValue(e.target.value)} {...testId(props.testId)} />
      ) : (
        <input id={id} className="rr-input" type={props.type} value={value ?? ''} placeholder={props.placeholder} onChange={(e) => setValue(e.target.value)} {...testId(props.testId)} />
      )}
    </div>
  );
}

export function Select({ props, bindings }: P<'Select'>) {
  const [value, setValue] = useBoundProp<string>(props.value as string, bindings?.value);
  const id = `s-${bindings?.value ?? props.label}`;
  return (
    <div className="rr-field">
      <label htmlFor={id}>{props.label}</label>
      <select id={id} className="rr-input" value={value ?? ''} onChange={(e) => setValue(e.target.value)} {...testId(props.testId)}>
        {props.options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </div>
  );
}

export function JsonField({ props, bindings }: P<'JsonField'>) {
  const [value, setValue] = useBoundProp<string>(props.value as string, bindings?.value);
  let error: string | null = null;
  if (value?.trim()) {
    try {
      JSON.parse(value);
    } catch (e) {
      error = (e as Error).message;
    }
  }
  const id = `j-${bindings?.value ?? props.label}`;
  return (
    <div className="rr-field">
      <label htmlFor={id}>{props.label}</label>
      <textarea id={id} className="rr-input mono" rows={props.rows} value={value ?? ''} onChange={(e) => setValue(e.target.value)} spellCheck={false} aria-invalid={!!error} />
      {error && <small className="rr-danger">Invalid JSON: {error}</small>}
    </div>
  );
}

export function Button({ props, emit, loading }: P<'Button'>) {
  return (
    <button type="button" className={`rr-btn ${props.variant}`} disabled={props.disabled || loading} onClick={() => emit('press')} {...testId(props.testId)}>
      {props.label}
    </button>
  );
}

export function Can({ props, children }: P<'Can'>) {
  return (
    <CanGuard permission={props.permission} app={props.app}>
      {children}
    </CanGuard>
  );
}
