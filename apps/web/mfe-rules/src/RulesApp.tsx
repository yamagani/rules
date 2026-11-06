import { query, RemoteFrame, subpath, type RemoteAppProps, type ScreenRoute } from '@rules/sdui-runtime';
import { useMemo } from 'react';

/** /rules → decision list; /rules/<decision>?version=n&tab=… → editor, test panel, AI panel. */
export function route(props: Pick<RemoteAppProps, 'basePath' | 'location'>): ScreenRoute {
  const [decision] = subpath(props.basePath, props.location);
  const q = query(props.location);
  return decision ? { screen: 'decision', params: { decision, version: q.version, tab: q.tab } } : { screen: 'list', params: {} };
}

export default function RulesApp(props: RemoteAppProps) {
  const r = useMemo(() => route(props), [props]);
  return (
    <div data-testid="mfe-rules-root">
      <RemoteFrame mfe="rules" route={r} props={props} />
    </div>
  );
}
