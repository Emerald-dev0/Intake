import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { HERO_DEMO_PROMPTS, PROMPT_EXAMPLES, type DemoProposal } from '../content/site';
import { useBillingPlans } from '../lib/useBillingPlans';
import { HeroFlow } from './HeroFlow';
import { StartLink } from './MarketingChrome';
import { useViewState } from './motion';

export function Arrow({ diagonal = false }: { diagonal?: boolean }) {
  return diagonal ? (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
      <path d="M5 11 11 5M5.5 5H11v5.5" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  ) : (
    <svg aria-hidden="true" viewBox="0 0 16 16" width="15" height="15">
      <path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check() {
  return <span className="mk-check" aria-hidden="true">✓</span>;
}

/**
 * Scroll reveal.
 *
 * Four entrances, and an exit. `fadeOut` is what makes the page feel alive on the way back up: a
 * block the reader has finished with settles back rather than sitting at full strength for the rest
 * of the scroll. It is never applied to anything interactive — a control must not fade under the
 * pointer.
 *
 * The element is in the DOM immediately; only the entrance is delayed, so the page is readable with
 * JavaScript slow, broken, or motion reduced.
 */
type RevealVariant = 'rise' | 'fade' | 'wipe' | 'scale';

export function Reveal({
  children,
  className = '',
  delay = 0,
  variant = 'rise',
  fadeOut = false,
  as: Tag = 'div',
}: {
  children: ReactNode;
  className?: string;
  delay?: number;
  variant?: RevealVariant;
  fadeOut?: boolean;
  as?: 'div' | 'li' | 'article' | 'section' | 'span' | 'p';
}) {
  const [ref, state] = useViewState<HTMLDivElement>({ once: !fadeOut });
  const classes = [
    'mk-reveal',
    `mk-reveal--${variant}`,
    state === 'in' ? 'is-in' : '',
    fadeOut && state === 'after' ? 'is-out' : '',
    className,
  ].filter(Boolean).join(' ');
  return (
    <Tag ref={ref as never} className={classes} style={{ '--d': `${delay}ms` } as CSSProperties}>
      {children}
    </Tag>
  );
}

export function SectionIntro({
  eyebrow,
  title,
  titleId,
  children,
  className = '',
}: {
  eyebrow: string;
  title: ReactNode;
  titleId: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <Reveal className={`mk-section-intro ${className}`} variant="rise" fadeOut>
      <span className="mk-eyebrow">{eyebrow}</span>
      <h2 id={titleId}>{title}</h2>
      <p>{children}</p>
    </Reveal>
  );
}


/**
 * Picks the closest worked example for whatever the visitor typed. Pure, so the
 * homepage demo and its unit test share the exact same behaviour.
 */
export function demoProposalFor(text: string): DemoProposal {
  const words = text.toLowerCase().split(/[^a-z]+/).filter(word => word.length > 2);
  const HINTS: Array<[number, string[]]> = [
    [0, ['birthday', 'rsvp', 'party', 'wedding', 'dinner', 'invite', 'guests']],
    [1, ['feedback', 'customer', 'survey', 'satisfaction', 'review', 'recommend']],
    [2, ['club', 'student', 'signup', 'sign', 'member', 'audition', 'school', 'volunteer']],
  ];
  let best = 1;
  let bestScore = 0;
  for (const [index, hints] of HINTS) {
    const score = hints.filter(hint => words.includes(hint)).length;
    if (score > bestScore) { bestScore = score; best = index; }
  }
  return HERO_DEMO_PROMPTS[best]!;
}

/**
 * The conversion lever: type a request, see a proposed question list, no account.
 * Proposals are worked examples, labelled as such; creating a real form needs
 * the free account, and the call to action says exactly that.
 */
function HeroPromptBox({ authenticated }: { authenticated: boolean }) {
  const [value, setValue] = useState('');
  const [proposal, setProposal] = useState<DemoProposal | null>(null);

  function run(event?: FormEvent) {
    event?.preventDefault();
    if (!value.trim()) return;
    setProposal(demoProposalFor(value));
  }
  function tryPrompt(prompt: string) {
    setValue(prompt);
    setProposal(demoProposalFor(prompt));
  }

  return (
    <div className="mk-hero-try">
      <form className="mk-hero-try__form" onSubmit={run}>
        <label htmlFor="mk-hero-prompt">Try it — no signup needed</label>
        <div className="mk-hero-try__row">
          <input
            id="mk-hero-prompt"
            type="text"
            value={value}
            onChange={event => setValue(event.target.value)}
            placeholder="e.g. RSVP for my birthday"
            maxLength={140}
            autoComplete="off"
          />
          <button className="mk-button mk-button--primary" type="submit" disabled={!value.trim()}>
            <span>See the questions</span>
            <Arrow />
          </button>
        </div>
      </form>
      <div className="mk-hero-try__chips" role="group" aria-label="Example requests">
        {HERO_DEMO_PROMPTS.map(item => (
          <button key={item.prompt} type="button" onClick={() => tryPrompt(item.prompt)}>
            “{item.prompt}”
          </button>
        ))}
      </div>
      {proposal && (
        <div className="mk-hero-try__result" key={proposal.prompt} role="status">
          <div className="mk-review-card">
            <div className="mk-review-card__head">
              <span>EXAMPLE PROPOSAL</span>
              <span className="mk-chip mk-chip--warm">SAMPLE</span>
            </div>
            <ul className="mk-preview-questions">
              {proposal.questions.map((question, index) => (
                <li key={question.title} style={{ '--i': index } as CSSProperties}>
                  <span className="mk-preview-question__number">{String(index + 1).padStart(2, '0')}</span>
                  <span className="mk-preview-question__body">
                    <strong>{question.title}</strong>
                    <small>{question.kind}{question.detail ? ` · ${question.detail}` : ''}</small>
                  </span>
                </li>
              ))}
            </ul>
            <div className="mk-review-card__note"><Check /> Your real proposal works exactly like this — then you confirm.</div>
          </div>
          <div className="mk-hero-try__cta">
            <StartLink authenticated={authenticated}>
              {authenticated ? 'Open Intake' : 'Sign up free'}
            </StartLink>
            <span>That was a sample. A free account makes the real thing — no card, 20 credits a day.</span>
          </div>
        </div>
      )}
    </div>
  );
}

export function Hero({ authenticated }: { authenticated: boolean }) {
  const plans = useBillingPlans();
  return (
    <section className="mk-hero" id="top" aria-labelledby="mk-hero-title">
      <div className="mk-container mk-hero__center">
        <h1 id="mk-hero-title">
          <span className="mk-anim-in" style={{ '--d': '60ms' } as CSSProperties}>Tell Intake what you need.</span>
          <span className="mk-hero__accent mk-anim-in" style={{ '--d': '160ms' } as CSSProperties}>
            It builds the form for you.
            <svg className="mk-hero__scribble" viewBox="0 0 520 34" preserveAspectRatio="none" aria-hidden="true" focusable="false">
              <path d="M6 22 C 70 10, 150 30, 236 18 S 392 6, 512 20" pathLength={1} />
            </svg>
          </span>
        </h1>
        <p className="mk-hero__lede mk-anim-in" style={{ '--d': '260ms' } as CSSProperties}>
          Write one plain-English sentence. Intake shows you the questions, you change what you like, and only then does the form appear in your account.
        </p>
        <div className="mk-hero__actions mk-anim-in" style={{ '--d': '360ms' } as CSSProperties}>
          {authenticated ? (
            <StartLink authenticated />
          ) : (
            <a className="mk-button mk-button--primary" href="/auth/sign-up">
              <span>Sign up free</span>
              <Arrow />
            </a>
          )}
          <a className="mk-button mk-button--secondary" href="#creation">See it work <Arrow /></a>
        </div>
        <p className="mk-hero__trust mk-anim-in" style={{ '--d': '420ms' } as CSSProperties}>
          Free during launch · {plans.freeDailyCredits} credits a day · No card
        </p>
      </div>

      <div className="mk-container mk-hero__diagram mk-anim-in" style={{ '--d': '480ms' } as CSSProperties}>
        <HeroFlow />
      </div>

      <div className="mk-container mk-hero__try">
        <HeroPromptBox authenticated={authenticated} />
      </div>

      <div className="mk-marquee" aria-label="Examples of what you can ask for">
        <div className="mk-marquee__track">
          {[0, 1].map(copy => (
            <ul className="mk-marquee__row" key={copy} aria-hidden={copy === 1}>
              {PROMPT_EXAMPLES.map(prompt => (
                <li key={prompt}><span aria-hidden="true">“</span>{prompt}<span aria-hidden="true">”</span></li>
              ))}
            </ul>
          ))}
        </div>
      </div>
    </section>
  );
}


/**
 * What's next, with an email capture. Each item is something visitors asked
 * for; the list tells Intake what to build first.
 */
