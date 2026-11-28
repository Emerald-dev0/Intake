import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type ReactNode } from 'react';
import { HugeiconsIcon, type IconSvgElement } from '@hugeicons/react';
import {
  CheckmarkCircle02Icon,
  CheckmarkSquare02Icon,
  CircleArrowDown01Icon,
  Coins01Icon,
  InputShortTextIcon,
  PauseIcon,
  PlayIcon,
  QuillWrite01Icon,
  RadioButtonIcon,
  Search01Icon,
  TaskEdit01Icon,
  TextAlignLeftIcon,
  UserCheck01Icon,
} from '@hugeicons/core-free-icons';
import { HERO_DEMO_PROMPTS, type DemoProposal } from '../content/site';
import { LogoMark } from '../components/LogoMark';
import { GoogleFormsLogo, PlannedProviderLogo, TypeformLogo, type PlannedProviderName } from '../components/ProviderLogos';

/**
 * The hero, as a story that plays itself: one sentence in, a form out.
 *
 *   1. You write. A plain-English request types itself into the card.
 *   2. Intake reads it. The phrases that matter light up, and a thread drops from each one into
 *      the Intake mark. One phrase, one question.
 *   3. Intake drafts. The questions appear in a draft. Nothing exists anywhere yet.
 *   4. You confirm. A cursor presses Confirm. This beat is the product: nothing is created until
 *      you say so.
 *   5. It is created, in the provider you picked. The thread to that provider lights up and its
 *      tile says so. Planned providers stay dim on dashed threads and never light up.
 *
 * Three real worked examples rotate (the same ones the "try it" box uses), alternating Google
 * Forms and Typeform. There is a pause button and example tabs, so the motion is never forced.
 *
 * Threads are measured, not drawn by hand: an SVG overlay reads the positions of the phrases, the
 * mark, the draft and the tiles, and joins them with curves. So the composition can be laid out
 * with ordinary CSS grid at every width, including the stacked phone layout, and the threads
 * always land where they should. Draw-in and pulses are `stroke-dashoffset` on `pathLength="1"`.
 *
 * Reduced motion: no typing, no loop, no pulses. It shows the "waiting for your OK" frame of the
 * first example with every thread drawn, and the tabs still switch examples.
 */

type ProviderId = 'google-forms' | 'typeform';
type Segment = string | { phrase: string };

type Example = {
  id: string;
  tab: string;
  title: string;
  segments: Segment[];
  proposal: DemoProposal;
  target: ProviderId;
};

const PROVIDER_NAME: Record<ProviderId, string> = { 'google-forms': 'Google Forms', typeform: 'Typeform' };

function proposalFor(prompt: string): DemoProposal {
  return HERO_DEMO_PROMPTS.find(item => item.prompt === prompt) ?? HERO_DEMO_PROMPTS[0]!;
}

/** Each highlighted phrase becomes the question at the same position in the proposal. */
const EXAMPLES: Example[] = [
  {
    id: 'feedback',
    tab: 'Customer feedback',
    title: 'Customer feedback',
    segments: ['Customer feedback form for a SaaS product. Ask ', { phrase: 'how satisfied people are' }, ', ', { phrase: 'what they liked' }, ', ', { phrase: 'what could improve' }, ', and whether they’d ', { phrase: 'recommend it' }, '.'],
    proposal: proposalFor('Customer feedback survey'),
    target: 'google-forms',
  },
  {
    id: 'rsvp',
    tab: 'Birthday RSVP',
    title: 'Birthday RSVP',
    segments: ['RSVP for my birthday. Ask for ', { phrase: 'their name' }, ', ', { phrase: 'how many are coming' }, ', ', { phrase: 'any allergies' }, ', and ', { phrase: 'a song for the playlist' }, '.'],
    proposal: proposalFor('RSVP for my birthday'),
    target: 'typeform',
  },
  {
    id: 'club',
    tab: 'Club sign-up',
    title: 'Student club sign-up',
    segments: ['Student club sign-up. Collect their ', { phrase: 'full name' }, ' and ', { phrase: 'email' }, ', their ', { phrase: 'department' }, ', and ', { phrase: 'which teams' }, ' they want to join.'],
    proposal: proposalFor('Student club sign-up'),
    target: 'google-forms',
  },
];

const PHASES = ['typing', 'reading', 'drafting', 'confirm', 'created', 'leaving'] as const;
type Phase = (typeof PHASES)[number];

/** How long each beat holds once it has started. Typing ends on its own when the text is done. */
const HOLD: Record<Exclude<Phase, 'typing'>, number> = {
  reading: 1700,
  drafting: 1900,
  confirm: 1700,
  created: 2900,
  leaving: 650,
};

const KIND_ICON: Record<string, IconSvgElement> = {
  'Multiple choice': RadioButtonIcon,
  Paragraph: TextAlignLeftIcon,
  'Short answer': InputShortTextIcon,
  Dropdown: CircleArrowDown01Icon,
  Checkboxes: CheckmarkSquare02Icon,
};

const LIVE: Array<{ id: ProviderId; detail: string }> = [
  { id: 'google-forms', detail: 'Create and edit in place' },
  { id: 'typeform', detail: 'Create and import' },
];
const SOON: Array<{ id: PlannedProviderName; name: string }> = [
  { id: 'surveymonkey', name: 'SurveyMonkey' },
  { id: 'googlesheets', name: 'Google Sheets' },
  { id: 'jira', name: 'Jira' },
  { id: 'n8n', name: 'n8n' },
];

function flatText(segments: Segment[]) {
  return segments.map(segment => (typeof segment === 'string' ? segment : segment.phrase)).join('');
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

function Icon({ icon, size = 16 }: { icon: IconSvgElement; size?: number }) {
  return <HugeiconsIcon icon={icon} size={size} strokeWidth={1.6} aria-hidden="true" focusable="false" />;
}

/** Renders the sentence with phrase spans, cut off after `count` characters. */
function Sentence({ segments, count, phraseRefs }: { segments: Segment[]; count: number; phraseRefs?: (index: number, node: HTMLSpanElement | null) => void }) {
  let remaining = count;
  let phraseIndex = -1;
  const out: ReactNode[] = [];
  segments.forEach((segment, index) => {
    const text = typeof segment === 'string' ? segment : segment.phrase;
    const visible = text.slice(0, Math.max(0, remaining));
    remaining -= text.length;
    if (typeof segment === 'string') {
      out.push(<span key={index}>{visible}</span>);
    } else {
      phraseIndex += 1;
      const current = phraseIndex;
      out.push(
        <span
          key={index}
          className="mk-flow__phrase"
          style={{ '--i': current } as CSSProperties}
          ref={phraseRefs ? node => phraseRefs(current, node) : undefined}
        >
          {visible}
        </span>,
      );
    }
  });
  return <>{out}</>;
}

type Geometry = {
  w: number;
  h: number;
  inPaths: string[];
  stem: string;
  out: Array<{ id: string; d: string; live: boolean }>;
};

const EMPTY_GEOMETRY: Geometry = { w: 0, h: 0, inPaths: [], stem: '', out: [] };

function rel(node: Element, origin: DOMRect) {
  const rect = node.getBoundingClientRect();
  return {
    left: rect.left - origin.left,
    top: rect.top - origin.top,
    right: rect.right - origin.left,
    bottom: rect.bottom - origin.top,
    cx: rect.left - origin.left + rect.width / 2,
    cy: rect.top - origin.top + rect.height / 2,
    width: rect.width,
    height: rect.height,
  };
}

const r = (value: number) => Math.round(value * 10) / 10;

export function HeroFlow() {
  const [reduced] = useState(prefersReducedMotion);
  const [exampleIndex, setExampleIndex] = useState(0);
  const [phase, setPhase] = useState<Phase>(reduced ? 'confirm' : 'typing');
  const [typed, setTyped] = useState(reduced ? Number.POSITIVE_INFINITY : 0);
  const [playing, setPlaying] = useState(!reduced);
  const [onScreen, setOnScreen] = useState(true);
  const [cycle, setCycle] = useState(0);
  const [geometry, setGeometry] = useState<Geometry>(EMPTY_GEOMETRY);

  const example = EXAMPLES[exampleIndex]!;
  const text = useMemo(() => flatText(example.segments), [example]);
  const phaseIndex = PHASES.indexOf(phase);
  const running = playing && onScreen && !reduced;

  const figureRef = useRef<HTMLElement | null>(null);
  const markRef = useRef<HTMLDivElement | null>(null);
  const draftRef = useRef<HTMLDivElement | null>(null);
  const phraseNodes = useRef<Array<HTMLSpanElement | null>>([]);
  const tileNodes = useRef<Map<string, HTMLLIElement | null>>(new Map());

  const setPhraseRef = useCallback((index: number, node: HTMLSpanElement | null) => {
    phraseNodes.current[index] = node;
  }, []);
  const setTileRef = useCallback((id: string) => (node: HTMLLIElement | null) => {
    tileNodes.current.set(id, node);
  }, []);

  /* ---- the loop -------------------------------------------------------- */

  // Typing: two characters every 34ms, then the reading beat starts.
  useEffect(() => {
    if (!running || phase !== 'typing') return;
    if (typed >= text.length) {
      const next = window.setTimeout(() => setPhase('reading'), 380);
      return () => window.clearTimeout(next);
    }
    const tick = window.setTimeout(() => setTyped(count => count + 2), typed === 0 ? 650 : 34);
    return () => window.clearTimeout(tick);
  }, [phase, running, text.length, typed]);

  // Every other beat holds for its time, then hands over.
  useEffect(() => {
    if (!running || phase === 'typing') return;
    const timer = window.setTimeout(() => {
      if (phase === 'leaving') {
        setExampleIndex(index => (index + 1) % EXAMPLES.length);
        setTyped(0);
        setCycle(value => value + 1);
        setPhase('typing');
      } else {
        setPhase(PHASES[phaseIndex + 1]!);
      }
    }, HOLD[phase]);
    return () => window.clearTimeout(timer);
  }, [phase, phaseIndex, running]);

  // Off screen, the loop and every CSS animation hold still.
  useEffect(() => {
    const node = figureRef.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);

  const choose = (index: number) => {
    setExampleIndex(index);
    setCycle(value => value + 1);
    if (reduced) {
      setTyped(Number.POSITIVE_INFINITY);
      setPhase('confirm');
    } else {
      setTyped(0);
      setPhase('typing');
      setPlaying(true);
    }
  };

  /* ---- measured threads ------------------------------------------------ */

  const measure = useCallback(() => {
    const figure = figureRef.current;
    const mark = markRef.current;
    const draft = draftRef.current;
    if (!figure || !mark || !draft) return;
    const origin = figure.getBoundingClientRect();
    if (!origin.width) return;
    const m = rel(mark, origin);
    const d = rel(draft, origin);

    const phrases = phraseNodes.current.filter((node): node is HTMLSpanElement => Boolean(node));
    const inPaths = phrases.map((node, index) => {
      // The last line box of the phrase: where its underline sits.
      const rects = node.getClientRects();
      const box = rects[rects.length - 1] ?? node.getBoundingClientRect();
      const sx = box.left - origin.left + box.width / 2;
      const sy = box.bottom - origin.top - 2;
      const ex = m.cx + (index - (phrases.length - 1) / 2) * 12;
      const ey = m.top + 14;
      const dy = ey - sy;
      return `M${r(sx)} ${r(sy)} C ${r(sx)} ${r(sy + dy * 0.62)}, ${r(ex)} ${r(ey - dy * 0.5)}, ${r(ex)} ${r(ey)}`;
    });

    const stemStartY = m.bottom - 12;
    const stemEndY = d.top + 12;
    const stem = `M${r(m.cx)} ${r(stemStartY)} C ${r(m.cx + 18)} ${r(stemStartY + 30)}, ${r(d.cx - 14)} ${r(stemEndY - 30)}, ${r(d.cx)} ${r(stemEndY)}`;

    const out: Geometry['out'] = [];
    tileNodes.current.forEach((node, id) => {
      if (!node) return;
      const t = rel(node, origin);
      const live = node.dataset.live === 'true';
      if (t.top > d.bottom - 8) {
        // Stacked layout: the tile sits below the draft.
        const sx = Math.min(Math.max(t.cx, d.left + 36), d.right - 36);
        const sy = d.bottom - 10;
        const ey = t.top + 12;
        const dy = ey - sy;
        out.push({ id, live, d: `M${r(sx)} ${r(sy)} C ${r(sx)} ${r(sy + dy * 0.55)}, ${r(t.cx)} ${r(ey - dy * 0.5)}, ${r(t.cx)} ${r(ey)}` });
        return;
      }
      const leftSide = t.cx < d.cx;
      const sx = leftSide ? d.left + 10 : d.right - 10;
      const sy = Math.min(Math.max(t.cy, d.top + 56), d.bottom - 56);
      const ex = leftSide ? t.right - 12 : t.left + 12;
      const ey = t.cy;
      const dx = ex - sx;
      out.push({ id, live, d: `M${r(sx)} ${r(sy)} C ${r(sx + dx * 0.55)} ${r(sy)}, ${r(ex - dx * 0.45)} ${r(ey)}, ${r(ex)} ${r(ey)}` });
    });

    setGeometry({ w: r(origin.width), h: r(origin.height), inPaths, stem, out });
  }, []);

  useLayoutEffect(() => { measure(); }, [measure, exampleIndex]);

  useEffect(() => {
    const figure = figureRef.current;
    if (!figure) return;
    // requestAnimationFrame where it exists; a plain timeout in environments without it.
    const raf = typeof window.requestAnimationFrame === 'function'
      ? (fn: () => void) => window.requestAnimationFrame(fn)
      : (fn: () => void) => window.setTimeout(fn, 16);
    const cancel = typeof window.cancelAnimationFrame === 'function'
      ? (id: number) => window.cancelAnimationFrame(id)
      : (id: number) => window.clearTimeout(id);
    let frame = 0;
    const schedule = () => {
      cancel(frame);
      frame = raf(measure);
    };
    const observer = typeof ResizeObserver === 'function' ? new ResizeObserver(schedule) : null;
    observer?.observe(figure);
    if (draftRef.current) observer?.observe(draftRef.current);
    window.addEventListener('resize', schedule);
    document.fonts?.ready.then(schedule).catch(() => undefined);
    return () => {
      observer?.disconnect();
      window.removeEventListener('resize', schedule);
      cancel(frame);
    };
  }, [measure]);

  /* ---- render ---------------------------------------------------------- */

  const targetName = PROVIDER_NAME[example.target];
  const status: Record<Phase, { icon: IconSvgElement; text: string }> = {
    typing: { icon: QuillWrite01Icon, text: 'You write' },
    reading: { icon: Search01Icon, text: 'Reading your request' },
    drafting: { icon: TaskEdit01Icon, text: `${example.proposal.questions.length} questions drafted` },
    confirm: { icon: UserCheck01Icon, text: 'Waiting for your OK' },
    created: { icon: CheckmarkCircle02Icon, text: `Created in ${targetName}` },
    leaving: { icon: CheckmarkCircle02Icon, text: `Created in ${targetName}` },
  };

  const classes = [
    'mk-flow',
    `is-${phase}`,
    phaseIndex >= 1 ? 'has-read' : '',
    phaseIndex >= 2 ? 'has-draft' : '',
    phaseIndex >= 3 ? 'has-confirm' : '',
    phaseIndex >= 4 ? 'has-created' : '',
    `targets-${example.target}`,
    running || reduced ? '' : 'is-paused',
    reduced ? 'is-static' : '',
  ].filter(Boolean).join(' ');

  const sentenceDone = typed >= text.length;
  const current = status[phase];

  return (
    <figure className={classes} ref={figureRef} aria-labelledby="mk-flow-caption">
      <p className="mk-sr-only">
        Example: you write “{flatText(EXAMPLES[0]!.segments)}” Intake drafts four questions for you to check. Nothing is created until you confirm, then the form appears in Google Forms.
      </p>

      {/* Threads sit under every card, so their ends tuck neatly behind what they join. */}
      <svg
        key={`${exampleIndex}-${cycle}`}
        className="mk-flow__threads"
        width={geometry.w}
        height={geometry.h}
        viewBox={`0 0 ${geometry.w || 1} ${geometry.h || 1}`}
        aria-hidden="true"
        focusable="false"
      >
        <g className="mk-flow__lines-out">
          {geometry.out.map(line => (
            <path
              key={line.id}
              d={line.d}
              className={`mk-thread ${line.live ? 'mk-thread--live' : 'mk-thread--soon'}${line.id === example.target ? ' is-target' : ''}`}
            />
          ))}
        </g>
        <g className="mk-flow__lines-in">
          {geometry.inPaths.map((d, index) => (
            <path key={index} d={d} pathLength={1} className="mk-thread mk-thread--live mk-thread--draw" style={{ '--i': index } as CSSProperties} />
          ))}
          {geometry.stem && <path d={geometry.stem} pathLength={1} className="mk-thread mk-thread--live mk-thread--draw mk-thread--stem" />}
        </g>
        <g className="mk-flow__pulses">
          {geometry.inPaths.map((d, index) => (
            <path key={index} d={d} pathLength={1} className="mk-thread-pulse mk-thread-pulse--in" style={{ '--i': index } as CSSProperties} />
          ))}
          {geometry.stem && <path d={geometry.stem} pathLength={1} className="mk-thread-pulse mk-thread-pulse--stem" />}
          {geometry.out.filter(line => line.id === example.target).map(line => (
            <path key={line.id} d={line.d} pathLength={1} className="mk-thread-pulse mk-thread-pulse--out" />
          ))}
        </g>
      </svg>

      {/* 1. You write */}
      <div className="mk-flow__request" aria-hidden="true">
        <div className="mk-flow__request-head">
          <span><Icon icon={QuillWrite01Icon} size={14} /> Your request</span>
          <span><Icon icon={Coins01Icon} size={14} /> 1 credit</span>
        </div>
        <p className="mk-flow__sentence">
          <span className="mk-flow__sentence-stack">
            {/* The full sentence reserves the height and carries the thread anchors. */}
            <span className="mk-flow__sentence-ghost">“<Sentence segments={example.segments} count={text.length} phraseRefs={setPhraseRef} />”</span>
            <span className="mk-flow__sentence-typed" key={`${exampleIndex}-${cycle}`}>
              “<Sentence segments={example.segments} count={typed} />{sentenceDone ? '”' : ''}
              {!sentenceDone && <i className="mk-caret" />}
            </span>
          </span>
        </p>
      </div>

      {/* 2. Intake reads */}
      <div className="mk-flow__core" aria-hidden="true">
        <div className="mk-flow__mark" ref={markRef}>
          <span className="mk-flow__orbit" />
          <span className="mk-flow__mark-tile"><LogoMark size={44} /></span>
        </div>
        <span className="mk-flow__status" key={phase}>
          <Icon icon={current.icon} size={14} />
          {current.text}
        </span>
      </div>

      {/* 3–4. Intake drafts, you confirm */}
      <div className="mk-flow__draft" ref={draftRef} aria-hidden="true">
        <div className="mk-flow__draft-head">
          <span>What Intake understood</span>
          <span className="mk-flow__chip">{phaseIndex >= 4 ? 'Created' : 'Draft'}</span>
        </div>
        <p className="mk-flow__draft-title" key={`t-${exampleIndex}-${cycle}`}>{example.title}</p>
        <ol className="mk-flow__questions" key={`q-${exampleIndex}-${cycle}`}>
          {example.proposal.questions.map((question, index) => (
            <li key={question.title} style={{ '--i': index } as CSSProperties}>
              <span className="mk-flow__q-skeleton" />
              <span className="mk-flow__q-body">
                <span className="mk-flow__q-number">{String(index + 1).padStart(2, '0')}</span>
                <span className="mk-flow__q-icon"><Icon icon={KIND_ICON[question.kind] ?? TextAlignLeftIcon} size={15} /></span>
                <span className="mk-flow__q-text">
                  <strong>{question.title}</strong>
                  <small>{question.kind}</small>
                </span>
              </span>
            </li>
          ))}
        </ol>
        <div className="mk-flow__draft-foot">
          <span className="mk-flow__note">
            <span className="mk-flow__note-wait">Nothing exists yet. Change anything.</span>
            <span className="mk-flow__note-done"><Icon icon={CheckmarkCircle02Icon} size={14} /> Created in {targetName}</span>
          </span>
          <span className="mk-flow__confirm">
            <span>Confirm</span>
            <svg className="mk-flow__cursor" viewBox="0 0 24 24" width="22" height="22" focusable="false">
              <path d="M5 3.2 19 12l-6.1 1.3 3.4 6.4-2.7 1.4-3.4-6.5L5.5 19z" fill="#1b1a17" stroke="#fff" strokeWidth="1.4" strokeLinejoin="round" />
            </svg>
          </span>
        </div>
      </div>

      {/* 5. Where it lands. Live providers in their own colours, planned ones monochrome. */}
      <ul className="mk-providers mk-flow__tiles" aria-label="Live today">
        {LIVE.map(provider => (
          <li
            key={provider.id}
            ref={setTileRef(provider.id)}
            data-live="true"
            className={`mk-provider mk-flow-tile mk-flow-tile--live mk-flow-tile--${provider.id}${provider.id === example.target ? ' is-target' : ''}`}
          >
            <span className="mk-flow-tile__body">
              <span className="mk-flow-tile__icon">
                {provider.id === 'google-forms'
                  ? <GoogleFormsLogo size={26} label={null} />
                  : <TypeformLogo height={10} tone="mono" tight label={null} />}
              </span>
              <span className="mk-flow-tile__text">
                <strong>{PROVIDER_NAME[provider.id]}</strong>
                <small>{provider.detail}</small>
              </span>
              <span className="mk-flow-tile__badge" aria-hidden="true">Created</span>
            </span>
          </li>
        ))}
      </ul>
      <ul className="mk-flow__tiles mk-flow__tiles--soon" aria-label="Next in line">
        {SOON.map(provider => (
          <li key={provider.id} ref={setTileRef(provider.id)} data-live="false" className={`mk-flow-tile mk-flow-tile--soon mk-flow-tile--${provider.id}`}>
            <span className="mk-flow-tile__body">
              <span className="mk-flow-tile__icon" aria-hidden="true"><PlannedProviderLogo name={provider.id} size={18} /></span>
              <strong>{provider.name}</strong>
              <em>Soon</em>
            </span>
          </li>
        ))}
      </ul>

      <figcaption id="mk-flow-caption" className="mk-flow__caption">
        <span><span className="mk-flow__legend mk-flow__legend--live" aria-hidden="true" />Google Forms and Typeform today.</span>{' '}
        <span><span className="mk-flow__legend mk-flow__legend--soon" aria-hidden="true" />SurveyMonkey, Google Sheets, Jira and n8n are next in line.</span>
      </figcaption>

      <div className="mk-flow__controls">
        <div className="mk-flow__tabs" role="group" aria-label="Choose an example">
          {EXAMPLES.map((item, index) => (
            <button key={item.id} type="button" aria-pressed={index === exampleIndex} onClick={() => choose(index)}>
              {item.tab}
              <span className="mk-flow__tab-provider">{PROVIDER_NAME[item.target]}</span>
            </button>
          ))}
        </div>
        {!reduced && (
          <button
            type="button"
            className="mk-flow__play"
            onClick={() => setPlaying(value => !value)}
            aria-label={playing ? 'Pause the example' : 'Play the example'}
          >
            <Icon icon={playing ? PauseIcon : PlayIcon} size={15} />
          </button>
        )}
      </div>
    </figure>
  );
}
