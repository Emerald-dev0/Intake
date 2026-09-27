import { AnimatePresence, motion, useScroll, useTransform, type MotionValue } from 'motion/react';
import { useRef, useState } from 'react';
import { SectionHead, Reveal } from '../components/SectionHead';
import { LogoMark } from '../reel/parts';
import { REPO } from './Hero';
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
          <p>Intake isn’t another place to keep forms. It’s the helper that sets them up for you in the tools you and your people already use.</p>
        </Reveal>
      </div>
    </section>
  );
}

/* ───────────── Where your forms live ───────────── */

const PROMISES = [
  ['It’s your form', 'It lives in your Google or Microsoft account, next to all your other forms.'],
  ['Responses stay put', 'Answers go straight to Google Forms or Microsoft Forms. Intake doesn’t collect them.'],
  ['Edit it anywhere', 'Change it by hand in Google Forms or Microsoft Forms, or just ask Intake.'],
  ['You’re in control', 'You choose what to connect, and you can disconnect in one click.'],
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
          lede="Intake doesn’t host forms or hold your responses. It signs in to the form tool you already use, with your permission, and does the setup for you."
        />
        <div className="where-grid">
          <Reveal className="pv-card is-google">
            <div className="pv-top">
              <span className="pv-name">
                <i /> Google Forms
              </span>
              <span className="pv-status">First up</span>
            </div>
            <h3>Sign in with Google.</h3>
            <p>Intake makes the form in your Google account. Responses go to Google Forms, and on to Google Sheets if you want them there.</p>
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
              <span className="pv-status">Up next</span>
            </div>
            <h3>Sign in with Microsoft.</h3>
            <p>Same idea for work and school accounts. The form shows up in your Microsoft Forms, ready to share with your team or class.</p>
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
              You never pick
              <br />a question <em>type.</em>
            </>
          }
          lede="Say “their WhatsApp number” and you get a phone question. Say “out of 5” and you get a star rating. Intake picks the right one every time."
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
  ['Is Intake another form builder?', 'No. Intake doesn’t host forms at all. It builds them for you inside Google Forms or Microsoft Forms, the tools you and the people filling them in already know.'],
  ['Where do the responses go?', 'Straight to Google Forms or Microsoft Forms, same as any form you make yourself. Intake never collects them.'],
  ['Can I still edit the form myself?', 'Yes. It’s a normal form in your account. Open it and change whatever you like, or just tell Intake what to change.'],
  ['What access does Intake need?', 'Permission to create and edit forms in the account you connect. You approve it when you sign in, and you can take it back any time.'],
  ['What if my request is vague?', 'Intake only asks a question when the answer would change the form, like which age groups to offer. Otherwise it just gets on with it.'],
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
  const [v, setV] = useState('');
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
        <Reveal delay={0.12}>
          <form
            className="cta-form"
            onSubmit={(e) => {
              e.preventDefault();
              window.dispatchEvent(new CustomEvent('intake:try', { detail: v.trim() || 'Signup for our book club. Ask for name, email, favourite genre (fiction, history, poetry) and whether they can host. If yes, ask for their address.' }));
            }}
          >
            <input value={v} onChange={(e) => setV(e.target.value)} placeholder="Describe the form you need…" aria-label="Describe the form you need" />
            <button className="btn btn-accent" type="submit">
              Build it ↵
            </button>
          </form>
        </Reveal>
        <Reveal delay={0.2} className="cta-links">
          <a href={REPO} target="_blank" rel="noreferrer">
            Star the repo ↗
          </a>
          <a href={`${REPO}#readme`} target="_blank" rel="noreferrer">
            Read the README ↗
          </a>
          <a href="#top">Watch the demo again ↑</a>
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
          <p>Say what you need. Intake makes the form in your Google or Microsoft account.</p>
        </div>
        <div className="foot-cols">
          <div>
            <h5>Product</h5>
            <a href="#how">How it works</a>
            <a href="#reels">Demos</a>
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
