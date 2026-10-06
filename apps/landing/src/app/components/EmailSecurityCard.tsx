import { useEffect, useRef, useState } from 'react';
import {
  confirmEmailChange, confirmVerificationCode, emailErrorMessage, fetchAccountEmailStatus,
  requestEmailChange, requestVerificationCode,
} from '../../lib/email';

type EmailState =
  | { status: 'loading' }
  | { status: 'error' }
  | { status: 'ready'; email: string; verified: boolean; deliveryConfigured: boolean };

const RESEND_SECONDS = 60;

/**
 * Account → Security: the email half of the account.
 *
 * States are explicit because "nothing happened" is the one thing a user must never have to guess:
 * verified, not verified, code sent, code expired, code rejected, delivery unavailable.
 */
export function EmailSecurityCard() {
  const [state, setState] = useState<EmailState>({ status: 'loading' });
  const [mode, setMode] = useState<'idle' | 'verify' | 'change'>('idle');
  /** What the outstanding code is for. Tracked separately because `mode` narrows in the verify block. */
  const [purpose, setPurpose] = useState<'verify' | 'change'>('verify');
  const [code, setCode] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [cooldown, setCooldown] = useState(0);
  const input = useRef<HTMLInputElement>(null);

  async function load(): Promise<void> {
    try {
      const status = await fetchAccountEmailStatus();
      setState({
        status: 'ready',
        email: status.email,
        verified: status.emailVerified,
        deliveryConfigured: status.deliveryConfigured,
      });
    } catch {
      setState({ status: 'error' });
    }
  }

  useEffect(() => { void load(); }, []);

  useEffect(() => {
    if (cooldown <= 0) return;
    const timer = setTimeout(() => setCooldown(value => value - 1), 1000);
    return () => clearTimeout(timer);
  }, [cooldown]);

  useEffect(() => {
    if (mode !== 'idle') input.current?.focus();
  }, [mode]);

  async function sendVerification(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      const result = await requestVerificationCode();
      if (result.status === 'already_verified') {
        await load();
        setMode('idle');
        return;
      }
      setPurpose('verify');
      setMode('verify');
      setCooldown(RESEND_SECONDS);
      setNotice('A six-digit code is on its way. It expires in ten minutes.');
    } catch (cause) {
      setError(emailErrorMessage(cause, 'Intake could not send the code. Try again shortly.'));
    } finally {
      setBusy(false);
    }
  }

  async function sendChangeCode(): Promise<void> {
    setError('');
    setBusy(true);
    try {
      await requestEmailChange(newEmail.trim().toLowerCase());
      setPurpose('change');
      setMode('verify');
      setCooldown(RESEND_SECONDS);
      setNotice(`A six-digit code was sent to ${newEmail.trim()}. Confirm it to move your account to that address.`);
    } catch (cause) {
      setError(emailErrorMessage(cause, 'Intake could not send the code. Check the address and try again.'));
    } finally {
      setBusy(false);
    }
  }

  async function confirm(): Promise<void> {
    if (!/^\d{6}$/.test(code) || busy || mode === 'idle') return;
    const changing = purpose === 'change';
    setError('');
    setBusy(true);
    try {
      if (changing) await confirmEmailChange(code);
      else await confirmVerificationCode(code);
      setCode('');
      setNewEmail('');
      setMode('idle');
      setNotice(changing ? 'Your account email was updated. Intake emailed both addresses to confirm it.' : 'Your email address is verified.');
      await load();
    } catch (cause) {
      setCode('');
      setError(emailErrorMessage(cause, 'That code could not be confirmed. Try again.'));
    } finally {
      setBusy(false);
    }
  }

  if (state.status === 'loading') {
    return <p className="forms-progress" role="status">Checking your email status…</p>;
  }
  if (state.status === 'error') {
    return <div role="alert"><p className="forms-progress">Intake could not check your email status right now.</p><button className="btn btn-ghost btn-sm" type="button" onClick={() => void load()}>Try again</button></div>;
  }

  const { email, verified, deliveryConfigured } = state;

  return <div className="email-security">
    <div className="email-security-row">
      <div>
        <span className="email-security-label">Email address</span>
        <strong>{email}</strong>
      </div>
      <span className={`status-pill ${verified ? 'ok' : 'warn'}`}>{verified ? 'Verified' : 'Not verified'}</span>
    </div>

    {!deliveryConfigured && <p className="forms-progress">Email delivery is not configured on this Intake server, so verification and password reset emails cannot be sent yet.</p>}

    {notice && <div className="form-banner ok" role="status"><p>{notice}</p></div>}
    {error && <div className="form-error" role="alert">{error}</div>}

    {mode === 'idle' && <>
      {verified
        ? <p className="forms-progress">This address is confirmed, so Intake can send security notices and password resets to it.</p>
        : <p className="forms-progress">Confirming your address lets Intake send security notices and password resets. It also unlocks administrator access for allowlisted accounts.</p>}
      <div className="email-security-actions">
        {!verified && deliveryConfigured && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => void sendVerification()}>{busy ? 'Sending…' : 'Send verification code'}</button>}
        {deliveryConfigured && <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => { setMode('change'); setNotice(''); setError(''); }}>Change email address</button>}
        <a className="btn btn-ghost btn-sm" href="/auth/reset-password">Reset password</a>
      </div>
    </>}

    {mode === 'change' && <>
      <label className="email-security-field">
        New email address
        <input
          ref={input} type="email" value={newEmail} autoComplete="email"
          onChange={event => setNewEmail(event.target.value)} placeholder="you@example.com" disabled={busy}
        />
      </label>
      <div className="email-security-actions">
        <button className="btn btn-accent btn-sm" type="button" disabled={busy || !/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(newEmail)} onClick={() => void sendChangeCode()}>
          {busy ? 'Sending…' : 'Send code to new address'}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => { setMode('idle'); setError(''); setNewEmail(''); }}>Cancel</button>
      </div>
    </>}

    {mode === 'verify' && <>
      <label className="email-security-field">
        Six-digit code
        <input
          ref={input} inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6}
          className="otp-input" value={code} placeholder="000000"
          onChange={event => setCode(event.target.value.replace(/\D/g, '').slice(0, 6))} disabled={busy}
        />
      </label>
      <div className="email-security-actions">
        <button className="btn btn-accent btn-sm" type="button" disabled={busy || code.length !== 6} onClick={() => void confirm()}>
          {busy ? 'Confirming…' : purpose === 'change' ? 'Confirm new address' : 'Confirm code'}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy || cooldown > 0} onClick={() => void (purpose === 'change' ? sendChangeCode() : sendVerification())}>
          {cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend code'}
        </button>
        <button className="btn btn-ghost btn-sm" type="button" disabled={busy} onClick={() => { setMode('idle'); setCode(''); setError(''); }}>Cancel</button>
      </div>
      <p className="forms-progress">The code expires in ten minutes and allows five attempts.</p>
    </>}
  </div>;
}
