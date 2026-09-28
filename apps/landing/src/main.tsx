import { StrictMode, Suspense, lazy } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/fraunces/full.css';
import '@fontsource-variable/fraunces/full-italic.css';
import './styles/base.css';
import './styles/reel.css';
import './styles/sections.css';
import './styles/mobile.css';
const App = lazy(() => import('./App'));
const AuthPage = lazy(() => import('./app/AuthPage').then(m => ({ default: m.AuthPage })));
const Workspace = lazy(() => import('./app/Workspace').then(m => ({ default: m.Workspace })));
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="workspace-status" role="status">Opening Intake…</div>}>
      {location.pathname.startsWith('/app') ? <Workspace /> : location.pathname.startsWith('/auth/') ? <AuthPage /> : <App />}
    </Suspense>
  </StrictMode>,
);
