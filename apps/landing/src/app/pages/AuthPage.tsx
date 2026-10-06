import { useEffect, useState, type FormEvent } from 'react';
import { authClient as client } from '../../lib/auth';
import { fetchPublicEmailConfig, type PublicEmailConfig } from '../../lib/email';
import { oauthErrorMessage } from '../../lib/sign-in-errors';
import { useSignInConfig } from '../hooks/useSignInConfig';
import { LogoMark } from '../../components/LogoMark';

export function AuthPage({ signUp = false }: { signUp?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [googleBusy, setGoogleBusy] = useState(false);
  const [emailConfig, setEmailConfig] = useState<PublicEmailConfig | null>(null);
  const google = useSignInConfig();

  // Whether a verification email can actually be delivered decides where sign-up lands: sending
  // someone to a code entry screen that can never receive a code is worse than no verification.
  useEffect(() => {
    let active = true;
    void fetchPublicEmailConfig().then(config => { if (active) setEmailConfig(config); }).catch(() => undefined);
    return () => { active = false; };
  }, []);
  const params = new URLSearchParams(location.search);
  const oauthError = params.get('error');

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
      const returnTarget = new URLSearchParams(window.location.search).get('redirect');
      // Verified accounts are what admin access and sensitive actions rely on, so the step is worth
      // the extra screen whenever Intake can actually send the code.
      if (emailConfig?.verificationRequired) {
        window.location.replace('/auth/verify');
        return;
      }
      window.location.replace(!signUp && returnTarget === '/admin' ? '/admin' : '/app');
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
          <p>{signUp ? (emailConfig?.verificationRequired ? 'Start with an Intake account. We will email you a six-digit code to confirm your address.' : 'Start with an Intake account. Connecting Google or Microsoft is a separate step after you sign in.') : 'Sign in to your Intake workspace.'}</p>
          {params.get('reason') === 'session_expired' && <div className="form-error" role="status">Your session ended before authorization finished. Sign in, then connect the provider again.</div>}
          {oauthError && <div className="form-error" role="alert">{oauthErrorMessage(oauthError)}</div>}
          {google.status === 'available' && <>
            <button className="btn auth-google" type="button" aria-describedby="google-signin-note" onClick={() => void continueWithGoogle()} disabled={busyAny}>
              <span aria-hidden>G</span>{googleBusy ? 'Opening Google…' : 'Continue with Google'}
            </button>
            <p className="auth-provider-note" id="google-signin-note">Google sign-in authenticates you to Intake only. It does not authorize Google Forms access.</p>
            <div className="auth-or" aria-hidden><span>or continue with email</span></div>
          </>}
          {google.status === 'loading' && <p className="auth-provider-note" role="status">Checking whether Google sign-in is available… Email/password remains available.</p>}
          {google.status === 'unavailable' && google.reason === 'unreachable' && <div className="form-error" role="status">Google sign-in could not be checked right now. You can still use your email and password.</div>}
          {google.status === 'unavailable' && google.reason === 'not_configured' && <p className="auth-provider-note">Google sign-in is not configured on this Intake server. Use your email and password.</p>}
          <form onSubmit={submit}>
            {signUp && <label>Full name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={100} disabled={busyAny} /></label>}
            <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" disabled={busyAny} /></label>
            <label>Password<input required type="password" minLength={signUp ? 8 : undefined} autoComplete={signUp ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={signUp ? 'At least 8 characters' : 'Your password'} disabled={busyAny} /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-accent auth-submit" type="submit" disabled={busyAny}>{busy ? 'Please wait…' : signUp ? 'Create account →' : 'Sign in →'}</button>
            {!signUp && <div className="auth-forgot"><a href="/auth/reset-password">Forgot your password?</a></div>}
          </form>
          <div className="auth-switch">{signUp ? 'Already have an account?' : 'New to Intake?'} <a href={signUp ? '/auth/sign-in' : '/auth/sign-up'}>{signUp ? 'Sign in' : 'Create an account'}</a></div>
        </section>
      </main>
      <footer className="auth-footer"><span>INTAKE © {new Date().getFullYear()}</span><span>Built to work with the tools you already use.</span><a href="/pricing">Plans &amp; pricing</a></footer>
    </div>
  );
}
