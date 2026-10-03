import { useState, type FormEvent } from 'react';
import { authClient as client } from '../../lib/auth';
import { LogoMark } from '../../reel/parts';

export function AuthPage({ signUp = false }: { signUp?: boolean }) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

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
      window.location.replace(!signUp && returnTarget === '/admin' ? '/admin' : '/app');
    } catch {
      setError('Unable to reach Intake right now. Please try again.');
    } finally {
      setBusy(false);
    }
  }

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
          {new URLSearchParams(location.search).get('reason') === 'session_expired' && <div className="form-error" role="status">Your session ended before authorization finished. Sign in, then connect the provider again.</div>}
          <form onSubmit={submit}>
            {signUp && <label>Full name<input required autoComplete="name" value={name} onChange={e => setName(e.target.value)} placeholder="Your name" maxLength={100} disabled={busy} /></label>}
            <label>Email address<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} placeholder="you@example.com" disabled={busy} /></label>
            <label>Password<input required type="password" minLength={signUp ? 8 : undefined} autoComplete={signUp ? 'new-password' : 'current-password'} value={password} onChange={e => setPassword(e.target.value)} placeholder={signUp ? 'At least 8 characters' : 'Your password'} disabled={busy} /></label>
            {error && <div className="form-error" role="alert">{error}</div>}
            <button className="btn btn-accent auth-submit" type="submit" disabled={busy}>{busy ? 'Please wait…' : signUp ? 'Create account →' : 'Sign in →'}</button>
          </form>
          <div className="auth-switch">{signUp ? 'Already have an account?' : 'New to Intake?'} <a href={signUp ? '/auth/sign-in' : '/auth/sign-up'}>{signUp ? 'Sign in' : 'Create an account'}</a></div>
        </section>
      </main>
      <footer className="auth-footer">INTAKE © {new Date().getFullYear()} <span>Built to work with the tools you already use.</span></footer>
    </div>
  );
}
