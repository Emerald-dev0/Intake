import { useCallback, useEffect, useState } from 'react';
import { createAuthClient } from 'better-auth/react';
import { LogoMark } from '../reel/parts';
import { connectionSummary, Connections, useProviders, type ProviderLoad } from './Connections';

const client = createAuthClient();
type User = { id: string; name: string; email: string; image?: string | null };

type State = { status: 'loading' | 'error' | 'ready'; user?: User };
export function Workspace() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const [menuOpen, setMenuOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [signOutError, setSignOutError] = useState('');
  const providers = useProviders(state.status === 'ready');
  const load = useCallback(async () => {
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/me', { credentials: 'same-origin', cache: 'no-store' });
      if (response.status === 401) { window.location.replace('/auth/sign-in'); return; }
      if (!response.ok) throw new Error('Session request failed');
      const data = await response.json() as { user: User };
      setState({ status: 'ready', user: data.user });
    } catch { setState({ status: 'error' }); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  async function signOut() {
    setSigningOut(true);
    setSignOutError('');
    try {
      const result = await client.signOut();
      if (result.error) throw new Error('Sign out failed');
      window.location.replace('/auth/sign-in');
    } catch {
      setSignOutError('Could not sign out. Please try again.');
      setSigningOut(false);
    }
  }

  if (state.status !== 'ready' || !state.user) return <div className="workspace-status"><a href="/" className="app-logo"><LogoMark size={28} /><span>intake</span></a>{state.status === 'loading' ? <p role="status">Opening your workspace…</p> : <div role="alert"><p>We couldn’t verify your session right now.</p><button className="btn btn-accent" onClick={() => void load()}>Try again</button></div>}</div>;
  const user = state.user;
  const page = location.pathname.startsWith('/app/connections') ? 'connections' : location.pathname.startsWith('/app/account') ? 'account' : 'home';
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
          {page === 'home' ? <Dashboard name={user.name} providers={providers.state} /> : page === 'connections' ? <Connections load={providers.state} reload={providers.load} /> : <Account user={user} providers={providers.state} />}
        </main>
        <footer className="app-bottom">INTAKE <span>Built for the forms you already use.</span></footer>
      </div>
    </div>
  );
}

function Dashboard({ name, providers }: { name: string; providers: ProviderLoad }) {
  return <>
    <div className="page-heading"><div className="eyebrow">01 / YOUR WORKSPACE</div><p>Welcome, {name.split(' ')[0]}.</p><h1>What do you need<br />to <em>collect?</em></h1><div className="heading-description">Describe the form you want to create. Intake will build it in your connected form platform when this feature launches.</div></div>
    <section className="prompt-card"><div className="prompt-top"><span><span className="rec" /> THE NEXT STEP</span><span>INTAKE / CREATE</span></div><label htmlFor="future-prompt">Start with an idea</label><textarea id="future-prompt" placeholder="e.g. A registration form for our conference, with name, email and transportation needs…" disabled aria-describedby="prompt-note" /><div className="prompt-actions"><span id="prompt-note">Form creation is coming in a future release.</span><button className="btn btn-accent" disabled title="Form creation is not available yet">Create a form ↗</button></div></section>
    <div className="dashboard-grid"><section className="info-card"><span className="info-index">01 / CONNECT</span><div className="info-icon">◇</div><h2>Your tools, your forms.</h2><p>Authorize a Google or Microsoft account separately from this login. A connection is permission for that account. It is not created by signing in, and it does not create a form.</p><a href="/app/connections">{connectionSummary(providers.providers)} <span>↗</span></a></section><section className="info-card"><span className="info-index">02 / CREATE</span><div className="info-icon orange">✳</div><h2>Just say what you need.</h2><p>Intake will turn your request into an actual form on the platform you connect. No new form builder to learn.</p><span className="soon-label">COMING IN A FUTURE RELEASE</span></section></div>
  </>;
}

function Account({ user, providers }: { user: User; providers: ProviderLoad }) {
  return <><div className="page-heading"><div className="eyebrow">03 / PROFILE</div><h1>Your <em>account.</em></h1><div className="heading-description">This is your Intake identity. Connected providers are separate accounts you have explicitly authorized.</div></div><div className="profile-card"><div className="avatar large">{user.name.slice(0, 1).toUpperCase()}</div><div><span>INTAKE ACCOUNT</span><strong>{user.name}</strong><span>EMAIL</span><strong>{user.email}</strong></div></div><section className="account-connections"><span className="info-index">CONNECTED PROVIDERS</span><p>{providers.status === 'loading' ? 'Checking connections…' : providers.status === 'error' ? 'Provider connections could not be loaded.' : `${connectionSummary(providers.providers)}.`}</p><a href="/app/connections">Manage connections <span>↗</span></a></section></>;
}
