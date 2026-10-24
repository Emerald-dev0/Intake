import { useEffect, useState } from 'react';
import { Outlet, useLocation, useNavigate } from 'react-router-dom';
import { LogoMark } from '../../components/LogoMark';
import { ThemeToggle } from '../../components/ThemeToggle';
import { authClient as client } from '../../lib/auth';
import { useSession } from '../hooks/useSession';
import { useProviders } from '../Connections';
import { CreditsProvider, useCreditsSource } from '../hooks/useCredits';
import { creditSummary, resetLabel } from '../../lib/credits';
import { CommandPalette, useCommandPalette, type PaletteDestination } from '../components/CommandPalette';

/**
 * Operator navigation. The server decides: `/api/admin/access` returns 200
 * only for a verified allowlisted session, and this link renders only then.
 * Everyone else — signed out, regular users, unreachable API — sees nothing.
 */
function useOperatorAccess() {
  const [isOperator, setIsOperator] = useState(false);
  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const response = await fetch('/api/admin/access', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
        if (active) setIsOperator(response.ok);
      } catch {
        if (active) setIsOperator(false);
      }
    })();
    return () => { active = false; };
  }, []);
  return isOperator;
}

const NAV = [
  { key: 'home', href: '/app', label: 'Home', icon: '⌂' },
  { key: 'forms', href: '/app/forms', label: 'Chat', icon: '✳' },
  { key: 'library', href: '/app/library', label: 'Library', icon: '▤' },
  { key: 'connections', href: '/app/connections', label: 'Connections', icon: '◇' },
  { key: 'billing', href: '/app/billing', label: 'Billing', icon: '◎' },
] as const;

/**
 * Where ⌘K can take you. Built from NAV so a new destination cannot appear in one place and be
 * missing from the other.
 */
const DESTINATIONS: PaletteDestination[] = [
  { label: 'New chat', hint: 'Start a form from a sentence', to: '/app/forms', shortcut: '＋' },
  ...NAV.filter(item => item.key !== 'home').map(item => ({ label: item.label, hint: item.href, to: item.href })),
  { label: 'Account', hint: 'Identity, security, plan', to: '/app/account' },
  { label: 'Pricing', hint: 'Plans and credits', to: '/pricing' },
];

/**
 * The workspace shell. One narrow rail, one composer-first stage: a person should always be one
 * sentence — not one menu — away from the thing they came to do. The palette is the second way in:
 * any form, any destination, one keystroke, no mouse.
 */
export function WorkspaceLayout() {
  const { user, clearSession } = useSession();
  const providers = useProviders(true);
  const credits = useCreditsSource();
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const [newFormNonce, setNewFormNonce] = useState(0);
  const isOperator = useOperatorAccess();
  const palette = useCommandPalette();
  // Operator console is a destination only for an allowlisted session — the server decided that, so
  // the palette inherits the answer instead of guessing from client state.
  const destinations: PaletteDestination[] = isOperator
    ? [...DESTINATIONS, { label: 'Operator console', hint: 'Internal operations', to: '/admin' }]
    : DESTINATIONS;
  const navigate = useNavigate();

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
  const current = NAV.find(item => item.key === page) ?? NAV[0];

  function startNewForm() {
    setMobileOpen(false);
    setNewFormNonce(value => value + 1);
    if (page !== 'forms') navigate('/app/forms');
  }

  return (
    <CreditsProvider value={{ state: credits.state, reload: credits.reload, note: credits.note }}>
    <div className="workspace">
      <aside className={`app-sidebar ${mobileOpen ? 'open' : ''}`}>
        <a href="/app" className="app-logo"><LogoMark size={26} /><span>intake</span></a>
        <button type="button" className="sidebar-new" onClick={startNewForm} title="Start a new conversation">
          <span aria-hidden>＋</span> New chat
        </button>

        <nav aria-label="Application navigation" className="side-nav">
          {NAV.map(item => (
            <a
              key={item.key}
              className={page === item.key ? 'active' : ''}
              href={item.href}
              aria-current={page === item.key ? 'page' : undefined}
            >
              <span className="side-nav__icon" aria-hidden>{item.icon}</span>{item.label}
            </a>
          ))}
        </nav>

        <div className="sidebar-spacer" />

        {isOperator && <a href="/admin" className="sidebar-operator"><span aria-hidden>⌁</span> Operator console</a>}

        <div className="sidebar-credits" aria-live="polite">
          {credits.state.status === 'ready'
            ? <>
              <span className="sidebar-credits__label">CREDITS</span>
              <strong>{creditSummary(credits.state.credits)}</strong>
              <span className="sidebar-credits__reset">Daily · {resetLabel(credits.state.credits.nextDailyReset)}</span>
              <a className="sidebar-plan-link" href="/app/billing">Plan &amp; billing →</a>
            </>
            : credits.state.status === 'loading'
              ? <span className="sidebar-credits__label">Checking credits…</span>
              : <button type="button" className="sidebar-credits-retry" onClick={() => credits.reload()}>Credits unavailable — retry</button>}
        </div>

        <div className="sidebar-bottom">
          <a href="/app/account" className="sidebar-account"><span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span><span>{user.name}</span></a>
          <a href="/" className="site-link">Visit website ↗</a>
        </div>
      </aside>
      {mobileOpen && <button className="mobile-shade" aria-label="Close navigation" onClick={() => setMobileOpen(false)} />}
      <div className="app-body">
        <header className="app-topbar">
          <button className="mobile-trigger" onClick={() => setMobileOpen(true)} aria-label="Open navigation">☰</button>
          <div className="topbar-path">{current.label}</div>
          <button
            type="button"
            className="topbar-search"
            onClick={event => palette.openWith(event.currentTarget)}
            aria-keyshortcuts="Meta+K Control+K"
          >
            <span aria-hidden>⌕</span>
            <span className="topbar-search__label">Search forms</span>
            <kbd>⌘K</kbd>
          </button>
          <div className="account-wrap">
            <button className="account-trigger" aria-expanded={menuOpen} onClick={() => setMenuOpen(!menuOpen)}>
              <span className="avatar">{user.name.slice(0, 1).toUpperCase()}</span>
              <span className="account-name">{user.name}</span>
              <span aria-hidden>⌄</span>
            </button>
            {menuOpen && <div className="account-menu">
              <div className="account-identity"><strong>{user.name}</strong><span>{user.email}</span></div>
              <a href="/app/account">Account</a>
              <a href="/app/billing">Plan &amp; billing</a>
              <ThemeToggle menuItem />
              <button disabled={signingOut} onClick={() => void signOut()}>{signingOut ? 'Signing out…' : 'Sign out →'}</button>
              {signOutError && <p role="alert">{signOutError}</p>}
            </div>}
          </div>
        </header>
        <main className="app-content">
          <Outlet context={{ user, providers: providers.state, reloadProviders: providers.load, credits: credits.state, reloadCredits: credits.reload, noteCredits: credits.note, newChatNonce: newFormNonce }} />
        </main>
      </div>
      <CommandPalette
        open={palette.open}
        onClose={() => palette.setOpen(false)}
        destinations={destinations}
        returnFocusTo={palette.opener}
      />
    </div>
    </CreditsProvider>
  );
}
