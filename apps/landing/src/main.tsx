import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/fraunces/standard.css';
import '@fontsource-variable/fraunces/standard-italic.css';
import './styles/base.css';
import './styles/marketing.css';
import { BrowserRouter, useRoutes } from 'react-router-dom';
import { routes } from './app/routes';
function Routes() { return useRoutes(routes); }
import './styles/app.css';
import './styles/drafts.css';
import './styles/edit-forms.css';
import './styles/library.css';
import './styles/admin.css';
import './styles/pricing.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<div className="workspace-status" role="status">Opening Intake…</div>}>
      <BrowserRouter><Routes /></BrowserRouter>
    </Suspense>
  </StrictMode>,
);
