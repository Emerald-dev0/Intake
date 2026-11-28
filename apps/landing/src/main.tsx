import { StrictMode, Suspense } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource-variable/geist';
import '@fontsource-variable/geist-mono';
import '@fontsource-variable/fraunces/standard.css';
import '@fontsource-variable/fraunces/standard-italic.css';
import './styles/base.css';
import './styles/marketing.css';
import './styles/landing.css';
// `hero.css` and `home.css` belong to `src/marketing/MarketingHome.tsx`, which is no longer the
// homepage. They stay in the repository with that page; importing them here would ship their
// rules to every visitor of a page that no longer uses them.
import { BrowserRouter, useRoutes } from 'react-router-dom';
import { routes } from './app/routes';
import { IntakeLoader } from './components/IntakeLoader';
function Routes() { return useRoutes(routes); }
import './styles/app.css';
import './styles/drafts.css';
import './styles/edit-forms.css';
import './styles/library.css';
import './styles/admin.css';
import './styles/pricing.css';
import './styles/privacy.css';
import './styles/billing.css';
import './styles/developers.css';
import './styles/hosted-form.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Suspense fallback={<IntakeLoader label="Opening Intake…" />}>
      <BrowserRouter><Routes /></BrowserRouter>
    </Suspense>
  </StrictMode>,
);
