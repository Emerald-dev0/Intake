import { useState, type CSSProperties, type FormEvent, type ReactNode } from 'react';
import { FAQS, COMING_SOON, HERO_DEMO_PROMPTS, LIVE_PROVIDERS, PROMPT_EXAMPLES, ROADMAP_NOTE, ROADMAP_PROVIDERS, type DemoProposal } from '../content/site';
import { NotifyForm } from './NotifyForm';
import { formatUsd } from '../lib/plans';
import { useBillingPlans, comparePlanPrices } from '../lib/useBillingPlans';
import { LogoMark } from '../components/LogoMark';
import { GoogleFormsLogo, PlannedProviderLogo, TypeformLogo } from '../components/ProviderLogos';
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
          <StartLink authenticated={authenticated} />
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
export function ComingSoonSection() {
  return (
    <section className="mk-section mk-coming" id="whats-next" aria-labelledby="mk-coming-title">
      <div className="mk-container mk-coming__grid">
        <Reveal variant="fade">
          <SectionIntro eyebrow="WHAT'S NEXT" titleId="mk-coming-title" title={<>What Intake does next.</>}>
            Three things on the workbench. Leave your email and you will hear about each one exactly once — when it ships.
          </SectionIntro>
          <NotifyForm interest="updates" buttonLabel="Email me" id="mk-coming-notify" />
        </Reveal>
        <ul className="mk-coming__list">
          {COMING_SOON.map((item, index) => (
            <Reveal as="li" key={item.title} delay={index * 90} variant="rise">
              <span className="mk-coming__number">{String(index + 1).padStart(2, '0')}</span>
              <div><h3>{item.title}</h3><p>{item.body}</p></div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

/** A repeated call to action: same promise, no new words to learn. */
function RepeatCta({ authenticated, label }: { authenticated: boolean; label: string }) {
  return (
    <div className="mk-repeat-cta">
      <span>{label}</span>
      <StartLink authenticated={authenticated} className="mk-button mk-button--primary" />
    </div>
  );
}

/**
 * Plain-language permissions: what Intake asks Google for, why, and what it
 * never does. Mirrors the privacy policy; the sensitive scope (forms.body) is
 * named exactly as Google names it.
 */
const TRUST_ASK = [
  {
    title: 'Your basic identity, to sign you in',
    text: 'Name, email address, and profile info (the openid, email, and profile scopes). This never touches your forms.',
  },
  {
    title: 'Forms access, only when you connect',
    text: 'One extra permission, requested in a separate step you start yourself: Google Forms asks for forms.body (create and edit the forms you own); Typeform asks for forms:write and forms:read (create and list), plus accounts:read to name the account and offline so the connection survives the week. Intake never asks for Drive, Gmail or webhooks.',
  },
  {
    title: 'Spreadsheet sync, only when you ask for it',
    text: 'Keeping a form’s answers in a Google Sheet needs one more permission — drive.file — and it reaches only the files Intake created itself. Intake asks for it only when you set up syncing for a form, never when you connect. It cannot see, list or open anything else in your Drive: not other spreadsheets, not documents, not photos.',
  },
  {
    title: 'Response reading, only when you ask for it',
    text: 'Response Insights counts the answers people give you. That needs one extra Google permission — forms.responses.readonly — and Intake asks for it only when you open Response Insights and choose to allow it, never when you connect. Google adds it to what you already granted instead of replacing it, you can take it away from your Google account permissions at any time, and your forms can still be created and edited without it.',
  },
] as const;

const TRUST_NEVER = [
  'Keep a copy of the answers people submit',
  'Open, list or change any file in your Drive that Intake did not create itself',
  'Touch Gmail, Calendar, or Contacts',
  'Delete a form or change who it is shared with',
  'Train models on your forms or sell your data',
  'Show ads or send marketing email you did not ask for',
] as const;

export function TrustSection() {
  return (
    <section className="mk-section mk-trust" id="trust" aria-labelledby="mk-trust-title">
      <div className="mk-container">
        <SectionIntro eyebrow="PERMISSIONS, IN PLAIN LANGUAGE" titleId="mk-trust-title" title={<>What Intake asks for, and what it never does.</>}>
          Each provider gets the narrowest permission its API allows and a reason. Everything else on this list is something Intake cannot do — by design, not by promise, and that rule does not change as providers are added.
        </SectionIntro>
        <div className="mk-trust__grid">
          <Reveal variant="fade">
            <h3>What Intake asks for</h3>
            <ul className="mk-trust__ask">
              {TRUST_ASK.map(item => (
                <li key={item.title}><strong>{item.title}</strong><p>{item.text}</p></li>
              ))}
            </ul>
          </Reveal>
          <Reveal delay={120} variant="fade">
            <h3>What Intake never does</h3>
            <ul className="mk-feature-list mk-trust__never">
              {TRUST_NEVER.map(item => <li key={item}><span className="mk-cross" aria-hidden="true">✕</span>{item}</li>)}
            </ul>
            <p className="mk-trust__policy">The full version lives in the <a href="/privacy">privacy policy</a>, written for Google&rsquo;s API data policy and Typeform&rsquo;s developer terms.</p>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

export function ControlSection() {
  return (
    <section className="mk-section mk-control" id="control" aria-labelledby="mk-control-title">
      <div className="mk-container mk-control__grid">
        <Reveal>
          <span className="mk-eyebrow">NOTHING HAPPENS BY SURPRISE</span>
          <h2 id="mk-control-title">You are the one who presses go.</h2>
          <p>Intake writes the form, not the other way round. Nothing is created, changed or sent anywhere until you have read the proposal and confirmed it.</p>
          <a className="mk-text-link" href="#how-it-works">See the whole flow <Arrow /></a>
        </Reveal>
        <Reveal className="mk-approval-flow" delay={140}>
          <div role="group" aria-label="The three moments of an Intake change">
            <div className="mk-approval-flow__step">
              <span>01</span><div><strong>Intake drafts it</strong><small>Questions or a suggested edit</small></div>
            </div>
            <div className="mk-approval-flow__connector" aria-hidden="true"><i /></div>
            <div className="mk-approval-flow__step mk-approval-flow__step--review">
              <span>02</span><div><strong>You read it</strong><small>Still nothing in your account</small></div>
            </div>
            <div className="mk-approval-flow__connector" aria-hidden="true"><i /></div>
            <div className="mk-approval-flow__step mk-approval-flow__step--apply">
              <span>03</span><div><strong>You confirm</strong><small>Now it becomes real</small></div>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function ProviderConnection({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-google" id="providers" aria-labelledby="mk-google-title">
      <div className="mk-container">
        <div className="mk-google__inner">
          <Reveal className="mk-google__mark">
            <div aria-hidden="true">
              <span className="mk-google__logo"><LogoMark size={22} /> Intake</span>
              <span className="mk-google__link"><i /><i /><i /></span>
              <span className="mk-google__targets">
                <span className="mk-google__logo"><GoogleFormsLogo size={18} /> Google Forms</span>
                <span className="mk-google__logo"><TypeformLogo height={12} tone="mono" /> Typeform</span>
              </span>
            </div>
          </Reveal>
          <Reveal className="mk-google__copy" delay={110}>
            <span className="mk-eyebrow">A CONNECTION, NOT A MOVE</span>
            <h2 id="mk-google-title">Your forms stay in your account.</h2>
            <p>Sign in to Intake, then connect the tool the form should live in. That provider hosts the page people fill in, the answers go to you, and Intake keeps only what it needs to write the form. Two providers are connected today; the next ones are already chosen.</p>
          </Reveal>
          <Reveal className="mk-google__action" delay={200}><StartLink authenticated={authenticated} className="mk-text-link">Sign up free</StartLink></Reveal>
        </div>

        <Reveal className="mk-provider-board" delay={120}>
          <div className="mk-provider-board__intro">
            <span className="mk-eyebrow">PROVIDERS</span>
            <h3 id="mk-provider-board-title">Two live now. More in the queue.</h3>
            <p>{ROADMAP_NOTE}</p>
          </div>
          <div className="mk-provider-board__groups" aria-labelledby="mk-provider-board-title">
            <div className="mk-provider-board__group">
              <h4>Live today <span className="mk-chip mk-chip--quiet">WORKS NOW</span></h4>
              <ul>
                {LIVE_PROVIDERS.map(provider => (
                  <li key={provider.name}>
                    <span className="mk-provider-board__mark">
                      {provider.name === 'Google Forms'
                        ? <GoogleFormsLogo size={18} label={null} />
                        : <TypeformLogo height={12} label={null} />}
                    </span>
                    <span>
                      <strong>{provider.name}</strong>
                      <small>{provider.detail}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mk-provider-board__group mk-provider-board__group--planned">
              <h4>Next in line <span className="mk-chip">PLANNED</span></h4>
              <ul>
                {ROADMAP_PROVIDERS.map(provider => (
                  <li key={provider.name}>
                    <span className="mk-provider-board__mark"><PlannedProviderLogo name={provider.icon} size={17} /></span>
                    <span>
                      <strong>{provider.name}</strong>
                      <small>{provider.detail}</small>
                    </span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
        </Reveal>
      </div>
    </section>
  );
}

export function PricingSection({ authenticated }: { authenticated: boolean }) {
  const plans = useBillingPlans();
  const prices = comparePlanPrices(plans.proMonthlyCents, plans.proAnnualCents);
  const freeFeatures = [
    `${plans.freeDailyCredits} credits every day`,
    'Create forms from a description',
    'Edit forms you already have',
    'A library of everything you made',
    'Review before anything is applied',
  ];
  return (
    <section className="mk-section mk-pricing" id="pricing" aria-labelledby="mk-pricing-title">
      <div className="mk-container">
        <div className="mk-pricing__heading">
          <SectionIntro eyebrow="PRICING" titleId="mk-pricing-title" title={<>Free to start. Pro when you are busy.</>}>
            The Free plan covers the whole workflow. Pro simply adds more credits for the months when you are building a lot.
          </SectionIntro>
          <Reveal delay={160}><a className="mk-text-link" href="/pricing">See full pricing <Arrow diagonal /></a></Reveal>
        </div>

        <div className="mk-price-grid">
          <Reveal className="mk-price-card" variant="scale">
            <article aria-labelledby="mk-free-title">
              <div className="mk-price-card__top"><span>START HERE</span><span className="mk-chip mk-chip--quiet">FREE</span></div>
              <h3 id="mk-free-title">Free</h3>
              <p className="mk-price-card__description">Everything you need to build and change forms.</p>
              <p className="mk-price"><strong>$0</strong><span>forever</span></p>
              <StartLink authenticated={authenticated} className="mk-button mk-button--secondary mk-price-card__cta">
                {authenticated ? 'Open Intake' : 'Sign up free'}
              </StartLink>
              <p className="mk-price-card__fine">No card needed · Free forever</p>
              <ul className="mk-feature-list">
                {freeFeatures.map(feature => <li key={feature}><Check />{feature}</li>)}
              </ul>
            </article>
          </Reveal>

          <Reveal className="mk-price-card mk-price-card--pro" delay={140} variant="scale">
            <article aria-labelledby="mk-pro-title">
              <div className="mk-price-card__top"><span>FOR HEAVIER USE</span><span className="mk-chip mk-chip--warm">PRO</span></div>
              <h3 id="mk-pro-title">Pro</h3>
              <p className="mk-price-card__description">More credits a month, same straightforward workflow.</p>
              <p className="mk-price"><strong>{formatUsd(prices.monthlyCents)}</strong><span>/ month</span></p>
              <p className="mk-price-card__annual">or {formatUsd(prices.annualCents)} a year — save {prices.annualSavingsPercent}% ({formatUsd(prices.annualSavingsCents)} off)</p>
              <a className="mk-button mk-button--secondary mk-price-card__cta" href="/pricing">See what is included <Arrow /></a>
              <ul className="mk-feature-list">
                <li><Check />{plans.proDailyCredits} credits a day plus {plans.proMonthlyCredits} a month</li>
                <li><Check />Every workflow from Free, unchanged</li>
                <li><Check />Daily credits are used first</li>
                <li><Check />Unused credits do not roll over</li>
              </ul>
              <div className="mk-price-card__waitlist">
                <p>Pro is not on sale yet.</p>
                <NotifyForm interest="pro" buttonLabel="Notify me" id="mk-pro-notify" />
              </div>
            </article>
          </Reveal>
        </div>

        <Reveal className="mk-credit-guide" delay={120} variant="fade">
          <div className="mk-credit-guide__intro">
            <span className="mk-eyebrow">WHAT A CREDIT IS</span>
            <h3 id="mk-credit-title">One credit, one request understood.</h3>
            <p>Each amount is worked out on the server before you confirm, and you see your balance whenever you want.</p>
          </div>
          <dl className="mk-credit-examples">
            <div><dt>Simple edit</dt><dd>1 credit<small>One focused change</small></dd></div>
            <div><dt>Standard form</dt><dd>2 credits<small>Around six questions</small></dd></div>
            <div><dt>Bigger form</dt><dd>3–5 credits<small>Longer or with sections</small></dd></div>
          </dl>
        </Reveal>
      </div>
    </section>
  );
}

function FaqItem({ question, answer, index }: { question: string; answer: string; index: number }) {
  const [open, setOpen] = useState(false);
  const id = `mk-faq-${index}`;
  return (
    <article className={`mk-faq-item${open ? ' is-open' : ''}`}>
      <h3>
        <button type="button" id={`${id}-button`} aria-expanded={open} aria-controls={`${id}-panel`} onClick={() => setOpen(value => !value)}>
          <span>{question}</span>
          <span className="mk-faq-item__icon" aria-hidden="true"><i /><i /></span>
        </button>
      </h3>
      <div className="mk-faq-item__panel" id={`${id}-panel`} role="region" aria-labelledby={`${id}-button`} inert={!open}>
        <div className="mk-faq-item__inner"><p>{answer}</p></div>
      </div>
    </article>
  );
}

export function FAQSection({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-section mk-faq" id="faq" aria-labelledby="mk-faq-title">
      <div className="mk-container mk-faq__layout">
        <Reveal className="mk-faq__heading">
          <span className="mk-eyebrow">QUESTIONS, ANSWERED</span>
          <h2 id="mk-faq-title">Frequently asked questions.</h2>
          <p>Short answers to what people ask before their first form.</p>
        </Reveal>
        <div className="mk-faq__list">
          {FAQS.map((faq, index) => <FaqItem key={faq.question} question={faq.question} answer={faq.answer} index={index} />)}
        </div>
        <Reveal variant="fade" className="mk-faq__cta">
          <RepeatCta authenticated={authenticated} label="Still deciding? The fastest answer is your own first form." />
        </Reveal>
      </div>
    </section>
  );
}

export function FinalCTA({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-final-cta" aria-labelledby="mk-final-title">
      <div className="mk-final-cta__glow" aria-hidden="true" />
      <div className="mk-container mk-final-cta__inner">
        <Reveal variant="rise">
          <span className="mk-eyebrow">YOUR NEXT FORM</span>
          <h2 id="mk-final-title">Write it once. Watch it become a form.</h2>
          <p>Describe what you need, look it over, and let Intake build it in the tool your team already works in.</p>
        </Reveal>
        <Reveal delay={140}><StartLink authenticated={authenticated} /></Reveal>
      </div>
    </section>
  );
}
