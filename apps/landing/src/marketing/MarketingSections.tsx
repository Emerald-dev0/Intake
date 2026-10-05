import { useState, type ReactNode } from 'react';
import { FAQS, WORKFLOW_STEPS } from '../content/site';
import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans';
import { LogoMark } from '../components/LogoMark';
import { StartLink } from './MarketingChrome';

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
    <div className={`mk-section-intro ${className}`}>
      <span className="mk-eyebrow">{eyebrow}</span>
      <h2 id={titleId}>{title}</h2>
      <p>{children}</p>
    </div>
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
    <article className="mk-product-preview" aria-label="Illustrative Intake product preview">
      <div className="mk-product-preview__chrome">
        <div className="mk-product-preview__brand">
          <LogoMark size={20} />
          <strong>intake</strong>
          <span aria-hidden="true">/</span>
          <span>Forms</span>
        </div>
        <span className="mk-illustration-label"><i aria-hidden="true" /> Illustrative preview</span>
      </div>

      <div className="mk-product-preview__workspace">
        <div className="mk-preview-rail" role="group" aria-label="Illustrative workspace navigation">
          <span className="mk-preview-rail__label">WORKSPACE</span>
          <span>Overview</span>
          <span>Library</span>
          <span className="is-active"><i aria-hidden="true">＋</i> Forms</span>
          <span>Connections</span>
            <div className="mk-preview-rail__bottom">PLAN<br /><b>Free · 20 daily credits</b></div>
        </div>

        <div className="mk-preview-main">
          <div className="mk-preview-main__top">
            <span>{mode === 'create' ? 'CREATE A FORM' : 'EDIT AN EXISTING FORM'}</span>
            <span>GOOGLE FORMS</span>
          </div>
          <div className="mk-preview-switch" role="group" aria-label="Choose a product preview">
            <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create</button>
            <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Edit existing</button>
          </div>

          {mode === 'create' ? <CreatePreview /> : <EditPreview />}
        </div>
      </div>

      <div className="mk-product-preview__foot">
        <span><i aria-hidden="true" /> No Google change has been made in this example.</span>
        <span>Confirm in Intake to apply <Arrow /></span>
      </div>
    </article>
  );
}

function CreatePreview() {
  return (
    <div className="mk-preview-content" role="group" aria-label="Example Google Forms creation proposal">
      <div className="mk-request-card">
        <span>YOUR REQUEST</span>
        <p>“Create a customer feedback form for a SaaS product. Ask what people liked, what could improve, and whether they’d recommend it.”</p>
      </div>
      <div className="mk-review-card">
        <div className="mk-review-card__head">
          <span>02 / WHAT INTAKE UNDERSTOOD</span>
          <span className="mk-draft-label">DRAFT · NOT CREATED</span>
        </div>
        <p className="mk-review-card__title">Customer feedback</p>
        <p className="mk-review-card__description">A few questions about the product experience.</p>
        <ul className="mk-preview-questions">
          {HERO_QUESTIONS.map((question, index) => (
            <li key={question.title}>
              <span className="mk-preview-question__number">{String(index + 1).padStart(2, '0')}</span>
              <span className="mk-preview-question__body">
                <strong>{question.title}</strong>
                <small>{question.kind}{'detail' in question && question.detail ? ` · ${question.detail}` : ''}</small>
              </span>
            </li>
          ))}
        </ul>
        <div className="mk-review-card__note"><Check /> Review the proposal before creating</div>
      </div>
    </div>
  );
}

function EditPreview() {
  return (
    <div className="mk-preview-content" role="group" aria-label="Example existing Google Forms edit proposal">
      <div className="mk-existing-form">
        <span>EXISTING GOOGLE FORM · EXAMPLE</span>
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
          <span className="mk-draft-label">DRAFT · NOT APPLIED</span>
        </div>
        <div className="mk-edit-proposal__change">
          <span>ADD QUESTION</span>
          <strong>Would you like a follow-up call?</strong>
          <small>Multiple choice · Yes / No</small>
        </div>
        <div className="mk-edit-proposal__position">Place after “Overall satisfaction”</div>
        <p className="mk-edit-proposal__note">Review the change. Confirm to update this same form.</p>
      </div>
    </div>
  );
}

export function Hero({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-hero" id="top" aria-labelledby="mk-hero-title">
      <div className="mk-container mk-hero__grid">
        <div className="mk-hero__copy">
          <span className="mk-eyebrow mk-hero__eyebrow"><i aria-hidden="true" /> NATURAL LANGUAGE FOR REAL GOOGLE FORMS</span>
          <h1 id="mk-hero-title">
            <span>Tell Intake what you need.</span>
            <span className="mk-hero__accent">It builds the form for you.</span>
          </h1>
          <p className="mk-hero__lede">Create and manage real Google Forms using natural language. Describe what you need, review Intake’s proposal, and confirm before anything is applied.</p>
          <p className="mk-hero__positioning">Not another form host. A natural-language control layer for Google Forms — including the forms you already have.</p>
          <div className="mk-hero__actions">
            <StartLink authenticated={authenticated} />
            <a className="mk-button mk-button--secondary" href="#how-it-works">See how it works <Arrow /></a>
          </div>
          <div className="mk-hero__facts" role="group" aria-label="Intake product facts">
            <span>Creates real Google Forms</span>
            <span>Edits existing forms</span>
            <span>Review before apply</span>
          </div>
        </div>

        <div className="mk-hero__visual">
          <ProductPreview />
          <p className="mk-hero__caption">Product preview uses illustrative data. It does not call AI, connect Google, or change a form.</p>
        </div>
      </div>
      <div className="mk-container mk-hero__bottom">
        <span>Describe the form. Inspect the plan. Choose when it goes to Google.</span>
        <a href="#product">Why Intake is different <Arrow /></a>
      </div>
    </section>
  );
}

const DIFFERENCES = [
  {
    number: '01',
    title: 'Natural language',
    text: 'Describe the outcome instead of adding every question and setting one at a time.',
  },
  {
    number: '02',
    title: 'Real Google Forms',
    text: 'After confirmation, Intake creates a real form in the Google account you connected.',
  },
  {
    number: '03',
    title: 'Review before apply',
    text: 'Inspect the structured proposal first. Drafting or revising it does not change Google Forms.',
  },
  {
    number: '04',
    title: 'Edit what exists',
    text: 'Ask for supported changes to an existing form. Intake proposes an edit to that same form.',
  },
] as const;

export function DifferenceSection() {
  return (
    <section className="mk-section mk-difference" id="product" aria-labelledby="mk-difference-title">
      <div className="mk-container">
        <div className="mk-difference__intro">
          <SectionIntro eyebrow="THE INTAKE DIFFERENCE" titleId="mk-difference-title" title={<>Not another form builder.</>}>
            Intake does not replace Google Forms with another place to host responses. It gives you a natural-language way to create and manage the Google Forms you already need.
          </SectionIntro>
          <p className="mk-difference__aside">Build the form you already had in your head — then decide whether the proposal is ready to apply.</p>
        </div>

        <div className="mk-workflow-compare" role="group" aria-label="Traditional form workflow compared with Intake">
          <div className="mk-workflow-compare__column">
            <span className="mk-eyebrow">MANUAL SETUP</span>
            <h3>Construct it field by field.</h3>
            <ol>
              <li>Open Google Forms</li>
              <li>Add and configure each question</li>
              <li>Set up sections and options</li>
              <li>Repeat the work when needs change</li>
            </ol>
          </div>
          <div className="mk-workflow-compare__divider" aria-hidden="true">→</div>
          <div className="mk-workflow-compare__column mk-workflow-compare__column--intake">
            <span className="mk-eyebrow">WITH INTAKE</span>
            <h3>Describe the outcome.</h3>
            <ol>
              <li>Say what the form should collect</li>
              <li>Review the structured proposal</li>
              <li>Confirm the supported operation</li>
              <li>Create or update a real Google Form</li>
            </ol>
          </div>
        </div>

        <div className="mk-difference__features">
          {DIFFERENCES.map(item => (
            <article className="mk-difference__feature" key={item.number}>
              <span>{item.number}</span>
              <div><h3>{item.title}</h3><p>{item.text}</p></div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function HowItWorks() {
  return (
    <section className="mk-section mk-how" id="how-it-works" aria-labelledby="mk-how-title">
      <div className="mk-container">
        <SectionIntro eyebrow="A CLEAR FOUR-STEP FLOW" titleId="mk-how-title" title={<>Describe. Understand. Review. Apply.</>}>
          Intake turns a request into a proposal you can inspect. You stay between the AI interpretation and any change to your Google account.
        </SectionIntro>
        <ol className="mk-steps">
          {WORKFLOW_STEPS.map((step, index) => (
            <li className="mk-step" key={step.title}>
              <span className="mk-step__number">{String(index + 1).padStart(2, '0')}</span>
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </li>
          ))}
        </ol>
        <div className="mk-how__edit-note">
          <span className="mk-how__edit-mark" aria-hidden="true">↳</span>
          <p>For an existing Google Form, Intake first inspects the current form, then shows the proposed edits before you confirm.</p>
          <a href="#editing">See an edit example <Arrow /></a>
        </div>
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
          <SectionIntro eyebrow="01 / CREATE A FORM" titleId="mk-creation-title" title={<>Natural language in. A form plan out.</>}>
            Start with a plain-language request. Intake turns it into a structured proposal with questions you can review before the real Google Form is created.
          </SectionIntro>
          <StartLink authenticated={authenticated} className="mk-text-link">Try creating a form</StartLink>
        </div>

        <div className="mk-creation__grid">
          <article className="mk-creation-request">
            <div className="mk-card-kicker"><span>YOUR REQUEST</span><span>ILLUSTRATIVE EXAMPLE</span></div>
            <p>“Create an employee onboarding survey. Ask for department, role, onboarding satisfaction, what was confusing, what we should improve, and whether they need additional help.”</p>
            <div className="mk-creation-request__note"><span aria-hidden="true">↳</span> Written as a brief, not a list of form-building steps.</div>
          </article>

          <article className="mk-creation-proposal" aria-label="Illustrative structured form proposal">
            <div className="mk-creation-proposal__head">
              <div><span className="mk-card-kicker">02 / WHAT INTAKE UNDERSTOOD</span><h3>Employee onboarding</h3></div>
              <span className="mk-draft-label">DRAFT · NOT CREATED</span>
            </div>
            <p className="mk-creation-proposal__description">Example proposal · review the exact questions and choices in Intake.</p>
            <ol className="mk-creation-questions">
              {ONBOARDING_QUESTIONS.map((question, index) => (
                <li key={question.title}>
                  <span className="mk-creation-questions__number">{String(index + 1).padStart(2, '0')}</span>
                  <div><strong>{question.title}</strong><small>{question.type}{'options' in question ? ` · ${question.options}` : ''}</small></div>
                </li>
              ))}
            </ol>
            <p className="mk-creation-proposal__foot"><Check /> Review, revise if needed, then confirm creation.</p>
          </article>
        </div>
        <p className="mk-illustration-note">Illustrative content only. This page does not run AI or create a form.</p>
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
          <SectionIntro eyebrow="02 / EDIT AN EXISTING GOOGLE FORM" titleId="mk-editing-title" title={<>Change the form you have. Not a replacement.</>}>
            Choose a form from your Intake library or provide its Google Forms edit URL. Intake inspects its current structure, proposes supported changes, and updates that same form only after you confirm.
          </SectionIntro>
        </div>

        <div className="mk-editing__request">
          <span>REQUESTED CHANGE</span>
          <p>“Add a question asking whether the customer wants a follow-up call, and place it after the satisfaction rating.”</p>
        </div>

        <ol className="mk-edit-flow" aria-label="Illustrative existing Google Form edit workflow">
          <li className="mk-edit-flow__card">
            <span className="mk-edit-flow__number">01</span>
            <span className="mk-card-kicker">EXISTING GOOGLE FORM</span>
            <h3>Customer feedback</h3>
            <ul>{EXISTING_QUESTIONS.map(question => <li key={question}>{question}</li>)}</ul>
          </li>
          <li className="mk-edit-flow__card mk-edit-flow__card--request">
            <span className="mk-edit-flow__number">02</span>
            <span className="mk-card-kicker">INTAKE ANALYZES</span>
            <h3>The current structure</h3>
            <p>Intake reads the selected form before drafting an edit. The example is illustrative, not a live connection.</p>
          </li>
          <li className="mk-edit-flow__card mk-edit-flow__card--proposal">
            <span className="mk-edit-flow__number">03</span>
            <span className="mk-card-kicker">PROPOSED EDIT</span>
            <span className="mk-draft-label">DRAFT · NOT APPLIED</span>
            <h3>Add one question</h3>
            <p><strong>Would you like a follow-up call?</strong></p>
            <small>Multiple choice · Yes / No</small>
            <p className="mk-edit-flow__placement">Place after “Overall satisfaction”</p>
          </li>
          <li className="mk-edit-flow__card mk-edit-flow__card--confirm">
            <span className="mk-edit-flow__number">04</span>
            <span className="mk-card-kicker">ONLY AFTER YOU CONFIRM</span>
            <h3>Apply to the same form</h3>
            <p>Intake updates the selected Google Form in place. It does not create a replacement.</p>
          </li>
        </ol>
        <p className="mk-illustration-note">This example shows a supported question addition and position change. Actual edits depend on the selected form and supported Google Forms operations.</p>
      </div>
    </section>
  );
}

export function ControlSection() {
  return (
    <section className="mk-section mk-control" id="control" aria-labelledby="mk-control-title">
      <div className="mk-container mk-control__grid">
        <div>
          <span className="mk-eyebrow">YOUR DECISION, EVERY TIME</span>
          <h2 id="mk-control-title">You stay in control.</h2>
          <p>Intake turns the request into a structured proposal, checks it against supported operations, and lets you review the result. Drafting and revising do not apply changes to Google Forms. Nothing is applied until you explicitly confirm.</p>
          <a className="mk-text-link" href="#how-it-works">See the review-first workflow <Arrow /></a>
        </div>
        <div className="mk-approval-flow" role="group" aria-label="Intake only applies a form change after user confirmation">
          <div className="mk-approval-flow__step">
            <span>01</span><div><strong>Intake prepares a proposal</strong><small>Questions or supported edits</small></div>
          </div>
          <div className="mk-approval-flow__connector" aria-hidden="true" />
          <div className="mk-approval-flow__step mk-approval-flow__step--review">
            <span>02</span><div><strong>You review the proposal</strong><small>No Google change has happened</small></div>
          </div>
          <div className="mk-approval-flow__connector" aria-hidden="true" />
          <div className="mk-approval-flow__step mk-approval-flow__step--apply">
            <span>03</span><div><strong>You confirm the operation</strong><small>Only then does Intake apply it</small></div>
          </div>
        </div>
      </div>
    </section>
  );
}

export function GoogleConnection({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-google" aria-labelledby="mk-google-title">
      <div className="mk-container mk-google__inner">
        <div className="mk-google__mark" aria-hidden="true">
          <span>Intake</span><span className="mk-google__arrow">↕</span><span>Google Forms</span>
        </div>
        <div className="mk-google__copy">
          <span className="mk-eyebrow">A CONNECTION, NOT A REPLACEMENT</span>
          <h2 id="mk-google-title">Your forms stay where you already use them.</h2>
          <p>Sign in to Intake, then separately authorize the Google account that owns the form or has editor access. Google hosts the responder page and collects responses. Intake is independent of Google.</p>
        </div>
        <StartLink authenticated={authenticated} className="mk-text-link">Get started</StartLink>
      </div>
    </section>
  );
}

const FREE_FEATURES = [
  `${PLAN_CATALOG.free.dailyCredits} daily AI credits`,
  'Google Forms connection',
  'AI form creation and editing',
  'Intake form library',
  'Review-before-apply workflow',
] as const;

export function PricingSection({ authenticated }: { authenticated: boolean }) {
  const prices = proPriceComparison();
  return (
    <section className="mk-section mk-pricing" id="pricing" aria-labelledby="mk-pricing-title">
      <div className="mk-container">
        <div className="mk-pricing__heading">
          <SectionIntro eyebrow="STRAIGHTFORWARD PRICING" titleId="mk-pricing-title" title={<>Start free. Add credits if you need them.</>}>
            Free includes the full supported Google Forms workflow. Pro adds a monthly credit reserve; it does not add different form tools or faster processing.
          </SectionIntro>
          <a className="mk-text-link" href="/pricing">View full pricing <Arrow diagonal /></a>
        </div>

        <div className="mk-price-grid">
          <article className="mk-price-card" aria-labelledby="mk-free-title">
            <div className="mk-price-card__top"><span>01 / START HERE</span><span>FREE</span></div>
            <h3 id="mk-free-title">Free</h3>
            <p className="mk-price-card__description">Create and manage forms with the review step built in.</p>
            <p className="mk-price"><strong>$0</strong><span>no payment</span></p>
            <StartLink authenticated={authenticated} className="mk-button mk-button--secondary mk-price-card__cta">
              {authenticated ? 'Open Intake' : 'Try Intake Free'}
            </StartLink>
            <ul className="mk-feature-list">
              {FREE_FEATURES.map(feature => <li key={feature}><Check />{feature}</li>)}
            </ul>
          </article>

          <article className="mk-price-card mk-price-card--pro" aria-labelledby="mk-pro-title">
            <div className="mk-price-card__top"><span>02 / MORE AI CREDITS</span><span>PRO</span></div>
            <h3 id="mk-pro-title">Pro</h3>
            <p className="mk-price-card__description">For more AI-assisted form work across the month.</p>
            <p className="mk-price"><strong>{formatUsd(prices.monthlyCents)}</strong><span>/ month</span></p>
            <p className="mk-price-card__annual">or {formatUsd(prices.annualCents)} / year</p>
            <a className="mk-button mk-button--secondary mk-price-card__cta" href="/pricing">View pricing details <Arrow /></a>
            <ul className="mk-feature-list">
              <li><Check />{PLAN_CATALOG.pro.dailyCredits} daily credits plus {PLAN_CATALOG.pro.monthlyCredits} monthly credits</li>
              <li><Check />The same supported form creation and editing workflows</li>
              <li><Check />Daily credits are used before the monthly reserve</li>
              <li><Check />Unused credits do not roll over</li>
            </ul>
            <p className="mk-payment-note">Prices are display-only for now. Checkout and plan changes are not available yet.</p>
          </article>
        </div>

        <div className="mk-credit-guide" role="group" aria-labelledby="mk-credit-title">
          <div className="mk-credit-guide__intro">
            <span className="mk-eyebrow">AI CREDITS, SIMPLY</span>
            <h3 id="mk-credit-title">Credits cover AI interpretation.</h3>
            <p>Intake calculates each cost on the server from the validated proposal. Applying an already-reviewed form does not use additional AI credits.</p>
          </div>
          <dl className="mk-credit-examples">
            <div><dt>Simple edit</dt><dd>1 credit<small>One focused change</small></dd></div>
            <div><dt>Standard creation</dt><dd>2 credits<small>About six questions, no branching</small></dd></div>
            <div><dt>Complex creation</dt><dd>3–5 credits<small>Larger or conditional forms</small></dd></div>
          </dl>
          <p className="mk-credit-guide__foot">Failed, unsupported, or clarification-needed interpretations are not charged.</p>
        </div>
      </div>
    </section>
  );
}

export function FAQSection() {
  return (
    <section className="mk-section mk-faq" id="faq" aria-labelledby="mk-faq-title">
      <div className="mk-container mk-faq__layout">
        <div className="mk-faq__heading">
          <span className="mk-eyebrow">ANSWERS, WITHOUT THE GUESSWORK</span>
          <h2 id="mk-faq-title">Frequently asked questions.</h2>
          <p>What Intake can do, how Google Forms fits in, and what happens before a change is applied.</p>
        </div>
        <div className="mk-faq__list">
          {FAQS.map(({ question, answer }) => (
            <article className="mk-faq-item" key={question}>
              <h3>{question}</h3>
              <p>{answer}</p>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}

export function FinalCTA({ authenticated }: { authenticated: boolean }) {
  return (
    <section className="mk-final-cta" aria-labelledby="mk-final-title">
      <div className="mk-container mk-final-cta__inner">
        <div>
          <span className="mk-eyebrow">YOUR NEXT FORM, IN PLAIN LANGUAGE</span>
          <h2 id="mk-final-title">Build the form you already had in mind.</h2>
          <p>Describe it, review what Intake understands, and choose when to create it in Google Forms.</p>
        </div>
        <StartLink authenticated={authenticated} />
      </div>
    </section>
  );
}
