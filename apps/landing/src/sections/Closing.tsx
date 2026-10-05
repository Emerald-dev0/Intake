import { motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useRef } from 'react';
import { SectionHead, Reveal } from '../components/SectionHead';
import { LogoMark } from '../reel/parts';
import { REPO } from './Hero';
import { Waitlist } from './Waitlist';
import { CREATOR, FAQS } from '../content/site';

/* ───────────── Statement ───────────── */

const STATEMENT: { w: string; accent?: boolean }[] = [
  { w: 'You' },
  { w: 'describe', accent: true },
  { w: 'it.' },
  { w: 'Intake' },
  { w: 'drafts', accent: true },
  { w: 'it.' },
  { w: 'You' },
  { w: 'review' },
  { w: 'and' },
  { w: 'confirm.', accent: true },
];

function Word({ w, accent, range, p }: { w: string; accent: boolean; range: [number, number]; p: MotionValue<number> }) {
  const o = useTransform(p, range, [0.12, 1]);
  return (
    <motion.span className={accent ? 'pw-accent' : ''} style={{ opacity: o }}>
      {w}{' '}
    </motion.span>
  );
}

export function Statement() {
  const ref = useRef<HTMLHeadingElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 50%'] });
  return (
    <section className="section statement" aria-labelledby="statement-title">
      <div className="wrap">
        <h2 className="stmt" id="statement-title" ref={ref}>
          {STATEMENT.map((x, i) => (
            <Word key={i} w={x.w} accent={!!x.accent} p={scrollYProgress} range={[i / STATEMENT.length, (i + 1) / STATEMENT.length]} />
          ))}
        </h2>
        <Reveal className="stmt-sub">
          <p>Intake can create a new Google Form or prepare supported natural-language edits to an existing one. Review the proposal; Intake changes your connected Google account only after you explicitly confirm.</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ───────────── Where your forms live ───────────── */

const PROMISES = [
  ['Your Google account', 'Authorize Google separately from Intake sign-in. Only the account you connect can be used for form operations.'],
  ['Responses stay with Google', 'Google hosts the responder page and collects responses. Intake stores form specifications and management metadata, not respondent answers.'],
  ['Review before apply', 'AI interpretation and draft revisions do not contact Google Forms. Confirm only after you have inspected the proposal.'],
  ['Existing forms stay the same', 'An edit proposal updates the selected Google Form after confirmation; Intake does not make an edit by creating a replacement form.'],
];

export function Where() {
  return (
    <section className="section where" id="where" aria-labelledby="where-title">
      <div className="wrap">
        <SectionHead
          n="07"
          kicker="Google Forms integration"
          titleId="where-title"
          title={<>Your forms. <em>Your</em> account.</>}
          lede="Intake uses an authorized Google connection to create real Google Forms and propose supported edits to existing forms. Signing in to Intake is separate from Google authorization. Live use requires Google OAuth and Forms API configuration; every provider change still waits for your explicit confirmation."
        />
        <div className="where-grid">
          <Reveal className="pv-card is-google">
            <div className="pv-top">
              <span className="pv-name">
                <i /> Google Forms
              </span>
              <span className="pv-status">Create · review · confirm</span>
            </div>
            <h3>Create a real Google Form.</h3>
            <p>Describe what to collect. Intake generates a structured proposal; after you review and confirm, the form is created in your connected Google account.</p>
            <div className="pv-mock">
              <span className="pv-mock-dot" />
              <code>Google hosts the form and responses</code>
            </div>
          </Reveal>
          <Reveal className="pv-card is-google" delay={0.08}>
            <div className="pv-top">
              <span className="pv-name">
                <i /> Existing Google Forms
              </span>
              <span className="pv-status">Edit · review · confirm</span>
            </div>
            <h3>Update the form you already have.</h3>
            <p>Choose a form from your Intake library or provide its Google Forms edit URL. Intake reads its current structure and applies supported edits to that same form only after you confirm.</p>
            <div className="pv-mock">
              <span className="pv-mock-dot" />
              <code>Requires Google editor access</code>
            </div>
          </Reveal>
        </div>
        <div className="promises">
          {PROMISES.map(([t, d], i) => (
            <Reveal key={t} delay={i * 0.06} className="promise">
              <span className="promise-n">{String(i + 1).padStart(2, '0')}</span>
              <h4>{t}</h4>
              <p>{d}</p>
            </Reveal>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── Capabilities ───────────── */

type CapabilityPreviewType = 'short_text' | 'long_text' | 'email_text' | 'one_choice' | 'checkboxes' | 'dropdown';

function MiniWidget({ type }: { type: CapabilityPreviewType }) {
  switch (type) {
    case 'short_text':
      return (
        <div className="mw-line">
          <span className="mw-typing">Adaeze Okafor</span>
        </div>
      );
    case 'long_text':
      return (
        <div className="mw-box">
          <i style={{ width: '90%' }} />
          <i style={{ width: '70%' }} />
          <i style={{ width: '40%' }} />
        </div>
      );
    case 'email_text':
      return <div className="mw-line mw-email">ada@example.com</div>;
    case 'one_choice':
      return (
        <div className="mw-opts">
          <span className="on">
            <i /> Yes
          </span>
          <span>
            <i /> No
          </span>
        </div>
      );
    case 'checkboxes':
      return (
        <div className="mw-opts is-check">
          <span className="on">
            <i /> Media
          </span>
          <span className="on d2">
            <i /> Tech
          </span>
          <span>
            <i /> Welfare
          </span>
        </div>
      );
    case 'dropdown':
      return (
        <div className="mw-drop">
          Midfielder <em>▾</em>
        </div>
      );
  }
}

const TYPES: readonly [CapabilityPreviewType, string, string][] = [
  ['short_text', 'Short answer', '“their name or phone number”'],
  ['long_text', 'Paragraph', '“anything we could improve”'],
  ['email_text', 'Email address · plain text', '“their email address”'],
  ['one_choice', 'Multiple choice · one answer', '“whether they need a bus”'],
  ['checkboxes', 'Checkboxes · several answers', '“which teams they’d join”'],
  ['dropdown', 'Dropdown · one answer', '“playing position”'],
];

export function Capabilities() {
  return (
    <section className="section caps" id="capabilities" aria-labelledby="capabilities-title">
      <div className="wrap">
        <SectionHead
          n="08"
          kicker="Supported Google Forms question types"
          titleId="capabilities-title"
          title={<>Describe what to ask. Intake maps it to a <em>supported type.</em></>}
          lede="Supported questions include short answers, paragraphs, one-answer multiple choice, checkboxes, and dropdowns. Email and phone requests become plain text fields without format-specific validation. Number, date, and rating controls are not supported; Intake flags unsupported requests instead of applying them. Conditional logic is limited to section-routing patterns Google Forms can express."
        />
        <div className="caps-grid">
          {TYPES.map(([t, name, said], i) => (
            <Reveal key={t} delay={(i % 4) * 0.06} className="cap">
              <div className="cap-top">
                <span className="cap-name">{name}</span>
              </div>
              <div className="cap-widget">
                <MiniWidget type={t} />
              </div>
              <span className="cap-said">{said}</span>
            </Reveal>
          ))}
          <Reveal delay={0.18} className="cap cap-more">
            <span className="cap-name">It also handles</span>
            <div className="cap-tags">
              {['Form title and description', 'Required questions', 'Question descriptions', 'Question order', 'Google-supported section routing'].map((x) => (
                <span key={x}>{x}</span>
              ))}
            </div>
          </Reveal>
        </div>
      </div>
    </section>
  );
}

/* ───────────── FAQ ───────────── */

export function FAQ() {
  return (
    <section className="section faq" id="faq" aria-labelledby="faq-title">
      <div className="wrap faq-grid">
        <SectionHead
          n="09"
          kicker="Frequently asked questions"
          titleId="faq-title"
          title={<>Clear answers about <em>Intake.</em></>}
          lede="Product, Google Forms access, AI-assisted creation, editing, and review-before-apply."
        />
        <div className="faq-list">
          {FAQS.map(({ question, answer }) => (
            <section key={question} className="faq-item" aria-labelledby={`faq-${question.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>
              <h3 className="faq-q" id={`faq-${question.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`}>{question}</h3>
              <p className="faq-a">{answer}</p>
            </section>
          ))}
        </div>
      </div>
    </section>
  );
}

/* ───────────── CTA + footer ───────────── */

export function CTA() {
  return (
    <section className="cta" id="start">
      <div className="cta-glow" aria-hidden />
      <div className="wrap cta-in">
        <Reveal>
          <span className="cta-k">Last question · required *</span>
        </Reveal>
        <Reveal delay={0.05}>
          <h2 className="cta-title">
            Stop clicking.
            <br />
            Start <em>saying.</em>
          </h2>
        </Reveal>
        <Reveal delay={0.1}>
          <p className="cta-sub">Create an Intake account, authorize Google separately, and review a creation or edit proposal before confirming. Live use requires an active, configured Intake service and the right Google permissions; the demos here are scripted.</p>
        </Reveal>
        <Reveal delay={0.16}>
          <Waitlist />
        </Reveal>
        <Reveal delay={0.2} className="cta-links">
          <a href="/auth/sign-up">Create an Intake account ↗</a>
          <a href={REPO} target="_blank" rel="noreferrer">
            Star the repo ↗
          </a>
          <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            Read the README ↗
          </a>
          <a href="#try">Try the demo ↑</a>
        </Reveal>
      </div>
    </section>
  );
}

export function Footer() {
  return (
    <footer className="foot">
      <div className="wrap foot-top">
        <div className="foot-brand">
          <a href="#top" className="logo">
            <LogoMark size={26} />
            <span>intake</span>
          </a>
          <p>Describe a form or a change. Review the proposal and confirm before Intake applies it to Google Forms.</p>
        </div>
        <div className="foot-cols">
          <div>
            <h2>Product</h2>
            <a href="#how">How Intake works</a>
            <a href="#demo">Workflow demos</a>
            <a href="#try">Local form preview</a>
            <a href="#faq">Frequently asked questions</a>
            <a href="/pricing">Plans &amp; pricing</a>
          </div>
          <div>
            <h2>Project</h2>
            <a href={REPO} target="_blank" rel="noreferrer">
              GitHub
            </a>
            <a href={`${REPO}#roadmap`} target="_blank" rel="noreferrer">
              Roadmap
            </a>
            <a href={`${REPO}#contributing`} target="_blank" rel="noreferrer">
              Contributing
            </a>
            <a href={`${REPO}#license`} target="_blank" rel="noreferrer">
              MIT License
            </a>
          </div>
          <div>
            <h2>Google Forms</h2>
            <span className="foot-status">Create and edit workflows are implemented.</span>
            <span className="foot-small">Live use requires an active service configuration and Google authorization.</span>
          </div>
        </div>
      </div>
      <div className="foot-word" aria-hidden>
        intake<span className="foot-dot" />
      </div>
      <div className="wrap foot-bottom">
        <span>© {new Date().getFullYear()} Intake</span>
        <span>Built by <a className="creator-attribution" href={CREATOR.github} target="_blank" rel="noreferrer">{CREATOR.displayName}</a></span>
      </div>
    </footer>
  );
}
