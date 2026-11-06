import { StandaloneHost } from '@rules/sdui-runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ReleasesApp from './ReleasesApp';

// Standalone development entry: the remote without the shell, with a mock session.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneHost App={ReleasesApp} basePath="/releases" mockUser={import.meta.env.VITE_MOCK_USER ?? 'bob'} />
  </StrictMode>,
);
