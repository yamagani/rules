/** One valid and one invalid props fixture per catalog component (used by tests and docs). */
import type { ComponentName } from './catalog';

export const propFixtures: Record<ComponentName, { valid: unknown; invalid: unknown }> = {
  Page: { valid: { title: 'Rules', breadcrumbs: [{ label: 'Home', href: '/' }] }, invalid: { subtitle: 'no title' } },
  Stack: { valid: { direction: 'horizontal', gap: 'sm' }, invalid: { direction: 'diagonal' } },
  Grid: { valid: { columns: 2 }, invalid: { columns: 9 } },
  Card: { valid: { title: 'Versions' }, invalid: { title: 42 } },
  Tabs: { valid: { tabs: [{ id: 'a', label: 'A' }] }, invalid: { tabs: [] } },
  Toolbar: { valid: { align: 'between' }, invalid: { align: 'middle' } },
  Modal: { valid: { id: 'alias', title: 'Move alias' }, invalid: { id: 'alias' } },
  DataTable: {
    valid: {
      columns: [{ key: 'version', label: 'Version' }, { key: 'status', label: 'Status', kind: 'badge' }],
      rows: [
        {
          id: 3,
          cells: { version: 'v3', status: { label: 'active', tone: 'success' }, aliases: ['default'] },
          actions: [{ label: 'Deprecate', on: { action: 'submit', params: { action: 'deprecate' } } }],
        },
      ],
    },
    invalid: { columns: [], rows: [] },
  },
  KeyValue: { valid: { items: [{ label: 'Version', value: 3 }] }, invalid: { items: [{ label: 'x', value: { nested: true } }] } },
  Badge: { valid: { label: 'active', tone: 'success' }, invalid: { label: 'active', tone: 'purple' } },
  EmptyState: { valid: { title: 'No versions' }, invalid: { description: 'missing title' } },
  Text: { valid: { text: 'Hello' }, invalid: { text: ['Hello'] } },
  Form: { valid: { id: 'create' }, invalid: {} },
  TextField: { valid: { label: 'Key', value: { $bindState: '/form/key' } }, invalid: { label: 'Key', value: { $bindState: 'form/key' } } },
  Select: {
    valid: { label: 'Alias', value: 'beta', options: [{ value: 'beta', label: 'beta' }] },
    invalid: { label: 'Alias', value: 'beta', options: ['beta'] },
  },
  JsonField: { valid: { label: 'Input', value: '{}' }, invalid: { label: 'Input', value: '{}', rows: 1 } },
  Button: { valid: { label: 'Activate', variant: 'primary' }, invalid: { label: 'Activate', variant: 'shiny' } },
  Can: { valid: { permission: 'publish' }, invalid: { permission: 'superuser' } },
  JdmEditor: {
    valid: { app: 'loan-origination', decisionRef: 'eligibility', versionId: 5, readOnly: false, canSave: true },
    invalid: { app: 'loan-origination', decisionRef: 'eligibility', versionId: 0, readOnly: false },
  },
  VersionDiff: {
    valid: { app: 'loan-origination', decision: 'eligibility', from: 3, to: 5 },
    invalid: { app: 'loan-origination', decision: 'eligibility', from: 'v3', to: 5 },
  },
  TestPanel: {
    valid: { app: 'loan-origination', decision: 'eligibility', targets: [{ value: 'draft', label: 'Latest draft' }], defaultTarget: 'draft' },
    invalid: { app: 'loan-origination', decision: 'eligibility', targets: [], defaultTarget: 'draft' },
  },
  AuditTimeline: {
    valid: { entries: [{ id: 1, actor: 'bob', action: 'alias.moved', at: '2026-01-01T00:00:00Z', summary: 'beta → v5' }] },
    invalid: { entries: [{ id: 1, actor: 'bob' }] },
  },
  AiGeneratePanel: {
    valid: { app: 'loan-origination', decision: 'fraud-flag', enabled: true, providers: [{ id: 1, name: 'mock', model: 'm' }] },
    invalid: { app: 'loan-origination', decision: 'fraud-flag', providers: [] },
  },
  ProviderSettings: {
    valid: {
      app: 'loan-origination',
      canEdit: true,
      providers: [
        { id: 1, name: 'mock', type: 'mock', model: 'm', baseUrl: null, apiKeyRef: null, keyConfigured: true, enabled: true, monthlyTokenBudget: null, tokensThisMonth: 0 },
      ],
      appProviderId: 1,
      appFallbackProviderId: null,
    },
    invalid: {
      app: 'loan-origination',
      canEdit: true,
      providers: [{ id: 1, name: 'x', type: 'skynet', model: 'm' }],
      appProviderId: null,
      appFallbackProviderId: null,
    },
  },
};
