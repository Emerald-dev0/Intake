import { useState } from 'react';
import { Outlet, useLocation } from 'react-router-dom';
import { LogoMark } from '../../reel/parts';
import { authClient as client } from '../../lib/auth';
import { useSession } from '../hooks/useSession';
import { useProviders } from '../Connections';

export function WorkspaceLayout() {
  const { user, clearSession } = useSession();
  const providers = useProviders(true);
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      const result = await client.signOut();
      if (result.error) throw new Error('Sign out failed');
      clearSession();
      window.location.replace('/auth/sign-in');
    } catch {
      setSignOutError('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  const page = useLocation().pathname.split('/')[2] || 'home';
  return (
    <div className="workspace">
      <aside className={`app-sidebar ${mobileOpen ? 'open' : ''}`}>
        <a href="/app" className="app-logo"><LogoMark size={28} /><span>intake</span><small>WORKSPACE</small></a>
        <div className="sidebar-label">WORKSPACE</div>
        <nav aria-label="Application navigation" className="side-nav">
          <a className={page === 'home' ? 'active' : ''} href="/app"><span aria-hidden>⌂</span> Overview</a>
          <a className={page === 'connections' ? 'active' : ''} href="/app/connections"><span aria-hidden>◇</span> Connections</a>
        </nav>
        <div className="sidebar-bottom"><div className="side-note"><span className="rec" /> INTAKE / EARLY STAGE<p>Form creation is not available yet. Connect a provider only when you want Intake authorized to operate that account.</p></div><a href="/" className="site-link">← Visit website</a></div>
      </aside>
      {mobileOpen && <button className="mobile-shade" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className="app-body">
        <header className="app-topbar"><button className="mobile-trigger" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button><div className="topbar-path">WORKSPACE <span>/</span> {page === 'home' ? 'OVERVIEW' : page === 'connections' ? 'CONNECTIONS' : 'ACCOUNT'}</div><div className="account-wrap"><button className="account-trigger" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span className="account-name">{user.name}</span><span aria-hidden>⌄</span></button>{menuOpen && <div className="account-menu"><div className="account-identity"><strong>{user.name}</strong><span>{user.email}</span></div><a href="/app/account">Account</a><button disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out →'}</button>{signOutError && <p role="alert">{signOutError}</p>}</div>}</div></header>
        <main className="app-content">
          <Outlet context={{ user, providers: providers.state, reloadProviders: providers.load }} />
        </main>
        <footer className="app-bottom">INTAKE <span>Built for the forms you already use.</span></footer>
      </div>
    </div>
  );
}
