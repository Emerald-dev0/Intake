import { lazy } from 'react';
import { Navigate, type RouteObject } from 'react-router-dom';
import { ProtectedLayout } from './layouts/ProtectedLayout';
import { WorkspaceLayout } from './layouts/WorkspaceLayout';

const LandingPage = lazy(() => import('../App'));
const AuthPage = lazy(() => import('./pages/AuthPage').then(m => ({ default: m.AuthPage })));
const OverviewPage = lazy(() => import('./pages/OverviewPage').then(m => ({ default: m.OverviewPage })));
const ConnectionsPage = lazy(() => import('./pages/ConnectionsPage').then(m => ({ default: m.ConnectionsPage })));
const FormsPage = lazy(() => import('./pages/FormsPage').then(m => ({ default: m.FormsPage })));
const LibraryPage = lazy(() => import('./pages/LibraryPage').then(m => ({ default: m.LibraryPage })));
const AccountPage = lazy(() => import('./pages/AccountPage').then(m => ({ default: m.AccountPage })));
const VerifyEmailPage = lazy(() => import('./pages/VerifyEmailPage').then(m => ({ default: m.VerifyEmailPage })));
const ResetPasswordPage = lazy(() => import('./pages/ResetPasswordPage').then(m => ({ default: m.ResetPasswordPage })));
const WaitlistPage = lazy(() => import('./WaitlistPage'));
const PricingPage = lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })));
const VsPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.VsPage })));
const TemplatesPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.TemplatesPage })));
const GuidesPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.GuidesPage })));
const TrustPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.TrustPage })));
const ChangelogPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.ChangelogPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })));
const AdminGate = lazy(() => import('../admin/AdminGate').then(m => ({ default: m.AdminGate })));
const AdminShell = lazy(() => import('../admin/AdminShell').then(m => ({ default: m.AdminShell })));
const AdminOverviewPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminOverviewPage })));
const AdminUsersPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminUsersPage })));
const AdminUserDetailPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminUserDetailPage })));
const AdminAiPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminAiPage })));
const AdminCreditsPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminCreditsPage })));
const AdminFormsPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminFormsPage })));
const AdminProvidersPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminProvidersPage })));
const AdminEmailPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminEmailPage })));
const AdminSystemPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminSystemPage })));
const AdminActivityPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminActivityPage })));
const AdminAnalyticsPage = lazy(() => import('../admin/AdminPages').then(m => ({ default: m.AdminAnalyticsPage })));
const AdminWaitlistPage = lazy(() => import('../admin/AdminWaitlistPage'));
function NotFoundPage() {
  return <main className="workspace-status"><h1>Page not found</h1><a href="/">Back to Intake</a></main>;
}

export const routes: RouteObject[] = [
  { path: '/', element: <LandingPage /> },
  { path: '/pricing', element: <PricingPage /> },
  { path: '/vs', element: <VsPage /> },
  { path: '/templates', element: <TemplatesPage /> },
  { path: '/guides', element: <GuidesPage /> },
  { path: '/trust', element: <TrustPage /> },
  { path: '/changelog', element: <ChangelogPage /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/auth/sign-in', element: <AuthPage key="sign-in" /> },
  // New accounts open through the wait-list, so the sign-up entry never shows a sign-in form to
  // somebody who has no account yet.
  { path: '/auth/sign-up', element: <Navigate to="/waitlist" replace /> },
  { path: '/waitlist', element: <WaitlistPage /> },
  { path: '/auth/verify', element: <VerifyEmailPage /> },
  { path: '/auth/reset-password', element: <ResetPasswordPage /> },
  { path: '/admin', element: <AdminGate />, children: [
    { element: <AdminShell />, children: [
      { index: true, element: <AdminOverviewPage /> },
      { path: 'users', element: <AdminUsersPage /> },
      { path: 'users/:userId', element: <AdminUserDetailPage /> },
      { path: 'ai', element: <AdminAiPage /> },
      { path: 'credits', element: <AdminCreditsPage /> },
      { path: 'forms', element: <AdminFormsPage /> },
      { path: 'providers', element: <AdminProvidersPage /> },
      { path: 'email', element: <AdminEmailPage /> },
      { path: 'waitlist', element: <AdminWaitlistPage /> },
      { path: 'system', element: <AdminSystemPage /> },
      { path: 'activity', element: <AdminActivityPage /> },
      { path: 'analytics', element: <AdminAnalyticsPage /> },
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
      { path: 'billing', element: <BillingPage /> },
      { path: '*', element: <NotFoundPage /> },
    ] },
  ] },
  { path: '*', element: <NotFoundPage /> },
];
