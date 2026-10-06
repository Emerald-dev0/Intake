import { useState, type CSSProperties, type ReactNode } from 'react';
import { FAQS, PROMPT_EXAMPLES, WORKFLOW_STEPS } from '../content/site';
import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans';
import { LogoMark } from '../components/LogoMark';
import { StartLink } from './MarketingChrome';
import { useViewState } from './motion';

function Arrow({ diagonal = false }: { diagonal?: boolean }) {
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

function Check() {
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

function Reveal({
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

function SectionIntro({
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

type PreviewMode = 'create' | 'edit';

const HERO_QUESTIONS = [
  { title: 'Overall satisfaction', kind: 'Multiple choice', detail: 'Very satisfied · Satisfied · Neutral · Dissatisfied' },
  { title: 'What did you like?', kind: 'Paragraph' },
  { title: 'What could we improve?', kind: 'Paragraph' },
  { title: 'Would you recommend us?', kind: 'Multiple choice', detail: 'Yes · No' },
] as const;

function ProductPreview() {
  const [mode, setMode] = useState<PreviewMode>('create');

  return (
    <article className="mk-product-preview" aria-label="Example Intake workspace">
      <div className="mk-product-preview__chrome">
        <div className="mk-product-preview__brand">
          <LogoMark size={20} />
          <strong>intake</strong>
          <span aria-hidden="true">/</span>
          <span>Forms</span>
        </div>
        <span className="mk-chip mk-chip--quiet"><i aria-hidden="true" /> Example</span>
      </div>

      <div className="mk-product-preview__workspace">
        <div className="mk-preview-rail" role="group" aria-label="Workspace navigation example">
          <span className="mk-preview-rail__label">WORKSPACE</span>
          <span>Overview</span>
          <span>Library</span>
          <span className="is-active"><i aria-hidden="true">＋</i> Forms</span>
          <span>Connections</span>
          <div className="mk-preview-rail__bottom">PLAN<br /><b>Free · {PLAN_CATALOG.free.dailyCredits} daily credits</b></div>
        </div>

        <div className="mk-preview-main">
          <div className="mk-preview-main__top">
            <span>{mode === 'create' ? 'CREATE A FORM' : 'EDIT AN EXISTING FORM'}</span>
            <span>GOOGLE FORMS</span>
          </div>
          <div className="mk-preview-switch" role="group" aria-label="Choose an example">
            <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create</button>
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Edit existing</button>
          </div>

          <div className="mk-preview-stage" key={mode}>
            {mode === 'create' ? <CreatePreview /> : <EditPreview />}
          </div>
        </div>
      </div>

      <div className="mk-product-preview__foot">
        <span><i aria-hidden="true" /> Nothing changes in Google until you confirm.</span>
        <span>Confirm in Intake to apply <Arrow /></span>
      </div>
    </article>
  );
}

function CreatePreview() {
  return (
    <div className="mk-preview-content" role="group" aria-label="Example creation proposal">
      <div className="mk-request-card">
        <span>YOUR REQUEST</span>
        <p>“Create a customer feedback form for a SaaS product. Ask what people liked, what could improve, and whether they’d recommend it.”<i className="mk-caret" aria-hidden="true" /></p>
      </div>
      <div className="mk-review-card">
        <div className="mk-review-card__head">
          <span>WHAT INTAKE UNDERSTOOD</span>
          <span className="mk-chip">DRAFT</span>
        </div>
        <p className="mk-review-card__title">Customer feedback</p>
        <p className="mk-review-card__description">A few questions about the product experience.</p>
        <ul className="mk-preview-questions">
          {HERO_QUESTIONS.map((question, index) => (
            <li key={question.title} style={{ '--i': index } as CSSProperties}>
              <span className="mk-preview-question__number">{String(index + 1).padStart(2, '0')}</span>
              <span className="mk-preview-question__body">
                <strong>{question.title}</strong>
                <small>{question.kind}{'detail' in question && question.detail ? ` · ${question.detail}` : ''}</small>
              </span>
            </li>
          ))}
        </ul>
        <div className="mk-review-card__note"><Check /> Looks right? Confirm and it is created.</div>
      </div>
    </div>
  );
}

function EditPreview() {
  return (
    <div className="mk-preview-content" role="group" aria-label="Example edit proposal">
      <div className="mk-existing-form">
        <span>YOUR GOOGLE FORM</span>
        <strong>Customer feedback</strong>
        <p>Overall satisfaction <span>Multiple choice</span></p>
        <p>What could we improve? <span>Paragraph</span></p>
      </div>
      <div className="mk-request-card mk-request-card--compact">
        <span>REQUESTED CHANGE</span>
        <p>“Add a follow-up call question after the satisfaction rating.”</p>
      </div>
      <div className="mk-edit-proposal">
        <div className="mk-review-card__head">
          <span>PROPOSED EDIT</span>
          <span className="mk-chip mk-chip--warm">DRAFT</span>
        </div>
        <div className="mk-edit-proposal__change">
          <span>ADD QUESTION</span>
          <strong>Would you like a follow-up call?</strong>
          <small>Multiple choice · Yes / No</small>
        </div>
        <div className="mk-edit-proposal__position">Goes after “Overall satisfaction”</div>
        <p className="mk-edit-proposal__note">Confirm and this same form is updated. No second copy.</p>
      </div>
    </div>
  );
}

export function Hero({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-hero" id="top" aria-labelledby="mk-hero-title">
      <div className="mk-container mk-hero__grid">
        <div className="mk-hero__copy">
          <span className="mk-eyebrow mk-hero__eyebrow mk-anim-in" style={{ '--d': '60ms' } as CSSProperties}><i aria-hidden="true" /> FOR PEOPLE WHO JUST NEED THE FORM</span>
          <h1 id="mk-hero-title">
            <span className="mk-anim-in" style={{ '--d': '140ms' } as CSSProperties}>Tell Intake what you need.</span>
            <span className="mk-hero__accent mk-anim-in" style={{ '--d': '240ms' } as CSSProperties}>It builds the form for you.</span>
          </h1>
          <p className="mk-hero__lede mk-anim-in" style={{ '--d': '340ms' } as CSSProperties}>
            Say what you want to collect, in a sentence. You get the questions first, change whatever you like, and only then does the form appear in your Google account.
          </p>
          <div className="mk-hero__actions mk-anim-in" style={{ '--d': '440ms' } as CSSProperties}>
            <StartLink authenticated={authenticated} />
            <a className="mk-button mk-button--secondary" href="#creation">See it work <Arrow /></a>
          </div>
          <div className="mk-hero__facts mk-anim-in" style={{ '--d': '540ms' } as CSSProperties} role="group" aria-label="What Intake does">
            <span>Real Google Forms</span>
            <span>Edit the ones you have</span>
            <span>Nothing changes until you say so</span>
          </div>
        </div>

        <div className="mk-hero__visual mk-anim-in" style={{ '--d': '300ms' } as CSSProperties}>
          <ProductPreview />
        </div>
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

const DIFFERENCES = [
  {
    title: 'Write it, do not configure it',
    text: 'Skip the question-by-question setup. One description covers the title, the questions, the choices and what is required.',
  },
  {
    title: 'A real form in your account',
    text: 'What gets created is a normal Google Form. Same links, same responses tab, same everything, because it is one.',
  },
  {
    title: 'Look before it lands',
    text: 'The proposal comes first, every time. Read it, push back, adjust. Google Forms is not touched until you confirm.',
  },
  {
    title: 'Works on forms you already have',
    text: 'Point Intake at an existing form and ask for a change. It proposes the edit, and applies it to that same form.',
  },
] as const;

export function DifferenceSection() {
  return (
    <section className="mk-section mk-difference" id="product" aria-labelledby="mk-difference-title">
      <div className="mk-container">
        <div className="mk-difference__intro">
          <SectionIntro eyebrow="WHY INTAKE" titleId="mk-difference-title" title={<>Not another form builder.</>}>
            Intake does not move your forms somewhere new. It gives you a faster way to make and change the Google Forms you were always going to use.
          </SectionIntro>
          <Reveal className="mk-difference__aside" as="p" delay={120} variant="fade" fadeOut>
            Build the form you already had in your head, then decide when it is ready.
          </Reveal>
        </div>

        <div className="mk-workflow-compare" role="group" aria-label="Doing it by hand compared with Intake">
          <Reveal className="mk-workflow-compare__column" variant="fade">
            <span className="mk-eyebrow">BY HAND</span>
            <h3>Piece it together.</h3>
            <ol>
              <li>Open Google Forms</li>
              <li>Add and set up every question</li>
              <li>Sort out sections and answer options</li>
              <li>Do it again whenever something changes</li>
            </ol>
          </Reveal>
          <div className="mk-workflow-compare__divider" aria-hidden="true">
            <span className="mk-workflow-compare__arrow"><Arrow /></span>
          </div>
          <Reveal className="mk-workflow-compare__column mk-workflow-compare__column--intake" delay={120} variant="fade">
            <span className="mk-eyebrow">WITH INTAKE</span>
            <h3>Say what you want.</h3>
            <ol>
              <li>Describe what the form should collect</li>
              <li>Read the questions it came up with</li>
              <li>Adjust anything that does not fit</li>
              <li>Confirm and it is created or updated</li>
            </ol>
          </Reveal>
        </div>

        <ul className="mk-difference__features">
          {DIFFERENCES.map((item, index) => (
            <Reveal as="li" className="mk-difference__feature" key={item.title} delay={index * 90} variant="rise">
              <span className="mk-difference__icon" aria-hidden="true"><i /></span>
              <div><h3>{item.title}</h3><p>{item.text}</p></div>
            </Reveal>
          ))}
        </ul>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="mk-section mk-how" id="how-it-works" aria-labelledby="mk-how-title">
      <div className="mk-container">
        <SectionIntro eyebrow="FOUR STEPS, NO GUESSWORK" titleId="mk-how-title" title={<>Describe. Understand. Adjust. Create.</>}>
          You stay in the loop the whole way through. Intake does the typing, you make the decisions.
        </SectionIntro>
        <ol className="mk-steps">
          {WORKFLOW_STEPS.map((step, index) => (
            <Reveal as="li" className="mk-step" key={step.title} delay={index * 110} variant="rise">
              <span className="mk-step__number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </Reveal>
          ))}
        </ol>
        <Reveal className="mk-how__edit-note" delay={140} variant="fade">
          <span className="mk-how__edit-mark" aria-hidden="true">↳</span>
          <p>Editing is the same story: Intake reads the form first, shows the change, then applies it.</p>
          <a href="#editing">See an edit example <Arrow /></a>
        </Reveal>
      </div>
    </section>
  );
}

const ONBOARDING_QUESTIONS = [
  { title: 'Department', type: 'Short answer' },
  { title: 'Role', type: 'Short answer' },
  { title: 'Overall onboarding satisfaction', type: 'Multiple choice', options: 'Very satisfied · Satisfied · Neutral · Dissatisfied' },
  { title: 'What felt confusing?', type: 'Paragraph' },
  { title: 'What should we improve?', type: 'Paragraph' },
  { title: 'Do you need additional help?', type: 'Multiple choice', options: 'Yes · No' },
] as const;

export function CreationDemo({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-section mk-creation" id="creation" aria-labelledby="mk-creation-title">
      <div className="mk-container">
        <div className="mk-creation__heading">
          <SectionIntro eyebrow="CREATE A FORM" titleId="mk-creation-title" title={<>One paragraph in. A finished form out.</>}>
            Write the request the way you would say it out loud. What comes back is a full plan with every question, answer type and optional choice already filled in.
          </SectionIntro>
          <Reveal delay={160}><StartLink authenticated={authenticated} className="mk-text-link">Try it with your own idea</StartLink></Reveal>
        </div>

        <div className="mk-creation__grid">
          <Reveal className="mk-creation-request">
            <div className="mk-card-kicker"><span>YOUR REQUEST</span><span className="mk-chip mk-chip--quiet">Example</span></div>
            <p>“Create an employee onboarding survey. Ask for department, role, onboarding satisfaction, what was confusing, what we should improve, and whether they need additional help.”</p>
            <div className="mk-creation-request__note"><span aria-hidden="true">↳</span> Written as a brief. Intake works out the structure.</div>
          </Reveal>

          <Reveal className="mk-creation-proposal" delay={140}>
            <article aria-label="Example form proposal">
              <div className="mk-creation-proposal__head">
                <div><span className="mk-card-kicker">WHAT INTAKE UNDERSTOOD</span><h3>Employee onboarding</h3></div>
                <span className="mk-chip mk-chip--warm">DRAFT</span>
              </div>
              <p className="mk-creation-proposal__description">Six questions, two of them required, ready for you to check.</p>
              <ol className="mk-creation-questions">
                {ONBOARDING_QUESTIONS.map((question, index) => (
                  <li key={question.title} style={{ '--i': index } as CSSProperties}>
                    <span className="mk-creation-questions__number">{String(index + 1).padStart(2, '0')}</span>
                    <div><strong>{question.title}</strong><small>{question.type}{'options' in question ? ` · ${question.options}` : ''}</small></div>
                  </li>
                ))}
              </ol>
              <p className="mk-creation-proposal__foot"><Check /> Happy with it? Confirm and it is created in Google Forms.</p>
            </article>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

const EXISTING_QUESTIONS = [
  'Overall satisfaction',
  'What did you like about the product?',
  'What could we improve?',
] as const;

export function EditingDemo() {
  return (
    <section className="mk-section mk-editing" id="editing" aria-labelledby="mk-editing-title">
      <div className="mk-container">
        <div className="mk-editing__heading">
          <SectionIntro eyebrow="EDIT A GOOGLE FORM" titleId="mk-editing-title" title={<>Change the form you already have.</>}>
            Pick one from your library or paste its Google Forms link, then describe the change. Intake reads what is there, proposes the edit, and applies it to that same form.
          </SectionIntro>
        </div>

        <Reveal className="mk-editing__request" variant="wipe">
          <span>REQUESTED CHANGE</span>
          <p>“Add a question asking whether the customer wants a follow-up call, and place it after the satisfaction rating.”</p>
        </Reveal>

        <ol className="mk-edit-flow" aria-label="How an edit flows from request to applied change">
          <Reveal as="li" className="mk-edit-flow__card">
            <span className="mk-edit-flow__number">01</span>
            <span className="mk-card-kicker">YOUR GOOGLE FORM</span>
            <h3>Customer feedback</h3>
            <ul>{EXISTING_QUESTIONS.map(question => <li key={question}>{question}</li>)}</ul>
          </Reveal>
          <Reveal as="li" className="mk-edit-flow__card mk-edit-flow__card--request" delay={110}>
            <span className="mk-edit-flow__number">02</span>
            <span className="mk-card-kicker">INTAKE READS IT</span>
            <h3>The current structure</h3>
            <p>Every question, type and position is read from the form itself before anything is proposed.</p>
          </Reveal>
          <Reveal as="li" className="mk-edit-flow__card mk-edit-flow__card--proposal" delay={220}>
            <span className="mk-edit-flow__number">03</span>
            <span className="mk-card-kicker">PROPOSED EDIT</span>
            <span className="mk-chip mk-chip--warm">DRAFT</span>
            <h3>Add one question</h3>
            <p><strong>Would you like a follow-up call?</strong></p>
            <small>Multiple choice · Yes / No</small>
            <p className="mk-edit-flow__placement">Goes after “Overall satisfaction”</p>
          </Reveal>
          <Reveal as="li" className="mk-edit-flow__card mk-edit-flow__card--confirm" delay={330}>
            <span className="mk-edit-flow__number">04</span>
            <span className="mk-card-kicker">YOU CONFIRM</span>
            <h3>Applied in place</h3>
            <p>The form is updated where it already lives. Links people have stay the same.</p>
          </Reveal>
        </ol>
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
              <span>02</span><div><strong>You read it</strong><small>Still nothing in Google</small></div>
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

export function GoogleConnection({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-google" aria-labelledby="mk-google-title">
      <div className="mk-container mk-google__inner">
        <Reveal className="mk-google__mark">
          <div aria-hidden="true">
            <span className="mk-google__logo"><LogoMark size={22} /> Intake</span>
            <span className="mk-google__link"><i /><i /><i /></span>
            <span className="mk-google__logo mk-google__logo--google">Google Forms</span>
          </div>
        </Reveal>
        <Reveal className="mk-google__copy" delay={110}>
          <span className="mk-eyebrow">A CONNECTION, NOT A MOVE</span>
          <h2 id="mk-google-title">Your forms stay in your Google account.</h2>
          <p>Sign in to Intake, then connect the Google account that holds the form. Google hosts the page people fill in, and the answers go to you.</p>
        </Reveal>
        <Reveal className="mk-google__action" delay={200}><StartLink authenticated={authenticated} className="mk-text-link">Get started</StartLink></Reveal>
      </div>
    </section>
  );
}

const FREE_FEATURES = [
  `${PLAN_CATALOG.free.dailyCredits} credits every day`,
  'Create forms from a description',
  'Edit forms you already have',
  'A library of everything you made',
  'Review before anything is applied',
] as const;

export function PricingSection({ authenticated }: { authenticated: boolean }) {
  const prices = proPriceComparison();
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
                {authenticated ? 'Open Intake' : 'Start free'}
              </StartLink>
              <ul className="mk-feature-list">
                {FREE_FEATURES.map(feature => <li key={feature}><Check />{feature}</li>)}
              </ul>
            </article>
          </Reveal>

          <Reveal className="mk-price-card mk-price-card--pro" delay={140} variant="scale">
            <article aria-labelledby="mk-pro-title">
              <div className="mk-price-card__top"><span>FOR HEAVIER USE</span><span className="mk-chip mk-chip--warm">PRO</span></div>
              <h3 id="mk-pro-title">Pro</h3>
              <p className="mk-price-card__description">More credits a month, same straightforward workflow.</p>
              <p className="mk-price"><strong>{formatUsd(prices.monthlyCents)}</strong><span>/ month</span></p>
              <p className="mk-price-card__annual">or {formatUsd(prices.annualCents)} a year</p>
              <a className="mk-button mk-button--secondary mk-price-card__cta" href="/pricing">See what is included <Arrow /></a>
              <ul className="mk-feature-list">
                <li><Check />{PLAN_CATALOG.pro.dailyCredits} credits a day plus {PLAN_CATALOG.pro.monthlyCredits} a month</li>
                <li><Check />Every workflow from Free, unchanged</li>
                <li><Check />Daily credits are used first</li>
                <li><Check />Unused credits do not roll over</li>
              </ul>
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

export function FAQSection() {
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
          <p>Describe what you need, look it over, and let Intake build it in Google Forms.</p>
        </Reveal>
        <Reveal delay={140}><StartLink authenticated={authenticated} /></Reveal>
      </div>
    </section>
  );
}
