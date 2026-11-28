# Tick

The character who carries Intake's one continuous line.

## Brief

| | |
| --- | --- |
| **Name** | Tick |
| **Who** | A small, quick-thinking helper whose head is a rounded checkbox. The checkmark lives inside the box and doubles as the face: a tick means something is approved, an empty box means it is still thinking, a dash means it does not understand yet. |
| **Personality** | Eager, witty, slightly smug — the colleague who finishes the sentence you were about to write and then waits, pleased, for you to notice. |
| **Signature prop** | A chunky pencil. The hand-drawn line that threads through the whole page comes out of its tip. |
| **Signature accessory** | A clipboard clip on top of the head, worn like a hair tuft, because everything Tick approves gets filed. |
| **Distinct feature** | A slightly lopsided head — never a perfect square, always rotated about −3° — and one asymmetrical detail: the right eye sits a touch higher and wider than the left, so the face is recognisable at 32px. |
| **Style** | Flat, bold vector. One 3px stroke with rounded caps and joins, simple geometric shapes, a big expressive head on a small body, exaggerated hands. Palette variables plus ink and paper only. No gradients, no shadows, no photorealism. Slight imperfect curves keep it hand-drawn rather than geometric. |

## Why a checkbox

The product is about approving a list of questions before anything is created. A checkbox is the smallest, most recognisable object in that idea, and it carries a built-in set of expressions: ticked, empty, dashed. That means the face can change without redrawing the character.

## Palette

Every fill and stroke is a CSS variable so the mascot follows the page theme:

- `--ink` — outlines, pupils, body
- `--paper` — head and body fill
- `--accent` — the checkmark, the pencil, the stamp
- `--bg` — the negative space inside the box

Ticking the box fills it with `--accent` and leaves the tick in `--paper`; thinking leaves it empty with an `--ink` outline.

## The rig

`src/landing/Tick.tsx` is one SVG with named groups so each part can animate on its own:

`#head`, `#eyes` (with `#eye-left`, `#eye-right`, `#pupil-left`, `#pupil-right`, `#lid-left`, `#lid-right`), `#mouth`, `#brows`, `#accessory`, `#body`, `#arm-left`, `#arm-right`, `#hand-left`, `#hand-right`, `#leg-left`, `#leg-right`, `#prop`.

Transforms are applied to those groups only, with `transform-box: fill-box` and `transform-origin` set at the natural joint (neck, shoulder, elbow, hip). Poses are therefore data, not drawings.

## Poses

| Pose | Used in | What moves |
| --- | --- | --- |
| `idle` | top bar mark, quiet sections | nothing but breathing and blinking |
| `waving` | story section | right arm up, hand rocking, head tilted |
| `sitting` | features, perched on a numbered row | legs forward, body lowered, one hand on the row |
| `drawing` | hero, how it works | head down, pencil angled into the line, left arm steadying |
| `running` | how it works | lean forward, two-frame leg loop, stack of forms under one arm |
| `celebrating` | final CTA and footer | both arms up, stamp held high, confetti at the moment of the tick |

## Expressions

`neutral`, `happy` (both eyes ticked), `thinking` (empty boxes, brows up), `surprised` (wide pupils, small mouth), `wink` (one lid closed, smirk). Expressions swap only the eye, brow and mouth groups, so the silhouette never jumps.

## Behaviour

- Blinks every 3–6 seconds at a random interval, with a double-blink roughly one in five times.
- Head turns up to 6° and pupils up to 3px toward the pointer, eased; at rest it drifts back.
- Breathes on a 4.6s loop and sways a degree or two.
- Hover: waves. Click: a random trick (spin, hop, backflip), the head ticks and unticks, and a small confetti burst in `--accent`.
- Anchor points (`data-anchor="pencil-tip"`, `data-anchor="hand-right"`, `data-anchor="head-top"`) let the page attach the continuous line and the speech bubbles to the rig instead of to fixed coordinates.

## Quality bar

Checked at 64, 200 and 500px: the head reads as a checkbox with a face at the smallest size, proportions match across all six poses (the head never changes size, only the body's limbs), and the stroke weight is uniform because it is one attribute on the root `<g>`.

## Reduced motion

When `prefers-reduced-motion: reduce`, the rig renders in its `idle` pose at the `neutral` expression, blinking is off, cursor tracking is off, and clicks still tick the box but skip the trick and the confetti.
