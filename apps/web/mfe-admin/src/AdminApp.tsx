export interface AdminAppProps {
  /** Base path the shell mounts this remote under (e.g. "/admin"). */
  basePath: string;
}

export default function AdminApp({ basePath }: AdminAppProps) {
  return (
    <section data-testid="mfe-admin-root">
      <h2>Admin</h2>
      <p>Mounted at {basePath}. Screens arrive in Phase 4.</p>
    </section>
  );
}
