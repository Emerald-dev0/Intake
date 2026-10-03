import { useState } from 'react';
import { authClient as client } from '../../lib/auth';
import { oauthErrorMessage } from '../../lib/sign-in-errors';
import { connectionSummary } from '../Connections';
import { useSignInConfig } from '../hooks/useSignInConfig';
import { useWorkspace } from '../hooks/useWorkspace';

export function AccountPage() {
  const { user, providers } = useWorkspace();
  const google = useSignInConfig();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const linkError = new URLSearchParams(location.search).get('error');
  const params = new URLSearchParams(location.search);

  async function linkGoogle() {
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      // Explicit, user-initiated linking. Intake never merges a password account into a Google
      // sign-in silently; this is the deliberate action the user takes instead.
      await client.linkSocial({ provider: 'google', callbackURL: '/app/account', errorCallbackURL: '/app/account' });
    } catch {
      setError('Unable to reach Intake right now. Please try again.');
      setBusy(false);
    }
  }

  return <><div className="page-heading"><div className="eyebrow">03 / PROFILE</div><h1>Your <em>account.</em></h1><div className="heading-description">This is your Intake identity. Connected providers are separate accounts you have explicitly authorized.</div></div>
    <div className="profile-card"><div className="avatar large">{user.name.slice(0, 1).toUpperCase()}</div><div><span>INTAKE ACCOUNT</span><strong>{user.name}</strong><span>EMAIL</span><strong>{user.email}</strong></div></div>
    <section className="account-connections"><span className="info-index">SIGN-IN METHODS</span>
      <p>Your email and password sign you in. Adding Google is an authentication change only — it does not connect your Google Forms, and it never grants Intake access to your forms.</p>
      {linkError && <p className="form-error" role="alert">{oauthErrorMessage(linkError)}</p>}
      {error && <p className="form-error" role="alert">{error}</p>}
      {google.status === 'available'
        ? <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void linkGoogle()}>{busy ? 'Opening Google…' : 'Link Google sign-in →'}</button>
        : google.status === 'loading'
          ? <span className="forms-progress">Checking sign-in options…</span>
          : google.reason === 'not_configured'
            ? <span className="forms-progress">Google sign-in is not configured on this Intake server.</span>
            : <span className="forms-progress">Google sign-in could not be checked right now.</span>}
      {params.get('error') === 'account_already_linked_to_different_user' && <p className="forms-progress">Use the Google account that matches {user.email}, or keep signing in with your password.</p>}
    </section>
    <section className="account-connections"><span className="info-index">CONNECTED PROVIDERS</span><p>{providers.status === 'loading' ? 'Checking connections…' : providers.status === 'error' ? 'Provider connections could not be loaded.' : `${connectionSummary(providers.providers)}.`}</p><a href="/app/connections">Manage connections <span>↗</span></a></section></>;
}
