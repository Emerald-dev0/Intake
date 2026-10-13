import { useState, type FormEvent } from 'react';

/**
 * One email box for the Pro waitlist and the product-updates list. Posts to the
 * public subscribe endpoint; the same indistinct success covers new and repeat
 * addresses, and a honeypot field absorbs naive bots.
 */
export function NotifyForm({
  interest,
  buttonLabel,
  id,
}: {
  interest: 'pro' | 'updates';
  buttonLabel: string;
  id: string;
}) {
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'sending' | 'done' | 'error' | 'invalid'>('idle');

  async function submit(event: FormEvent) {
    event.preventDefault();
    if (status === 'sending' || status === 'done') return;
    if (!/^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/.test(email.trim())) { setStatus('invalid'); return; }
    setStatus('sending');
    try {
      const form = document.getElementById(id) as HTMLFormElement | null;
      const honeypot = form?.querySelector<HTMLInputElement>('input[name="website"]')?.value ?? '';
      const response = await fetch('/api/updates/subscribe', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ email: email.trim(), interest, website: honeypot }),
      });
      if (!response.ok) throw new Error('subscribe failed');
      setStatus('done');
    } catch {
      setStatus('error');
    }
  }

  if (status === 'done') {
    return <p className="mk-notify__done" role="status">You are on the list. One email when it ships — nothing else.</p>;
  }

  return (
    <form className="mk-notify" id={id} onSubmit={submit}>
      <label className="mk-notify__label" htmlFor={`${id}-email`}>Email me when it opens</label>
      <div className="mk-notify__row">
        <input
          id={`${id}-email`}
          type="email"
          name="email"
          autoComplete="email"
          placeholder="you@example.com"
          maxLength={320}
          value={email}
          onChange={event => { setEmail(event.target.value); if (status !== 'idle') setStatus('idle'); }}
        />
        <input type="text" name="website" autoComplete="off" tabIndex={-1} aria-hidden="true" className="mk-notify__honeypot" />
        <button className="mk-button mk-button--primary" type="submit" disabled={status === 'sending'}>
          <span>{status === 'sending' ? 'Joining…' : buttonLabel}</span>
        </button>
      </div>
      {status === 'invalid' && <p className="mk-notify__error" role="alert">Enter a valid email address.</p>}
      {status === 'error' && <p className="mk-notify__error" role="alert">Could not join right now. Try again in a moment.</p>}
    </form>
  );
}
