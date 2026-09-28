import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';

const URL_ = import.meta.env.VITE_WAITLIST_URL as string | undefined;
const FIELD = (import.meta.env.VITE_WAITLIST_FIELD as string | undefined) || 'email';
const KEY = 'intake:waitlist';

type State = 'idle' | 'sending' | 'done' | 'error' | 'closed';

export function Waitlist({ source = 'cta' }: { source?: string }) {
  const [email, setEmail] = useState('');
  const [state, setState] = useState<State>(() => (typeof localStorage !== 'undefined' && localStorage.getItem(KEY) ? 'done' : 'idle'));
  const valid = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!valid) {
      setState('error');
      return;
    }
    if (!URL_) {
      setState('closed');
      return;
    }
    setState('sending');
    try {
      const body = new FormData();
      body.append(FIELD, email.trim());
      if (!URL_.includes('docs.google.com')) body.append('source', source);
      // no-cors: works with Google Forms' formResponse and most form backends.
      await fetch(URL_, { method: 'POST', mode: 'no-cors', body });
      localStorage.setItem(KEY, '1');
      setState('done');
    } catch {
      setState('error');
    }
  }

  return (
    <div className="wl" id="waitlist">
      <AnimatePresence mode="wait" initial={false}>
        {state === 'done' ? (
          <motion.div key="done" className="wl-done" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
            <span className="wl-tick">✓</span>
            <div>
              <b>You’re on the list.</b>
              <span>We’ll email you when you can connect your account.</span>
            </div>
          </motion.div>
        ) : (
          <motion.form key="form" className={`wl-form ${state === 'error' ? 'is-error' : ''}`} onSubmit={submit} noValidate initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -10 }}>
            <input
              type="email"
              inputMode="email"
              autoComplete="email"
              value={email}
              onChange={(e) => {
                setEmail(e.target.value);
                if (state === 'error' || state === 'closed') setState('idle');
              }}
              placeholder="you@example.com"
              aria-label="Your email"
            />
            <button className="btn btn-accent" type="submit" disabled={state === 'sending'}>
              {state === 'sending' ? <span className="spin sm" /> : 'Get early access'}
            </button>
          </motion.form>
        )}
      </AnimatePresence>
      <p className={`wl-note ${state === 'error' ? 'is-error' : ''}`}>
        {state === 'error'
          ? 'That email doesn’t look right. Mind checking it?'
          : state === 'closed'
            ? 'The waitlist opens very soon. Watch the GitHub repo in the meantime.'
            : state === 'done'
              ? ' '
              : 'One email when it’s ready. No spam, no sharing your address.'}
      </p>
    </div>
  );
}
