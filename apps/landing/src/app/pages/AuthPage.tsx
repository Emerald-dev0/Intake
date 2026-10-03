import { useEffect, useState, type FormEvent } from 'react';
import { authClient as client } from '../../lib/auth';
import { LogoMark } from '../../reel/parts';

type GoogleButtonState = { status: 'loading' } | { status: 'available' } | { status: 'unavailable'; reason: 'not_configured' | 'unreachable' };

/**
 * OAuth failures arrive as `?error=<code>` on this page (Better Auth appends the machine-readable
 * code to the error callback URL). Codes are mapped to plain language here and never rendered raw,
 * so nothing internal — no provider payloads, no secrets, no stack traces — reaches the user.
 */
const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled. Nothing was changed.',
  account_not_linked: 'An Intake account already uses this email with a password. Sign in with your password, then link Google from your account page.',
  email_not_verified: 'Google did not confirm this email address, so Intake did not sign you in.',
  unable_to_get_user_info: 'Google sign-in could not be completed. Nothing was changed. Please try again.',
  invalid_code: 'That Google sign-in attempt expired. Please try again.',
  state_not_found: 'That Google sign-in attempt could not be verified. Please start again from this page.',
  oauth_provider_not_found: 'Google sign-in is not available on this Intake server.',
  email_not_found: 'Google did not share an email address, so Intake cannot create an account for it.',
  unable_to_link_account: 'Intake could not link this Google account safely. Nothing was changed.',
  account_already_linked_to_different_user: 'That Google account is already linked to a different Intake account.',
  email_does_not_match: 'That Google account uses a different email than the Intake account you are signed in to.',
  internal_server_error: 'Google sign-in could not be completed right now. Please try again.',
};

function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? 'Google sign-in could not be completed. Nothing was changed. Please try again.';
}

export function AuthPage({ signUp = false }: { signUp?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [google, setGoogle] = useState<GoogleButtonState>({ status: 'loading' });
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error');

  // The button is only rendered after the server confirms Google sign-in is configured.
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/sign-in/config', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
        const body = await response.json().catch(() => null) as unknown;
        const configured = response.ok && typeof body === 'object' && body !== null && (body as { providers?: { google?: unknown } }).providers?.google === true;
        if (!controller.signal.aborted) setGoogle(configured ? { status: 'available' } : { status: 'unavailable', reason: 'not_configured' });
      } catch {
        if (!controller.signal.aborted) setGoogle({ status: 'unavailable', reason: 'unreachable' });
      }
    })();
    return () => controller.abort();
  }, []);

  async function continueWithGoogle() {
    if (googleBusy || busy) return;
    setError('');
    setGoogleBusy(true);
    try {
      // Same-origin redirect: Better Auth sets the HttpOnly session cookie and returns to /app.
      // Any failure is redirected back to this page with a `?error=` code.
      await client.signIn.social({ provider: 'google', callbackURL: '/app', errorCallbackURL: signUp ? '/auth/sign-up' : '/auth/sign-in' });
    } catch {
      setError('Unable to reach Intake right now. Please try again.');
      setGoogleBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      const result = signUp
        ? await client.signUp.email({ name: name.trim(), email: email.trim(), password })
        : await client.signIn.email({ email: email.trim(), password });
      if (result.error) {
        // Don't leak whether a particular email is registered on sign-in.
        setError(signUp ? (result.error.message || 'Could not create your account. Please try again.') : 'Could not sign in. Check your details and try again.');
        return;
      }
      window.location.replace('/app');
    } catch {
      setError('Unable to reach Intake right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  const busyAny = busy || googleBusy;
  return (
    <div className="auth-page">
      <div className="grain" aria-hidden />
      <header className="auth-header"><a href="/" className="app-logo" aria-label="Intake home"><LogoMark size={28} /><span>intake</span></a><a href="/" className="auth-back">← Back to website</a></header>
      <main className="auth-layout">
        <div className="auth-intro"><span className="eyebrow"><i /> YOUR WORKSPACE STARTS HERE</span><h1>Make the form.<br /><em>Not the fuss.</em></h1><p>One account for the work ahead. Connecting a form platform is a separate authorization, not part of signing in.</p><div className="auth-line">01 / Create your Intake account<br />02 / Connect a form platform <span>Separate authorization</span><br />03 / Tell Intake what you need <span>Review before creating</span></div></div>
        <section className="auth-card" aria-label={signUp ? 'Create an account' : 'Sign in'}>
          <div className="card-kicker">INTAKE / ACCOUNT</div>
          <h2>{signUp ? 'Create your account' : 'Welcome back'}</h2>
          <p>{signUp ? 'Start with an Intake account. Connecting Google or Microsoft is a separate step after you sign in.' : 'Sign in to your Intake workspace.'}</p>
          {params.get('reason') === 'session_expired' && <div className="form-error" role="status">Your session ended before authorization finished. Sign in, then connect the provider again.</div>}
          {oauthError && <div className="form-error" role="alert">{oauthErrorMessage(oauthError)}</div>}
          {google.status === 'available' && <>
            <button className="btn auth-google" type="button" onClick={() => void continueWithGoogle()} disabled={busyAny}>
              <span aria-hidden>G</span>{googleBusy ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <div className="auth-or" aria-hidden><span>or continue with email</span></div>
          </>}
          {google.status === 'unavailable' && google.reason === 'unreachable' && <div className="form-error" role="status">Google sign-in could not be checked right now. You can still use your email and password.</div>}
          <form onSubmit={submit}>
            {signUp && <label>Full name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={100} disabled={busyAny} /></label>}
            <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" disabled={busyAny} /></label>
            <label>Password<input required type="password" minLength={signUp ? 8 : undefined} autoComplete={signUp ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={signUp ? 'At least 8 characters' : 'Your password'} disabled={busyAny} /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-accent auth-submit" type="submit" disabled={busyAny}>{busy ? 'Please wait…' : signUp ? 'Create account →' : 'Sign in →'}</button>
          </form>
          <div className="auth-switch">{signUp ? 'Already have an account?' : 'New to Intake?'} <a href={signUp ? '/auth/sign-in' : '/auth/sign-up'}>{signUp ? 'Sign in' : 'Create an account'}</a></div>
        </section>
      </main>
      <footer className="auth-footer">INTAKE © {new Date().getFullYear()} <span>Built to work with the tools you already use.</span></footer>
    </div>
  );
}
