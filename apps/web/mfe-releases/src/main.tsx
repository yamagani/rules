import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReleasesApp from './ReleasesApp';

// Standalone entry for local development: renders the remote without the shell.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ReleasesApp basePath="/releases" />
  </StrictMode>,
);
