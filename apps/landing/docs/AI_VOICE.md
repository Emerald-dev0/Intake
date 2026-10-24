# Intake's AI voice: what the prompt says, and how to change it without breaking it

The interpreter is a hosted Groq model (`openai/gpt-oss-120b` by default). We do not own its weights,
so "fine-tuning" is not the lever available to us. The lever is the brief: what the model is told,
what it is shown, and what the server checks afterwards. That is what this document covers.

Files:

| File | What lives there |
| --- | --- |
| `server/forms/interpretation/prompts.ts` | The system prompt (creation and edit) and the JSON Schemas |
| `server/forms/interpretation/voice.ts` | Deterministic checks on the words the model wrote |
| `server/forms/interpretation/provider-interpreter.ts` | The single guided retry that uses those checks |
| `server/forms/interpretation/interpreter.ts` | Contract validation: what may become a draft |
| `test/ai-voice.test.mjs` | The prompt's structure, and the retry behaviour |

## The prompt is nine sections, not one paragraph

`creationSystem(provider)` joins named constants in this order. Order matters: role and stakes set the
frame, voice sets the register, and the capability rules land after the model already knows who it is
talking to.

1. **Who you are** — Intake, a colleague, not a chatbot; the person is busy and slightly impatient.
2. **What good looks like** — the actual success condition: they read, skim, change one thing, press
   create. Trust comes from understanding, one honest sentence, and no invented facts.
3. **How you write** — the voice rules, a "sound like this" list, and a "never sound like this" list
   that names the exact phrases (`Certainly!`, `As an AI`, `I hope this helps`, `Based on the
   information provided`, marketing adjectives). Naming the tells works better than saying "be human".
4. **Building the reply** — a recipe per status (ready / revision / clarification / unsupported /
   small talk), plus four hard limits: never contradict the spec, never claim creation, never promise
   a capability, never ask two questions.
5. **Reading what they sent** — a decision table over message kinds: enough detail, one missing fact,
   a field list, a greeting, a non-form request, thinking out loud, a change of mind, a clarification
   answer. This is where "don't invent a form to look productive" lives.
6. **The result** — the three-outcome contract, field exclusivity, title/description/identifier craft.
7. **Writing the questions themselves** — one idea per question, spoken titles, required-by-default
   rules for anything the organiser must act on, option hygiene, the no-invention rule, assumption
   style, and the 25-question ceiling.
8. **Revisions** — full specification out, ids preserved, minimal diff, orphans resolved.
9. **Target rules** — Google (section routing, controller placement, the three-step fan-out
   adaptation) or Typeform (logic jumps, fan-out allowed, no invented bridging question).

Then seven **worked examples** with a `Why:` line each, and a numbered **self-check** the model runs
before it answers. Examples give the model reasoning to copy, not sentences: the prompt says so
explicitly, because a model that copies example wording writes every RSVP identically.

`EDIT_SYSTEM` reuses the voice block and adds its own contract, because editing an existing form is a
different job with a different failure mode — touching something nobody asked about.

## Why the voice is checked in code as well as asked for in the prompt

A prompt is a request. `server/forms/interpretation/voice.ts` reads the spoken fields of the model's
answer (`reply`, `question`, `explanation`) and looks for the things that are cheap and safe to
detect:

| Code | Example |
| --- | --- |
| `assistant_filler` | "Certainly!", "Happy to help", "Of course" |
| `closing_filler` | "I hope this helps", "Let me know if you need anything else" |
| `ai_self_reference` | "As an AI language model…" |
| `template_hedging` | "Based on the information provided…", "I will now create…" |
| `internal_jargon` | JSON, schema, prompt, model, tokens, interpreter, API |
| `self_praise` | seamless, powerful, robust, comprehensive |
| `exclamation`, `emoji`, `markdown`, `multiline` | formatting tells |
| `too_long` | over 400 characters |

When something is flagged, the interpreter gets **one** guided retry: the original request plus a
short instruction that names the field, the problem, and the fix, and explicitly says the status and
specification must not change. It never loops. If the second answer still trips a check, it ships —
losing someone's form over a stray exclamation mark would be a worse product than a slightly stiff
sentence.

Severity split, on purpose:

- **Voice problems are repairable, never fatal.** They do not invalidate a correct specification.
- **Contract problems are fatal.** Wrong field, wrong type, missing exclusivity, an uncreatable
  arrangement: the request fails closed and nothing reaches the user's account.

## How to change the prompt

1. Write the rule where it belongs (role, voice, contract, craft, target), not at the end of the
   prompt "so the model sees it last".
2. Add or update a worked example. A rule without an example is a suggestion; a rule with an
   example is a target.
3. If the rule is cheap to detect, add it to `voice.ts` with a hint written as an instruction to the
   model. Do not add a check you cannot state in one line.
4. Run `npx tsx --test test/ai-voice.test.mjs test/interpretation.test.mjs test/drafts-routes.test.mjs`.
5. Try it against the live model before shipping. The sandbox has no Groq key, so prompt changes are
   covered by structural tests and fixtures here; the qualitative judgement happens against a real
   key:

```bash
# one request, one answer, no product surface involved
GROQ_API_KEY=... npx tsx scripts/ask-intake.ts "RSVP for our dinner: name, headcount, dietary needs"
```

## What is deliberately not done

- **No fine-tuning.** Groq serves hosted weights; there is no training path for this model on our
  account. If that changes, `GROQ_MODEL` makes the swap a config change, and this prompt is the
  dataset seed.
- **No server-side rewriting.** The server does not edit the model's sentences. A rule applied to
  half-understood prose produces worse writing than a second attempt with feedback.
- **No streaming.** The answer is strict JSON validated before anything is stored or charged;
  streaming unvalidated partial JSON into the chat would narrate plans that then fail.
- **No user text in the system prompt.** Requests arrive as the structured user message, so prompt
  injection stays a data problem. `test/ai-voice.test.mjs` asserts the system prompt is identical
  whatever the person typed.
