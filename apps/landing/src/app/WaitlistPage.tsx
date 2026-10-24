import { useEffect, useRef, useState, type FormEvent } from 'react';
import { LogoMark } from '../components/LogoMark';
import { ThemeToggle } from '../components/ThemeToggle';
import { WAITLIST_BENEFITS, WAITLIST_DESCRIPTION, WAITLIST_FAQS, WAITLIST_SENDER, WAITLIST_TITLE } from '../content/waitlist';
import { useSiteAnalytics } from '../lib/analytics';
import { isWaitlistEmail, joinWaitlist, normalizeWaitlistEmail, WaitlistError } from '../lib/waitlist';
import { usePageMeta, webPageSchema } from '../marketing/usePageMeta';

const SCHEMA = webPageSchema('/waitlist', WAITLIST_TITLE, WAITLIST_DESCRIPTION);

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return <svg aria-hidden="true" viewBox="0 0 20 20" width="18" height="18" fill="none">
    <path d={diagonal ? 'M5 15 15 5M5 5h10v10' : 'M4 10h12M11 5l5 5-5 5'} stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
  </svg>;
}

/** A non-interactive illustration, not a pretend generated form or a claim of live access. */
function FormPreview() {
  return <figure className="waitlist-preview" aria-label="Illustration of a written request becoming an event registration form">
    <div className="waitlist-preview__grid" aria-hidden="true" />
    <div className="waitlist-preview__content" aria-hidden="true">
      <div className="waitlist-preview__label"><span>AN IDEA, MADE USEFUL</span><span>01 / FORMS</span></div>
      <div className="waitlist-prompt">
        <div className="waitlist-prompt__label"><svg viewBox="0 0 20 20" width="16" height="16" fill="none"><path d="m10 2 2.2 5.8L18 10l-5.8 2.2L10 18l-2.2-5.8L2 10l5.8-2.2Z" stroke="currentColor" strokeWidth="1.3" /></svg> YOUR WORDS</div>
        <p>“Create an event signup with name, email, and dietary needs.”</p>
        <span className="waitlist-prompt__cursor" />
      </div>
      <div className="waitlist-preview__connector"><span /><LogoMark size={30} /><span /></div>
      <div className="waitlist-paper-stack">
        <div className="waitlist-paper">
          <div className="waitlist-paper__top"><span>INTAKE / FORM PREVIEW</span><span className="waitlist-paper__dot" /></div>
          <h2>See you there.</h2>
          <p>A few details, and you’re on the guest list.</p>
          <div className="waitlist-paper__field"><span><small>01</small> Full name <b>*</b></span><div>Your name</div></div>
          <div className="waitlist-paper__field"><span><small>02</small> Email address <b>*</b></span><div>you@example.com</div></div>
          <div className="waitlist-paper__field"><span><small>03</small> Any dietary needs?</span><div className="waitlist-paper__select">Select an option <span>⌄</span></div></div>
          <div className="waitlist-paper__bottom"><span>YOUR FORM. YOUR FINAL SAY.</span><svg viewBox="0 0 20 20" width="12" height="12" fill="none"><path d="m4 10 4 4 8-8" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" /></svg></div>
        </div>
      </div>
    </div>
    <figcaption><span>Forms are just the start.</span><small>Illustrative preview · You always review before applying.</small></figcaption>
  </figure>;
}

export default function WaitlistPage() {
  usePageMeta({ title: WAITLIST_TITLE, description: WAITLIST_DESCRIPTION, path: '/waitlist', schema: SCHEMA });
  useSiteAnalytics('/waitlist');
  const [email, setEmail] = useState('');
  const [website, setWebsite] = useState('');
  const [state, setState] = useState<'idle' | 'joining' | 'joined'>('idle');
  const [joinedEmail, setJoinedEmail] = useState('');
  const [error, setError] = useState('');
  const input = useRef<HTMLInputElement>(null);
  const successHeading = useRef<HTMLHeadingElement>(null);
  const request = useRef<AbortController | null>(null);

  useEffect(() => () => { request.current?.abort(); }, []);
  useEffect(() => { if (state === 'joined') successHeading.current?.focus(); }, [state]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (request.current) return;
    const recipient = normalizeWaitlistEmail(email);
    if (!isWaitlistEmail(recipient)) {
      setError('Please enter a valid email address.');
      input.current?.focus();
      return;
    }
    const controller = new AbortController();
    request.current = controller;
    setError('');
    setState('joining');
    try {
      await joinWaitlist(recipient, website, controller.signal);
      if (controller.signal.aborted) return;
      setJoinedEmail(recipient);
      setState('joined');
    } catch (failure) {
      if (controller.signal.aborted) return;
      setError(failure instanceof WaitlistError ? failure.message : 'Something went wrong. Please try again.');
      setState('idle');
    } finally {
      if (request.current === controller) request.current = null;
    }
  }

  function addAnother() {
    setEmail('');
    setWebsite('');
    setError('');
    setJoinedEmail('');
    setState('idle');
    // Focus after React replaces the confirmation with the form.
    requestAnimationFrame(() => input.current?.focus());
  }

  return <div className="marketing-page waitlist-page">
    <a className="skip-link" href="#waitlist-main">Skip to the wait-list</a>
    <header className="waitlist-header">
      <div className="waitlist-wrap waitlist-header__inner">
        <a className="mk-brand" href="/" aria-label="Intake home"><LogoMark size={30} /><span>intake</span></a>
        <span className="waitlist-header__edition">A WORK IN PROGRESS. A BETTER WAY TO WORK.</span>
        <nav aria-label="Wait-list navigation">
          <a className="waitlist-explore" href="/">Explore Intake <Arrow diagonal /></a>
          <ThemeToggle className="waitlist-theme" />
        </nav>
      </div>
    </header>

    <main id="waitlist-main" tabIndex={-1}>
      <section className="waitlist-hero waitlist-wrap" aria-labelledby="waitlist-title">
        <div className="waitlist-hero__copy">
          <p className="waitlist-eyebrow"><span className="waitlist-status-dot" /> THE NEXT CHAPTER STARTS HERE</p>
          <h1 id="waitlist-title">Less busywork.<br /><em>More possibility.</em></h1>
          <p className="waitlist-hero__lead">A simpler way to collect, organize, and work with information. Starting with forms. Built with you.</p>
          <p className="waitlist-hero__lead waitlist-hero__open">
            Intake is open — you do not need this list. <a href="/auth/sign-up">Create a free account</a> and build the first form today.
          </p>

          <div className="waitlist-signup" id="join">
            {state === 'joined' ? <div className="waitlist-success" role="status" aria-live="polite">
              <span className="waitlist-success__check" aria-hidden="true"><svg viewBox="0 0 24 24" width="23" height="23"><path d="m5 12 4 4L19 6" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg></span>
              <div>
                <p className="waitlist-label">YOU’RE HERE EARLY. WE LIKE THAT.</p>
                <h2 ref={successHeading} tabIndex={-1}>You’re on the list.</h2>
                <p>Your place is saved for <strong>{joinedEmail}</strong>. We’ll email you when early access opens.</p>
                <p className="waitlist-success__note">Look out for a personal welcome note from Daniel. If it doesn’t arrive, check your spam folder — your signup is still saved.</p>
                <button type="button" className="waitlist-text-link" onClick={addAnother}>Add another email <Arrow /></button>
              </div>
            </div> : <form onSubmit={event => { void submit(event); }} noValidate aria-busy={state === 'joining'}>
              <label className="waitlist-label" htmlFor="waitlist-email">YOUR EMAIL. YOUR INVITATION.</label>
              <div className={`waitlist-form-row${error ? ' has-error' : ''}`}>
                <input
                  ref={input} id="waitlist-email" name="email" type="email" inputMode="email" autoComplete="email"
                  autoCapitalize="none" spellCheck={false} placeholder="you@example.com" required maxLength={254}
                  value={email} disabled={state === 'joining'} aria-invalid={Boolean(error)}
                  aria-describedby={error ? 'waitlist-error waitlist-consent' : 'waitlist-consent'}
                  onChange={event => { setEmail(event.target.value); if (error) setError(''); }}
                />
                <button className="waitlist-submit" type="submit" disabled={state === 'joining'}>
                  {state === 'joining' ? <><span className="waitlist-spinner" aria-hidden="true" /> Joining…</> : <>Join the wait-list <Arrow /></>}
                </button>
              </div>
              <div className="waitlist-honeypot" aria-hidden="true">
                <label htmlFor="waitlist-website">Leave this field empty</label>
                <input id="waitlist-website" name="website" type="text" tabIndex={-1} autoComplete="off" value={website} onChange={event => setWebsite(event.target.value)} />
              </div>
              {error && <p className="waitlist-error" id="waitlist-error" role="alert">{error}</p>}
              <p className="waitlist-consent" id="waitlist-consent">Early access and occasional product updates. No spam, no extra hoops. By joining, you agree to our <a href="/privacy">Privacy Policy</a>. Leave any time by emailing Daniel.</p>
            </form>}
          </div>
          <div className="waitlist-human"><span className="waitlist-avatar" aria-hidden="true">D</span><p>One welcome note. From a real person.<br /><a href={`mailto:${WAITLIST_SENDER}`}>{WAITLIST_SENDER}</a></p></div>
        </div>
        <FormPreview />
      </section>

      <section className="waitlist-benefits waitlist-wrap" aria-labelledby="waitlist-benefits-title">
        <div className="waitlist-section-heading"><span className="waitlist-label">MORE THAN A PLACE IN LINE</span><h2 id="waitlist-benefits-title">Be part of what’s next.</h2></div>
        <ol>{WAITLIST_BENEFITS.map((benefit, index) => <li key={benefit.title}>
          <span className="waitlist-benefits__number">0{index + 1}</span><h3>{benefit.title}</h3><p>{benefit.body}</p>
        </li>)}</ol>
      </section>

      <div className="waitlist-bottom waitlist-wrap">
        <aside className="waitlist-founder" aria-labelledby="waitlist-founder-title">
          <p className="waitlist-label" id="waitlist-founder-title">A NOTE FROM THE FOUNDER</p>
          <blockquote>“You should be able to focus on what you need to get done, not spend so much time figuring out the tools you use to do it.”</blockquote>
          <div className="waitlist-founder__signoff"><div><span>Daniel</span><small>Founder, Intake</small></div><a className="waitlist-text-link" href={`mailto:${WAITLIST_SENDER}`}>Tell me what you need <Arrow diagonal /></a></div>
        </aside>
        <section className="waitlist-faq" aria-labelledby="waitlist-faq-title">
          <p className="waitlist-label">A FEW GOOD QUESTIONS</p>
          <h2 id="waitlist-faq-title">Before you join.</h2>
          {WAITLIST_FAQS.map(faq => <details key={faq.question}><summary>{faq.question}<span aria-hidden="true">+</span></summary><p>{faq.answer}</p></details>)}
        </section>
      </div>
    </main>

    <footer className="waitlist-footer waitlist-wrap">
      <span>© {new Date().getFullYear()} Intake <span className="waitlist-footer__separator">/</span> Just getting started.</span>
      <nav aria-label="Footer navigation"><a href="/auth/sign-in">Already have access? Sign in</a><a href="/privacy">Privacy</a><a href="/terms">Terms</a></nav>
    </footer>
  </div>;
}
