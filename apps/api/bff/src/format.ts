import type { Schemas } from '@rules/api-client';

export const statusTone = {
  draft: 'info',
  active: 'success',
  deprecated: 'warning',
  disabled: 'neutral',
} as const;

export function statusBadge(status: keyof typeof statusTone) {
  return { label: status, tone: statusTone[status] };
}

export function shortDate(iso: string | null | undefined): string | null {
  return iso ? iso.slice(0, 10) : null;
}

/** One readable line per audit entry, built from its recorded old/new values. */
export function auditSummary(e: Schemas['AuditOut']): string {
  const d = e.details as Record<string, unknown>;
  const v = (k: string) => (d[k] === null || d[k] === undefined ? '—' : String(d[k]));
  switch (e.action) {
    case 'alias.moved':
      return `Alias "${v('alias')}" moved from v${v('old_version')} to v${v('new_version')}`;
    case 'alias.created':
      return `Alias "${v('alias')}" created on v${v('new_version')}`;
    case 'alias.deleted':
      return `Alias "${v('alias')}" removed (was v${v('old_version')})`;
    case 'version.activated':
    case 'version.enabled':
    case 'version.disabled':
    case 'version.deprecated': {
      const tests = d.tests as { passed?: number; total?: number } | undefined;
      const sunset = d.new_sunset_at ? `, sunset ${String(d.new_sunset_at).slice(0, 10)}` : '';
      return `v${v('version')}: ${v('old_status')} → ${v('new_status')}${tests ? ` (tests ${tests.passed}/${tests.total})` : ''}${sunset}`;
    }
    case 'version.created':
      return `v${v('version')} saved by ${v('author')}${d.comment ? `: ${v('comment')}` : ''}`;
    case 'ai.generated':
      return `Generated draft v${v('version')} with ${v('provider')}/${v('model')} in ${v('attempts')} attempt(s) (run #${v('run_id')}, ${v('input_tokens')}+${v('output_tokens')} tokens)`;
    case 'ai.generation_failed':
      return `AI generation failed (run #${v('run_id')})${d.stage ? ` at ${v('stage')}` : ''}${d.error ? `: ${v('error')}` : ''}`;
    case 'grant.created':
    case 'grant.deleted':
      return `${v('permission')} for ${v('subject_type')} "${v('subject')}" on ${v('scope')}`;
    default:
      return Object.entries(d)
        .slice(0, 4)
        .map(([k, val]) => `${k}=${typeof val === 'object' ? JSON.stringify(val) : String(val)}`)
        .join(', ');
  }
}
