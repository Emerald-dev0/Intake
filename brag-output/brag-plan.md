# Intake — Launch Film Plan (`brag-output/brag-plan.md`)

**Film:** 89.0s, 1920×1080 @ 30fps, 16:9 master · **Route:** `brag-slim` self-render
**Tone:** cinematic · **Law:** show the thing — real Intake UI, real sound design, zero AI clichés.

## Creative thesis

The product's story is a *replacement of a loop*: forty minutes of manual
form-building → one sentence of description → a real Google/Microsoft Form with
the logic already wired. The film makes the audience feel the old loop's tedium
mechanically (counters, clicks, one-more-thing) so that "Or just describe it."
lands as relief, and the NL→structure transformation (S6) earns the title of
signature moment. Intake is never framed as "AI": it is the natural-language
*interface* for the forms people already use, and the film is scrupulous that
the finished form lives in the user's own, explicitly authorized, provider
account.

## Locked timing grid (single source of truth: `work/scripts/film.py`)

| # | Scene | Time | Beat |
|---|-------|------|------|
| S1 | Builder typing | 0–7.2 | "Untitled form" types, Full name row, dropdown pick, Required toggle. Chrome: `THE FORM BUILDER`, climbing `CLICKS` counter. Caption: "forty minutes of this. and counting." |
| S2 | The list grows | 7.2–13.4 | Six builder rows land one per click. Caption: "Click. Type. Pick. Repeat." |
| S3 | The loop | 13.4–20.6 | Full 12-step `BUILDER_STEPS` list ("Do it all again × 8" in rule-yellow), skeleton card, "One more thing…". Statement: "You know what to ask. / Building it is the *tedious part.*" Freeze + hard cut 20.1–20.6. |
| S4 | The interruption | 20.6–25.6 | Near-black, near-silence (music ducks to ~2%). "Or just" (Fraunces) / "describe it." Tagline micro-line. |
| S5 | Describe | 25.6–35.0 | Real Intake workspace chrome (`Connected · ada.okafor@gmail.com`). Three typed messages, ENTER beats, "Understood — building." Composer placeholder "Describe the form you need…", `ENTER · to build`. Caption: "Three sentences. Zero dropdowns." |
| S6 | **The transformation** | 35.0–46.2 | Ghost sentence's words detach and dissolve into field nodes (Name/Email/Phone/Age range/Accommodation) on a spine; IF·accommodation chip draws its wire; spec panel types out the FORM CONSTRUCTION JSON (logic in blue). Caption: "Not generated. *Understood.*" |
| S7 | Authorized path | 46.2–52.2 | Chain: INTAKE → ada.okafor@gmail.com ✓connected → Google Forms → form. "Explicit authorization. Nothing else is touched." Caption: "Your forms. Your account." |
| S8 | Real form assembles | 52.2–61.2 | Google-Forms document (purple header) builds 5 questions + IF wire + conditional row 6. Caption: "*logic, already wired.*" |
| S9 | Created | 61.2–65.6 | ✓ Form created bar + Edit / Share / `forms.gle/fyr26`. Caption: "Ready to share." |
| S10 | Conversational edits | 65.6–73.0 | Three transformations: add Department question (chip QUESTION ADDED), age ranges tighten live, 2 fields removed (receipt "2 fields removed · logic collapsed"). Caption: "*It's already a form.*" |
| S11 | The new loop | 73.0–79.0 | BUILD·CLICK·CONFIGURE·EDIT·PREVIEW·REPEAT struck and collapsed (1.15–1.7), divider (1.75–2.1), DESCRIBE → BUILD → USE slide in at 2.15/3.05/3.95. Caption: "That's the whole job now." |
| S12 | Who it's for | 79.0–82.2 | "If you know what to collect…" + 5 checked use-case lines. |
| S13 | Brand | 82.2–85.6 | Soft glow, `LogoMark` pop, "intake", "The natural-language interface for forms." |
| S14 | End card | 85.6–89.0 | "Describe it. Build it. Use it." + logo + `github.com/Emerald-dev0/Intake`. Poster beat ~60.4s. |

## Sound design (work/scripts/make_audio.py)

- **Music:** CC0 track (skill `assets/music/`) under a 7-act gain arc —
  friction (0.50→0.72) → cut → **near-silence 20.35–25.3** (0.025) →
  discovery (0.28→0.50) → momentum (→0.72) → payoff (0.88 at S9) →
  resolution (→0.10 tail). Verified via RMS-per-5s report.
- **SFX:** ~175 placed events from `film.EVENTS` using the skill's CC0 sample
  sets — keyboard keypresses (randomized 32) for every typed character,
  interface clicks/toggles, casino card-slides for rows/whooshes,
  impactSoft thuds for drops/collapse, impactBell chimes for payoffs
  (connected ✓, Form created, brand), slider clacks, link pops, wire ticks.
  Intentional, not whooshes-on-every-transition: density follows the story.

## Render pipeline (brag-slim self-render)

- `work/scripts/engine.py` — Pillow frame engine: 2× supersample + LANCZOS,
  camera (zoom/drift per scene), all shapes composited through per-shape RGBA
  tiles (correct alpha blending + working fades), cached text L-masks,
  soft glow sprite, film grain, alpha 0–255 everywhere.
- `work/scripts/scenes.py` — the 14 scenes above; `film.py` — timings, palette
  (ink `#0c0c0b`, paper `#f8f3e9`, accent `#ff5a1f`, logic `#9db0ff`, rule
  `#f2c94c`, ok `#7fd8b0`), copy, typing runs, SFX grid.
- `render_video.py` CLI: `stills` (review shots) / `full` (raw pipe → ffmpeg
  libx264 CRF 15 preset slow yuv420p +faststart, AAC 256k 48k) / `frame T`.
- Poster: strongest settled beat (~60.4s: the real form with conditional logic +
  "logic, already wired."), baked as frame 0 so every thumbnail grabber shows it.

## Product-accuracy guardrails

- Not a form builder, not a replacement for Google/Microsoft Forms — the
  interface *for* them.
- Only touches a provider after explicit authorization (S7 makes this text).
- The finished form is a normal provider form (S9/S10 use it in place).
- Never claims response collection on Intake's behalf or unauthorized access.
