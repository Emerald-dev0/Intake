import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Cancel01Icon,
  Cursor01Icon,
  LockKeyIcon,
  PencilEdit02Icon,
  Tick02Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { COMPARISON_ROWS } from '../content/site';
import { Reveal, SectionIntro } from './MarketingSections';

/**
 * The redesigned homepage sections that come after the hero.
 *
 * Every section here reads the tokens at the top of marketing.css and is styled in home.css. The
 * copy is the existing product copy, made shorter; nothing here claims more than the product does.
 */

function Icon({ icon, size = 18 }: { icon: IconSvgElement; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.6} aria-hidden="true" focusable="false" />;
}

/* ================================================================ Why Intake */

const DIFFERENCES: Array<{ icon: IconSvgElement; title: string; text: string }> = [
  {
    icon: UserCheck01Icon,
    title: 'You approve every question first',
    text: 'Nothing is created or changed until you confirm. Rewrite, drop, add or reorder — the form only becomes real when you say so.',
  },
  {
    icon: PencilEdit02Icon,
    title: 'It edits the forms you already have',
    text: 'Point Intake at a form you own and describe the change. It updates that same form. No copies, no migration.',
  },
  {
    icon: LockKeyIcon,
    title: 'The form lives in your own account',
    text: 'A normal form in your own workspace: same links, same responses tab, same sharing. Your data never moves to another platform.',
  },
];

const BY_HAND = [
  'Open your form tool',
  'Add and set up every question',
  'Sort out sections and answer options',
  'Do it all again when something changes',
] as const;

const WITH_INTAKE = [
  'Describe what the form should collect',
  'Read the questions it came up with',
  'Change anything that does not fit',
  'Confirm, and it is created or updated',
] as const;

/** The editor you know: the same blank question, again and again. Decorative. */
function ByHandSketch() {
  return (
    <div className="mk-why__sketch mk-why__sketch--hand" aria-hidden="true">
      {['Untitled question', 'Untitled question', 'Untitled question'].map((label, index) => (
        <div className="mk-why__ghost" key={index}>
          <span>{label}</span>
          <i>Multiple choice</i>
        </div>
      ))}
      <div className="mk-why__add">+ Add question</div>
      <span className="mk-why__cursor"><Icon icon={Cursor01Icon} size={16} /></span>
    </div>
  );
}

/** One sentence and the draft it becomes. Decorative. */
function IntakeSketch() {
  return (
    <div className="mk-why__sketch mk-why__sketch--intake" aria-hidden="true">
      <div className="mk-why__say">“A feedback form for my coffee shop”</div>
      <ol className="mk-why__draft">
        {['Overall satisfaction', 'What did you like?', 'Would you recommend us?'].map(label => (
          <li key={label}><Icon icon={Tick02Icon} size={13} />{label}</li>
        ))}
      </ol>
      <div className="mk-why__ready">Ready when you are <Icon icon={ArrowRight01Icon} size={13} /></div>
    </div>
  );
}

export function WhySection() {
  return (
    <section className="mk-section mk-why" id="product" aria-labelledby="mk-why-title">
      <div className="mk-container">
        <SectionIntro eyebrow="WHY INTAKE" titleId="mk-why-title" title={<>Three things the others <em>don’t</em> do.</>}>
          Intake doesn’t move your forms somewhere new, and it isn’t tied to one vendor. It’s a faster way to make the forms you were going to make anyway — and to change the ones you already own.
        </SectionIntro>

        <div className="mk-why__panel" role="group" aria-label="Doing it by hand compared with Intake">
          <Reveal as="article" className="mk-why__card mk-why__card--hand" variant="fade">
            <ByHandSketch />
            <span className="mk-eyebrow">BY HAND</span>
            <h3>Piece it together.</h3>
            <ol className="mk-why__steps">
              {BY_HAND.map(step => <li key={step}><Icon icon={Cancel01Icon} size={14} />{step}</li>)}
            </ol>
          </Reveal>
          <span className="mk-why__bridge" aria-hidden="true"><Icon icon={ArrowRight01Icon} size={18} /></span>
          <Reveal as="article" className="mk-why__card mk-why__card--intake" delay={120} variant="fade">
            <IntakeSketch />
            <span className="mk-eyebrow">WITH INTAKE</span>
            <h3>Say what you want.</h3>
            <ol className="mk-why__steps">
              {WITH_INTAKE.map(step => <li key={step}><Icon icon={Tick02Icon} size={14} />{step}</li>)}
            </ol>
          </Reveal>
        </div>

        <ul className="mk-why__features">
          {DIFFERENCES.map((item, index) => (
            <Reveal as="li" className="mk-why__feature" key={item.title} delay={index * 90} variant="rise">
              <span className="mk-why__icon"><Icon icon={item.icon} size={20} /></span>
              <h3>{item.title}</h3>
              <p>{item.text}</p>
            </Reveal>
          ))}
        </ul>

        <div className="mk-why__compare" id="compare">
          <Reveal className="mk-why__compare-head" variant="rise">
            <h3 id="mk-compare-title">How does it compare?</h3>
            <p>The alternatives draft text or keep you inside one platform. Intake builds the real form in the tool you chose, and lets you approve it first.</p>
          </Reveal>
          <Reveal variant="rise" delay={80}>
            <div className="mk-compare__scroll" role="region" aria-labelledby="mk-compare-title" tabIndex={0}>
              <table className="mk-compare__table">
                <caption>Intake compared with Google&rsquo;s built-in AI help, Typeform AI, and asking a chatbot</caption>
                <thead>
                  <tr>
                    <th scope="col"><span className="mk-compare__th-label">Capability</span></th>
                    <th scope="col" className="is-intake"><span className="mk-compare__th-label">Intake</span></th>
                    <th scope="col"><span className="mk-compare__th-label">Google&rsquo;s built-in AI</span></th>
                    <th scope="col"><span className="mk-compare__th-label">Typeform AI</span></th>
                    <th scope="col"><span className="mk-compare__th-label">ChatGPT</span></th>
                  </tr>
                </thead>
                <tbody>
                  {COMPARISON_ROWS.map(row => (
                    <tr key={row.label}>
                      <th scope="row">{row.label}</th>
                      <td className="is-intake"><span className="mk-why__yes"><Icon icon={Tick02Icon} size={13} /></span>{row.intake}</td>
                      <td>{row.googleAi}</td>
                      <td>{row.typeformAi}</td>
                      <td>{row.chatgpt}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}
