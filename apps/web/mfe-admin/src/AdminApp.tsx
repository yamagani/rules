import { query, RemoteFrame, type RemoteAppProps, type ScreenRoute } from '@rules/sdui-runtime';
import { useMemo } from 'react';

/** /admin?tab=grants|audit|ai|usage → access, audit log, AI providers, AI usage. */
export function route(props: Pick<RemoteAppProps, 'location'>): ScreenRoute {
  return { screen: 'overview', params: { tab: query(props.location).tab } };
}

export default function AdminApp(props: RemoteAppProps) {
  const r = useMemo(() => route(props), [props]);
  return (
    <div data-testid="mfe-admin-root">
      <RemoteFrame mfe="admin" route={r} props={props} />
    </div>
  );
}
