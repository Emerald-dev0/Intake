import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';

const LandingPage = lazy(() => import('../App'));
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then(m => ({ default: m.OverviewPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })));
function NotFoundPage() {
  return <main className="workspace-status"><h1>Page not found</h1><a href="/">Back to Intake</a></main>;
}

export const routes: RouteObject[] = [
  { path: '/', element: <LandingPage /> },
  { path: '/auth/sign-in', element: <AuthPage key="sign-in" /> },
  { path: '/auth/sign-up', element: <AuthPage key="sign-up" signUp /> },
  { path: '/app', element: <ProtectedLayout />, children: [
    { element: <WorkspaceLayout />, children: [
      { index: true, element: <OverviewPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFoundPage /> },
    ] },
  ] },
  { path: '*', element: <NotFoundPage /> },
];
