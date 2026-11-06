import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import AdminApp from './AdminApp';

// Standalone entry for local development: renders the remote without the shell.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AdminApp basePath="/admin" />
  </StrictMode>,
);
