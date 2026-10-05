import { motion } from 'motion/react';
import { useEffect, useState } from 'react';
import { Reel } from '../reel/Reel';
import { Stories } from '../mobile/Stories';
import { useIsMobile } from '../lib/useIsMobile';
import { conference } from '../reel/scenes';
import { LogoMark } from '../reel/parts';

export const REPO = 'https://github.com/Emerald-dev0/Intake';

export function Nav() {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    const f = () => setScrolled(window.scrollY > 24);
    f();
    window.addEventListener('scroll', f, { passive: true });
    return () => window.removeEventListener('scroll', f);
  }, []);
  return (
    <header className={`nav ${scrolled ? 'is-scrolled' : ''}`}>
      <div className="nav-in">
        <a href="#top" className="logo" aria-label="Intake home">
          <LogoMark size={26} />
          <span>intake</span>
        </a>
        <nav className="nav-links" aria-label="Main navigation">
          <a href="#how">How Intake works</a>
          <a href="#demo">Demos</a>
          <a href="#try">Try the demo</a>
          <a href="#where">Google Forms</a>
          <a href="#faq">FAQ</a>
          <a href="/pricing">Pricing</a>
        </nav>
        <div className="nav-cta">
          <a className="nav-gh" href={REPO} target="_blank" rel="noreferrer">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" /></svg>
            GitHub
          </a>
          <a className="nav-gh nav-pricing-link" href="/pricing">Pricing</a>
          <a className="nav-gh" href="/auth/sign-in">Sign in</a>
          <a className="btn btn-cream btn-sm" href="/auth/sign-up">Create account</a>
        </div>
      </div>
    </header>
  );
}

const IDEAS = [
  'Questionnaire for my final-year research project',
  'RSVP for Tolu’s 30th — plus-ones and dietary needs',
  'Job application for a junior designer, with portfolio link',
  'Parent consent form for the school trip to Lekki',
  'Weekly check-in for my team: mood, energy, and blockers',
  'Registration for a church retreat, ask if they need a bus',
];

function HeroComposer() {
  const [value, setValue] = useState('');
  const [ph, setPh] = useState('');
  const [focused, setFocused] = useState(false);

  useEffect(() => {
    let i = 0;
    let c = 0;
    let dir = 1;
    let timer = 0;
    const tick = () => {
      const s = IDEAS[i];
      c += dir;
      setPh(s.slice(0, c));
      if (dir === 1 && c >= s.length) {
        dir = -1;
        timer = window.setTimeout(tick, 2200);
        return;
      }
      if (dir === -1 && c <= 0) {
        dir = 1;
        i = (i + 1) % IDEAS.length;
      }
      timer = window.setTimeout(tick, dir === 1 ? 32 + Math.random() * 40 : 14);
    };
    timer = window.setTimeout(tick, 900);
    return () => clearTimeout(timer);
  }, []);

  const submit = () => {
    const t = value.trim() || IDEAS.find((x) => x.startsWith(ph)) || IDEAS[0];
    window.dispatchEvent(new CustomEvent('intake:try', { detail: t }));
  };

  return (
    <form
      className={`hero-composer ${focused ? 'is-focus' : ''}`}
      aria-label="Local scripted form preview"
      onSubmit={(e) => {
        e.preventDefault();
        submit();
      }}
    >
      <span className="hc-label">I need a form for…</span>
      <div className="hc-row">
        <div className="hc-input">
          <input value={value} onChange={(e) => setValue(e.target.value)} onFocus={() => setFocused(true)} onBlur={() => setFocused(false)} aria-label="Describe your form" />
          {!value && (
            <span className="hc-ph" aria-hidden>
              {ph}
              <i className="caret" />
            </span>
          )}
        </div>
        <button type="submit" className="btn btn-accent">
          Try the demo
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
      <p className="hc-note">Scripted local preview only: this input sends no request and creates no Google Form.</p>
    </form>
  );
}

const line = {
  hidden: { y: '110%' },
  show: (i: number) => ({ y: '0%', transition: { duration: 1.1, delay: 0.15 + i * 0.12, ease: [0.22, 1, 0.36, 1] as const } }),
};

export function Hero() {
  const mobile = useIsMobile();
  return (
    <section className="hero" id="top" aria-labelledby="hero-title">
      <div className="hero-bg" aria-hidden>
        <div className="hero-grid" />
        <div className="hero-glow" />
      </div>
      <div className="wrap hero-top">
        <motion.a href="#where" className="hero-badge" initial={{ opacity: 1, y: 0 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <span className="hb-live">
            <i /> Google Forms
          </span>
          <span className="hb-text">Create or edit · review before apply</span>
          <span className="hb-arrow">→</span>
        </motion.a>

        <h1 className="hero-title" id="hero-title">
          <span className="ht-line">
            <motion.span custom={0} variants={line} initial="hidden" animate="show">
              Create and edit
            </motion.span>
          </span>
          <span className="ht-line">
            <motion.span custom={1} variants={line} initial="hidden" animate="show">
              Google Forms with AI.
            </motion.span>
          </span>
        </h1>

        <motion.div className="hero-row" initial={{ opacity: 1, y: 0 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.55 }}>
          {mobile ? (
            <div>
              <p className="hero-sub">
                Intake is an AI-assisted Google Forms workspace. Describe a new form or a change in natural language; Intake proposes a structured plan for you to review and confirm before it is applied in your connected Google account.
              </p>
              <p className="hero-status">Google Forms create and edit workflows are implemented. Live use depends on deployment configuration and separate Google authorization; this page’s previews are scripted and make no provider changes.</p>
              <div className="hero-actions">
                <a className="btn btn-accent" href="/auth/sign-up">
                  Create account
                </a>
                <a className="btn btn-ghost" href="#try">
                  Try the demo
                </a>
              </div>
            </div>
          ) : (
            <>
              <div>
                <p className="hero-sub">Intake is an AI-assisted Google Forms workspace. Describe a new form or a change in natural language; Intake proposes a structured plan for you to review and confirm before it is applied in your connected Google account.</p>
                <p className="hero-status">Google Forms create and edit workflows are implemented. Live use depends on deployment configuration and separate Google authorization; this page’s previews are scripted and make no provider changes.</p>
              </div>
              <HeroComposer />
            </>
          )}
        </motion.div>
      </div>

      {mobile && (
        <motion.div id="demo" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <Stories />
          <p className="ms-hint">Scripted preview · no real form is created or changed · tap to skip</p>
        </motion.div>
      )}

      {!mobile && (
      <motion.div className="wrap-wide hero-reel" id="demo" initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}>
        <div className="reel-meta">
          <span>
            <i className="rec" /> Scripted demo · no Google Form is created here
          </span>
          <span className="reel-meta-r">Drag the timeline to scrub ⟷</span>
        </div>
        <Reel scene={conference} className="reel-hero" />
      </motion.div>
      )}

      <Marquee />
    </section>
  );
}

const PROMPTS = [
  'Questionnaire for a final-year project',
  'Volunteer signup for Saturday’s cleanup',
  'RSVP with plus-ones',
  'Customer feedback, anonymous',
  'Hackathon registration for the team lead and members',
  'Parent consent for the school trip',
  'Cake order form with delivery address',
  'Patient intake with allergy follow-up',
  'Weekly team check-in',
  '5-a-side tournament registration',
  'Book club signup',
];

function Marquee() {
  const row = [...PROMPTS, ...PROMPTS];
  return (
    <div className="marquee" aria-hidden>
      <div className="marquee-track">
        {row.map((p, i) => (
          <span key={i} className="mq-item">
            <span className="mq-q">“</span>
            {p}
            <span className="mq-q">”</span>
            <span className="mq-arrow">→ form</span>
          </span>
        ))}
      </div>
    </div>
  );
}
