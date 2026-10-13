import { useEffect, useState } from 'react';

export default function WaitlistPage() {
  // Parse URL query parameters manually
  const search = new URLSearchParams(window.location.search);
  const joined = search.get('joined') === '1';
  const already = search.get('already') === '1';
  const [email, setEmail] = useState('');

  // Pre‑fill if we came from the auth flow
  useEffect(() => {
    if (joined || already) setEmail('');
  }, [joined, already]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email) return;
    const { already: dup } = await (await import('../../server/waitlist')).upsertWaitlist(email);
    if (dup) {
      setEmail(email); // stay on page, show “already” state
      return;
    }
    // new entry – show success state
    setEmail(email);
  };

  // Determine which message to display
  let message: React.ReactNode = null;
  if (already) {
    message = (
      <p>
        You’re already on the wait‑list 👀. We’ll let you know as soon as we’re ready.
      </p>
    );
  } else if (joined) {
    message = (
      <p>
        We’ve added {email ?? 'your e‑mail'} to the wait‑list. <br />
        You’ll receive a welcome mail from <strong>daniel@calder.click</strong> as soon as we’re live.
      </p>
    );
  } else {
    /* Show the join form */
    message = (
      <form onSubmit={handleSubmit} className="mk-form">
        <input
          type="email"
          placeholder="your e‑mail"
          value={email}
          onChange={e => setEmail(e.target.value)}
          required
          className="mk-input"
        />
        <button type="submit" className="mk-button mk-button--primary">
          Join the wait‑list
        </button>
      </form>
    );
  }

  return (
    <section className="mk-section mk-waitlist">
      <div className="mk-container">
        <h1>Thanks for your interest!</h1>
        {message}
      </div>
    </section>
  );
}