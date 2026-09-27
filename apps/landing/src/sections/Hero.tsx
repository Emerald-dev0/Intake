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
        <nav className="nav-links">
          <a href="#how">How it works</a>
          <a href="#reels">Demos</a>
          <a href="#try">Try it</a>
          <a href="#where">Google &amp; Microsoft</a>
          <a href="#faq">FAQ</a>
        </nav>
        <div className="nav-cta">
          <a className="nav-gh" href={REPO} target="_blank" rel="noreferrer">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor"><path d="M8 0a8 8 0 0 0-2.53 15.59c.4.07.55-.17.55-.38v-1.33c-2.23.48-2.7-1.07-2.7-1.07-.36-.92-.89-1.17-.89-1.17-.73-.5.05-.49.05-.49.8.06 1.23.83 1.23.83.72 1.22 1.87.87 2.33.66.07-.52.28-.87.5-1.07-1.78-.2-3.65-.89-3.65-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.22 2.2.82a7.6 7.6 0 0 1 4 0c1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.28.82 2.15 0 3.07-1.87 3.75-3.66 3.95.29.25.54.73.54 1.48v2.2c0 .21.15.46.55.38A8 8 0 0 0 8 0Z" /></svg>
            GitHub
          </a>
          <a className="btn btn-cream btn-sm" href="#waitlist">
            Get early access
          </a>
        </div>
      </div>
    </header>
  );
}

const IDEAS = [
  'RSVP for Tolu’s 30th — plus-ones and dietary needs',
  'Job application for a junior designer, with portfolio link',
  'Parent consent form for the school trip to Lekki',
  'Weekly check-in for my team: mood 1–5 and blockers',
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
          Build it
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M3 8h10M9 4l4 4-4 4" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
      </div>
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
    <section className="hero" id="top">
      <div className="hero-bg" aria-hidden>
        <div className="hero-grid" />
        <div className="hero-glow" />
      </div>
      <div className="wrap hero-top">
        <motion.a href="#where" className="hero-badge" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.7 }}>
          <span className="hb-live">
            <i /> in the works
          </span>
          <span className="hb-text">Works inside Google Forms &amp; Microsoft Forms</span>
          <span className="hb-arrow">→</span>
        </motion.a>

        <h1 className="hero-title">
          <span className="ht-line">
            <motion.span custom={0} variants={line} initial="hidden" animate="show">
              Say what you need.
            </motion.span>
          </span>
          <span className="ht-line">
            <motion.span custom={1} variants={line} initial="hidden" animate="show">
              It’s already a <em>form.</em>
            </motion.span>
          </span>
        </h1>

        <motion.div className="hero-row" initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.9, delay: 0.55 }}>
          {mobile ? (
            <div>
              <p className="hero-sub">
                Tell Intake what you want to ask people. It builds the form <b>in your own Google Forms or Microsoft Forms</b> and hands you the link.
              </p>
              <div className="hero-actions">
                <a className="btn btn-accent" href="#waitlist">
                  Get early access
                </a>
                <a className="btn btn-ghost" href="#try">
                  Try it
                </a>
              </div>
            </div>
          ) : (
            <>
              <p className="hero-sub">
                Tell Intake what you want to ask people. It builds the form for you <b>inside your own Google Forms or Microsoft Forms</b>, follow-up questions and all, then hands you the link. No dragging, no dropping, no settings to hunt for.
              </p>
              <HeroComposer />
            </>
          )}
        </motion.div>
      </div>

      {mobile && (
        <motion.div id="demo" initial={{ opacity: 0, y: 40 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1, delay: 0.6, ease: [0.22, 1, 0.36, 1] }}>
          <Stories />
          <p className="ms-hint">Tap to skip · hold to pause</p>
        </motion.div>
      )}

      {!mobile && (
      <motion.div className="wrap-wide hero-reel" id="demo" initial={{ opacity: 0, y: 60 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 1.2, delay: 0.7, ease: [0.22, 1, 0.36, 1] }}>
        <div className="reel-meta">
          <span>
            <i className="rec" /> Watch it make a real Google Form
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
  'Volunteer signup for Saturday’s cleanup',
  'RSVP with plus-ones',
  'Customer feedback, anonymous',
  'Hackathon registration with team size',
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
