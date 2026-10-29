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
| 4 | Hosted form builder, renderer and embed | next |
| 5 | Lifecycle: publish, pause, close, reopen, archive, delete, enforced by the server | partly done (state machine; delete and reopen details to finish) |
| 6 | Submissions: validation against the published version, size and time limits, rate limiting, idempotency, safe persistence, timestamps and source metadata, isolation | not started |
| 7 | Response inbox: pagination, search, filters, detail, CSV export, deterministic counts and summaries, permissions | not started |
| 8 | AI insights on the existing 20-credit system: canonical deduction, no double charge, no charge on provider error, cost shown, limits, no unrelated data, token and cost tracking, SQL for exact statistics | not started |
| 9 | Usage metering: per project and platform-wide, reconciled against the Render, Neon, Vercel and AI dashboards, no secrets exposed | not started |
| 10 | Payments and subscriptions through the existing Bachs merchant account: server-verified webhooks as the authority, signature verification, idempotency, the full lifecycle, quota behaviour, sandbox and live separation, sandbox-tested, live gated | not started |
| 11 | Notification preferences and email events through the existing email system: opt-in, digest and threshold, idempotency, delivery logs, a preference screen, no respondent email by default | not started |
| 12 | Public AEO and technical SEO: crawlable accurate content, metadata, canonical, OG, sitemap and robots, structured data only where accurate, internal links, no fabricated claims | not started |
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

## Phase 4, next: the hosted form

What has to exist before a developer can put a form in their product:

1. **A builder.** Add, remove and reorder fields; set the label, the description, whether it is
   required, and the options for a choice field. Edit a draft; a published version is never
   rewritten.
2. **A public renderer.** A hosted page at a permanent address, plus an embeddable form. Field
   types: short and long text, email, number, dropdown, single and multiple choice, checkbox, date.
3. **Theming as tokens, not inheritance.** An iframe pointing at another origin cannot read the
   host page's stylesheet, variables or fonts. The theme is therefore configuration: primary
   colour, background, text, border, typeface, corner radius, light/dark/system, and a transparent
   background option.
4. **Graceful states.** Loading, a validation error, a closed form, a form that does not exist and a
   network failure each get their own state. An embedded form never shows an empty box.
5. **A copyable snippet** and the permanent hosted URL, both shown in the console.

## Phase 6, next after that: submissions

The rules are fixed before the table is written:

- A submission is validated against the **published version** that was live, not the current draft.
- A payload limit and a request timeout, both enforced by the server.
- Rate limiting per form and per caller, reusing the existing abuse limiter.
- An idempotency key, so a retry never creates a second response.
- A submission stores the form version it was accepted under, the timestamps, and the source
  metadata — nothing from the respondent that was not asked for.
- A submission can only be read by the account that owns the project it belongs to.

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
npm run db:migrate:intake     # needs DATABASE_URL; applies 022, 023, 024, 025
npm run dev                   # API + Vite
npm test                      # the whole suite
```

The developer workspace lives behind the same session as the console: sign in, then
`/app/developers`.
