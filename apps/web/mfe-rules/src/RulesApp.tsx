export interface RulesAppProps {
  /** Base path the shell mounts this remote under (e.g. "/rules"). */
  basePath: string;
}

export default function RulesApp({ basePath }: RulesAppProps) {
  return (
    <section data-testid="mfe-rules-root">
      <h2>Rules</h2>
      <p>Mounted at {basePath}. Screens arrive in Phase 4.</p>
    </section>
  );
}
