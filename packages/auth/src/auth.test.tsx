import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Session } from '@rules/schemas';
import { hasPermission } from './index';
import { Can, SessionProvider } from './react';

const session = (global: Session['permissions']['global'], apps: Session['permissions']['apps']): Session => ({
  authenticated: true,
  user: { subject: 'u', displayName: 'U', roles: [] },
  permissions: { global, apps },
  demoMode: false,
  demoUsers: [],
  app: 'loan-origination',
});

describe('hasPermission', () => {
  it('applies implications', () => {
    const bob = session([], { 'loan-origination': ['edit', 'publish'] });
    expect(hasPermission(bob, 'loan-origination', 'view')).toBe(true);
    expect(hasPermission(bob, 'loan-origination', 'admin')).toBe(false);
    expect(hasPermission(bob, 'other-app', 'view')).toBe(false);
    const alice = session(['admin'], {});
    expect(hasPermission(alice, 'any-app', 'publish')).toBe(true);
    const svc = session([], { 'loan-origination': ['evaluate'] });
    expect(hasPermission(svc, 'loan-origination', 'view')).toBe(false);
  });
});

describe('<Can/>', () => {
  it('renders children only with the permission', () => {
    render(
      <SessionProvider session={session([], { 'loan-origination': ['edit'] })}>
        <Can permission="edit"><span>edit-button</span></Can>
        <Can permission="publish" fallback={<span>no-publish</span>}><span>publish-button</span></Can>
      </SessionProvider>,
    );
    expect(screen.queryByText('edit-button')).not.toBeNull();
    expect(screen.queryByText('publish-button')).toBeNull();
    expect(screen.queryByText('no-publish')).not.toBeNull();
  });
});
