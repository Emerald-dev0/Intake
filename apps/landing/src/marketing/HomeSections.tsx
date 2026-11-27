import type { ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  ArrowRight01Icon,
  Cursor01Icon,
  LockKeyIcon,
  PencilEdit02Icon,
  Tick02Icon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { COMPARISON_ROWS } from '../content/site';
import { Reveal } from './MarketingSections';

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
