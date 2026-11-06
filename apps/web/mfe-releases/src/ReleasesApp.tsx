export interface ReleasesAppProps {
  /** Base path the shell mounts this remote under (e.g. "/releases"). */
  basePath: string;
}

export default function ReleasesApp({ basePath }: ReleasesAppProps) {
  return (
    <section data-testid="mfe-releases-root">
      <h2>Releases</h2>
      <p>Mounted at {basePath}. Screens arrive in Phase 4.</p>
    </section>
  );
}
