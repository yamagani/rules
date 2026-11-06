import { StandaloneHost } from '@rules/sdui-runtime';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import RulesApp from './RulesApp';

// Standalone development entry: the remote without the shell, with a mock session.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <StandaloneHost App={RulesApp} basePath="/rules" mockUser={import.meta.env.VITE_MOCK_USER ?? 'carol'} />
  </StrictMode>,
);
