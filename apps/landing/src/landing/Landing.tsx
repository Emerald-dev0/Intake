/**
 * The landing page.
 *
 * One idea runs through it: the line is the form. Tick draws a single stroke that starts at the
 * pencil in the hero, threads down the page and finishes in the footer, and wherever it meets
 * content it resolves into a form element — a ticked box, an open dropdown, a filled progress bar,
 * a submit button.
 *
 * Everything factual on this page comes from `src/content/site.ts`, `src/lib/plans.ts` and the FAQ
 * module, so the page cannot drift from the rest of the site or from what the product actually does.
 * Class names that carry behaviour the tests already guarantee (`.mk-faq-item`, `.mk-footer`,
 * `.mk-provider`, `.mk-reveal`, `.mk-marquee__*`, `.mk-menu-toggle`, `.mk-sheet`, `.mk-preview-switch`)
 * are kept on purpose; the visual system around them is new.
 */

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type ReactNode,
} from 'react';
import { Link } from 'react-router-dom';
import { ProviderMark } from '../app/components/ProviderBadge';
import { usePublicSession } from '../marketing/usePublicSession';
import { useSiteAnalytics } from '../lib/analytics';
import { PLAN_CATALOG, formatUsd, proPriceComparison } from '../lib/plans.ts';
import {
  FAQS,
  LIVE_PROVIDERS,
  PROMPT_EXAMPLES,
  ROADMAP_PROVIDERS,
  WORKFLOW_STEPS,
  CREATOR,
} from '../content/site.ts';
import { Tick, type MascotExpression, type MascotPose } from './Tick.tsx';
import { ScrollLine } from './ScrollLine.tsx';
import { raf, cancelRaf } from './frame.ts';

const NAV = [
  { label: 'How it works', href: '#how' },
  { label: 'Pricing', href: '#pricing' },
  { label: 'FAQ', href: '#faq' },
];

/** Pages that live outside the homepage. The changelog belongs in the bar, not only the footer. */
const PAGES = [
  { label: 'Changelog', href: '/changelog' },
  { label: 'Developers', href: '/developers' },
];

const SIGN_UP = '/auth/sign-up';
const comparison = proPriceComparison();
const FREE_CREDITS = PLAN_CATALOG.free.dailyCredits;
const PRO_MONTHLY_CREDITS = PLAN_CATALOG.pro.monthlyCredits;

/** Three things most form builders skip. Copy from the brief, verbatim in substance. */
const DIFFERENTIATORS = [
  {
    index: '01',
    title: 'Not another form builder',
    body: 'Intake writes the form, you approve it, and your own account hosts it. Your links. Your responses. Nothing lives on our platform.',
    tag: 'Your account, always',
    wide: true,
  },
  {
    index: '02',
    title: 'You approve every question',
    body: 'Describe what you want in a sentence. Intake comes back with the full list of questions. Change anything that feels off, then confirm once.',
    tag: 'Nothing is created before you say so',
    wide: false,
  },
  {
    index: '03',
    title: 'It can edit, too',
    body: 'Point Intake at a Google Form you already own, say what should change, and it updates that same form after you confirm. Typeform creation and import work today; editing a Typeform is next, and we say so rather than fake it.',
    tag: 'Same form, updated in place',
    wide: false,
  },
];

const FEATURES = [
  {
    index: '01',
    title: 'Form from a sentence',
    body: 'One description in plain English becomes a typed question list: short answer, paragraph, multiple choice, checkboxes, dropdown, required flags.',
    pills: ['Google Forms', 'Typeform'],
  },
  {
    index: '02',
    title: 'Review before it exists',
    body: 'The proposal is a document you read, not a preview you squint at. Every question, every answer type, every choice, before anything is real.',
    pills: ['Every question', 'Every time'],
  },
  {
    index: '03',
    title: 'Edit forms you already have',
    body: 'Pick a Google Form you made with Intake, or paste a link to one you own. Describe the change, confirm, and the same form is updated — no duplicate copy.',
    pills: ['Google Forms'],
  },
  {
    index: '04',
    title: 'Import your Typeforms',
    body: 'Existing Typeform links come into your library so everything you have made sits in one place.',
    pills: ['Typeform'],
  },
  {
    index: '05',
    title: 'Branching built in',
    body: 'Google sections and routing, or Typeform logic jumps, are written from the same description — with descriptions and required fields where they belong.',
    pills: ['Required fields', 'Descriptions'],
  },
  {
    index: '06',
    title: 'Response Insights',
    body: 'See how many people answered, what they picked and the most common phrases. Reads responses only when you ask it to, with a permission you grant separately.',
    pills: ['Pro, opening later'],
  },
  {
    index: '07',
    title: 'Spreadsheet sync',
    body: 'New responses land as rows in a Google Sheet Intake creates for you — or in one you already have, if you pick it.',
    pills: ['Pro, opening later'],
  },
];

const QUESTION_PILLS = [
  'Short answer', 'Paragraph', 'Multiple choice', 'Checkboxes', 'Dropdown',
  'Branching', 'Required', 'Descriptions',
];

const STATS = [
  { value: FREE_CREDITS, suffix: '', label: 'Credits per day on Free', note: 'Refreshed every day at 00:00 UTC.', bar: 0.9 },
  { value: 2, suffix: '', label: 'Credits for a standard form', note: 'One interpretation of one request.', bar: 0.36 },
  { value: 1, suffix: '', label: 'Credits for a simple edit', note: 'A tweak costs less than a build.', bar: 0.18 },
];

/* ------------------------------------------------------------------ small utilities */

function useReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() =>
    typeof window !== 'undefined' && typeof window.matchMedia === 'function'
      ? window.matchMedia('(prefers-reduced-motion: reduce)').matches
      : false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onChange = () => setReduced(query.matches);
    query.addEventListener('change', onChange);
    return () => query.removeEventListener('change', onChange);
  }, []);
  return reduced;
}

/**
 * Confetti, in the accent colour only.
 *
 * Inline elements with a CSS animation rather than a canvas: it is a few grams of delight, not a
 * rendering pipeline, and it disappears completely when motion is reduced.
 */
function burst(x: number, y: number, count = 18) {
  if (typeof document === 'undefined') return;
  const layer = document.createElement('div');
  layer.className = 'land-confetti-layer';
  layer.style.left = `${x}px`;
  layer.style.top = `${y}px`;
  document.body.appendChild(layer);
  for (let index = 0; index < count; index += 1) {
    const piece = document.createElement('i');
    const angle = (Math.PI * 2 * index) / count + Math.random() * 0.5;
    const distance = 40 + Math.random() * 90;
    piece.className = 'land-confetti';
    piece.style.setProperty('--tx', `${Math.cos(angle) * distance}px`);
    piece.style.setProperty('--ty', `${Math.sin(angle) * distance - 30}px`);
    piece.style.setProperty('--rot', `${Math.random() * 540 - 270}deg`);
    piece.style.animationDelay = `${Math.random() * 90}ms`;
    layer.appendChild(piece);
  }
  window.setTimeout(() => layer.remove(), 1400);
}

/** Magnetic pull: a button that leans toward the pointer and springs back. */
function useMagnetic(strength = 0.28) {
  const ref = useRef<HTMLAnchorElement | null>(null);
  const frame = useRef(0);
  const onMove = useCallback((event: { clientX: number; clientY: number }) => {
    const node = ref.current;
    if (!node || frame.current) return;
    const { clientX, clientY } = event;
    frame.current = raf(() => {
      frame.current = 0;
      const box = node.getBoundingClientRect();
      const dx = clientX - (box.left + box.width / 2);
      const dy = clientY - (box.top + box.height / 2);
      node.style.setProperty('--pull-x', `${dx * strength}px`);
      node.style.setProperty('--pull-y', `${dy * strength}px`);
    });
  }, [strength]);
  const reset = useCallback(() => {
    const node = ref.current;
    if (!node) return;
    node.style.setProperty('--pull-x', '0px');
    node.style.setProperty('--pull-y', '0px');
  }, []);
  useEffect(() => () => { if (frame.current) cancelRaf(frame.current); }, []);
  return { ref, onPointerMove: onMove, onPointerLeave: reset, onBlur: reset };
}

/** Adds `is-in` once an element has been seen, and never removes it. */
function useRevealContainer(enabled: boolean) {
  const root = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const node = root.current;
    if (!node) return;
    const targets = [...node.querySelectorAll<HTMLElement>('.mk-reveal')];
    if (!enabled || typeof IntersectionObserver !== 'function') {
      targets.forEach(target => target.classList.add('is-in'));
      return;
    }
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          entry.target.classList.add('is-in');
          observer.unobserve(entry.target);
        }
      });
    }, { rootMargin: '0px 0px -12% 0px', threshold: 0.08 });
    targets.forEach(target => observer.observe(target));
    return () => observer.disconnect();
  }, [enabled]);
  return root;
}

function useCountUp(target: number, active: boolean) {
  const [value, setValue] = useState(active ? target : 0);
  useEffect(() => {
    if (!active) { setValue(0); return; }
    let frame = 0;
    const start = performance.now();
    const run = (now: number) => {
      const progress = Math.min(1, (now - start) / 900);
      const eased = 1 - Math.pow(1 - progress, 3);
      setValue(Math.round(target * eased));
      if (progress < 1) frame = raf(run);
    };
    frame = raf(run);
    return () => cancelRaf(frame);
  }, [active, target]);
  return value;
}

/* ------------------------------------------------------------------ preloader */

function Preloader({ onDone, still }: { onDone: () => void; still: boolean }) {
  const [stage, setStage] = useState<'draw' | 'tick' | 'split'>('draw');
  useEffect(() => {
    if (still) { onDone(); return; }
    const tick = window.setTimeout(() => setStage('tick'), 780);
    const split = window.setTimeout(() => setStage('split'), 1320);
    const finish = window.setTimeout(onDone, 1980);
    return () => { window.clearTimeout(tick); window.clearTimeout(split); window.clearTimeout(finish); };
  }, [onDone, still]);

  return (
    <div
      className={`land-preloader is-${stage}`}
      role="status"
      aria-live="polite"
      onClick={onDone}
      onKeyDown={event => { if (event.key === 'Enter' || event.key === 'Escape') onDone(); }}
      tabIndex={0}
    >
      <div className="land-preloader__panel land-preloader__panel--top" />
      <div className="land-preloader__panel land-preloader__panel--bottom" />
      <div className="land-preloader__mark">
        <svg viewBox="0 0 120 60" aria-hidden>
          <rect className="land-preloader__box" x="6" y="6" width="48" height="48" rx="12" />
          <path className="land-preloader__tick" d="M18 30 l10 11 22 -26" />
          <text className="land-preloader__word" x="66" y="42">INTAKE</text>
        </svg>
      </div>
      <span className="land-preloader__skip">Tap to skip</span>
    </div>
  );
}

/* ------------------------------------------------------------------ top bar */

function TopBar({ authenticated }: { authenticated: boolean }) {
  const [hidden, setHidden] = useState(false);
  const [open, setOpen] = useState(false);
  const lastY = useRef(0);
  const sheetId = useId();

  useEffect(() => {
    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = raf(() => {
        frame = 0;
        const y = window.scrollY;
        setHidden(y > 160 && y > lastY.current + 4);
        lastY.current = y;
      });
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { window.removeEventListener('scroll', onScroll); if (frame) cancelRaf(frame); };
  }, []);

  return (
    <header className={`land-top${hidden ? ' is-hidden' : ''}${open ? ' is-open' : ''}`}>
      <a className="land-top__brand" href="#top" aria-label="Intake home">
        <span className="land-top__mark" aria-hidden>
          <svg viewBox="0 0 24 24"><rect x="2" y="4" width="20" height="17" rx="5" /><path d="M7 12.5 l3.4 3.6 7 -7.6" /></svg>
        </span>
        <span>Intake</span>
      </a>

      <nav className="mk-nav-links land-top__nav" aria-label="Sections">
        {NAV.map(item => <a key={item.href} href={item.href}>{item.label}</a>)}
        {PAGES.map(item => <Link key={item.href} to={item.href}>{item.label}</Link>)}
      </nav>

      <div className="mk-header__actions land-top__actions">
        {authenticated
          ? <Link className="mk-button--nav land-btn land-btn--ghost" to="/app">Open my forms</Link>
          : <Link className="mk-button--nav land-btn land-btn--accent" to={SIGN_UP}>Build my first form</Link>}
        <button
          type="button"
          className="mk-menu-toggle land-menu-toggle"
          aria-expanded={open}
          aria-controls={sheetId}
          aria-label={open ? 'Close menu' : 'Open menu'}
          onClick={() => setOpen(value => !value)}
        >
          <span /><span />
        </button>
      </div>

      <div id={sheetId} className={`mk-sheet land-sheet${open ? ' is-open' : ''}`} hidden={!open}>
        <div className="mk-sheet__panel">
          <nav aria-label="Menu">
            {NAV.map(item => (
              <a key={item.href} href={item.href} onClick={() => setOpen(false)}>{item.label}</a>
            ))}
            {PAGES.map(item => (
              <Link key={item.href} to={item.href} onClick={() => setOpen(false)}>{item.label}</Link>
            ))}
            <Link to={SIGN_UP} onClick={() => setOpen(false)}>Build my first form</Link>
          </nav>
        </div>
      </div>
    </header>
  );
}

/* ------------------------------------------------------------------ hero */

const PREVIEW_QUESTIONS = [
  { kind: 'short', title: 'What’s your name?', detail: 'Short answer · required' },
  { kind: 'choice', title: 'How did you hear about us?', detail: 'Multiple choice · 4 options' },
  { kind: 'paragraph', title: 'Anything else we should know?', detail: 'Paragraph' },
  { kind: 'check', title: 'Can we follow up by email?', detail: 'Checkboxes · Yes' },
];

const EDIT_CHANGES = [
  { change: 'Would you like a follow-up call?', note: 'Goes after “Overall satisfaction”' },
  { change: 'Change the rating question to a dropdown', note: 'Keeps every existing answer option' },
  { change: 'Make the last section optional', note: 'Nothing is removed from the form' },
];

function Hero({ authenticated }: { authenticated: boolean }) {
  const [typed, setTyped] = useState('');
  const [mode, setMode] = useState<'create' | 'edit'>('create');
  const [built, setBuilt] = useState(0);
  const reduced = useReducedMotion();
  const magnetic = useMagnetic();
  const [example, setExample] = useState(0);

  // The typing demo: type a prompt, hold it, delete it, move to the next one.
  useEffect(() => {
    if (reduced) { setTyped(PROMPT_EXAMPLES[0]); return; }
    let cancelled = false;
    let timer = 0;
    let index = 0;
    let phrase = 0;
    let deleting = false;
    const step = () => {
      if (cancelled) return;
      const target = PROMPT_EXAMPLES[phrase % PROMPT_EXAMPLES.length];
      if (!deleting) {
        index += 1;
        setTyped(target.slice(0, index));
        if (index >= target.length) { deleting = true; timer = window.setTimeout(step, 2200); return; }
        timer = window.setTimeout(step, 38 + Math.random() * 40);
        return;
      }
      index = Math.max(0, index - 3);
      setTyped(target.slice(0, index));
      if (index === 0) {
        deleting = false;
        phrase += 1;
        setExample(phrase % PROMPT_EXAMPLES.length);
        timer = window.setTimeout(step, 260);
        return;
      }
      timer = window.setTimeout(step, 18);
    };
    timer = window.setTimeout(step, 500);
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [reduced]);

  // The preview builds itself: one question at a time, then a pause and a restart.
  useEffect(() => {
    if (reduced) { setBuilt(PREVIEW_QUESTIONS.length); return; }
    const timers: number[] = [];
    const cycle = () => {
      setBuilt(0);
      PREVIEW_QUESTIONS.forEach((_, order) => {
        timers.push(window.setTimeout(() => setBuilt(order + 1), 520 + order * 520));
      });
      timers.push(window.setTimeout(cycle, 520 + PREVIEW_QUESTIONS.length * 520 + 3400));
    };
    cycle();
    return () => timers.forEach(timer => window.clearTimeout(timer));
  }, [reduced, mode]);

  return (
    <section className="mk-hero land-hero" id="top" data-line="hero" data-line-x="0.5" data-line-y="0.72">
      <div className="land-hero__badges mk-reveal">
        <span className="land-badge">Describe it. Review it. Done.</span>
        <span className="land-badge land-badge--quiet">Google Forms · Typeform</span>
        <span className="land-badge land-badge--quiet">Free to start</span>
      </div>

      <h1 className="land-hero__title mk-reveal">
        {'INTAKE'.split('').map((letter, index) => (
          <span key={`${letter}-${index}`} className="land-word__letter" style={{ '--i': index } as CSSProperties}>{letter}</span>
        ))}
      </h1>

      <p className="land-hero__headline mk-reveal">Tell Intake what you need. It builds the form.</p>
      <p className="land-hero__lede mk-reveal">
        Write it in plain English. Intake turns it into a real form in your own account — Google Forms
        and Typeform today, with SurveyMonkey, Google Sheets, Jira and n8n next. You see every question
        first, tweak whatever you like, and only then does it get created.
      </p>

      <div className="land-hero__actions mk-reveal">
        <Link ref={magnetic.ref} {...{ onPointerMove: magnetic.onPointerMove, onPointerLeave: magnetic.onPointerLeave }} className="land-btn land-btn--accent land-btn--lg" to={authenticated ? '/app' : SIGN_UP}>
          {authenticated ? 'Open my forms' : 'Build my first form'}
          <span className="land-btn__arrow" aria-hidden>→</span>
        </Link>
        <a className="land-btn land-btn--ghost land-btn--lg" href="#how">See how it works</a>
      </div>

      <div className="mk-providers land-hero__providers mk-reveal" aria-label="Works with">
        {LIVE_PROVIDERS.map(provider => (
          <span className="mk-provider land-provider" key={provider.name}>
            {provider.name === 'Google Forms'
              ? <svg viewBox="0 0 20 20" aria-hidden><rect x="2" y="3" width="16" height="14" rx="4" /><path d="M6 10l2.6 2.6L14 7.4" /></svg>
              : <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h14M3 10h9M3 15h11" /></svg>}
            <span>
              <strong>{provider.name}</strong>
              <small>{provider.name === 'Typeform' ? 'Create and import' : 'Create and edit in place'}</small>
            </span>
          </span>
        ))}
      </div>

      <div className="land-hero__stage mk-reveal">
        <div className="land-frame land-frame--hero">
          <div className="land-prompt" aria-label="Describe the form you need">
            <span className="land-prompt__label">What do you need to collect?</span>
            <p className="land-prompt__text" aria-hidden>{typed}<i className="land-caret" /></p>
            <div className="land-prompt__foot">
              <span>No sign-up needed to preview the questions.</span>
              <span className="land-mono">{String(example + 1).padStart(2, '0')} / {String(PROMPT_EXAMPLES.length).padStart(2, '0')}</span>
            </div>
          </div>

          <div className="land-device">
            <div className="land-device__bar">
              <span className="land-device__dots" aria-hidden><i /><i /><i /></span>
              <span className="land-device__name">
                Intake · {mode === 'create' ? 'proposal' : 'DRAFT'}
              </span>
              <div className="mk-preview-switch land-switch" role="group" aria-label="Preview mode">
                <button type="button" aria-pressed={mode === 'create'} onClick={() => setMode('create')}>Create</button>
                <button type="button" aria-pressed={mode === 'edit'} onClick={() => setMode('edit')}>Edit</button>
              </div>
            </div>

            {mode === 'create' ? (
              <ol className="land-device__list">
                {PREVIEW_QUESTIONS.map((question, order) => (
                  <li key={question.title} className={`land-question${built > order ? ' is-in' : ''}`}>
                    <span className="land-question__box" aria-hidden>
                      <svg viewBox="0 0 16 16"><path d="M3.5 8.5l3 3 6-7" /></svg>
                    </span>
                    <span className="land-question__body">
                      <strong>{question.title}</strong>
                      <small>{question.detail}</small>
                    </span>
                    <span className="land-mono land-question__index">{String(order + 1).padStart(2, '0')}</span>
                  </li>
                ))}
                <li className={`land-device__confirm${built >= PREVIEW_QUESTIONS.length ? ' is-in' : ''}`}>
                  <span>Nothing is created until you confirm.</span>
                  <span className="land-btn land-btn--sm land-btn--ink" aria-hidden>Confirm</span>
                </li>
              </ol>
            ) : (
              <ul className="land-device__changes">
                {EDIT_CHANGES.map((item, order) => (
                  <li key={item.change} style={{ '--i': order } as CSSProperties}>
                    <span className="land-mono">0{order + 1}</span>
                    <span>
                      <strong>{item.change}</strong>
                      <small>{item.note}</small>
                    </span>
                    <span className="land-tag">Plain English</span>
                  </li>
                ))}
                <li className="land-device__changes-note">
                  Same form. No duplicate copy. The change is applied only after you confirm.
                </li>
              </ul>
            )}
          </div>
        </div>

        <div className="land-hero__tick">
          <Tick pose="drawing" expression="happy" size={168} onPoke={anchor => burst(anchor.x, anchor.y)} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ providers */

function MonochromeRoadmapMark() {
  return <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden><circle cx="10" cy="10" r="6" opacity="0.85" /></svg>;
}

function ProviderStrip() {
  const [direction, setDirection] = useState(1);
  const last = useRef(0);
  useEffect(() => {
    const onScroll = () => {
      const y = window.scrollY;
      setDirection(y >= last.current ? 1 : -1);
      last.current = y;
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, []);

  const row = (
    <>
      <span className="land-strip__item">Works today</span>
      {LIVE_PROVIDERS.map(provider => (
        <span className="land-strip__item land-strip__item--live" key={provider.name}>
          <ProviderMark provider={provider.name === 'Google Forms' ? 'google' : 'typeform'} />{provider.name}
        </span>
      ))}
      <span className="land-strip__item land-strip__item--muted">Next up</span>
      {ROADMAP_PROVIDERS.map(provider => (
        <span className="land-strip__item" key={provider.name}>
          <MonochromeRoadmapMark />{provider.name}<em className="land-chip">planned</em>
        </span>
      ))}
    </>
  );

  return (
    <div className="land-strip mk-reveal" data-direction={direction} aria-label="Supported providers">
      <div className="mk-marquee__track land-strip__track">
        <div className="mk-marquee__row land-strip__row">{row}</div>
        <div className="mk-marquee__row land-strip__row" aria-hidden>{row}</div>
      </div>
      <p className="land-strip__caption">
        The next ones are labelled “planned” until they actually work. No pretending.
      </p>
    </div>
  );
}

/* ------------------------------------------------------------------ provider board */

/**
 * Which tools actually work, as a board rather than a logo wall.
 *
 * A row of brand marks implies support. This says it in words, puts the two live tools in their own
 * group, and labels the rest "planned" in a chip that no amount of squinting can miss.
 */
function Providers() {
  return (
    <section className="land-section land-providers" id="providers" data-line="providers">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>01</i> Providers</span>
        <h2>Your forms stay in your account.</h2>
        <p className="land-providers__lede">
          Intake writes to the tool you already use, after you connect it. Two live now. More in the queue.
        </p>
      </header>

      <div className="land-providers__board">
        <div className="mk-provider-board__group land-providers__group mk-reveal">
          <h3>Live today</h3>
          <ul>
            {LIVE_PROVIDERS.map(provider => (
              <li key={provider.name}>
                {provider.name === 'Google Forms'
                  ? <svg viewBox="0 0 20 20" aria-hidden><rect x="2" y="3" width="16" height="14" rx="4" /><path d="M6 10l2.6 2.6L14 7.4" /></svg>
                  : <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h14M3 10h9M3 15h11" /></svg>}
                <span>
                  <strong>{provider.name}</strong>
                  <small>{provider.detail}</small>
                </span>
              </li>
            ))}
          </ul>
        </div>

        <div className="mk-provider-board__group land-providers__group mk-reveal">
          <h3>Next in line <em className="land-chip">planned</em></h3>
          <ul>
            {ROADMAP_PROVIDERS.map(provider => (
              <li key={provider.name}>
                <svg viewBox="0 0 20 20" fill="currentColor" aria-hidden><circle cx="10" cy="10" r="6" opacity="0.8" /></svg>
                <span>
                  <strong>{provider.name}</strong>
                  <small>{provider.detail}</small>
                </span>
                <em className="land-chip">PLANNED</em>
              </li>
            ))}
          </ul>
          <p className="land-note">No dates, no fake votes. Write to support@intake.calder.click and say which one you need next.</p>
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ differentiators */

function Differentiators() {
  return (
    <section className="land-section land-section--dark" id="difference" data-line="difference">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>02</i> What most form builders skip</span>
        <h2>Three things we refused to leave out.</h2>
      </header>
      <div className="land-cards">
        {DIFFERENTIATORS.map(card => (
          <article key={card.index} className={`land-card mk-reveal${card.wide ? ' land-card--wide' : ''}`} data-cursor="Look">
            <span className="land-card__index land-mono">{card.index}</span>
            <h3>{card.title}</h3>
            <p>{card.body}</p>
            <footer className="land-card__caption">
              <span>{card.tag}</span>
              <span className="land-card__go" aria-hidden>↗</span>
            </footer>
          </article>
        ))}
        <article className="land-card land-card--art mk-reveal" aria-hidden>
          <Tick pose="sitting" expression="thinking" size={132} still />
        </article>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ how it works */

function HowItWorks() {
  return (
    <section className="land-section" id="how" data-line="how">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>03</i> How it works</span>
        <h2>Four steps. One sentence to start.</h2>
      </header>

      <ol className="land-steps">
        {WORKFLOW_STEPS.map((step, index) => (
          <li className="land-step mk-reveal" key={step.title}>
            <span className="land-step__index land-mono">{String(index + 1).padStart(2, '0')}</span>
            <div className="land-step__body">
              <h3>{step.title}</h3>
              <p>{step.body}</p>
            </div>
            <span className={`land-step__ui land-step__ui--${index}`} aria-hidden>
              {index === 0 && <span className="land-ui-type">RSVP for my birthday</span>}
              {index === 1 && <span className="land-ui-list"><i /><i /><i /></span>}
              {index === 2 && <span className="land-ui-toggle">Change anything</span>}
              {index === 3 && <span className="land-ui-confirm">Confirm</span>}
            </span>
          </li>
        ))}
      </ol>

      <div className="land-steps__mascot mk-reveal">
        <Tick pose="running" expression="happy" size={150} />
        <p className="land-note">Every step happens before anything is created. The confirmation is yours.</p>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ story */

const STORY_WORDS = 'Nobody wakes up excited to build a form. So we turned it into a sentence, and you stay in charge of every question.'.split(' ');

function Story() {
  const ref = useRef<HTMLDivElement>(null);
  const [lit, setLit] = useState(0);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    let frame = 0;
    const update = () => {
      frame = 0;
      const box = node.getBoundingClientRect();
      const span = box.height + window.innerHeight * 0.5;
      const travelled = (window.innerHeight * 0.85 - box.top) / span;
      setLit(Math.round(Math.min(1, Math.max(0, travelled)) * STORY_WORDS.length));
    };
    const onScroll = () => { if (!frame) frame = raf(update); };
    update();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) cancelRaf(frame);
    };
  }, []);

  return (
    <section className="land-section land-section--dark land-story" id="story" data-line="story">
      <span className="land-label mk-reveal"><i>04</i> Why this exists</span>
      <div className="land-story__grid" ref={ref}>
        <p className="land-story__text" aria-label={STORY_WORDS.join(' ')}>
          {STORY_WORDS.map((word, index) => (
            <span key={`${word}-${index}`} className={index < lit ? 'is-lit' : ''} aria-hidden>{word} </span>
          ))}
        </p>
        <div className="land-story__tick mk-reveal">
          <Tick pose="waving" expression="wink" size={196} onPoke={anchor => burst(anchor.x, anchor.y)} />
        </div>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ features */

function Features() {
  const [open, setOpen] = useState<string | null>(FEATURES[0].title);
  const scope = useId();
  return (
    <section className="land-section" id="features" data-line="features">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>05</i> What it does</span>
        <h2>Everything the form needs, before it exists.</h2>
      </header>

      <ul className="land-features">
        {FEATURES.map(feature => {
          const isOpen = open === feature.title;
          return (
            <li
              key={feature.title}
              className={`land-feature mk-reveal${isOpen ? ' is-open' : ''}`}
              onMouseEnter={() => setOpen(feature.title)}
              onFocus={() => setOpen(feature.title)}
            >
              <button
                type="button"
                aria-expanded={isOpen}
                aria-controls={`${scope}-feature-${feature.index}`}
                onClick={() => setOpen(isOpen ? null : feature.title)}
              >
                <span className="land-feature__index land-mono">{feature.index}</span>
                <span className="land-feature__title">{feature.title}</span>
                <span className="land-feature__pills">
                  {feature.pills.map(pill => <em key={pill} className="land-tag">{pill}</em>)}
                </span>
                <span className="land-feature__plus" aria-hidden />
              </button>
              <div id={`${scope}-feature-${feature.index}`} className="land-feature__panel" hidden={!isOpen}>
                <p>{feature.body}</p>
              </div>
            </li>
          );
        })}
      </ul>

      <div className="land-pills mk-reveal" aria-label="Question types">
        <span className="land-label land-label--inline">Question types</span>
        {QUESTION_PILLS.map(pill => <span key={pill} className="land-tag land-tag--lg">{pill}</span>)}
      </div>

      <div className="land-features__tick mk-reveal">
        <Tick pose="sitting" expression="neutral" size={128} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ proof */

function Stat({ stat, index }: { stat: typeof STATS[number]; index: number }) {
  const ref = useRef<HTMLDivElement>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    const node = ref.current;
    if (!node) return;
    if (typeof IntersectionObserver !== 'function') { setSeen(true); return; }
    const observer = new IntersectionObserver(entries => {
      if (entries.some(entry => entry.isIntersecting)) { setSeen(true); observer.disconnect(); }
    }, { threshold: 0.4 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  const value = useCountUp(stat.value, seen);

  return (
    <div className="land-stat mk-reveal" ref={ref} style={{ '--i': index } as CSSProperties}>
      <span className="land-stat__value">{value}<i aria-hidden>→</i></span>
      <span className="land-stat__label">{stat.label}</span>
      <span className="land-bar" aria-hidden><i className={seen ? 'is-in' : ''} style={{ '--fill': stat.bar } as CSSProperties} /></span>
      <span className="land-stat__note">{stat.note}</span>
    </div>
  );
}

function Proof() {
  return (
    <section className="land-section land-section--dark" id="proof" data-line="proof">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>06</i> The free allowance</span>
        <h2>Enough free credits for real, everyday use.</h2>
      </header>
      <div className="land-stats">
        {STATS.map((stat, index) => <Stat key={stat.label} stat={stat} index={index} />)}
      </div>
      <p className="land-note mk-reveal">
        A credit is one interpretation of a request. The exact cost is shown before you confirm, and a
        request Intake cannot carry out costs nothing.
      </p>
    </section>
  );
}

/* ------------------------------------------------------------------ pricing */

function Pricing() {
  return (
    <section className="land-section" id="pricing" data-line="pricing">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>07</i> Pricing</span>
        <h2>Free while it is being built. Honest about what comes next.</h2>
      </header>

      <div className="land-price">
        <article className="land-plan land-plan--free mk-reveal">
          <span className="land-plan__name">Free · $0</span>
          <h3>{FREE_CREDITS} credits every day.</h3>
          <ul>
            <li>Create forms from a description</li>
            <li>Edit the Google Forms you own</li>
            <li>Keep a library of everything you make</li>
            <li>Review before anything is applied</li>
          </ul>
          <p className="land-plan__note">No card needed.</p>
          <Link className="mk-button--nav land-btn land-btn--accent" to={SIGN_UP}>Build my first form</Link>
        </article>

        <article className="land-plan land-plan--pro mk-reveal">
          <span className="land-plan__name">Pro · opening later</span>
          <h3>Not on sale yet.</h3>
          <p>
            When it opens it will be {formatUsd(comparison.monthlyCents)} a month or{' '}
            {formatUsd(comparison.annualCents)} a year, with {PRO_MONTHLY_CREDITS.toLocaleString()} extra credits
            each month on top of your {FREE_CREDITS} daily ones.
          </p>
          <ul>
            <li>Everything in Free stays exactly the same</li>
            <li>Response Insights and spreadsheet sync</li>
            <li>{PRO_MONTHLY_CREDITS.toLocaleString()} monthly credits, on top of the daily pot</li>
          </ul>
          <Link className="land-btn land-btn--ghost" to="/pricing">See the pricing page</Link>
        </article>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ privacy */

function PrivacyStrip() {
  return (
    <section className="land-privacy" data-line="privacy">
      <span className="land-label"><i>08</i> Your account, your data</span>
      <p className="mk-reveal">
        Signing in only shares your name, email and profile. Intake can’t touch your forms until you
        connect a provider yourself, and you can disconnect any time. It never asks for Gmail, Calendar
        or Contacts.
      </p>
      <Link className="land-link" to="/trust">How permissions work →</Link>
    </section>
  );
}

/* ------------------------------------------------------------------ faq */

function Faq() {
  const [open, setOpen] = useState<string | null>(null);
  // `useId` keeps the panels unique even if two copies of the page are mounted (a route
  // transition, or a test rendering the page twice into one document).
  const scope = useId();
  return (
    <section className="land-section land-faq" id="faq" data-line="faq">
      <header className="land-section__head mk-reveal">
        <span className="land-label"><i>09</i> Questions</span>
        <h2>Anything else you were about to ask.</h2>
      </header>
      <div className="land-faq__list">
        {FAQS.map((item, index) => {
          const isOpen = open === item.question;
          const id = `${scope}-faq-${index}`;
          return (
            <div className={`mk-faq-item land-faq__item${isOpen ? ' is-open' : ''}`} key={item.question}>
              <h3>
                <button
                  type="button"
                  id={`${id}-button`}
                  aria-expanded={isOpen}
                  aria-controls={`${id}-panel`}
                  onClick={() => setOpen(isOpen ? null : item.question)}
                >
                  <span>{item.question}</span>
                  <span className="land-faq__icon" aria-hidden><i /><i /></span>
                </button>
              </h3>
              <div
                className="mk-faq-item__panel land-faq__panel"
                id={`${id}-panel`}
                role="region"
                aria-labelledby={`${id}-button`}
                inert={!isOpen}
              >
                <p>{item.answer}</p>
              </div>
            </div>
          );
        })}
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ final cta */

function FinalCta({ authenticated, onDone }: { authenticated: boolean; onDone: (point: { x: number; y: number }) => void }) {
  const magnetic = useMagnetic(0.2);
  return (
    <section className="land-cta" id="start" data-line="cta">
      <h2 className="land-cta__title mk-reveal">Stop building forms.<br />Start describing them.</h2>
      <p className="land-cta__sub mk-reveal">Free to try. No card. You approve every question.</p>
      <div className="land-cta__actions mk-reveal">
        <Link
          ref={magnetic.ref}
          className="land-btn land-btn--accent land-btn--xl"
          to={authenticated ? '/app' : SIGN_UP}
          onPointerMove={magnetic.onPointerMove}
          onPointerLeave={magnetic.onPointerLeave}
          onPointerEnter={event => {
            const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
            onDone({ x: box.left + box.width / 2, y: box.top });
          }}
        >
          {authenticated ? 'Open my forms' : 'Build my first form'}
        </Link>
        <a className="land-btn land-btn--ghost land-btn--xl" href="#how">See how it works</a>
      </div>
      <div className="land-cta__tick">
        <Tick pose="celebrating" expression="happy" size={200} onPoke={onDone} />
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ footer */

/** The giant wordmark, dropped and bounced with a small spring simulation. */
function FooterWordmark({ still }: { still: boolean }) {
  const letters = useMemo(() => 'INTAKE'.split(''), []);
  const wrap = useRef<HTMLSpanElement>(null);
  const nodes = useRef<Array<HTMLSpanElement | null>>([]);
  const state = useRef(letters.map((_, index) => ({ y: -60 - index * 8, v: 0, rot: 0, vr: 0 })));

  useEffect(() => {
    if (still) {
      nodes.current.forEach(node => { if (node) node.style.transform = 'translateY(0)'; });
      return;
    }
    let frame = 0;
    let last = performance.now();

    /**
     * The simulation is idle-aware: once every letter has settled it stops requesting frames and
     * waits for the next push. A landing page that spins a rAF loop forever costs battery on a
     * phone and keeps any embedding process alive.
     */
    const tick = (now: number) => {
      const dt = Math.min(32, now - last) / 16.67;
      last = now;
      let moving = false;
      state.current.forEach((letter, index) => {
        const node = nodes.current[index];
        if (!node) return;
        letter.v += 1.6 * dt;
        letter.y += letter.v * dt;
        if (letter.y > 0) {
          letter.y = 0;
          letter.v = -letter.v * 0.42;
          letter.vr += (Math.random() - 0.5) * 0.4;
          if (Math.abs(letter.v) < 0.6) letter.v = 0;
        }
        letter.rot += letter.vr * dt;
        letter.rot *= 0.94;
        node.style.transform = `translateY(${letter.y.toFixed(2)}px) rotate(${letter.rot.toFixed(2)}deg)`;
        if (Math.abs(letter.y) > 0.05 || Math.abs(letter.v) > 0.05 || Math.abs(letter.rot) > 0.05) moving = true;
      });
      frame = moving ? raf(tick) : 0;
    };
    frame = raf(tick);

    const push = (event: PointerEvent) => {
      const host = wrap.current;
      if (!host) return;
      const box = host.getBoundingClientRect();
      if (event.clientY < box.top - 60 || event.clientY > box.bottom + 60) return;
      state.current.forEach((letter, index) => {
        const node = nodes.current[index];
        if (!node) return;
        const letterBox = node.getBoundingClientRect();
        const centre = letterBox.left + letterBox.width / 2;
        const distance = event.clientX - centre;
        if (Math.abs(distance) < 90) {
          const force = (1 - Math.abs(distance) / 90) * 9;
          letter.v -= force;
          letter.vr += (distance / 90) * 0.9;
        }
      });
      // A push wakes the simulation again if it had settled.
      if (!frame) frame = raf(tick);
    };
    window.addEventListener('pointermove', push, { passive: true });
    return () => {
      if (frame) cancelRaf(frame);
      window.removeEventListener('pointermove', push);
    };
  }, [still, letters]);

  return (
    <span className="land-footer__word" ref={wrap} aria-label="Intake">
      {letters.map((letter, index) => (
        <span
          key={`${letter}-${index}`}
          ref={node => { nodes.current[index] = node; }}
          aria-hidden
        >{letter}</span>
      ))}
    </span>
  );
}

function Footer({ authenticated, onConfetti }: { authenticated: boolean; onConfetti: (point: { x: number; y: number }) => void }) {
  const reduced = useReducedMotion();
  const fired = useRef(false);
  const ref = useRef<HTMLElement>(null);

  // The line ends here: a "Submitted" burst the first time the footer is reached.
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(entries => {
      if (!entries.some(entry => entry.isIntersecting) || fired.current) return;
      fired.current = true;
      if (!reduced) {
        const box = node.getBoundingClientRect();
        onConfetti({ x: box.left + box.width / 2, y: box.top + 80 });
      }
    }, { threshold: 0.15 });
    observer.observe(node);
    return () => observer.disconnect();
  }, [onConfetti, reduced]);

  return (
    <footer className="mk-footer land-footer" ref={ref}>
      <div className="land-footer__top">
        <FooterWordmark still={reduced} />
        <span className="land-footer__stamp">Submitted</span>
      </div>

      <div className="land-footer__grid">
        <div className="mk-footer__column">
          <h2>Product</h2>
          <Link to={SIGN_UP}>Create a form</Link>
          <Link to="/app">Library</Link>
          <Link to="/pricing">Pricing</Link>
          <a href="#features">Features</a>
        </div>
        <div className="mk-footer__column">
          <h2>Resources</h2>
          <a href="#how">How it works</a>
          <Link to="/templates">Templates</Link>
          <Link to="/guides">Guides</Link>
          <Link to="/changelog">Changelog</Link>
          <Link to="/developers">Developers</Link>
        </div>
        <div className="mk-footer__column">
          <h2>Legal</h2>
          <Link to="/privacy">Privacy</Link>
          <Link to="/terms">Terms</Link>
          <Link to="/trust">Trust and permissions</Link>
          <a href="mailto:support@intake.calder.click">support@intake.calder.click</a>
        </div>
        <div className="mk-footer__column mk-footer__column--providers">
          <h2>Providers</h2>
          <div className="land-footer__provider">
            <svg viewBox="0 0 20 20" aria-hidden><rect x="2" y="3" width="16" height="14" rx="4" /><path d="M6 10l2.6 2.6L14 7.4" /></svg>
            <span><strong>Google Forms</strong><small>Create and edit in place</small></span>
          </div>
          <div className="land-footer__provider">
            <svg viewBox="0 0 20 20" aria-hidden><path d="M3 5h14M3 10h9M3 15h11" /></svg>
            <span><strong>Typeform</strong><small>Create and import</small></span>
          </div>
        </div>
      </div>

      <div className="land-footer__bottom">
        <p className="mk-footer__credit">
          Designed by <a href={CREATOR.site}>Emerald</a> · Email by Calder
        </p>
        <p className="land-footer__meta">
          © {new Date().getFullYear()} Intake · An Intake product by Calder
          {authenticated ? <> · <Link to="/app">Your library</Link></> : null}
        </p>
      </div>
    </footer>
  );
}

/* ------------------------------------------------------------------ pill nav */

const PILL_SECTIONS = [
  { id: 'top', label: 'Top', index: '01' },
  { id: 'how', label: 'How it works', index: '02' },
  { id: 'features', label: 'Features', index: '03' },
  { id: 'proof', label: 'Credits', index: '04' },
  { id: 'pricing', label: 'Pricing', index: '05' },
  { id: 'faq', label: 'FAQ', index: '06' },
];

function PillNav() {
  const [active, setActive] = useState('top');
  const [progress, setProgress] = useState(0);

  useEffect(() => {
    const sections = PILL_SECTIONS
      .map(section => document.getElementById(section.id))
      .filter((node): node is HTMLElement => Boolean(node));
    const observer = typeof IntersectionObserver === 'function'
      ? new IntersectionObserver(entries => {
        const visible = entries.filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(visible.target.id);
      }, { threshold: [0.2, 0.5] })
      : null;
    sections.forEach(section => observer?.observe(section));

    let frame = 0;
    const onScroll = () => {
      if (frame) return;
      frame = raf(() => {
        frame = 0;
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        setProgress(scrollable > 0 ? Math.min(1, window.scrollY / scrollable) : 0);
      });
    };
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => { observer?.disconnect(); window.removeEventListener('scroll', onScroll); if (frame) cancelRaf(frame); };
  }, []);

  const circumference = 2 * Math.PI * 15;

  return (
    <nav className="land-pill" aria-label="Page sections">
      <span className="land-pill__ring" aria-hidden>
        <svg viewBox="0 0 36 36"><circle cx="18" cy="18" r="15" /><circle className="land-pill__ring-fill" cx="18" cy="18" r="15" strokeDasharray={circumference} strokeDashoffset={circumference * (1 - progress)} /></svg>
      </span>
      <ul>
        {PILL_SECTIONS.map(section => (
          <li key={section.id}>
            <a
              href={`#${section.id}`}
              className={active === section.id ? 'is-active' : ''}
              aria-current={active === section.id ? 'true' : undefined}
            >
              <span className="land-mono">{section.index}</span>
              <span className="land-pill__label">{section.label}</span>
            </a>
          </li>
        ))}
      </ul>
    </nav>
  );
}

/* ------------------------------------------------------------------ cursor */

function Cursor() {
  const dot = useRef<HTMLDivElement>(null);
  const [label, setLabel] = useState('');
  const reduced = useReducedMotion();
  const fine = useMemo(() => typeof window !== 'undefined' && window.matchMedia?.('(pointer: fine)').matches, []);

  useEffect(() => {
    if (reduced || !fine) return;
    let x = window.innerWidth / 2;
    let y = window.innerHeight / 2;
    let vx = 0;
    let frame = 0;
    const move = (event: PointerEvent) => {
      const nextX = event.clientX;
      const nextY = event.clientY;
      vx = nextX - x;
      x = nextX;
      y = nextY;
      const target = (event.target as HTMLElement | null)?.closest('[data-cursor]');
      setLabel(target ? (target as HTMLElement).dataset.cursor ?? '' : '');
      if (dot.current) {
        dot.current.style.transform = `translate3d(${x}px, ${y}px, 0) scale(${1 + Math.min(0.25, Math.abs(vx) / 60)})`;
      }
      if (!frame) {
        frame = raf(() => { frame = 0; vx *= 0.6; });
      }
    };
    window.addEventListener('pointermove', move, { passive: true });
    return () => { window.removeEventListener('pointermove', move); if (frame) cancelRaf(frame); };
  }, [fine, reduced]);

  if (!fine) return null;

  return (
    <div ref={dot} className={`land-cursor${label ? ' has-label' : ''}`} aria-hidden>
      <span>{label}</span>
    </div>
  );
}

/* ------------------------------------------------------------------ the page */

export default function Landing() {
  const authenticated = usePublicSession();
  useSiteAnalytics('/');
  const reduced = useReducedMotion();
  const [loading, setLoading] = useState(() => {
    if (typeof window === 'undefined') return false;
    try { return window.sessionStorage.getItem('intake:landing-seen') !== '1'; } catch { return true; }
  });
  const [trick, setTrick] = useState<{ pose: MascotPose; expression: MascotExpression; key: number } | null>(null);
  const revealRoot = useRevealContainer(!reduced);

  const finishLoading = useCallback(() => {
    setLoading(false);
    try { window.sessionStorage.setItem('intake:landing-seen', '1'); } catch { /* private mode */ }
  }, []);

  const poke = useCallback((anchor: { x: number; y: number }) => {
    if (!reduced) burst(anchor.x, anchor.y);
    const poses: Array<{ pose: MascotPose; expression: MascotExpression }> = [
      { pose: 'celebrating', expression: 'happy' },
      { pose: 'idle', expression: 'surprised' },
      { pose: 'waving', expression: 'wink' },
    ];
    const next = poses[Math.floor(Math.random() * poses.length)];
    setTrick({ ...next, key: Date.now() });
    window.setTimeout(() => setTrick(null), 1400);
  }, [reduced]);

  return (
    <div className={`land${reduced ? ' is-still' : ''}`} ref={revealRoot}>
      <a className="skip-link" href="#main-content">Skip to main content</a>
      {loading && <Preloader onDone={finishLoading} still={reduced} />}

      <ScrollLine still={reduced} />
      <Cursor />
      <TopBar authenticated={authenticated} />

      <main id="main-content" tabIndex={-1}>
        <Hero authenticated={authenticated} />
        <ProviderStrip />
        <Providers />
        <Differentiators />
        <HowItWorks />
        <Story />
        <Features />
        <Proof />
        <Pricing />
        <PrivacyStrip />
        <Faq />
        <FinalCta authenticated={authenticated} onDone={poke} />
        {trick && (
          <div className="land-trick" aria-hidden>
            <Tick pose={trick.pose} expression={trick.expression} size={120} trick="hop" trickKey={trick.key} still={reduced} />
          </div>
        )}
        <Footer authenticated={authenticated} onConfetti={poke} />
      </main>

      <PillNav />
    </div>
  );
}

/** Kept for callers that want the section list without importing the page. */
export const LANDING_SECTIONS = PILL_SECTIONS;

/** A tiny helper used by the mobile action bar on the old homepage; kept so imports stay stable. */
export function LandingLink({ children, href }: { children: ReactNode; href: string }) {
  return <a className="land-link" href={href}>{children}</a>;
}
