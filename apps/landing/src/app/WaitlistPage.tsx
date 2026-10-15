import { useEffect, useState } from 'react';
import { LogoMark } from '../components/LogoMark';

export default function WaitlistPage() {
  const search = new URLSearchParams(window.location.search);
  const joined = search.get('joined') === '1';
  const already = search.get('already') === '1';
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState<'idle' | 'loading' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  useEffect(() => {
    if (joined || already) setEmail('');
  }, [joined, already]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!email || status === 'loading') return;
    setStatus('loading');
    setErrorMsg('');
    try {
      const { upsertWaitlist } = await import('../../server/waitlist');
      const { already: dup } = await upsertWaitlist(email);
      if (dup) {
        setStatus('idle');
        window.history.replaceState(null, '', '/waitlist?already=1');
        window.location.reload();
        return;
      }
      setStatus('idle');
      window.history.replaceState(null, '', '/waitlist?joined=1');
      window.location.reload();
    } catch {
      setStatus('error');
      setErrorMsg('Something went wrong. Please try again.');
    }
  };

  return (
    <section className="mk-section mk-waitlist">
      <div className="mk-container">
        <div className="mk-waitlist__grid">
          <div className="mk-waitlist__copy">
            <span className="mk-eyebrow"><i /> Early Access</span>
            <h1>Be first in line.</h1>
            <p className="mk-waitlist__lede">
              Intake is currently in limited early access. Join the waitlist and we will let you know as soon as your spot opens.
            </p>
            <ul className="mk-waitlist__points">
              <li>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Priority access when your spot opens</span>
              </li>
              <li>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Hear from the founder with regular updates</span>
              </li>
              <li>
                <svg width="16" height="16" viewBox="0 0 16 16" fill="none"><path d="M3 8.5L6.5 12L13 4.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <span>Free plan includes 20 daily credits — no card needed</span>
              </li>
            </ul>
          </div>
          <div className="mk-waitlist__card">
            <div className="mk-waitlist__card-head">
              <LogoMark size={40} />
              <span className="mk-waitlist__card-brand">Intake</span>
            </div>
            {already ? (
              <div className="mk-waitlist__state mk-waitlist__state--already">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" /><path d="M13 20.5L17.5 25L27 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <h2>You are on the list</h2>
                <p>We already have your email. You will hear from us as soon as your spot opens.</p>
              </div>
            ) : joined ? (
              <div className="mk-waitlist__state mk-waitlist__state--joined">
                <svg width="40" height="40" viewBox="0 0 40 40" fill="none"><circle cx="20" cy="20" r="18" stroke="currentColor" strokeWidth="2" /><path d="M13 20.5L17.5 25L27 15.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
                <h2>You are in.</h2>
                <p>We have added <strong>{email}</strong> to the waitlist. A welcome email is on its way to <strong>{email}</strong>.</p>
                <p className="mk-waitlist__note">You will hear from the founder with regular updates as we get closer to your spot.</p>
              </div>
            ) : (
              <form onSubmit={handleSubmit} className="mk-waitlist__form">
                <h2>Join the waitlist</h2>
                <p>Enter your email and we will save your spot.</p>
                <label htmlFor="waitlist-email">Email address</label>
                <input
                  id="waitlist-email"
                  type="email"
                  placeholder="you@example.com"
                  value={email}
                  onChange={e => setEmail(e.target.value)}
                  required
                  disabled={status === 'loading'}
                />
                {status === 'error' && errorMsg && <p className="mk-waitlist__error">{errorMsg}</p>}
                <button className="mk-button mk-button--primary" type="submit" disabled={status === 'loading'}>
                  {status === 'loading' ? 'Joining…' : 'Join the waitlist'}
                  {status !== 'loading' && (
                    <svg width="14" height="14" viewBox="0 0 16 16" fill="none"><path d="M3 8h10M9 4l4 4-4 4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>
                  )}
                </button>
                <p className="mk-waitlist__privacy">We will only email you about your waitlist spot. No spam, ever.</p>
              </form>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}