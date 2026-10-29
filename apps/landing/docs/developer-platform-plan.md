# Intake for Developers — the plan

_The programme plan for phases 2–13 of "Intake for Developers", written against the real
repository: `apps/landing` (Vite SPA + Express API), `db/migrations`, `server/*`, `src/*`, `test/*`._

This is a second capability inside Intake, not a second product. The same account, the same
database, the same 20 daily credits, the same session. A developer signs in once and the workspace
is a place in the console, beside Chat, Library and Connections.

## The invariants, which do not change per phase

1. **One database.** No second store, no second schema, no shadow copy of a user.
2. **One currency.** AI work is charged through `creditService.charge({ userId, operationType,
   operationKey, cost })`, the same path the rest of Intake uses. No developer wallet, no
   conversion rate, no second balance screen.
3. **The server is the boundary.** Ownership, lifecycle, validation, limits and idempotency are
   enforced in `server/*`, not in the console. The console asks and renders the answer.
4. **The ownership chain is explicit.** A user owns a project, a project owns a form, a form owns
   a version, a form owns its submissions. Every query follows the chain. Somebody else's thing is
   a 404, never a 403.
5. **Nothing unimplemented is presented as working.** The Developers page carries a status for
   every capability — shipping, being built, not promised — and the tests fail if a badge lies.
6. **Every public change ships with a changelog entry**, in the same piece of work, with the same
   copy in the database and in the bundle.
7. **No secrets reach the browser.** Signing secrets, provider keys and database credentials stay
   on the server. A payment success redirect is never proof of payment.

## The phases

| Phase | What it is | State |
| --- | --- | --- |
| 0 | Audit and plan | done |
| 1 | Public changelog: index, permanent per-release URLs, canonical/OG, verified history only, 404/error/loading states, release-notes discipline | done (PR #23, #24) |
| 2 | Public Developers page | done |
| 3 | Authenticated developer workspace: projects, forms, responses, insights, integrations, settings — no fake nav | done (projects and forms) |
| 4 | Hosted form builder, renderer and embed | done |
| 5 | Lifecycle: publish, pause, close, reopen, archive, delete, enforced by the server | done |
| 6 | Submissions: validation against the published version, size and time limits, rate limiting, idempotency, safe persistence, timestamps and source metadata, isolation | done |
| 7 | Response inbox: pagination, search, filters, detail, CSV export, deterministic counts and summaries, permissions | done |
| 8 | AI insights on the existing 20-credit system: canonical deduction, no double charge, no charge on provider error, cost shown, limits, no unrelated data, token and cost tracking, SQL for exact statistics | done |
| 9 | Usage metering: per project and platform-wide, reconciled against the Render, Neon, Vercel and AI dashboards, no secrets exposed | done |
| 10 | Payments and subscriptions through the existing Bachs merchant account: server-verified webhooks as the authority, signature verification, idempotency, the full lifecycle, quota behaviour, sandbox and live separation, sandbox-tested, live gated | built and gated — the live tier is still switched off |
| 11 | Notification preferences and email events through the existing email system: opt-in, digest and threshold, idempotency, delivery logs, a preference screen, no respondent email by default | done |
| 12 | Public AEO and technical SEO: crawlable accurate content, metadata, canonical, OG, sitemap and robots, structured data only where accurate, internal links, no fabricated claims | done |
| 13 | Quality: tests across every area above, typecheck, lint, production build, safe migrations, no data loss | ongoing |
| 14 | Release Manager: private, admin-only, GitHub-linked, separate from the public changelog | done (PR #23) |

## Phase 3, as built

The data model is three tables (`db/migrations/025_developer_workspace.sql`):

- `dev_project` — a person, a name, an address unique inside that account, a status.
- `dev_form` — a project, a name, an address unique inside that project, a lifecycle state.
- `dev_form_version` — a form, a number, the definition as one JSON document, and whether it is a
  draft, the published version, or a superseded one.

The database enforces the rules the service relies on: one published version per form (a partial
unique index), readable addresses (a check constraint), and the cascade that takes a project's forms
and versions when the account goes.

The service (`server/dev/service.ts`) owns ownership and the lifecycle. The lifecycle is a table:

```
draft ──publish──▶ published ──pause──▶ paused ──resume──▶ published
                        │  ▲                │                   │
                     close│  │reopen         close              │
                        ▼  │                ▼                   │
                     closed ──reopen──▶ published        published
```

`archive` is available from every live state and `restore` returns an archived form to draft.

The API (`server/dev/routes.ts`, mounted at `/api/dev`) is behind the same session as the rest of
the signed-in area. There is no second authentication system for developers.

## Phases 4–7, as built: the form, the answers, the inbox

- **The builder** (`src/app/DevFormBuilder.tsx`) edits a draft. A published version is never
  rewritten: editing creates the next draft, and publishing makes it the one the public endpoint
  validates against.
- **The public renderer** (`src/marketing/HostedFormPage.tsx`) serves both the hosted page at a
  permanent address and the embed. Field types: short and long text, email, number, dropdown,
  single and multiple choice, checkbox, date.
- **Theming is configuration, not inheritance.** An iframe pointing at another origin cannot read
  the host page's stylesheet, variables or fonts. The theme is tokens — primary colour, background,
  text, border, typeface, corner radius, light/dark/system, and a transparent background.
- **Graceful states.** Loading, a validation error, a closed form, a form that does not exist and a
  network failure each get their own state. An embedded form never shows an empty box.
- **Submissions** (`server/dev/submissions.ts`) are validated against the published version that was
  live, limited in size, rate-limited per form and per caller, and deduplicated by an idempotency
  key. A submission stores the version it was accepted under, the timestamps and the source
  metadata — nothing from the respondent that was not asked for.
- **The inbox** (`server/dev/routes.ts`, `src/app/DevResponses.tsx`) paginates, searches, filters and
  exports CSV with the same columns as the table.

## Phase 8, as built: the summary

`server/dev/insights.ts` runs a bounded prompt through the canonical AI runner and charges
`DEV_INSIGHTS_COST = 3` credits through `creditService.charge`. The operation key is derived from
the form and the answers, so the same answers are never charged for twice. A provider failure is
not charged. The exact counts in the panel come from SQL, not from the model.

## Phase 9, as built: the counters

`dev_usage_daily` counts accepted submissions, refused requests and stored bytes per project per
day. The console shows thirty days, per project and in total, so an operator can compare the
numbers with what Render, Neon, Vercel and the model provider report. No secrets are exposed and
nothing is estimated.

## Phase 10, as built: the billing path

Bachs is the merchant of record, and the webhook is the authority:

- `POST /api/webhooks/bachs` verifies the signature before the body is parsed, and refuses
  anything that does not verify.
- The delivery id makes a retry one payment, not two.
- The lifecycle — activation, renewal, cancellation, expiry — is driven by the webhook and by
  nothing else. A customer returning from the checkout page proves nothing.
- `PAID_BILLING_ENABLED = false`: no checkout is created, and the refusal says why. The live tier
  stays off until it is deliberately switched on.
- Sandbox and live are separated by configuration: the base URL, the key and the signing secret
  are read from the environment, and nothing is sent to a live endpoint from a sandbox run.

## Phase 11, as built: the notice

`server/dev/notifications.ts` sends one notice per threshold or per digest, never one per answer.
It is opt-in, it notices the owner of the project and never a respondent, and the event id means
the same notice cannot be sent twice. The counter only resets after a real send, so a failed
delivery is retried rather than lost.

## Phase 12, as built: what a crawler sees

The developer page carries a `FAQPage` graph built from the same array the page renders, so the
two cannot drift. The hosted form page carries a canonical address, a description and a social
card; the embed is `noindex`. The sitemap and `llms.txt` are generated at build time and list
every release page. Nothing is claimed that is not true, and the Developers page carries a status
for every capability — shipping, being built, not promised — with a test that fails if a badge
lies.

## What is deliberately not planned

- **A second AI system.** Insights run on the credits the customer already has.
- **A webhook endpoint presented as existing.** Webhooks are on the Developers page as *not
  promised* until they are, and they are not.
- **A hosted billing system.** Bachs is the merchant of record; the webhooks are the authority.
- **Responding to respondents by email.** No per-submission email, ever, without an explicit
  opt-in.

## Running it

```bash
cd apps/landing
npm ci
npm run db:migrate:intake     # needs DATABASE_URL; applies 022 through 034
npm run dev                   # API + Vite
npm test                      # the whole suite
```

The developer workspace lives behind the same session as the console: sign in, then
`/app/developers`.
