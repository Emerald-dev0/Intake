import { AnimatePresence, motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useRef, useState } from 'react';
import { SectionHead, Reveal } from '../components/SectionHead';
import { LogoMark } from '../reel/parts';
import { REPO } from './Hero';
import { Waitlist } from './Waitlist';
import type { FieldType } from '../lib/types';

/* ───────────── Statement ───────────── */

const STATEMENT: { w: string; accent?: boolean }[] = [
  { w: 'You' },
  { w: 'say', accent: true },
  { w: 'it.' },
  { w: 'Intake' },
  { w: 'builds', accent: true },
  { w: 'it.' },
  { w: 'Google' },
  { w: 'or' },
  { w: 'Microsoft' },
  { w: 'hosts', accent: true },
  { w: 'it.' },
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
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'end 50%'] });
  return (
    <section className="section statement">
      <div className="wrap">
        <div className="stmt" ref={ref}>
          {STATEMENT.map((x, i) => (
            <Word key={i} w={x.w} accent={!!x.accent} p={scrollYProgress} range={[i / STATEMENT.length, (i + 1) / STATEMENT.length]} />
          ))}
        </div>
        <Reveal className="stmt-sub">
          <p>Your existing forms, controlled through natural language. Intake is designed to work inside the tools you already use, not host another form platform. Provider connections are coming later.</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ───────────── Where your forms live ───────────── */

const PROMISES = [
  ['It’s your form', 'The goal is a real form in the Google or Microsoft account you choose to connect.'],
  ['Responses stay put', 'Responses would go to the form platform, not a new Intake response system.'],
  ['Edit it anywhere', 'You can still edit it in your form platform; natural-language edits are planned.'],
  ['You’re in control', 'Provider authorization will be a separate step from your Intake sign-in.'],
];

export function Where() {
  return (
    <section className="section where" id="where">
      <div className="wrap">
        <SectionHead
          n="07"
          kicker="Where your forms live"
          title={
            <>
              Your forms. <em>Your</em> account.
            </>
          }
          lede="Intake is not another form builder. The planned provider connection will ask your permission separately from Intake login, then create the real form in the tool you already use. No provider integration is live yet."
        />
        <div className="where-grid">
          <Reveal className="pv-card is-google">
            <div className="pv-top">
              <span className="pv-name">
                <i /> Google Forms
              </span>
              <span className="pv-status">Planned first</span>
            </div>
            <h3>Connect Google Forms.</h3>
            <p>Planned first: create a real form in the Google account you explicitly authorize. Responses would stay with Google Forms.</p>
            <div className="pv-mock">
              <span className="pv-mock-dot" />
              <code>docs.google.com/forms/d/…/edit</code>
            </div>
          </Reveal>
          <Reveal className="pv-card is-ms" delay={0.08}>
            <div className="pv-top">
              <span className="pv-name">
                <i /> Microsoft Forms
              </span>
              <span className="pv-status">Planned next</span>
            </div>
            <h3>Connect Microsoft Forms.</h3>
            <p>Planned later for work and school accounts: a real form in your authorized Microsoft account.</p>
            <div className="pv-mock">
              <span className="pv-mock-dot" />
              <code>forms.office.com/r/…</code>
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

function MiniWidget({ type }: { type: FieldType }) {
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
    case 'email':
      return (
        <div className="mw-line mw-email">
          ada@<span>example</span>.com <b>✓</b>
        </div>
      );
    case 'phone':
      return <div className="mw-line">+234 803 555 0142</div>;
    case 'number':
      return (
        <div className="mw-line mw-num">
          <span>24</span>
          <em>▴▾</em>
        </div>
      );
    case 'single_choice':
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
    case 'multiple_choice':
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
    case 'date':
      return (
        <div className="mw-cal">
          {Array.from({ length: 14 }).map((_, i) => (
            <i key={i} className={i === 9 ? 'on' : ''} />
          ))}
        </div>
      );
    case 'time':
      return (
        <div className="mw-clock">
          <i />
        </div>
      );
    case 'rating':
      return (
        <div className="mw-stars">
          {[0, 1, 2, 3, 4].map((i) => (
            <span key={i} style={{ animationDelay: `${i * 0.18}s` }}>
              ★
            </span>
          ))}
        </div>
      );
  }
}

const TYPES: [FieldType, string, string][] = [
  ['short_text', 'Short answer', '“their name”'],
  ['long_text', 'Paragraph', '“anything we could improve”'],
  ['email', 'Email', '“their email”'],
  ['phone', 'Phone', '“WhatsApp number”'],
  ['number', 'Number', '“how many guests”'],
  ['single_choice', 'Yes / no & choices', '“whether they need a bus”'],
  ['multiple_choice', 'Checkboxes', '“which teams they’d join”'],
  ['dropdown', 'Dropdown', '“playing position”'],
  ['date', 'Date', '“date of birth”'],
  ['time', 'Time', '“arrival time”'],
  ['rating', 'Rating', '“out of 5”'],
];

export function Capabilities() {
  return (
    <section className="section caps" id="capabilities">
      <div className="wrap">
        <SectionHead
          n="08"
          kicker="Say it your way"
          title={
            <>
              Say what matters.
              <br />Skip the <em>settings.</em>
            </>
          }
          lede="Say “their WhatsApp number” and you get a phone question. Say “out of 5” and you get a star rating. Intake is designed to choose the appropriate question type for you."
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
              {['Required questions', 'Descriptions', 'Sections', 'Question order', 'Follow-up questions', 'Skip logic', 'Thank-you message'].map((x) => (
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

const FAQS = [
  ['Is Intake another form builder?', 'No. Intake is designed to create and manage real forms in the Google or Microsoft account you authorize. Provider connections and form creation are not live yet.'],
  ['Where will responses go?', 'The plan is for responses to stay with Google Forms or Microsoft Forms, not in an Intake response system. No provider forms are being created yet.'],
  ['Will I be able to edit the form myself?', 'That is the point of using an existing form platform: you can edit the real form there. Editing it by messaging Intake is a planned capability, not live yet.'],
  ['What access will Intake need?', 'Eventually you will need to authorize access to create and edit forms in the account you connect. This is separate from signing in to Intake. Provider connections are not available yet.'],
  ['What if my request is vague?', 'The intended agent would ask only when a missing detail changes the form. The current landing demo uses a simple in-browser parser, not the future agent.'],
  ['Does it work with Microsoft Forms?', 'That’s the plan. Google Forms comes first, then Microsoft Forms, and the same message will work for both.'],
];

export function FAQ() {
  const [open, setOpen] = useState<number | null>(0);
  return (
    <section className="section faq" id="faq">
      <div className="wrap faq-grid">
        <SectionHead
          n="09"
          kicker="Questions"
          title={
            <>
              Fair <em>questions.</em>
            </>
          }
          lede="The short answers to what people usually ask first."
        />
        <div className="faq-list">
          {FAQS.map(([q, a], i) => (
            <div key={q} className={`faq-item ${open === i ? 'is-open' : ''}`}>
              <button className="faq-q" onClick={() => setOpen(open === i ? null : i)} aria-expanded={open === i}>
                <span>{q}</span>
                <i className="faq-plus" />
              </button>
              <AnimatePresence initial={false}>
                {open === i && (
                  <motion.div className="faq-a" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}>
                    <p>{a}</p>
                  </motion.div>
                )}
              </AnimatePresence>
            </div>
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
          <p className="cta-sub">Intake is in the works. Create an Intake account now; connecting a provider and making real forms are planned for later.</p>
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
          <p>Say what you need. Intake is being built to make the real form in your Google or Microsoft account.</p>
        </div>
        <div className="foot-cols">
          <div>
            <h5>Product</h5>
            <a href="#how">How it works</a>
            <a href="#demo">Demos</a>
            <a href="#try">Try it</a>
            <a href="#faq">FAQ</a>
          </div>
          <div>
            <h5>Project</h5>
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
            <h5>Status</h5>
            <span className="foot-status">
              <i /> In the works
            </span>
            <span className="foot-small">Google Forms first, Microsoft Forms next.</span>
          </div>
        </div>
      </div>
      <div className="foot-word" aria-hidden>
        intake<span className="foot-dot" />
      </div>
      <div className="wrap foot-bottom">
        <span>© {new Date().getFullYear()} Intake</span>
        <span>No questions were dragged or dropped in the making of this page.</span>
      </div>
    </footer>
  );
}
