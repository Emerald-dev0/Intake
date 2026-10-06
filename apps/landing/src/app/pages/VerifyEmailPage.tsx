import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link } from 'react-router-dom';
import { authClient as client } from '../../lib/auth';
import {
  confirmVerificationCode, emailErrorMessage, fetchAccountEmailStatus, requestVerificationCode,
} from '../../lib/email';
import { LogoMark } from '../../components/LogoMark';

type Phase = 'checking' | 'code' | 'verified' | 'unavailable';

const RESEND_SECONDS = 60;

/**
 * "Check your email" — the step between creating an account and using it.
 *
 * The code is generated, hashed, stored and expired by Intake. This page only carries what the user
 * reads in their inbox; it never sees the code, and a wrong guess costs one of five attempts.
 */
export function VerifyEmailPage() {
  const [phase, setPhase] = useState<Phase>('checking');
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    void (async () => {
      try {
        const status = await fetchAccountEmailStatus();
        if (status.emailVerified) {
          setPhase('verified');
          return;
        }
        setEmail(status.email);
        if (!status.deliveryConfigured) {
          setPhase('unavailable');
          return;
        }
        setPhase('code');
        input.current?.focus();
      } catch {
        // No session: the visitor is not signed in, so there is nothing to verify here.
        window.location.replace('/auth/sign-in');
      }
    })();
  }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  async function sendCode(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const result = await requestVerificationCode();
      if (result.status === 'already_verified') {
        setPhase('verified');
        return;
      }
      setCooldown(RESEND_SECONDS);
      setNotice(`A new code is on its way to ${email}.`);
    } catch (cause) {
      setError(emailErrorMessage(cause, 'Intake could not send the code. Try again shortly.'));
    } finally {
      setBusy(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || !/^\d{6}$/.test(code)) return;
    setError('');
    setNotice('');
    setBusy(true);
    try {
      await confirmVerificationCode(code);
      setPhase('verified');
      // The account page and admin access both read emailVerified from the database.
      window.setTimeout(() => window.location.replace('/app'), 1400);
    } catch (cause) {
      setCode('');
      setError(emailErrorMessage(cause, 'That code could not be confirmed. Try again.'));
      input.current?.focus();
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
          <span className="eyebrow"><i /> ALMOST THERE</span>
          <h1>Check your<br /><em>inbox.</em></h1>
          <p>We sent a six-digit code to confirm this address. It expires in ten minutes, and entering it here finishes setting up your workspace.</p>
          <div className="auth-line">
            01 / Code arrives by email<br />
            02 / Enter it here <span>Six digits, ten minutes</span><br />
            03 / Workspace unlocked <span>Nothing else to confirm</span>
          </div>
        </div>

        <section className="auth-card" aria-label="Verify your email address">
          <div className="card-kicker">INTAKE / VERIFICATION</div>

          {phase === 'checking' && <p role="status">Checking your account…</p>}

          {phase === 'unavailable' && <>
            <h2>Email delivery is off</h2>
            <p>This Intake server has no email provider configured, so no verification code can be sent. You can still use your workspace.</p>
            <Link className="btn btn-accent auth-submit" to="/app">Continue to your workspace →</Link>
          </>}

          {phase === 'verified' && <>
            <h2>You’re verified.</h2>
            <p>Your email address is confirmed. Taking you to your workspace.</p>
            <div className="form-banner ok" role="status"><strong>Email verified.</strong><p>Nothing else is needed. Your account is ready.</p></div>
          </>}

          {phase === 'code' && <>
            <h2>Enter your code</h2>
            <p>We sent a six-digit code to <strong>{email || 'your inbox'}</strong>.</p>
            <form onSubmit={submit}>
              <label>
                Verification code
                <input
                  ref={input}
                  required
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  value={code}
                  onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))}
                  placeholder="000000"
                  className="otp-input"
                  disabled={busy}
                  aria-describedby="otp-help"
                />
              </label>
              <p className="otp-help" id="otp-help">The code expires after ten minutes. Five attempts, then request a new one.</p>
              {notice && <div className="form-banner ok" role="status"><p>{notice}</p></div>}
              {error && <div className="form-error" role="alert">{error}</div>}
              <button className="btn btn-accent auth-submit" type="submit" disabled={busy || code.length !== 6}>
                {busy ? 'Confirming…' : 'Confirm email →'}
              </button>
            </form>
            <div className="auth-switch">
              {cooldown > 0
                ? `You can request a new code in ${cooldown}s`
                : <>Didn’t get it? <button type="button" className="link-button" disabled={busy} onClick={() => void sendCode()}>Send a new code</button></>}
            </div>
            <div className="auth-switch">
              Wrong address? <button type="button" className="link-button" onClick={() => void client.signOut().then(() => window.location.replace('/auth/sign-up'))}>Use a different email</button>
            </div>
          </>}
        </section>
      </main>
      <footer className="auth-footer">
        <span>INTAKE © {new Date().getFullYear()}</span>
        <span>Intake will never ask you for this code.</span>
        <Link to="/pricing">Plans &amp; pricing</Link>
      </footer>
    </div>
  );
}
