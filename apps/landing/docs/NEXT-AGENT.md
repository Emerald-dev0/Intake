# Brief for the next agent: after the merge, redesign the signed-in product

Paste this whole file as the instruction. It assumes you are the coding agent working in
`Emerald-dev0/Intake`, and that a human has just merged PR #20 (`arena/ec576a10-intake` → `main`).

---

## Stage 0 — land the merge, then prove it on a real database

Do these in order. Do not start design work until Stage 0 is verified.

1. **Sync.** `git checkout main && git pull --ff-only && git checkout -b design/signed-in-product`.
   Never work directly on `main`.
2. **Install.** `cd apps/landing && npm ci` (there is no lockfile drift expected; if `npm ci` fails,
   stop and report rather than switching to `npm install`).
3. **Migrations.** Better Auth first, then Intake:
   `npm run db:migrate` → `npm run db:migrate:intake`. Expect `035_release_delete_a_form.sql` to be
   the last one applied. If any migration fails, **stop** — do not "fix" it by deleting rows.
4. **Preflight.** `npm run preflight -- --db`. Every check must pass, including the new
   `composed mail` check. A `warn` there means the send log did not apply; fix the migration before
   continuing.
5. **One real send.** Sign in as an allowlisted admin → `/admin/mail` → select **only your own
   account** → preview → tick the acknowledgement → send. Then confirm, in order:
   - the result panel says 1 of 1 accepted, with a per-recipient row;
   - the message actually arrived (real inbox, real provider);
   - `/admin/email` lists it as **composed mail**;
   - the plaintext alternative is readable in a client that blocks HTML.
   If the provider is not configured, the send will be recorded as `skipped` — that is correct
   behaviour, and it is **not** evidence that email works. Say so plainly.
6. **Typeform edit limits.** In the workspace, open the edit screen and confirm the collapsed
   "what Intake will not change" panel appears before you ask for a delete; confirm `/trust` shows the
   same paragraphs. Ask for a deletion in chat and confirm the refusal quotes the same sentence.

Report Stage 0 with exact command output for 3–5, and say explicitly which parts were verified live
and which were not.

---

## Stage 1 — the redesign

> **Status (2026-10-24): the first pass is done and pushed** in `f771d19` on this branch. Shipped:
> the ⌘K command palette (server-scoped form search + every destination, full keyboard model,
> focus restored), the shared page system (`PageHeader` / `Section` / `EmptyState` / `ErrorState` /
> `Skeleton` / `Note`) adopted by Library, Connections, Billing and Account, the home status strip
> with one server-derived next action, palette-to-form focus in the Library, and the deletion of
> `src/styles/mobile.css` (917 unreferenced lines that were never imported).
>
> **What is still open** is listed in [§8](#8-what-is-actually-left). Treat it as the real brief;
> the text below records the intent it came from.



The signed-in product is currently **clean but thin**: a chat-first home composer, a five-item rail
(Home · Chat · Library · Connections · Billing), a library with search and filters, and separate
Connections / Billing / Account pages that each carry their own heading styles. It works. It is not
yet something a customer would call spectacular, and finding a specific form means going to the
Library first.

Make it feel like one designed product, and make everything reachable in one keystroke.

### 1. A command palette (the "access" fix)

`⌘K` / `Ctrl K` from anywhere in `/app`, and a visible search affordance in the top bar.

- Searches your own forms by title (reuse `/api/forms` search — do not add a new endpoint unless the
  existing one cannot answer it), plus a fixed set of destinations (Home, New chat, Library,
  Connections, Billing, Account, and Operator console only when `/api/admin/access` returns 200).
- Arrow keys move, `Enter` opens, `Esc` closes, focus returns to the trigger, `aria-activedescendant`
  wired correctly. It must be usable with no mouse.
- Empty query shows recent forms and destinations; typing filters both groups.
- Never show a form the session cannot access. Server-scoped only, no client-side filtering of
  someone else's data.

### 2. Home becomes a dashboard that still starts with a sentence

Keep the composer as the primary object — that was a deliberate decision and it stays.

- Above it: a compact status strip — plan, credits remaining **with the reset time in plain words**,
  provider connection state, and any action the user actually needs to take (e.g. "Google is not
  connected yet — connect it"). One row, no card grid.
- Below it: recent forms with real affordances — open the form, copy the responder link, edit it,
  see whether it is live or incomplete. Keep it to the four most recent plus "see all".
- A first-run state: three short steps (connect a provider → describe a form → approve and create),
  each ticking off from real server state, not from localStorage.
- Remove nothing that is honest; remove anything decorative that competes with the composer.

### 3. One page system

Library, Connections, Billing and Account currently look like four different products.

- One heading component (`kicker · title · description · actions`), one page width, one vertical
  rhythm, one table/list style, one empty state, one error state, one skeleton.
- Errors keep today's rule: an unavailable source says it is unavailable. Never render a confident
  zero you did not measure.
- Loading uses skeletons sized like the content that replaces them; no layout jump.
- Every destructive or paid action keeps its confirmation step. Do not soften the confirm boundary.

### 4. Craft requirements (non-negotiable)

- **Tokens only.** Colours, type, spacing and radii come from `src/styles/base.css`. No new raw hex
  in page CSS. Both light and dark must be designed, not inverted.
- **Motion.** Transitions ≤ 180 ms, transform/opacity only, and `prefers-reduced-motion: reduce`
  turns them off. No parallax, no scroll-jacking.
- **Mobile.** Usable at 360 px: the rail becomes a sheet, the palette becomes full-screen, tap targets
  ≥ 44 px. Test at 360, 768, 1440.
- **Accessibility.** Visible focus on everything, contrast ≥ 4.5:1 for body text, labelled inputs,
  `aria-live` for async results, focus trapped in the palette and account menu and restored on close.
  Manually tab through each redesigned page once and fix what you find.
- **No new runtime dependencies** unless you can name what they replace. `recharts` is already there
  for charts. Do not add a UI kit.
- **No network in the preview iframe, no external fonts or images.** Inline SVG or data URI only.
- **Bundle discipline.** The admin bundle is already ~495 kB; do not let the signed-in bundle grow for
  polish. Lazy-load anything heavy.

### 5. Honesty rails (these outrank looking good)

- No engagement metrics Intake cannot compute (no uniques, sessions, retention, open rates).
- No "AI is thinking" theatre; progress states reflect real requests.
- No fake sample data in empty states.
- Anything you cannot verify live must be described as unverified in your final report.

### 6. Tests and verification

- Extend the existing jsdom tests rather than writing a parallel suite: `chat-shell`,
  `forms-library-page`, `admin-mail-page` are the patterns to copy (one mount per file, real UUIDs,
  `act()` around every interaction).
- Add coverage for: palette opens on ⌘K, filters forms, Enter navigates, Esc restores focus; home
  status strip reflects an unavailable credits source as an error, not as zero; first-run steps tick
  from server state.
- The old 456-line `forms-page.test.mjs` is now split by concern — `forms-page-create`,
  `forms-page-edit`, `forms-page-outcome`, `forms-page-recovery` — over a shared harness in
  `test/support/forms-page-harness.mjs` (it exports every helper the bodies use, including `act`).
  Each file runs on its own; run them per file, not in one 68-file process.
- **Never `assert.equal(page.$('#x'), null)`.** When that assertion fails, Node serialises the jsdom
  node into the error message and the process dies with SIGKILL — a real assertion failure then looks
  like an out-of-memory bug. Assert on a boolean: `assert.equal(Boolean(page.$('#x')), false)`.
- Before every commit: `npx tsc -p . --noEmit && npx tsc -p tsconfig.server.json --noEmit && npx vite build`.
- Do not commit generated `dist/` output.

### 8. What is actually left

Stage 1 is built and verified at the code level. Closed in this pass: palette, home status strip,
first-run steps from server state, Library focus + missing-filter escape hatch, one page system
across Library / Connections / Billing / Account, `Disclosure` for inert copy, dead-CSS removal, the
`forms-page` test split, and tests for each.

What is left is no longer redesign work:

1. **A visual check in a real browser.** Everything so far was verified with jsdom, typecheck and the
   build. No human has *looked* at 360 px, dark mode, or the palette against a real form list. Until
   someone does, treat spacing and contrast as asserted, not observed.
2. **Live provider / email / database verification.** Creation against Google and Typeform, OTP mail
   delivery and the migrations have not been exercised against real services from this branch.
3. **Account page density, if it still bothers a reader after a look.** The read-only facts are now
   inside `Section`s and the credit rules sit behind a `Disclosure`; further collapsing is a taste
   call that needs eyes on the page.

### 7. Definition of done

1. A signed-in user can reach any form or destination in ≤ 2 actions, and any form in one ⌘K keystroke.
2. Home reads as a dashboard and still starts with a sentence.
3. Library, Connections, Billing and Account share one visual system and one set of states.
4. Light and dark at 360 / 768 / 1440, keyboard-only pass, reduced-motion pass.
5. Tests, typecheck and build green; a short report stating what was verified live and what was not.

Ship it in small commits with one sentence each explaining *why*, and one PR back to `main`.
