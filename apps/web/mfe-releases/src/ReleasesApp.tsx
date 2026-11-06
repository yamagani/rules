import { query, RemoteFrame, subpath, type RemoteAppProps, type ScreenRoute } from '@rules/sdui-runtime';
import { useMemo } from 'react';

/** /releases → decisions; /releases/<decision>?from=&to= → versions, aliases, usage, diff. */
export function route(props: Pick<RemoteAppProps, 'basePath' | 'location'>): ScreenRoute {
  const [decision] = subpath(props.basePath, props.location);
  const q = query(props.location);
  return decision ? { screen: 'versions', params: { decision, from: q.from, to: q.to } } : { screen: 'list', params: {} };
}

export default function ReleasesApp(props: RemoteAppProps) {
  const r = useMemo(() => route(props), [props]);
  return (
    <div data-testid="mfe-releases-root">
      <RemoteFrame mfe="releases" route={r} props={props} />
    </div>
  );
}
