# Intake product review — walked the way a customer would

_2026-10-24. Reviewed on `arena/ec576a10-intake`._

## How this was done (so you can judge the confidence)

- Read the real flow in the code: `/` → `/auth/sign-in` → `/app` → `/app/forms` (describe → review →
  create) → `/app/library` → `/app/forms` (edit) → `/app/connections` → `/app/account` → `/app/billing`.
- Mounted every workspace page in the project's own jsdom harness with a fixture account, a connected
  Google account and a connected Typeform account, and read the rendered text of each screen.
- Exercised the API contract behind each screen (interpret, revise, confirm, library refresh, import)
  against a scripted server, including the failure paths.
- **Not** done: no click-through in a real browser (no Chromium in this sandbox, so no screenshots) and
  no live Google or Typeform account (every provider call was verified against a fake, not their API).
  Anything below marked "unverified" needs one real run before you trust it.

## The walkthrough, and how each moment felt

**Landing (`/`).** One promise, one input, proof underneath. Nothing to fix here for a first-time
visitor.

**Sign in.** Email/password plus Google sign-in. If the server has no Google client it says so in
plain words instead of showing a dead button — that kind of honesty is consistent everywhere in this
product.

**Home (`/app`).** This is the shape you asked for: a greeting, one composer, "Create in" chips for
Google Forms and Typeform, three example prompts, a quiet recent-forms list, and plan/connection
lines at footnote weight. It reads in about four seconds.

**Describe → review (`/app/forms`).** You type one sentence, press Enter, and get a reply. The draft
card shows the title, the numbered questions with required/optional and the real option lists, then
"Assumptions" and provider limitations, then the actions. While it works it narrates honestly
("Intake is planning the questions. No form is being created yet.").

Problems I found here:
1. **The primary action lives at the bottom of a long card.** With 20+ questions you scroll past the
   whole draft before you can press "Create form →", and "Edit questions", "Preview" and "Cancel" sit
   beside it with almost the same visual weight. A sticky action bar attached to the composer would
   fix both the reach and the hierarchy.
2. **Assumptions and limitations look like the same kind of thing.** "Costs are not collected" (our
   guess, yours to correct) and "Google cannot validate email format" (a hard limit) are two
   different messages in two identical lists. Splitting them — "We assumed" vs "This provider can't" —
   stops people reading our guesses as errors.
3. **Assumptions can quietly become invented facts.** The prompt told the model to "disclose
   consequential assumptions" but never said how specific an assumption may be, which is how a draft
   turns "a machine is available" into a named model. I added an explicit rule: never invent a brand,
   model, price, capacity or headcount the request did not state. This is a prompt-level fix I could
   not verify against a live model here — read the assumptions in your first few real drafts.

**Create.** Spinner, then the result with edit/respondent links and warnings. The failure design is
the best part of this product: a lost response is never retried blind, a partial outcome keeps the
real link, and the copy tells you to check the provider before starting over. Duplicated submits are
idempotent and credits are not charged twice.

**Library (`/app/library`).** Search, provider/source/status filters, cards, import, archive, remove.
I added a provider filter beside the source and status ones so a Typeform-only or Google-only list is
two clicks instead of a scan, and replaced the numbered eyebrow and oversized title with a quiet
heading and one sentence — this is a work surface, not a landing page.

**Edit (`/app/forms` → Edit an existing form).** Inspect the current form, get an exact diff, tick
"I checked the original" and only then apply. Google-only, and it says so. This is careful and
correct; the copy is dense but every sentence is doing a job.

**Connections.** Provider rows with status, account, scopes, disconnect. I removed the "02 /
PROVIDERS" eyebrow and the two-line brand sentence, and shortened the footer. The rows themselves
still carry a lot of jargon ("AUTHORIZED ACCESS", revocation warnings); that is the next page to
simplify.

**Account / Billing.** Five mono-labelled sections of policy text. Accurate, but this is the densest
screen in the product and the least changed by the redesign so far.

## What I changed in this branch

**Typeform as a real second target** (it was previously implemented server-side but unreachable):
migration `019_typeform_provider.sql` widens the provider checks (connections, OAuth transactions,
forms, drafts) and leaves `form_edit_draft` Google-only; the interpretation prompt is now
provider-aware (logic jumps, back-to-back fan-out allowed); draft creation, revision, confirmation,
import, library listing/refresh/remove and every message that used to say "Google" now names the
draft's own provider. Verified: 019 applied to a synthetic pre-019 schema — existing rows kept,
Typeform accepted, Typeform edit drafts still refused.

**The chat-first workspace convergence:** the Create page now hides its mode switch, credit policy and
form lists the moment a sentence has been sent, so what remains is the conversation and the composer;
the credit estimate became one line with the policy behind a disclosure; Connections and Library got
quiet headings.

**Tests:** 108/108 across the forms, drafts and preflight suites; 55/55 across interpretation,
providers and Typeform; library page 8/8; `frontend.test.mjs` 3/3 (it had been red at HEAD on stale
auth copy, so protected-page rendering is now actually covered). `forms-page.test.mjs` passes all 19
of its assertions but the sandbox's OOM killer ends the process at teardown; measured the same on
HEAD, so it is the harness, not a regression.

## What you should do next, in order

1. **Deploy once with both OAuth clients set** and run `node tools/verify-production.mjs --base-url …`.
   It is read-only by default and checks the things I could not: real redirect URIs, real provider
   reachability, the session and credit endpoints in production.
2. **Create three real Typeform drafts** — one simple, one branching, one long — and open them in
   Typeform. The planner emits logic jumps for conditional questions; their shape is the one thing
   here that is "unverified against a live account". If Typeform rejects them, the failure is visible
   and honest, but it will cost you a draft.
3. **Put the create action where the thumb is.** Sticky action bar with "Create form →" and a
   secondary "Edit questions", shown whenever a ready draft is on screen.
4. **Split assumptions from limitations** in the review card.
5. **Finish the pass on Account and Billing**, then delete the in-page "Create / Edit / Library"
   switch entirely and let the rail own navigation. Right now the chrome changes shape between pages
   that are one click apart.

## Known red tests (not regressions)

`homepage`, `pricing`, `waitlist` and the marketing suites assert copy that the marketing rewrite
changed; they fail at HEAD too. They are stale assertions, not broken pages — worth updating in a
separate, mechanical pass so the suite stops crying wolf.
