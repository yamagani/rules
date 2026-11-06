/** Minimal design tokens and component CSS, injected once. Light and dark aware. */
export const CSS = `
:root{--rr-bg:#f7f8fa;--rr-surface:#fff;--rr-text:#1d2330;--rr-muted:#5e6676;--rr-border:#dde1e8;--rr-primary:#2f5bea;--rr-primary-text:#fff;--rr-danger:#c4372d;--rr-success:#1f7a4d;--rr-warning:#9a6200;--rr-info:#2f5bea;--rr-code:#f1f3f6;--rr-radius:8px}
@media (prefers-color-scheme: dark){:root{--rr-bg:#12151b;--rr-surface:#1a1f27;--rr-text:#e6e9ef;--rr-muted:#9aa3b2;--rr-border:#2c3340;--rr-primary:#6d8dff;--rr-primary-text:#0b0d12;--rr-danger:#ff7a6e;--rr-success:#5fd39a;--rr-warning:#ffc266;--rr-info:#8aa6ff;--rr-code:#222935}}
.rr-page{color:var(--rr-text);font:14px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}
.rr-page h1{font-size:22px;margin:0 0 4px}.rr-sub{color:var(--rr-muted);margin:0 0 16px}
.rr-crumbs{font-size:12px;color:var(--rr-muted);margin-bottom:4px}.rr-crumbs a{color:inherit}
.rr-card{background:var(--rr-surface);border:1px solid var(--rr-border);border-radius:var(--rr-radius);padding:16px;min-width:0}
.rr-card>h3{margin:0 0 2px;font-size:15px}.rr-card>.rr-sub{margin-bottom:12px;font-size:13px}
.rr-grid{display:grid;min-width:0}@media (max-width:760px){.rr-grid{grid-template-columns:1fr!important}}
.rr-tabs{display:flex;gap:4px;border-bottom:1px solid var(--rr-border);margin-bottom:12px;overflow-x:auto}
.rr-tab{border:0;background:none;padding:8px 12px;cursor:pointer;color:var(--rr-muted);border-bottom:2px solid transparent;font:inherit}
.rr-tab[aria-selected=true]{color:var(--rr-text);border-color:var(--rr-primary);font-weight:600}
.rr-btn{border:1px solid var(--rr-border);background:var(--rr-surface);color:var(--rr-text);border-radius:6px;padding:6px 12px;font:inherit;cursor:pointer;white-space:nowrap}
.rr-btn:disabled{opacity:.5;cursor:not-allowed}.rr-btn.primary{background:var(--rr-primary);border-color:var(--rr-primary);color:var(--rr-primary-text)}
.rr-btn.danger{color:var(--rr-danger);border-color:var(--rr-danger)}.rr-btn.ghost{border-color:transparent;background:none}
.rr-badge{display:inline-block;padding:1px 8px;border-radius:999px;font-size:12px;font-weight:600;border:1px solid currentColor}
.rr-badge.neutral{color:var(--rr-muted)}.rr-badge.info{color:var(--rr-info)}.rr-badge.success{color:var(--rr-success)}.rr-badge.warning{color:var(--rr-warning)}.rr-badge.danger{color:var(--rr-danger)}
.rr-table-wrap{overflow-x:auto}.rr-table{width:100%;border-collapse:collapse}.rr-table th,.rr-table td{text-align:left;padding:8px;border-bottom:1px solid var(--rr-border);vertical-align:top}
.rr-table th{font-size:12px;color:var(--rr-muted);font-weight:600}.rr-actions{display:flex;gap:6px;flex-wrap:wrap}
.rr-field{display:flex;flex-direction:column;gap:4px;min-width:0}.rr-field label{font-size:12px;color:var(--rr-muted);font-weight:600}
.rr-input{border:1px solid var(--rr-border);border-radius:6px;padding:6px 8px;font:inherit;background:var(--rr-surface);color:var(--rr-text);min-width:0}
.rr-code,.rr-input.mono{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.rr-pre{background:var(--rr-code);border-radius:6px;padding:8px;overflow:auto;max-height:360px;margin:0;font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:12px}
.rr-kv{display:grid;grid-template-columns:max-content 1fr;gap:4px 16px;margin:0}.rr-kv dt{color:var(--rr-muted)}.rr-kv dd{margin:0;min-width:0;overflow-wrap:anywhere}
.rr-empty{text-align:center;color:var(--rr-muted);padding:24px}.rr-muted{color:var(--rr-muted)}.rr-danger{color:var(--rr-danger)}
.rr-overlay{position:fixed;inset:0;background:rgba(10,12,18,.45);display:flex;align-items:center;justify-content:center;z-index:50;padding:16px}
.rr-modal{background:var(--rr-surface);border-radius:var(--rr-radius);padding:16px;width:min(560px,100%);max-height:90vh;overflow:auto}
.rr-diff{display:grid;grid-template-columns:1fr 1fr;gap:8px}@media (max-width:760px){.rr-diff{grid-template-columns:1fr}}
.rr-diff-line{white-space:pre;padding:0 6px}.rr-diff-line.add{background:rgba(31,122,77,.18)}.rr-diff-line.del{background:rgba(196,55,45,.18)}
.rr-timeline{list-style:none;margin:0;padding:0}.rr-timeline li{border-left:2px solid var(--rr-border);padding:0 0 12px 12px;position:relative}
.rr-timeline li::before{content:"";position:absolute;left:-5px;top:6px;width:8px;height:8px;border-radius:50%;background:var(--rr-primary)}
.rr-error{border:1px solid var(--rr-danger);color:var(--rr-danger);border-radius:var(--rr-radius);padding:12px;background:var(--rr-surface)}
`;

let injected = false;
export function ensureStyles(): void {
  if (injected || typeof document === 'undefined') return;
  injected = true;
  const el = document.createElement('style');
  el.dataset.rulesRegistry = 'true';
  el.textContent = CSS;
  document.head.appendChild(el);
}

export const gapPx = { none: 0, sm: 6, md: 12, lg: 20 } as const;
