import { useState } from 'react';
import { NavLink, Outlet, useLocation } from 'react-router-dom';
import { authClient } from '../lib/auth';
import { LogoMark } from '../reel/parts';
import { useAdminIdentity } from './context';

const NAVIGATION = [
  { to: '/admin', label: 'Overview', icon: '⌂', end: true },
  { to: '/admin/users', label: 'Users', icon: '◎' },
  { to: '/admin/ai', label: 'AI & Usage', icon: '⌘' },
  { to: '/admin/credits', label: 'Credits', icon: '◈' },
  { to: '/admin/forms', label: 'Forms', icon: '▤' },
  { to: '/admin/providers', label: 'Providers', icon: '◇' },
  { to: '/admin/email', label: 'Email', icon: '✉' },
  { to: '/admin/system', label: 'System', icon: '⌁' },
  { to: '/admin/activity', label: 'Activity', icon: '≋' },
];

const TITLES: Record<string, string> = {
  '/admin': 'Operations overview',
  '/admin/users': 'User directory',
  '/admin/ai': 'AI & usage',
  '/admin/credits': 'Credit ledger',
  '/admin/forms': 'Form records',
  '/admin/providers': 'Provider connections',
  '/admin/email': 'Transactional email',
  '/admin/system': 'System health',
  '/admin/activity': 'Product activity',
};

export function AdminShell() {
  const admin = useAdminIdentity();
  const location = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const pageTitle = location.pathname.startsWith('/admin/users/') ? 'User detail' : TITLES[location.pathname] ?? 'Internal operations';

  async function signOut() {
    if (signingOut) return;
    setSigningOut(true);
    setSignOutError('');
    try {
      const result = await authClient.signOut();
      if (result.error) throw new Error('Sign out failed');
      window.location.replace('/auth/sign-in');
    } catch {
      setSignOutError('Sign out could not be confirmed. Try again.');
      setSigningOut(false);
    }
  }

  function closeNavigation() { setMobileOpen(false); }

  return (
    <div className="admin-app">
      <aside className={`admin-sidebar ${mobileOpen ? 'is-open' : ''}`}>
        <a className="admin-brand" href="/admin"><LogoMark size={26} /><span>intake</span><small>OPS</small></a>
        <div className="admin-nav-label">OPERATIONS</div>
        <nav className="admin-nav" aria-label="Admin navigation">
          {NAVIGATION.map(item => (
            <NavLink key={item.to} to={item.to} end={item.end} onClick={closeNavigation} className={({ isActive }) => `admin-nav-link${isActive ? ' active' : ''}`}>
              <span className="admin-nav-icon" aria-hidden>{item.icon}</span>{item.label}
            </NavLink>
          ))}
        </nav>
        <div className="admin-coming-soon">
          <span className="admin-nav-label">PLANNED</span>
          <div>Billing <small>Later</small></div>
          <div>Feature flags <small>Later</small></div>
        </div>
        <div className="admin-sidebar-footer">
          <span className="admin-scope-dot" /> READ-ONLY CONSOLE
          <p>No customer data or provider credentials are changed here.</p>
          <a href="/app">← User workspace</a>
        </div>
      </aside>
      {mobileOpen && <button className="admin-mobile-shade" onClick={closeNavigation} aria-label="Close admin navigation" />}
      <div className="admin-main">
        <header className="admin-topbar">
          <button className="admin-mobile-menu" onClick={() => setMobileOpen(open => !open)} aria-expanded={mobileOpen} aria-label="Toggle admin navigation">☰</button>
          <div className="admin-breadcrumb"><span>INTAKE / INTERNAL</span><b>/</b>{pageTitle}</div>
          <div className="admin-top-actions">
            <span className="admin-access-badge"><i /> ADMIN</span>
            <details className="admin-account-menu">
              <summary title={admin.email}><span>{admin.name.slice(0, 1).toUpperCase()}</span><strong>{admin.name}</strong><b>⌄</b></summary>
              <div className="admin-account-popover"><strong>{admin.name}</strong><span>{admin.email}</span><button disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out'}</button>{signOutError && <p role="alert">{signOutError}</p>}</div>
            </details>
          </div>
        </header>
        <main className="admin-content"><Outlet /></main>
        <footer className="admin-footer"><span>INTAKE / INTERNAL OPERATIONS</span><span>Private · Read-only · No customer mutations</span></footer>
      </div>
    </div>
  );
}
