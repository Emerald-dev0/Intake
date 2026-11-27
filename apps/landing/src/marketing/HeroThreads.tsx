import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { LogoMark } from '../components/LogoMark';
import { GoogleFormsLogo, PlannedProviderLogo, TypeformLogo, type PlannedProviderName } from '../components/ProviderLogos';

/**
 * The hero diagram: one sentence in, forms out.
 *
 * A plain-English request types itself out, orange threads carry it down into the Intake mark,
 * and from the mark the threads branch out to providers. Live providers are solid paper tiles on
 * full-strength threads that carry a pulse. Planned providers are dimmer tiles on dashed grey
 * threads that never carry one, so the roadmap reads as intent, not as support.
 *
 * How it is built:
 *   - Threads are SVG paths in a 1200×500 viewBox. The stage has the same aspect ratio, so the
 *     tiles (absolutely positioned HTML, as percentages of the same box) always sit on the
 *     thread ends at every width. Thread ends are hidden under the tiles.
 *   - The draw-in uses `stroke-dashoffset` on `pathLength="1"`; the pulse is a second, short dash
 *     on the same path. Pure CSS, no animation library.
 *   - Typing finishes first, then the threads draw. Off screen, every loop pauses.
 *   - Reduced motion: the sentence is written out in full, the threads are drawn statically, and
 *     there is no pulse or float.
 *   - Below 820px the same markup becomes a vertical flow: sentence, a thread, the mark, a thread,
 *     then a two-column grid of providers.
 */

export const HERO_SENTENCE = 'Customer feedback form for a SaaS product. Ask what people liked, what could improve, and whether they’d recommend it.';

const VIEW_W = 1200;
const VIEW_H = 500;

/** Where the request threads enter the mark. The sentence card sits directly above y = 0. */
const IN_THREADS = [
  'M470 0 C 468 64, 552 92, 586 160',
  'M602 0 C 618 54, 584 104, 600 156',
  'M738 0 C 734 76, 644 88, 614 160',
] as const;

type LiveTile = {
  kind: 'live';
  id: 'google-forms' | 'typeform';
  name: string;
  detail: string;
  x: number;
  y: number;
  path: string;
};
type SoonTile = {
  kind: 'soon';
  id: PlannedProviderName;
  name: string;
  x: number;
  y: number;
  path: string;
};

/**
 * Hand-tuned curves, deliberately uneven: no two leave the mark at the same angle, and the left
 * and right halves do not mirror each other.
 */
const LIVE_TILES: LiveTile[] = [
  { kind: 'live', id: 'google-forms', name: 'Google Forms', detail: 'Create and edit in place', x: 250, y: 176, path: 'M600 190 C 520 132, 420 238, 250 176' },
  { kind: 'live', id: 'typeform', name: 'Typeform', detail: 'Create and import', x: 952, y: 214, path: 'M600 190 C 690 258, 812 150, 952 214' },
];

const SOON_TILES: SoonTile[] = [
  { kind: 'soon', id: 'surveymonkey', name: 'SurveyMonkey', x: 136, y: 372, path: 'M600 190 C 520 300, 330 262, 136 372' },
  { kind: 'soon', id: 'googlesheets', name: 'Google Sheets', x: 404, y: 446, path: 'M600 190 C 572 318, 452 344, 404 446' },
  { kind: 'soon', id: 'jira', name: 'Jira', x: 816, y: 430, path: 'M600 190 C 664 286, 742 392, 816 430' },
  { kind: 'soon', id: 'n8n', name: 'n8n', x: 1072, y: 352, path: 'M600 190 C 742 330, 930 262, 1072 352' },
];

function position(x: number, y: number, index: number): CSSProperties {
  return {
    '--x': `${(x / VIEW_W) * 100}%`,
    '--y': `${(y / VIEW_H) * 100}%`,
    '--i': index,
  } as CSSProperties;
}

function prefersReducedMotion() {
  return typeof window !== 'undefined'
    && typeof window.matchMedia === 'function'
    && window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/** Types the request once. Returns the visible slice and whether it has finished. */
function useTypedSentence(text: string, startDelay = 700) {
  // Decided before the first paint, so the sentence never flashes in full and then clears.
  const [reduced] = useState(prefersReducedMotion);
  const [shown, setShown] = useState(reduced ? text : '');
  const [done, setDone] = useState(reduced);

  useEffect(() => {
    if (reduced) return;
    let index = 0;
    let interval = 0;
    const start = window.setTimeout(() => {
      interval = window.setInterval(() => {
        index += 2;
        setShown(text.slice(0, index));
        if (index >= text.length) {
          window.clearInterval(interval);
          setDone(true);
        }
      }, 34);
    }, startDelay);
    return () => {
      window.clearTimeout(start);
      window.clearInterval(interval);
    };
  }, [reduced, startDelay, text]);

  return { shown, done };
}

/** Pauses every loop in the diagram while it is off screen. */
function useOnScreen<T extends HTMLElement>() {
  const ref = useRef<T | null>(null);
  const [onScreen, setOnScreen] = useState(true);
  useEffect(() => {
    const node = ref.current;
    if (!node || typeof IntersectionObserver !== 'function') return;
    const observer = new IntersectionObserver(([entry]) => setOnScreen(Boolean(entry?.isIntersecting)), { threshold: 0 });
    observer.observe(node);
    return () => observer.disconnect();
  }, []);
  return [ref, onScreen] as const;
}

function LiveLogo({ id }: { id: LiveTile['id'] }) {
  return id === 'google-forms'
    ? <GoogleFormsLogo size={22} label={null} />
    : <TypeformLogo height={17} label={null} />;
}

/** A short vertical thread for the stacked mobile layout. */
function DropThread({ variant }: { variant: 'in' | 'out' }) {
  const d = variant === 'in' ? 'M30 0 C 12 18, 46 34, 30 56' : 'M30 0 C 46 20, 14 36, 30 56';
  return (
    <svg className={`mk-threads__drop mk-threads__drop--${variant}`} viewBox="0 0 60 56" aria-hidden="true" focusable="false">
      <path className="mk-thread mk-thread--live mk-thread--draw" d={d} pathLength={1} />
      <path className="mk-thread-pulse" d={d} pathLength={1} />
    </svg>
  );
}

export function HeroThreads() {
  const { shown, done } = useTypedSentence(HERO_SENTENCE);
  const [ref, onScreen] = useOnScreen<HTMLElement>();

  const classes = [
    'mk-threads',
    done ? 'is-drawn' : '',
    onScreen ? '' : 'is-paused',
  ].filter(Boolean).join(' ');

  return (
    <figure className={classes} ref={ref} aria-labelledby="mk-threads-caption">
      {/* 1. The sentence */}
      <div className="mk-threads__request">
        <div className="mk-threads__request-head">
          <span>YOUR REQUEST</span>
          <span>1 credit</span>
        </div>
        <p className="mk-threads__sentence">
          {/* Screen readers get the whole sentence once; the typing is visual only. */}
          <span className="mk-sr-only">“{HERO_SENTENCE}”</span>
          <span className="mk-threads__sentence-stack" aria-hidden="true">
            <span className="mk-threads__sentence-ghost">“{HERO_SENTENCE}”</span>
            <span className="mk-threads__sentence-typed">
              “{shown}{done ? '”' : ''}
              {!done && <i className="mk-caret" />}
            </span>
          </span>
        </p>
      </div>

      <DropThread variant="in" />

      {/* 2–4. Threads in, the mark, threads out */}
      <div className="mk-threads__stage">
        <svg className="mk-threads__svg" viewBox={`0 0 ${VIEW_W} ${VIEW_H}`} preserveAspectRatio="xMidYMid meet" aria-hidden="true" focusable="false">
          <g className="mk-threads__soon-lines">
            {SOON_TILES.map(tile => (
              <path key={tile.id} className="mk-thread mk-thread--soon" d={tile.path} />
            ))}
          </g>
          <g className="mk-threads__in">
            {IN_THREADS.map((d, index) => (
              <path key={d} className="mk-thread mk-thread--live mk-thread--draw" d={d} pathLength={1} style={{ '--i': index } as CSSProperties} />
            ))}
          </g>
          <g className="mk-threads__out">
            {LIVE_TILES.map((tile, index) => (
              <path key={tile.id} className="mk-thread mk-thread--live mk-thread--draw mk-thread--out" d={tile.path} pathLength={1} style={{ '--i': index } as CSSProperties} />
            ))}
          </g>
          {/* The travelling light: request → mark, then mark → live providers. */}
          <g className="mk-threads__pulses">
            {IN_THREADS.map((d, index) => (
              <path key={d} className="mk-thread-pulse" d={d} pathLength={1} style={{ '--p': `${index * 120}ms` } as CSSProperties} />
            ))}
            {LIVE_TILES.map((tile, index) => (
              <path key={tile.id} className="mk-thread-pulse mk-thread-pulse--out" d={tile.path} pathLength={1} style={{ '--p': `${1500 + index * 160}ms` } as CSSProperties} />
            ))}
          </g>
        </svg>

        <div className="mk-threads__core" aria-hidden="true">
          <span className="mk-threads__core-ring" />
          <span className="mk-threads__core-tile"><LogoMark size={46} /></span>
        </div>

        <DropThread variant="out" />

        <ul className="mk-providers mk-threads__tiles mk-threads__tiles--live" aria-label="Live today">
          {LIVE_TILES.map((tile, index) => (
            <li key={tile.id} className="mk-provider mk-thread-tile mk-thread-tile--live" style={position(tile.x, tile.y, index)}>
              <span className="mk-thread-tile__body">
                <LiveLogo id={tile.id} />
                <span>
                  <strong>{tile.name}</strong>
                  <small>{tile.detail}</small>
                </span>
              </span>
            </li>
          ))}
        </ul>

        <ul className="mk-threads__tiles mk-threads__tiles--soon" aria-label="Next in line">
          {SOON_TILES.map((tile, index) => (
            <li key={tile.id} className="mk-thread-tile mk-thread-tile--soon" style={position(tile.x, tile.y, index + 2)}>
              <span className="mk-thread-tile__body">
                <span className="mk-thread-tile__mark" aria-hidden="true"><PlannedProviderLogo name={tile.id} size={16} /></span>
                <strong>{tile.name}</strong>
                <em>Soon</em>
              </span>
            </li>
          ))}
        </ul>
      </div>

      <figcaption id="mk-threads-caption" className="mk-threads__caption">
        <span><span className="mk-threads__legend mk-threads__legend--live" aria-hidden="true" />Google Forms and Typeform today.</span>{' '}
        <span><span className="mk-threads__legend mk-threads__legend--soon" aria-hidden="true" />SurveyMonkey, Google Sheets, Jira and n8n are next in line.</span>
      </figcaption>
    </figure>
  );
}
