import { lazy } from 'react';
import { type RouteObject, Navigate, useParams } from 'react-router-dom';
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
const PricingPage = lazy(() => import('./pages/PricingPage').then(m => ({ default: m.PricingPage })));
const VsPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.VsPage })));
const TemplatesPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.TemplatesPage })));
const GuidesPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.GuidesPage })));
const TrustPage = lazy(() => import('../marketing/MarketingPages').then(m => ({ default: m.TrustPage })));
const ChangelogPage = lazy(() => import('../marketing/Changelog').then(m => ({ default: m.ChangelogPage })));
const DevelopersPage = lazy(() => import('../marketing/DevelopersPage').then(m => ({ default: m.DevelopersPage })));
const ReleaseDetailPage = lazy(() => import('../marketing/Changelog').then(m => ({ default: m.ReleaseDetailPage })));
const PrivacyPage = lazy(() => import('./pages/PrivacyPage').then(m => ({ default: m.PrivacyPage })));
const TermsPage = lazy(() => import('./pages/TermsPage').then(m => ({ default: m.TermsPage })));
const BillingPage = lazy(() => import('./pages/BillingPage').then(m => ({ default: m.BillingPage })));
const DevelopersWorkspacePage = lazy(() => import('../app/DevelopersConsole').then(m => ({ default: m.DevelopersWorkspacePage })));
const HostedFormPage = lazy(() => import('../marketing/HostedFormPage').then(m => ({ default: m.HostedFormPage })));
const DeveloperFormPage = lazy(() => import('../app/DevelopersConsole').then(m => ({ default: m.DeveloperFormPage })));
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
const AdminReleasesPage = lazy(() => import('../admin/AdminReleasesPage').then(m => ({ default: m.AdminReleasesPage })));
const AdminReleaseDetailPage = lazy(() => import('../admin/AdminReleasesPage').then(m => ({ default: m.AdminReleaseDetailPage })));
const AdminReleasePreviewPage = lazy(() => import('../admin/AdminReleasePreviewPage').then(m => ({ default: m.AdminReleasePreviewPage })));
const AdminMailPage = lazy(() => import('../admin/AdminMailPage'));
function NotFoundPage() {
  return <main className="workspace-status"><h1>Page not found</h1><a href="/">Back to Intake</a></main>;
}

/** Reads the address of a hosted form out of the route and renders it. */
function HostedFormRoute({ variant }: { variant: 'page' | 'embed' }) {
  const { projectSlug = '', formSlug = '' } = useParams();
  return <HostedFormPage projectSlug={projectSlug} formSlug={formSlug} variant={variant} />;
}

/**
 * Takes a reader from the address a release document is served from to its permanent address.
 *
 * Every release is written to the site as a document of its own, so a crawler and a link preview
 * read the release rather than a stub. A host may serve that document from the address it was
 * written to, which ends in `index.html`, and a reader who arrives there would otherwise be told
 * the page does not exist — on the page they were trying to read. The release is the same either
 * way, so the reader is taken to the address it has always had.
 */
function ChangelogDocumentRoute() {
  const { slug = '' } = useParams();
  return <Navigate to={`/changelog/${slug}`} replace />;
}

export const routes: RouteObject[] = [
  { path: '/', element: <LandingPage /> },
  { path: '/pricing', element: <PricingPage /> },
  { path: '/vs', element: <VsPage /> },
  { path: '/templates', element: <TemplatesPage /> },
  { path: '/guides', element: <GuidesPage /> },
  { path: '/trust', element: <TrustPage /> },
  { path: '/changelog', element: <ChangelogPage /> },
  { path: '/developers', element: <DevelopersPage /> },
  // A hosted form, and the bare version that goes in somebody else's page.
  { path: '/forms/:projectSlug/:formSlug', element: <HostedFormRoute variant="page" /> },
  { path: '/embed/forms/:projectSlug/:formSlug', element: <HostedFormRoute variant="embed" /> },
  { path: '/changelog/:slug', element: <ReleaseDetailPage /> },
  // The address a release document is served from, and the address the changelog index is served
  // from. Both are the same pages as the addresses above, so a reader is taken to the one they
  // have always had rather than being told the page does not exist.
  { path: '/changelog/index.html', element: <Navigate to="/changelog" replace /> },
  { path: '/changelog/:slug/index.html', element: <ChangelogDocumentRoute /> },
  { path: '/privacy', element: <PrivacyPage /> },
  { path: '/terms', element: <TermsPage /> },
  { path: '/auth/sign-in', element: <AuthPage key="sign-in" /> },
  { path: '/auth/sign-up', element: <AuthPage key="sign-up" signUp /> },
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
      { path: 'mail', element: <AdminMailPage /> },
      { path: 'waitlist', element: <AdminWaitlistPage /> },
      { path: 'releases', element: <AdminReleasesPage /> },
      { path: 'releases/:releaseId', element: <AdminReleaseDetailPage /> },
      { path: 'releases/:releaseId/preview', element: <AdminReleasePreviewPage /> },
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
      { path: 'developers', element: <DevelopersWorkspacePage /> },
      { path: 'developers/forms/:formId', element: <DeveloperFormPage /> },
      { path: '*', element: <NotFoundPage /> },
    ] },
  ] },
  { path: '*', element: <NotFoundPage /> },
];
