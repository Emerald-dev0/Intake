import { useEffect, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Book01Icon,
  Cancel01Icon,
  CodeIcon,
  Coins01Icon,
  CheckmarkCircle02Icon,
  Copy01Icon,
  Cursor01Icon,
  LinkSquare02Icon,
  LockKeyIcon,
  PencilEdit02Icon,
  PlusSignIcon,
  QuillWrite01Icon,
  Tick02Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { Link } from 'react-router-dom';
import { COMING_SOON, COMPARISON_ROWS, FAQS, LIVE_PROVIDERS, PROOF_EXAMPLE, ROADMAP_NOTE, ROADMAP_PROVIDERS, USE_CASES } from '../content/site';
import { formatUsd } from '../lib/plans';
import { comparePlanPrices, useBillingPlans } from '../lib/useBillingPlans';
import { formatReleaseDate } from '../lib/releases';
import { NotifyForm } from './NotifyForm';
import { useViewState } from './motion';
import { GoogleFormsLogo, PlannedProviderLogo, TypeformLogo } from '../components/ProviderLogos';
import { Reveal } from './MarketingSections';
import { StartLink } from './MarketingChrome';

/**
 * The redesigned homepage sections that come after the hero.
 *
 * House rules, the same as the hero: the picture carries the idea, the words stay short, and there
 * is room around both. Every section reads the tokens at the top of marketing.css and is styled in
 * home.css. Nothing here claims more than the product does.
 */

function Icon({ icon, size = 18 }: { icon: IconSvgElement; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.6} aria-hidden="true" focusable="false" />;
}

/** Centred section heading: a mono eyebrow, a serif line, and at most one short sentence. */
function HomeHead({ eyebrow, id, title, children }: { eyebrow: string; id: string; title: ReactNode; children?: ReactNode }) {
  return (
    <Reveal className="mk-head" variant="rise">
      <span className="mk-eyebrow">{eyebrow}</span>
      <h2 id={id}>{title}</h2>
      {children && <p>{children}</p>}
    </Reveal>
  );
}

/* ================================================================ Why Intake */

const DIFFERENCES: Array<{ icon: IconSvgElement; title: string; text: string }> = [
  { icon: UserCheck01Icon, title: 'You approve first', text: 'Nothing is created until you say so.' },
  { icon: PencilEdit02Icon, title: 'Edits in place', text: 'Change a form you own. No copies.' },
  { icon: LockKeyIcon, title: 'Your own account', text: 'The form lives where it always has.' },
];

/**
 * The comparison as marks. The full wording of every cell stays in COMPARISON_ROWS — read aloud to
 * screen readers here, and shown in full on /vs.
 */
type Mark = 'yes' | 'part' | 'no';
const SHORT_LABELS = ['In your own account', 'You approve first', 'Edits existing forms', 'Free plan', 'Speaks the provider’s language'];
const MARKS: Array<[google: Mark, typeform: Mark, chatgpt: Mark]> = [
  ['yes', 'yes', 'no'],
  ['part', 'part', 'no'],
  ['part', 'part', 'no'],
  ['no', 'part', 'part'],
  ['part', 'part', 'no'],
];
const MARK_LABEL: Record<Mark, string> = { yes: 'Yes', part: 'Partly', no: 'No' };

function MarkCell({ mark, note }: { mark: Mark; note: string }) {
  return (
    <td title={note}>
      <span className={`mk-mark mk-mark--${mark}`} aria-hidden="true">
        {mark === 'yes' ? <Icon icon={Tick02Icon} size={13} /> : <i />}
      </span>
      <span className="mk-sr-only">{MARK_LABEL[mark]}: {note}</span>
    </td>
  );
}

/** The editor you know: the same blank question, again and again. Decorative. */
function ByHandSketch() {
  return (
    <div className="mk-why__sketch mk-why__sketch--hand" aria-hidden="true">
      <div className="mk-why__ghosts">
        {[0, 1, 2, 3].map(index => (
          <div className="mk-why__ghost" key={index}>
            <span />
            <i>Multiple choice</i>
          </div>
        ))}
      </div>
      <div className="mk-why__add">+ Add question<span className="mk-why__cursor"><Icon icon={Cursor01Icon} size={17} /></span></div>
    </div>
  );
}

/** One sentence and the draft it becomes. Decorative. */
function IntakeSketch() {
  return (
    <div className="mk-why__sketch mk-why__sketch--intake" aria-hidden="true">
      <div className="mk-why__say">A feedback form for my coffee shop</div>
      <ol className="mk-why__draft">
        {['Overall satisfaction', 'What did you like?', 'Would you recommend us?'].map(label => (
          <li key={label}><Icon icon={Tick02Icon} size={13} />{label}</li>
        ))}
      </ol>
    </div>
  );
}

export function WhySection() {
  return (
    <section className="mk-section mk-home mk-why" id="product" aria-labelledby="mk-why-title">
      <div className="mk-container">
        <HomeHead eyebrow="WHY INTAKE" id="mk-why-title" title={<>Three things the others <em>don’t</em> do.</>}>
          Same tools, same account. Just a faster way in.
        </HomeHead>

        <div className="mk-why__panel" role="group" aria-label="Doing it by hand compared with Intake">
          <Reveal as="article" className="mk-why__card mk-why__card--hand" variant="rise">
            <ByHandSketch />
            <div className="mk-why__caption">
              <span className="mk-eyebrow">BY HAND</span>
              <h3>Piece it together.</h3>
              <p>Every question, one click at a time.</p>
            </div>
          </Reveal>
          <span className="mk-why__bridge" aria-hidden="true"><Icon icon={ArrowRight01Icon} size={18} /></span>
          <Reveal as="article" className="mk-why__card mk-why__card--intake" delay={140} variant="rise">
            <IntakeSketch />
            <div className="mk-why__caption">
              <span className="mk-eyebrow">WITH INTAKE</span>
              <h3>Say what you want.</h3>
              <p>One sentence. A draft you approve.</p>
            </div>
          </Reveal>
        </div>

        <ul className="mk-why__features">
          {DIFFERENCES.map((item, index) => (
            <Reveal as="li" className="mk-why__feature" key={item.title} delay={index * 110} variant="rise">
              <span className="mk-why__icon"><Icon icon={item.icon} size={20} /></span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </Reveal>
          ))}
        </ul>

        <div className="mk-why__compare" id="compare">
          <Reveal className="mk-why__compare-head" variant="rise">
            <h3 id="mk-compare-title">How it compares</h3>
            <ul className="mk-why__legend" aria-hidden="true">
              <li><span className="mk-mark mk-mark--yes"><Icon icon={Tick02Icon} size={11} /></span>Yes</li>
              <li><span className="mk-mark mk-mark--part"><i /></span>Partly</li>
              <li><span className="mk-mark mk-mark--no"><i /></span>No</li>
            </ul>
          </Reveal>
          <Reveal variant="rise" delay={100}>
            <div className="mk-why__matrix" role="region" aria-labelledby="mk-compare-title" tabIndex={0}>
              <table>
                <caption className="mk-sr-only">Intake compared with Google&rsquo;s built-in AI help, Typeform AI, and asking a chatbot</caption>
                <thead>
                  <tr>
                    <td />
                    <th scope="col" className="is-intake">Intake</th>
                    <th scope="col">Google&rsquo;s AI</th>
                    <th scope="col">Typeform AI</th>
                    <th scope="col">ChatGPT</th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map((row, index) => {
                    const [google, typeform, chatgpt] = MARKS[index] ?? ['part', 'part', 'part'];
                    return (
                      <tr key={row.label}>
                        <th scope="row">{SHORT_LABELS[index] ?? row.label}</th>
                        <td className="is-intake" title={row.intake}>
                          <span className="mk-mark mk-mark--yes" aria-hidden="true"><Icon icon={Tick02Icon} size={13} /></span>
                          <span className="mk-sr-only">Yes: {row.intake}</span>
                        </td>
                        <MarkCell mark={google} note={row.googleAi} />
                        <MarkCell mark={typeform} note={row.typeformAi} />
                        <MarkCell mark={chatgpt} note={row.chatgpt} />
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </Reveal>
          <Reveal className="mk-why__more" variant="fade" delay={160}>
            <a className="mk-text-link" href="/vs">Read the full comparison <Icon icon={ArrowRight01Icon} size={14} /></a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ============================================================== How it works */

const HOW_STEPS = [
  { label: 'Describe', title: 'Describe it', text: 'Write it like you’d explain it to a colleague. One sentence is usually enough.' },
  { label: 'Review', title: 'Review the draft', text: 'See the questions Intake understood. Ask for changes in plain English.' },
  { label: 'Confirm', title: 'Confirm', text: 'One click builds it in your Google Forms or Typeform — or updates the form you picked.' },
] as const;

/** The draft tweak shown in the Review step: one plain-English change, applied to one question. */
const CHANGED_QUESTION = 1;
const CHANGE_REQUEST = 'Make “Class” a dropdown';

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Types `text` while `active`; otherwise (or with reduced motion) shows all of it at once. */
function useTyping(text: string, active: boolean) {
  const [count, setCount] = useState(text.length);
  useEffect(() => {
    if (!active || prefersReducedMotion()) { setCount(text.length); return; }
    setCount(0);
    let index = 0;
    const timer = window.setInterval(() => {
      index += 2;
      setCount(Math.min(index, text.length));
      if (index >= text.length) window.clearInterval(timer);
    }, 28);
    return () => window.clearInterval(timer);
  }, [text, active]);
  return { shown: text.slice(0, count), done: count >= text.length };
}

/**
 * The demo card for How it works. It holds all three states and cross-fades between them, so a
 * step change is a transition, not a re-render. Decorative: the section text says the same thing,
 * and the worked example is repeated for screen readers in the section itself.
 */
function HowStage({ step, animate }: { step: number; animate: boolean }) {
  const { shown, done } = useTyping(PROOF_EXAMPLE.prompt, animate && step === 0);
  return (
    <div className={`mk-stage is-step-${step}`} aria-hidden="true">
      <div className="mk-stage__top">
        <span className="mk-stage__dots"><i /><i /><i /></span>
        <ol className="mk-stage__tabs">
          {HOW_STEPS.map((item, index) => (
            <li key={item.label} className={index === step ? 'is-active' : index < step ? 'is-done' : ''}>
              <span>{String(index + 1).padStart(2, '0')}</span>{item.label}
            </li>
          ))}
        </ol>
      </div>

      <div className="mk-stage__body">
        <div className={`mk-stage__layer mk-stage__describe${step === 0 ? ' is-active' : ''}`}>
          <span className="mk-stage__label">Describe your form</span>
          <p className="mk-stage__prompt">{shown}{!done && <i className="mk-stage__caret" />}</p>
          <div className="mk-stage__bar">
            <span className="mk-stage__chip"><GoogleFormsLogo size={14} label={null} />Google Forms</span>
            <span className={`mk-stage__go${done ? ' is-ready' : ''}`}>Draft it <Icon icon={ArrowRight01Icon} size={14} /></span>
          </div>
        </div>

        <div className={`mk-stage__layer mk-stage__review${step === 1 ? ' is-active' : ''}`}>
          <div className="mk-stage__head">
            <span className="mk-stage__draft">DRAFT</span>
            <span>{PROOF_EXAMPLE.questions.length} questions</span>
          </div>
          <ol className="mk-stage__questions">
            {PROOF_EXAMPLE.questions.map((question, index) => (
              <li key={question.title} className={index === CHANGED_QUESTION ? 'is-changed' : ''} style={{ '--i': index } as CSSProperties}>
                <span className="mk-stage__n">{String(index + 1).padStart(2, '0')}</span>
                <span className="mk-stage__q">{question.title}</span>
                <span className="mk-stage__kind">{question.kind}</span>
              </li>
            ))}
          </ol>
          <div className="mk-stage__ask">{CHANGE_REQUEST}</div>
        </div>

        <div className={`mk-stage__layer mk-stage__confirm${step === 2 ? ' is-active' : ''}`}>
          <span className="mk-stage__done"><Icon icon={CheckmarkCircle02Icon} size={34} /></span>
          <strong>Created in Google Forms</strong>
          <span className="mk-stage__meta"><GoogleFormsLogo size={14} label={null} />Parent check-in · {PROOF_EXAMPLE.questions.length} questions</span>
          <div className="mk-stage__links">
            <span><Icon icon={LinkSquare02Icon} size={14} />Open form</span>
            <span><Icon icon={Copy01Icon} size={14} />Copy link</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Which step sits on the middle line of the viewport. Falls back to the first. */
function useActiveStep(count: number) {
  const refs = useRef<Array<HTMLLIElement | null>>([]);
  const [active, setActive] = useState(0);
  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (!entry.isIntersecting) continue;
        const index = refs.current.indexOf(entry.target as HTMLLIElement);
        if (index >= 0) setActive(index);
      }
    }, { rootMargin: '-48% 0px -48% 0px', threshold: 0 });
    refs.current.slice(0, count).forEach(node => node && observer.observe(node));
    return () => observer.disconnect();
  }, [count]);
  return { refs, active };
}

export function HowItWorksSection() {
  const { refs, active } = useActiveStep(HOW_STEPS.length);
  return (
    <section className="mk-section mk-home mk-how2" id="how-it-works" aria-labelledby="mk-how2-title">
      <div className="mk-container">
        <HomeHead eyebrow="HOW IT WORKS" id="mk-how2-title" title={<>You decide. Intake <em>types</em>.</>}>
          Three steps, and nothing happens without you.
        </HomeHead>

        <div className="mk-how2__grid" id="proof">
          <ol className="mk-how2__steps" style={{ '--progress': (active + 0.5) / HOW_STEPS.length } as CSSProperties}>
            {HOW_STEPS.map((item, index) => (
              <li
                key={item.title}
                ref={node => { refs.current[index] = node; }}
                className={`mk-how2__step${index === active ? ' is-active' : ''}`}
              >
                <span className="mk-how2__num">{String(index + 1).padStart(2, '0')}</span>
                <h3>{item.title}</h3>
                <p>{item.text}</p>
                <div className="mk-how2__inline"><HowStage step={index} animate={false} /></div>
              </li>
            ))}
          </ol>
          <div className="mk-how2__sticky">
            <HowStage step={active} animate />
          </div>
        </div>

        <p className="mk-sr-only">
          A real example: the description “{PROOF_EXAMPLE.prompt}” became a draft of {PROOF_EXAMPLE.questions.length} questions —
          {' '}{PROOF_EXAMPLE.questions.map(question => `${question.title} (${question.kind})`).join(', ')}.
        </p>

        <Reveal className="mk-how2__edit" variant="fade">
          <p>Editing works the same way: Intake reads the form, shows the change, then applies it.</p>
          <a className="mk-text-link" href="#editing">See an edit <Icon icon={ArrowRight01Icon} size={14} /></a>
        </Reveal>
      </div>
    </section>
  );
}

/* ============================================================ Create & edit */

type Mode = 'create' | 'edit';

const CREATE_REQUEST = 'Create an employee onboarding survey. Ask for department, role, onboarding satisfaction, what was confusing, what we should improve, and whether they need additional help.';
const CREATE_QUESTIONS = [
  { title: 'Department', kind: 'Short answer' },
  { title: 'Role', kind: 'Short answer' },
  { title: 'Overall onboarding satisfaction', kind: 'Multiple choice' },
  { title: 'What felt confusing?', kind: 'Paragraph' },
  { title: 'What should we improve?', kind: 'Paragraph' },
  { title: 'Do you need additional help?', kind: 'Multiple choice' },
] as const;

const EDIT_REQUEST = 'Add a question asking whether the customer wants a follow-up call, and place it after the satisfaction rating.';
const EXISTING_QUESTIONS = [
  { title: 'Overall satisfaction', kind: 'Multiple choice' },
  { title: 'What did you like about the product?', kind: 'Paragraph' },
  { title: 'What could we improve?', kind: 'Paragraph' },
] as const;

function DraftRow({ index, title, kind }: { index: number; title: string; kind: string }) {
  return (
    <li style={{ '--i': index } as CSSProperties}>
      <span className="mk-make__n">{String(index + 1).padStart(2, '0')}</span>
      <span className="mk-make__q">{title}</span>
      <span className="mk-make__kind">{kind}</span>
    </li>
  );
}

/** The use-case prompts, one tap from the composer for signed-in visitors. */
function PromptCard({ audience, prompt, authenticated }: { audience: string; prompt: string; authenticated: boolean }) {
  const body = (
    <>
      <span className="mk-eyebrow">{audience}</span>
      <span className="mk-prompts__text">“{prompt}”</span>
      <span className="mk-prompts__go" aria-hidden="true"><Icon icon={ArrowRight01Icon} size={14} /></span>
    </>
  );
  return authenticated
    ? <Link className="mk-prompts__card" to="/app/forms" state={{ initialPrompt: prompt }}>{body}</Link>
    : <a className="mk-prompts__card" href="/auth/sign-up">{body}</a>;
}

export function CreateEditSection({ authenticated }: { authenticated: boolean }) {
  const [mode, setMode] = useState<Mode>('create');

  // Links elsewhere on the page that point at the edit example open it on the Edit tab.
  useEffect(() => {
    const open = (event: MouseEvent) => {
      const link = (event.target as Element | null)?.closest?.('a[href$="#editing"]');
      if (link) setMode('edit');
    };
    if (window.location.hash === '#editing') setMode('edit');
    document.addEventListener('click', open);
    return () => document.removeEventListener('click', open);
  }, []);

  const create = mode === 'create';
  return (
    <section className="mk-section mk-home mk-make" id="creation" aria-labelledby="mk-make-title">
      <div className="mk-container">
        <HomeHead eyebrow="CREATE OR EDIT" id="mk-make-title" title={<>A new form, or the one you <em>have</em>.</>}>
          Describe a fresh form, or the change you want. Same review step either way.
        </HomeHead>

        <Reveal className="mk-make__switch-wrap" variant="rise">
          <div className="mk-preview-switch mk-make__switch" role="group" aria-label="Choose an example">
            <button type="button" aria-pressed={create} onClick={() => setMode('create')}>
              <Icon icon={QuillWrite01Icon} size={15} />Create
            </button>
            <button type="button" aria-pressed={!create} onClick={() => setMode('edit')}>
              <Icon icon={PencilEdit02Icon} size={15} />Edit existing
            </button>
            <span className="mk-make__thumb" data-mode={mode} aria-hidden="true" />
          </div>
        </Reveal>

        <Reveal className="mk-make__window" variant="rise" delay={120}>
          <div id="editing" className="mk-make__anchor" />
          <div className="mk-make__chrome">
            <span className="mk-make__dots" aria-hidden="true"><i /><i /><i /></span>
            <span className="mk-make__crumb"><b>intake</b> / {create ? 'New form' : 'Customer feedback'}</span>
            <span className="mk-make__provider"><GoogleFormsLogo size={13} label={null} />Google Forms</span>
          </div>

          <div className="mk-make__body" key={mode}>
            <div className="mk-make__ask">
              <span className="mk-make__label">{create ? 'Your request' : 'Requested change'}</span>
              <p className="mk-make__quote">“{create ? CREATE_REQUEST : EDIT_REQUEST}”</p>
              <span className="mk-make__hint">
                <span aria-hidden="true">↳</span> {create ? 'Written as a brief. Intake works out the structure.' : 'Intake reads the form first, then proposes the edit.'}
              </span>
            </div>

            <div className="mk-make__result">
              <div className="mk-make__result-head">
                <div>
                  <span className="mk-make__label">{create ? 'What Intake understood' : 'Your Google Form'}</span>
                  <strong>{create ? 'Employee onboarding' : 'Customer feedback'}</strong>
                </div>
                <span className="mk-make__draft">DRAFT</span>
              </div>

              {create ? (
                <ol className="mk-make__list">
                  {CREATE_QUESTIONS.map((question, index) => <DraftRow key={question.title} index={index} {...question} />)}
                </ol>
              ) : (
                <ol className="mk-make__list">
                  <DraftRow index={0} {...EXISTING_QUESTIONS[0]} />
                  <li className="mk-make__new" style={{ '--i': 1 } as CSSProperties}>
                    <div className="mk-make__new-inner">
                      <span className="mk-make__n"><Icon icon={PlusSignIcon} size={12} /></span>
                      <span className="mk-make__q">Would you like a follow-up call?</span>
                      <span className="mk-make__kind">Multiple choice · Yes / No</span>
                      <span className="mk-make__where">Goes after “Overall satisfaction”</span>
                    </div>
                  </li>
                  {EXISTING_QUESTIONS.slice(1).map((question, index) => <DraftRow key={question.title} index={index + 2} {...question} />)}
                </ol>
              )}
            </div>
          </div>

          <div className="mk-make__foot">
            <span><Icon icon={Tick02Icon} size={14} />{create ? 'Nothing is created until you confirm.' : 'Applied to this same form. Links stay the same.'}</span>
            <span className="mk-make__confirm" aria-hidden="true">{create ? 'Confirm & create' : 'Confirm & apply'}</span>
          </div>
        </Reveal>

        <Reveal className="mk-make__cta" variant="fade" delay={160}>
          <StartLink authenticated={authenticated} className="mk-text-link">Try it with your own idea</StartLink>
        </Reveal>

        <div className="mk-prompts" id="use-cases">
          <Reveal className="mk-prompts__head" variant="rise">
            <h3 id="mk-prompts-title">Steal a prompt</h3>
            <p>Made for the form you need this week.</p>
          </Reveal>
          <Reveal variant="rise" delay={100}>
            <ul className="mk-prompts__row" aria-labelledby="mk-prompts-title">
              {USE_CASES.map(useCase => (
                <li key={useCase.audience}>
                  <PromptCard audience={useCase.audience} prompt={useCase.prompt} authenticated={authenticated} />
                </li>
              ))}
            </ul>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ======================================================== Control & trust */

const PERMISSIONS: Array<{ what: string; when: string; always?: boolean; scopes: Array<[provider: string, scopes: string]> }> = [
  { what: 'Sign you in', when: 'Always', always: true, scopes: [['Google', 'openid · email · profile']] },
  { what: 'Create and edit your forms', when: 'When you connect', scopes: [['Google Forms', 'forms.body'], ['Typeform', 'forms:write · forms:read · accounts:read · offline']] },
  { what: 'Keep answers in a Sheet', when: 'When you set up syncing', scopes: [['Google', 'drive.file — only files Intake made']] },
  { what: 'Count the answers', when: 'When you open Response Insights', scopes: [['Google', 'forms.responses.readonly']] },
];

const NEVER = [
  'Keep a copy of the answers people submit',
  'Open, list or change Drive files Intake did not create',
  'Touch Gmail, Calendar or Contacts',
  'Delete a form or change who it is shared with',
  'Train models on your forms or sell your data',
  'Show ads or send marketing email you did not ask for',
] as const;

export function ControlTrustSection() {
  return (
    <section className="mk-section mk-home mk-dark" id="control" aria-labelledby="mk-dark-title">
      <div className="mk-container">
        <HomeHead eyebrow="NOTHING BY SURPRISE" id="mk-dark-title" title={<>You’re the one who presses <em>go</em>.</>}>
          Intake asks for the narrowest permission it can — and only when you start that step.
        </HomeHead>

        <Reveal className="mk-dark__flow" variant="fade">
          <ol aria-label="The three moments of an Intake change">
            <li><span>01</span><strong>Intake drafts it</strong><small>Questions or a suggested edit</small></li>
            <li><span>02</span><strong>You read it</strong><small>Still nothing in your account</small></li>
            <li className="is-go"><span>03</span><strong>You confirm</strong><small>Now it becomes real</small></li>
          </ol>
        </Reveal>

        <div className="mk-dark__grid" id="trust">
          <Reveal className="mk-dark__card mk-dark__card--ask" variant="rise">
            <h3>What Intake asks for</h3>
            <ol className="mk-dark__perms">
              {PERMISSIONS.map((item, index) => (
                <li key={item.what} style={{ '--i': index } as CSSProperties}>
                  <span className={`mk-dark__switch${item.always ? ' is-always' : ''}`} aria-hidden="true"><i /></span>
                  <div className="mk-dark__perm">
                    <strong>{item.what}</strong>
                    <span className="mk-dark__when">{item.when}</span>
                  </div>
                  <ul className="mk-dark__scopes">
                    {item.scopes.map(([provider, scopes]) => (
                      <li key={provider}><span>{provider}</span><code>{scopes}</code></li>
                    ))}
                  </ul>
                </li>
              ))}
            </ol>
          </Reveal>

          <Reveal className="mk-dark__card mk-dark__card--never" variant="rise" delay={140}>
            <h3>What it never does</h3>
            <p className="mk-dark__aside">No Drive-wide access, no Gmail, no webhooks.</p>
            <ul className="mk-dark__never">
              {NEVER.map(item => <li key={item}><span aria-hidden="true"><Icon icon={Cancel01Icon} size={13} /></span>{item}</li>)}
            </ul>
          </Reveal>
        </div>

        <Reveal className="mk-dark__foot" variant="fade" delay={120}>
          <a className="mk-text-link" href="/trust">Trust &amp; permissions <Icon icon={ArrowRight01Icon} size={14} /></a>
          <a className="mk-text-link" href="/privacy">Privacy policy <Icon icon={ArrowRight01Icon} size={14} /></a>
        </Reveal>
      </div>
    </section>
  );
}

/* =============================================================== Providers */

export function ProvidersSection() {
  return (
    <section className="mk-section mk-home mk-prov" id="providers" aria-labelledby="mk-prov-title">
      <div className="mk-container">
        <HomeHead eyebrow="PROVIDERS" id="mk-prov-title" title={<>Your forms stay in your <em>account</em>.</>}>
          Connect the tool the form should live in. It hosts the form, and the answers go to you.
        </HomeHead>

        <Reveal className="mk-provider-board mk-prov__board" variant="rise">
          <div className="mk-prov__board-head">
            <h3 id="mk-provider-board-title">Two live now. More in the queue.</h3>
          </div>
          <div className="mk-provider-board__groups mk-prov__groups" role="group" aria-labelledby="mk-provider-board-title">
            <div className="mk-provider-board__group mk-prov__group mk-prov__group--live">
              <h4>Live today <span className="mk-prov__chip mk-prov__chip--live"><i />WORKS NOW</span></h4>
              <ul>
                {LIVE_PROVIDERS.map(provider => (
                  <li key={provider.name}>
                    <span className="mk-prov__mark">
                      {provider.name === 'Google Forms'
                        ? <GoogleFormsLogo size={26} label={null} />
                        : <TypeformLogo height={8} tight label={null} />}
                    </span>
                    <strong>{provider.name}</strong>
                    <small>{provider.detail}</small>
                  </li>
                ))}
              </ul>
            </div>
            <div className="mk-provider-board__group mk-prov__group mk-prov__group--planned">
              <h4>Next in line <span className="mk-prov__chip">PLANNED</span></h4>
              <ul>
                {ROADMAP_PROVIDERS.map(provider => (
                  <li key={provider.name}>
                    <span className="mk-prov__mark"><PlannedProviderLogo name={provider.icon} size={20} /></span>
                    <strong>{provider.name}</strong>
                    <small>{provider.detail}</small>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <p className="mk-prov__note">{ROADMAP_NOTE}</p>
        </Reveal>

        <div id="whats-next" className="mk-prov__next-anchor" />
        <Reveal className="mk-prov__next" variant="rise" delay={100}>
          <div className="mk-prov__next-copy">
            <h3 id="mk-next-title">On the workbench</h3>
            <ul className="mk-prov__next-list" aria-labelledby="mk-next-title">
              {COMING_SOON.filter(item => item.title !== 'More providers').map(item => <li key={item.title}>{item.title}</li>)}
            </ul>
          </div>
          <div className="mk-prov__next-form">
            <p>One email when each one ships. Nothing else.</p>
            <NotifyForm interest="updates" buttonLabel="Email me" id="mk-coming-notify" />
          </div>
        </Reveal>
      </div>
    </section>
  );
}

/* ================================================================= Pricing */

export function PricingHomeSection({ authenticated }: { authenticated: boolean }) {
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
    <section className="mk-section mk-home mk-price2" id="pricing" aria-labelledby="mk-price2-title">
      <div className="mk-container">
        <HomeHead eyebrow="PRICING" id="mk-price2-title" title={<>Free to start. Pro when you’re <em>busy</em>.</>}>
          The Free plan covers the whole workflow. Pro adds more credits.
        </HomeHead>

        <div className="mk-price2__grid">
          <Reveal as="article" className="mk-price2__card" variant="rise">
            <div className="mk-price2__top"><h3 id="mk-free-title">Free</h3><span className="mk-price2__tag">START HERE</span></div>
            <p className="mk-price2__amount"><strong>$0</strong><span>forever</span></p>
            <p className="mk-price2__desc">Everything you need to build and change forms.</p>
            <StartLink authenticated={authenticated} className="mk-button mk-button--primary mk-price2__cta">
              {authenticated ? 'Open Intake' : 'Sign up free'}
            </StartLink>
            <p className="mk-price2__fine">No card needed</p>
            <ul className="mk-price2__list">
              {freeFeatures.map(feature => <li key={feature}><Icon icon={Tick02Icon} size={14} />{feature}</li>)}
            </ul>
          </Reveal>

          <Reveal as="article" className="mk-price2__card mk-price2__card--pro" variant="rise" delay={140}>
            <div className="mk-price2__top"><h3 id="mk-pro-title">Pro</h3><span className="mk-price2__tag">OPENS LATER</span></div>
            <p className="mk-price2__amount"><strong>{formatUsd(prices.monthlyCents)}</strong><span>/ month</span></p>
            <p className="mk-price2__desc">or {formatUsd(prices.annualCents)} a year — save {prices.annualSavingsPercent}%</p>
            <div className="mk-price2__waitlist">
              <p>Pro is not on sale yet.</p>
              <NotifyForm interest="pro" buttonLabel="Notify me" id="mk-pro-notify" />
            </div>
            <ul className="mk-price2__list">
              <li><Icon icon={Tick02Icon} size={14} />{plans.proDailyCredits} credits a day plus {plans.proMonthlyCredits} a month</li>
              <li><Icon icon={Tick02Icon} size={14} />Every workflow from Free, unchanged</li>
              <li><Icon icon={Tick02Icon} size={14} />Daily credits are used first</li>
              <li><Icon icon={Tick02Icon} size={14} />Unused credits do not roll over</li>
            </ul>
          </Reveal>
        </div>

        <Reveal className="mk-price2__credits" variant="fade" delay={120}>
          <span className="mk-price2__credits-label"><Icon icon={Coins01Icon} size={16} />What a credit buys</span>
          <ul>
            <li><b>1</b> a simple edit</li>
            <li><b>2</b> a standard form</li>
            <li><b>3–5</b> a bigger form</li>
          </ul>
          <a className="mk-text-link" href="/pricing">Full pricing <Icon icon={ArrowRight01Icon} size={14} /></a>
        </Reveal>
      </div>
    </section>
  );
}

/* ===================================================================== FAQ */

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

const FAQ_VISIBLE = 6;

export function FaqHomeSection({ authenticated }: { authenticated: boolean }) {
  const [showAll, setShowAll] = useState(false);
  return (
    <section className="mk-section mk-home mk-faq2" id="faq" aria-labelledby="mk-faq-title">
      <div className="mk-container mk-faq2__layout">
        <div className="mk-faq2__side">
          <Reveal variant="rise">
            <span className="mk-eyebrow">FAQ</span>
            <h2 id="mk-faq-title">Questions, <em>answered</em>.</h2>
            <p>Short answers to what people ask before their first form.</p>
          </Reveal>
          <Reveal className="mk-faq2__ask" variant="rise" delay={120}>
            <p>Still deciding? The fastest answer is your own first form.</p>
            <StartLink authenticated={authenticated} className="mk-button mk-button--primary" />
            <a className="mk-faq2__mail" href="mailto:support@intake.calder.click">or write to support@intake.calder.click</a>
          </Reveal>
        </div>
        <div className="mk-faq2__list">
          {FAQS.slice(0, FAQ_VISIBLE).map((faq, index) => <FaqItem key={faq.question} question={faq.question} answer={faq.answer} index={index} />)}
          <div className={`mk-faq2__more${showAll ? ' is-open' : ''}`} id="mk-faq-more" inert={!showAll}>
            <div className="mk-faq2__more-inner">
              {FAQS.slice(FAQ_VISIBLE).map((faq, index) => (
                <FaqItem key={faq.question} question={faq.question} answer={faq.answer} index={index + FAQ_VISIBLE} />
              ))}
            </div>
          </div>
          {FAQS.length > FAQ_VISIBLE && (
            <button type="button" className="mk-faq2__toggle" aria-expanded={showAll} aria-controls="mk-faq-more" onClick={() => setShowAll(value => !value)}>
              {showAll ? 'Show fewer questions' : `Show all ${FAQS.length} questions`}
              <Icon icon={ArrowRight01Icon} size={14} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}

/* ================================================== Changelog & developers */

interface ReleaseTeaser { slug: string; title: string; releaseDate: string }

/** The three newest releases. The notes are loaded only when this section comes near the screen. */
function useLatestReleases(load: boolean) {
  const [releases, setReleases] = useState<ReleaseTeaser[] | null>(null);
  useEffect(() => {
    if (!load || releases) return;
    let cancelled = false;
    import('../content/changelog').then(({ BUNDLED_RELEASES }) => {
      if (cancelled) return;
      const latest = [...BUNDLED_RELEASES]
        .reverse()
        .sort((a, b) => b.releaseDate.localeCompare(a.releaseDate))
        .slice(0, 3)
        .map(({ slug, title, releaseDate }) => ({ slug, title, releaseDate }));
      setReleases(latest);
    }).catch(() => setReleases([]));
    return () => { cancelled = true; };
  }, [load, releases]);
  return releases;
}

const DEV_SHIPPING = [
  'A hosted form page and an embed snippet',
  'Submissions validated on the server',
  'A response inbox with search, filters and CSV export',
] as const;

export function UpdatesSection() {
  const [ref, state] = useViewState<HTMLDivElement>({ rootMargin: '0px 0px 300px 0px', once: true });
  const releases = useLatestReleases(state !== 'before');
  return (
    <section className="mk-section mk-home mk-updates" id="updates" aria-labelledby="mk-updates-title">
      <div className="mk-container">
        <HomeHead eyebrow="BUILT IN THE OPEN" id="mk-updates-title" title={<>Shipping, <em>in public</em>.</>}>
          Every release gets its own page. Every developer feature says whether it ships today.
        </HomeHead>

        <div className="mk-updates__grid" ref={ref}>
          <Reveal as="article" className="mk-updates__card" variant="rise">
            <div className="mk-updates__head">
              <span className="mk-updates__icon"><Icon icon={Book01Icon} size={18} /></span>
              <h3>Changelog</h3>
            </div>
            <ol className="mk-updates__releases">
              {(releases ?? [null, null, null]).map((release, index) => (
                <li key={release?.slug ?? index} className={release ? '' : 'is-loading'}>
                  {release ? (
                    <a href={`/changelog/${release.slug}`}>
                      <time dateTime={release.releaseDate}>{formatReleaseDate(release.releaseDate)}</time>
                      <span>{release.title}</span>
                    </a>
                  ) : <span className="mk-updates__skeleton" aria-hidden="true" />}
                </li>
              ))}
            </ol>
            <a className="mk-text-link" href="/changelog">Read the changelog <Icon icon={ArrowRight01Icon} size={14} /></a>
          </Reveal>

          <Reveal as="article" className="mk-updates__card mk-updates__card--dev" variant="rise" delay={140}>
            <div className="mk-updates__head">
              <span className="mk-updates__icon"><Icon icon={CodeIcon} size={18} /></span>
              <h3>Developers</h3>
            </div>
            <ul className="mk-updates__caps">
              {DEV_SHIPPING.map(item => <li key={item}><span>{item}</span><span className="mk-updates__status">Shipping</span></li>)}
            </ul>
            <a className="mk-text-link" href="/developers">Open the developer page <Icon icon={ArrowRight01Icon} size={14} /></a>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* =============================================================== Final CTA */

/** 0 → 1 as the element travels up through the viewport; written to a CSS variable, no re-renders. */
function useScrollDraw<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (prefersReducedMotion() || typeof window.requestAnimationFrame !== 'function') {
      node.style.setProperty('--draw', '1');
      return;
    }
    let frame = 0;
    const update = () => {
      frame = 0;
      const rect = node.getBoundingClientRect();
      const vh = window.innerHeight || 1;
      const progress = Math.min(1, Math.max(0, (vh - rect.top) / (vh * 0.55 + rect.height * 0.5)));
      node.style.setProperty('--draw', progress.toFixed(3));
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(update); };
    update();
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('resize', schedule);
    return () => {
      window.removeEventListener('scroll', schedule);
      window.removeEventListener('resize', schedule);
      if (frame && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(frame);
    };
  }, []);
  return ref;
}

export function FinalBand({ authenticated }: { authenticated: boolean }) {
  const ref = useScrollDraw<HTMLElement>();
  return (
    <section className="mk-final2" aria-labelledby="mk-final-title" ref={ref}>
      <div className="mk-final2__art" aria-hidden="true">
        <svg className="mk-final2__line" viewBox="0 0 1200 400" preserveAspectRatio="none" focusable="false">
          <path d="M-20 300 C 140 300, 180 120, 330 140 S 520 330, 640 250 S 800 40, 930 110 S 1080 300, 1220 210" />
        </svg>
        <span className="mk-final2__cover" />
      </div>
      <div className="mk-container mk-final2__inner">
        <Reveal variant="rise">
          <span className="mk-eyebrow">YOUR NEXT FORM</span>
          <h2 id="mk-final-title">Write it once. Watch it become a <em>form</em>.</h2>
          <p>Describe it, look it over, and Intake builds it in the tool you already use.</p>
        </Reveal>
        <Reveal variant="rise" delay={140} className="mk-final2__actions">
          <StartLink authenticated={authenticated} className="mk-button mk-final2__button" />
          <span>Free during launch · No card</span>
        </Reveal>
      </div>
    </section>
  );
}
