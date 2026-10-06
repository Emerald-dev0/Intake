import { useState, type FormEvent } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { authClient as client } from '../../lib/auth';
import { emailErrorMessage, requestPasswordReset } from '../../lib/email';
import { LogoMark } from '../../components/LogoMark';

/**
 * Password reset, in two states.
 *
 * With a token in the URL: choose a new password. The token is validated, single-used and expired by
 * the server; this page never inspects it beyond handing it back.
 *
 * Without one: ask for a link. The answer is always the same whether or not the address exists, so
 * this page can never be used to discover who has an Intake account.
 */
export function ResetPasswordPage() {
  const [params] = useSearchParams();
  const token = (params.get('token') ?? '').trim();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmation, setConfirmation] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [sent, setSent] = useState(false);
  const [done, setDone] = useState(false);

  async function requestLink(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    setError('');
    setBusy(true);
    try {
      await requestPasswordReset(email.trim().toLowerCase());
      setSent(true);
    } catch (cause) {
      setError(emailErrorMessage(cause, 'Intake could not send the reset email. Try again shortly.'));
    } finally {
      setBusy(false);
    }
  }

  async function choosePassword(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || password !== confirmation) return;
    setError('');
    setBusy(true);
    try {
      const result = await client.resetPassword({ newPassword: password, token });
      if (result.error) {
        setError(result.error.message || 'That reset link is no longer valid. Request a new one.');
        return;
      }
      setDone(true);
      window.setTimeout(() => window.location.replace('/auth/sign-in'), 2200);
    } catch {
      setError('Intake could not reach the server. Check your connection and try again.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="auth-page">
      <div className="grain" aria-hidden />
      <header className="auth-header">
        <a href="/" className="app-logo" aria-label="Intake home"><LogoMark size={28} /><span>intake</span></a>
        <a href="/" className="auth-back">← Back to website</a>
      </header>
      <main className="auth-layout">
        <div className="auth-intro">
          <span className="eyebrow"><i /> ACCOUNT RECOVERY</span>
          <h1>Reset your<br /><em>password.</em></h1>
          <p>Intake emails you a single-use link. Choosing a new password signs out every other session on your account.</p>
          <div className="auth-line">
            01 / Request the link <span>Sent only to a real account</span><br />
            02 / Open it <span>Valid for 30 minutes</span><br />
            03 / Set a new password <span>One use only</span>
          </div>
        </div>

        <section className="auth-card" aria-label="Reset your password">
          <div className="card-kicker">INTAKE / SECURITY</div>

          {done ? <>
            <h2>Password updated.</h2>
            <p>Sign in with your new password. Every other session on this account was signed out.</p>
            <div className="form-banner ok" role="status"><strong>All set.</strong><p>Taking you to sign in.</p></div>
          </> : token ? <>
            <h2>Choose a new password</h2>
            <p>Use at least eight characters. This link can only be used once.</p>
            <form onSubmit={choosePassword}>
              <label>
                New password
                <input
                  required type="password" minLength={8} autoComplete="new-password" value={password}
                  onChange={event => setPassword(event.target.value)} placeholder="At least 8 characters" disabled={busy}
                />
              </label>
              <label>
                Confirm new password
                <input
                  required type="password" minLength={8} autoComplete="new-password" value={confirmation}
                  onChange={event => setConfirmation(event.target.value)} placeholder="Type it again" disabled={busy}
                />
              </label>
              {confirmation && password !== confirmation && <div className="form-error" role="alert">The two passwords do not match.</div>}
              {error && <div className="form-error" role="alert">{error}</div>}
              <button className="btn btn-accent auth-submit" type="submit" disabled={busy || !password || password !== confirmation}>
                {busy ? 'Updating…' : 'Set new password →'}
              </button>
            </form>
          </> : sent ? <>
            <h2>Check your email</h2>
            <p>If an Intake account uses {email}, a reset link is on its way. It expires in 30 minutes.</p>
            <div className="form-banner ok" role="status">
              <strong>Request received.</strong>
              <p>Intake says the same thing whether or not the address is registered, so this page cannot be used to check who has an account.</p>
            </div>
            <div className="auth-switch"><button type="button" className="link-button" onClick={() => setSent(false)}>Use a different address</button></div>
          </> : <>
            <h2>Request a reset link</h2>
            <p>Enter the email address on your Intake account and we will send a single-use link.</p>
            <form onSubmit={requestLink}>
              <label>
                Email address
                <input
                  required type="email" autoComplete="email" value={email}
                  onChange={event => setEmail(event.target.value)} placeholder="you@example.com" disabled={busy}
                />
              </label>
              {error && <div className="form-error" role="alert">{error}</div>}
              <button className="btn btn-accent auth-submit" type="submit" disabled={busy || !email}>
                {busy ? 'Sending…' : 'Send reset link →'}
              </button>
            </form>
            <div className="auth-switch">Remembered it? <Link to="/auth/sign-in">Back to sign in</Link></div>
          </>}
        </section>
      </main>
      <footer className="auth-footer">
        <span>INTAKE © {new Date().getFullYear()}</span>
        <span>Intake will never ask for your password.</span>
        <Link to="/pricing">Plans &amp; pricing</Link>
      </footer>
    </div>
  );
}
