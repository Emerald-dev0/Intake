/**
 * Tick — Intake's mascot, as one rig rather than six drawings.
 *
 * The head is a rounded checkbox; the checkmark is the face. Poses are transform values applied to
 * named groups, expressions swap three small groups (eyes, brows, mouth), so every pose inherits the
 * same silhouette and the same 3px stroke. See docs/mascot.md for the brief and the rig map.
 *
 * Everything is drawn from CSS variables, so the character follows the page theme without a second
 * copy of its colours.
 */

import { useEffect, useRef, useState, type CSSProperties } from 'react';

export type MascotPose = 'idle' | 'waving' | 'sitting' | 'drawing' | 'running' | 'celebrating';
export type MascotExpression = 'neutral' | 'happy' | 'thinking' | 'surprised' | 'wink';

interface PoseTransforms {
  body: string;
  head: string;
  armLeft: string;
  armRight: string;
  handLeft: string;
  handRight: string;
  legLeft: string;
  legRight: string;
  prop: string;
}

/**
 * Poses as transforms, not as paths.
 *
 * Rotations are around joints set in CSS (`transform-origin`), and every value is a whole-degree
 * offset so the silhouette stays on-model. The head only ever tilts; the body does the acting.
 */
const POSES: Record<MascotPose, PoseTransforms> = {
  idle: {
    body: 'translate(0, 0)',
    head: 'rotate(-3deg)',
    armLeft: 'rotate(8deg)',
    armRight: 'rotate(-8deg)',
    handLeft: 'translate(0, 0)',
    handRight: 'translate(0, 0)',
    legLeft: 'rotate(2deg)',
    legRight: 'rotate(-2deg)',
    prop: 'rotate(-18deg)',
  },
  waving: {
    body: 'translate(0, 1px) rotate(1.5deg)',
    head: 'rotate(-6deg)',
    armLeft: 'rotate(6deg)',
    armRight: 'rotate(-118deg)',
    handLeft: 'translate(0, 0)',
    handRight: 'translate(1px, -1px)',
    legLeft: 'rotate(3deg)',
    legRight: 'rotate(-3deg)',
    prop: 'rotate(-46deg)',
  },
  sitting: {
    body: 'translate(0, 8px)',
    head: 'rotate(-5deg)',
    armLeft: 'rotate(34deg)',
    armRight: 'rotate(-26deg)',
    handLeft: 'translate(1px, 1px)',
    handRight: 'translate(0, 1px)',
    legLeft: 'rotate(74deg)',
    legRight: 'rotate(62deg)',
    prop: 'rotate(-64deg)',
  },
  drawing: {
    body: 'translate(0, 1px) rotate(3deg)',
    head: 'rotate(-9deg)',
    armLeft: 'rotate(16deg)',
    armRight: 'rotate(-34deg)',
    handLeft: 'translate(0, 1px)',
    handRight: 'translate(2px, 2px)',
    legLeft: 'rotate(4deg)',
    legRight: 'rotate(-4deg)',
    prop: 'rotate(18deg)',
  },
  running: {
    body: 'translate(0, -1px) rotate(-4deg)',
    head: 'rotate(-6deg)',
    armLeft: 'rotate(-52deg)',
    armRight: 'rotate(46deg)',
    handLeft: 'translate(0, -1px)',
    handRight: 'translate(0, 1px)',
    legLeft: 'rotate(38deg)',
    legRight: 'rotate(-42deg)',
    prop: 'rotate(-8deg)',
  },
  celebrating: {
    body: 'translate(0, -3px)',
    head: 'rotate(4deg)',
    armLeft: 'rotate(-148deg)',
    armRight: 'rotate(148deg)',
    handLeft: 'translate(0, -2px)',
    handRight: 'translate(0, -2px)',
    legLeft: 'rotate(12deg)',
    legRight: 'rotate(-12deg)',
    prop: 'rotate(26deg)',
  },
};

export interface MascotProps {
  pose?: MascotPose;
  expression?: MascotExpression;
  /** Rendered width in pixels; the SVG keeps its 120×140 proportions. */
  size?: number;
  flip?: boolean;
  className?: string;
  /** Called with the head or the pencil clicked. The page fires a confetti burst. */
  onPoke?: (anchor: { x: number; y: number }) => void;
  /** Turn off blinking and cursor tracking (the page passes this for reduced motion). */
  still?: boolean;
  /** The trick to play after a poke; the page keeps `trickKey` changing to replay it. */
  trick?: 'spin' | 'hop' | 'backflip' | null;
  trickKey?: number;
}

/**
 * Behaviour outside the drawing: blinking, cursor tracking, and the idle sway.
 *
 * Kept in the component rather than a separate hook file because the state is tiny and every
 * consumer of the rig wants the same three things.
 */
function useTickLife(still: boolean) {
  const [blink, setBlink] = useState(false);
  const [tilt, setTilt] = useState({ head: 0, pupils: 0 });
  const root = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (still) return;
    let timer = 0;
    let cancelled = false;
    const schedule = () => {
      // 3–6 seconds, with the occasional double blink.
      const wait = 3000 + Math.random() * 3000;
      timer = window.setTimeout(() => {
        if (cancelled) return;
        setBlink(true);
        window.setTimeout(() => { if (!cancelled) setBlink(false); }, 130);
        if (Math.random() < 0.2) {
          window.setTimeout(() => {
            setBlink(true);
            window.setTimeout(() => { if (!cancelled) setBlink(false); }, 110);
          }, 220);
        }
        schedule();
      }, wait);
    };
    schedule();
    return () => { cancelled = true; window.clearTimeout(timer); };
  }, [still]);

  useEffect(() => {
    if (still) return;
    let frame = 0;
    const onMove = (event: PointerEvent) => {
      if (frame) return;
      frame = window.requestAnimationFrame(() => {
        frame = 0;
        const node = root.current;
        if (!node) return;
        const box = node.getBoundingClientRect();
        const centreX = box.left + box.width / 2;
        const centreY = box.top + box.height / 2;
        const dx = Math.max(-1, Math.min(1, (event.clientX - centreX) / 320));
        const dy = Math.max(-1, Math.min(1, (event.clientY - centreY) / 320));
        setTilt({ head: dx * 6 + dy * 2, pupils: dx * 3 });
      });
    };
    window.addEventListener('pointermove', onMove, { passive: true });
    return () => {
      window.removeEventListener('pointermove', onMove);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [still]);

  return { blink, tilt, root };
}

/** The eyes and brows: the part of the face that carries the expression. */
function Face({ expression, blink, pupilShift }: { expression: MascotExpression; blink: boolean; pupilShift: number }) {
  const closed = blink || expression === 'wink';
  const wide = expression === 'surprised';
  const thinking = expression === 'thinking';
  const happy = expression === 'happy';

  return (
    <g id="eyes" className="tick__eyes">
      {/* Brows: only the thinking and surprised faces raise them. */}
      <g id="brows" className={`tick__brows is-${expression}`}>
        <path d="M38 34 q7 -5 14 -1" />
        <path d="M68 33 q7 -4 14 0" />
      </g>

      {happy ? (
        // A ticked box is a happy eye: two small checks instead of two pupils.
        <g id="eye-happy" className="tick__tick-eyes">
          <path d="M36 46 l7 7 12 -14" />
          <path d="M66 46 l7 7 12 -14" />
        </g>
      ) : (
        <>
          <rect id="eye-left" className={`tick__eye${thinking ? ' is-empty' : ''}`} x="40" y="41" width="16" height={wide ? 16 : 14} rx="4" />
          <rect id="eye-right" className={`tick__eye${thinking ? ' is-empty' : ''}`} x="62" y="39" width="18" height={wide ? 17 : 15} rx="4" />
          {!thinking && !closed && (
            <>
              <circle id="pupil-left" className="tick__pupil" cx={48 + pupilShift} cy={wide ? 49 : 48} r={wide ? 4.4 : 3.6} />
              <circle id="pupil-right" className="tick__pupil" cx={71 + pupilShift} cy={wide ? 47.5 : 46.5} r={wide ? 4.6 : 3.8} />
            </>
          )}
          {/* Lids: the blink is a filled rect growing down over the eye, not a scale. */}
          <g id="lid-left" className={`tick__lid${closed ? ' is-closed' : ''}`}>
            <rect x="40" y="41" width="16" height="14" rx="4" />
          </g>
          <g id="lid-right" className={`tick__lid${closed ? ' is-closed' : ''}`}>
            <rect x="62" y="39" width="18" height="15" rx="4" />
          </g>
        </>
      )}

      <g id="mouth" className={`tick__mouth is-${expression}`}>
        {expression === 'surprised' ? <ellipse cx="58" cy="68" rx="4.6" ry="6" />
          : expression === 'thinking' ? <path d="M49 68 h17" />
            : expression === 'wink' ? <path d="M48 66 q10 8 20 1" />
              : expression === 'happy' ? <path d="M47 65 q11 11 22 0" />
                : <path d="M49 67 q9 6 18 0" />}
      </g>
    </g>
  );
}

export function Tick({
  pose = 'idle',
  expression = 'neutral',
  size = 200,
  flip = false,
  className = '',
  onPoke,
  still = false,
  trick = null,
  trickKey = 0,
}: MascotProps) {
  const { blink, tilt, root } = useTickLife(still);
  const transforms = POSES[pose];
  const [ticks, setTicks] = useState(false);

  // The head ticks on a poke, then unticks a moment later.
  useEffect(() => {
    if (!trickKey) return;
    setTicks(true);
    const timer = window.setTimeout(() => setTicks(false), 900);
    return () => window.clearTimeout(timer);
  }, [trickKey]);

  const style = {
    width: size,
    '--tick-head-tilt': `${tilt.head}deg`,
    '--tick-pupil-shift': `${tilt.pupils}px`,
  } as CSSProperties;

  return (
    <span
      ref={root}
      className={`tick tick--${pose}${trick ? ` is-trick-${trick}` : ''}${flip ? ' is-flipped' : ''}${still ? ' is-still' : ''}${className ? ` ${className}` : ''}`}
      style={style}
    >
      <svg viewBox="0 0 120 148" width={size} height={(size * 148) / 120} role="img" aria-label="Tick, Intake’s checkmark-headed helper">
        <g className="tick__rig" transform={`translate(0 0)`}>
          {/* Filled box behind the whole character, so the tick can flash on. */}
          <g id="body" className="tick__body" style={{ transform: transforms.body }}>
            <path className="tick__limb" d="M47 118 l-2 18" style={{ transform: transforms.legLeft, transformOrigin: '48px 118px' }} />
            <path className="tick__limb" d="M73 118 l2 18" style={{ transform: transforms.legRight, transformOrigin: '72px 118px' }} />
            <rect className="tick__torso" x="40" y="90" width="40" height="34" rx="14" />
            <path className="tick__limb" d="M42 100 l-14 12" id="arm-left" style={{ transform: transforms.armLeft, transformOrigin: '42px 100px' }} />
            <path className="tick__limb" d="M78 100 l14 10" id="arm-right" style={{ transform: transforms.armRight, transformOrigin: '78px 100px' }} />
            <circle id="hand-left" className="tick__hand" cx="26" cy="113" r="6" style={{ transform: transforms.handLeft }} />
            <circle id="hand-right" className="tick__hand" cx="94" cy="111" r="6.5" style={{ transform: transforms.handRight }} />
          </g>

          {/* The head: a rounded checkbox, deliberately a few degrees off square. */}
          <g id="head" className="tick__head" style={{ transform: `rotate(calc(-3deg + var(--tick-head-tilt)))` }}>
            <rect className={`tick__box${ticks || expression === 'happy' ? ' is-ticked' : ''}`} x="22" y="14" width="76" height="70" rx="20" />
            <g className="tick__box-tick" aria-hidden>
              <path d="M36 47 l12 13 26 -30" />
            </g>
            <Face expression={expression} blink={blink} pupilShift={tilt.pupils} />
            {/* The clipboard clip, worn like a hair tuft. */}
            <g id="accessory" className="tick__clip">
              <rect x="48" y="6" width="24" height="12" rx="5" />
              <rect x="54" y="3" width="12" height="6" rx="3" />
            </g>
          </g>

          {/* The pencil. The page's line is drawn from its tip. */}
          <g id="prop" className="tick__prop" style={{ transform: transforms.prop, transformOrigin: '94px 111px' }}>
            <rect className="tick__pencil" x="96" y="86" width="9" height="34" rx="3" />
            <path className="tick__pencil-tip" d="M96 120 l4.5 9 4.5 -9 z" />
            <rect className="tick__pencil-band" x="96" y="86" width="9" height="5" rx="2" />
          </g>
        </g>
      </svg>

      {/* Anchor points the page measures when it needs to attach the line to the pencil. */}
      <span className="tick__anchor tick__anchor--pencil" data-anchor="pencil-tip" />
      <span className="tick__anchor tick__anchor--head" data-anchor="head-top" />

      <button
        type="button"
        className="tick__poke"
        aria-label="Poke Tick"
        onClick={event => {
          const box = (event.currentTarget as HTMLElement).getBoundingClientRect();
          onPoke?.({ x: box.left + box.width / 2, y: box.top });
        }}
      />
    </span>
  );
}
