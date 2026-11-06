import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import RulesApp from './RulesApp';

// Standalone entry for local development: renders the remote without the shell.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <RulesApp basePath="/rules" />
  </StrictMode>,
);
