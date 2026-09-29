# Composition Brief — Intake Launch Film (`composition-brief.md`)

**Deliverable:** `brag.mp4` · 89.0s · 1920×1080 · 30fps · H.264 (CRF 15, preset
slow, yuv420p, +faststart) · AAC 256k 48kHz stereo · poster baked as frame 0.
**Route:** brag-slim self-render (no browser runtime): a deterministic
Python/Pillow frame engine piped straight into ffmpeg.

## Stage & system

| Token | Value | Use |
|---|---|---|
| `INK` | `#0c0c0b` | ground for scenes 1–14 |
| `PAPER` | `#f8f3e9` | product documents (builder, Google Form) |
| `CREAM` | `#f1ece2` | primary type on ink |
| `ACCENT` | `#ff5a1f` | brand accent, counters, strikethroughs, "it." |
| `LOGIC` | `#9db0ff` | conditional logic: IF chips, wires, JSON logic keys |
| `RULE` | `#f2c94c` | "Do it all again × 8", frozen-state counter |
| `OK` | `#7fd8b0` | connected/created/required=true states |
| `FIELD` | `#ff7b47` | field-node dots and labels |

Type: **Geist** (Regular/Medium/SemiBold) for product UI and statements,
**Geist Mono** (Medium) for chrome, counters, chips, spec JSON (with `↵ ↑ ↳
→ × · —` glyph-safe set), **Fraunces italic** (300/400) for editorial captions
("tedious part.", "logic, already wired.", "It's already a form."), Fraunces
600 for display. All UI geometry derives from the real Intake components
(`LogoMark` 64-unit proportions, `Composer` + "ENTER · to build", account pill
"Connected · ada.okafor@gmail.com", Google-Forms document with purple header).

## Motion grammar

- Camera: per-scene slow push (1.00→1.03) + micro drift; S8 opens 1.03→1.00.
- Every element enters through eased pop/slide (smoothstep / ease-out), never
  linear; shapes blend as alpha tiles so fades are real.
- Signature motion (S6): words of the request physically detach, migrate, and
  dissolve into field nodes; the IF wire draws with an arrowhead; spec JSON
  reveals line-by-line.
- Micro-gestures: click rings (S2), caret blinks (S1/S5), dropdown panel
  (S1), strikethroughs (S3/S11), slider strike + label swap (S10), receipt
  fade (S10).
- Hard freeze + hard cut at 20.1–20.6 into the silence; the only hard cut.

## Typography law

Statements ≤ 3 lines; captions are one line; nothing holds past its reading
time (S11 words hold ≥0.9s each). Real product text is set exactly as in the
repo ("You know what to ask. Building it is the tedious part.", BUILDER_STEPS,
"Describe the form you need…").

## Sound map (see brag-plan.md)

~175 placed CC0 SFX under a 7-act music arc; near-silence 20.35–25.3; typing
is real keypress samples, one per rendered character.

## QC gates

Frame-0 poster = brag.jpg (60.4s settled beat). No dead frames (verified per
beat), no tofu glyphs, no shape/text mis-registration (all geometry passes one
camera transform), contrast: cream-on-ink ≈ 15:1, ink-on-paper ≈ 14:1.
