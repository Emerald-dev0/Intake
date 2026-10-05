import { lazy } from 'react';
import type { RouteObject } from 'react-router-dom';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';

const LandingPage = lazy(() => import('../App'));
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then(m => ({ default: m.OverviewPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const FormsPage = lazy(() => import('./pages/FormsPage').then(m => ({ default: m.FormsPage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then(m => ({ default: m.LibraryPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })));
const PricingPage = lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })));
const AdminGate = lazy(() => import('../admin/AdminGate').then(m => ({ default: m.AdminGate })));
const AdminShell = lazy(() => import('../admin/AdminShell').then(m => ({ default: m.AdminShell })));
const AdminOverviewPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminOverviewPage })));
const AdminUsersPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminUserDetailPage })));
const AdminAiPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminAiPage })));
const AdminCreditsPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminCreditsPage })));
const AdminFormsPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminFormsPage })));
const AdminProvidersPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminProvidersPage })));
const AdminSystemPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminSystemPage })));
const AdminActivityPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminActivityPage })));
function NotFoundPage() {
  return <main className="workspace-status"><h1>Page not found</h1><a href="/">Back to Intake</a></main>;
}

export const routes: RouteObject[] = [
  { path: '/', element: <LandingPage /> },
  { path: '/pricing', element: <PricingPage /> },
  { path: '/auth/sign-in', element: <AuthPage key="sign-in" /> },
  { path: '/auth/sign-up', element: <AuthPage key="sign-up" signUp /> },
  { path: '/admin', element: <AdminGate />, children: [
    { element: <AdminShell />, children: [
      { index: true, element: <AdminOverviewPage /> },
      { path: 'users', element: <AdminUsersPage /> },
      { path: 'users/:userId', element: <AdminUserDetailPage /> },
      { path: 'ai', element: <AdminAiPage /> },
      { path: 'credits', element: <AdminCreditsPage /> },
      { path: 'forms', element: <AdminFormsPage /> },
      { path: 'providers', element: <AdminProvidersPage /> },
      { path: 'system', element: <AdminSystemPage /> },
      { path: 'activity', element: <AdminActivityPage /> },
      { path: '*', element: <NotFoundPage /> },
    ] },
  ] },
  { path: '/app', element: <ProtectedLayout />, children: [
    { element: <WorkspaceLayout />, children: [
      { index: true, element: <OverviewPage /> },
      { path: 'connections', element: <ConnectionsPage /> },
      { path: 'library', element: <LibraryPage /> },
      { path: 'forms', element: <FormsPage /> },
      { path: 'account', element: <AccountPage /> },
      { path: '*', element: <NotFoundPage /> },
    ] },
  ] },
  { path: '*', element: <NotFoundPage /> },
];
