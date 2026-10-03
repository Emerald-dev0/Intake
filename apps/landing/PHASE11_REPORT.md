# Phase 11 implementation report

Phase 11 added **Google sign-in**, a **provider-independent AI layer with Groq as the primary
provider**, and the **AI credit infrastructure** (plans, entitlement buckets, prices, atomic ledger,
usage records, balance API and a minimal workspace meter).

Commits on this branch: `9618d52` (Google sign-in), `56e5500` (Groq behind the provider abstraction),
`775735d` (credit infrastructure and docs), `82cfb41` (metering finish, edit-target bug fix, tests).
Baseline for all code changes: `09f250e`.

Everything below describes what this repository now contains. **No live Google OAuth exchange and no
live Groq inference was performed**: there is no Neon connection, no Google Cloud client and no
provider API key in this environment. Where that matters, it is called out explicitly.

## 1. Files changed

63 files, +3,850 / −208 lines across all four commits.

**New backend**

| Path | Purpose |
| --- | --- |
| `server/sign-in/google.ts` | Google identity provider configuration (both-or-neither credentials) |
| `server/sign-in/routes.ts` | `GET /api/sign-in/config` (booleans only) |
| `server/sign-in/README.md` | Sign-in setup, callback URI, separation from Forms OAuth |
| `server/ai/provider.ts` | `AiProvider` interface, failure taxonomy, fail-closed stand-in |
| `server/ai/chat-completions.ts` | Shared OpenAI-compatible transport: request body, bounded read, JSON extraction, error mapping |
| `server/ai/groq.ts` | Groq endpoint, `GROQ_API_KEY`, `GROQ_MODEL`, `GROQ_REASONING_EFFORT` |
| `server/ai/openai.ts` | Optional OpenAI provider (explicit selection only) |
| `server/ai/registry.ts` | Deterministic provider selection; no request-time failover |
| `server/ai/usage-scope.ts` | Per-operation collection of model calls (tokens, latency, outcome) |
| `server/ai/operations.ts` | One logical operation: affordability check, metering, single charge, usage record |
| `server/ai/README.md` | Architecture, configuration, taxonomy, rules |
| `server/credits/entitlements.ts` | Plans, buckets, UTC reset keys, consumption order, public projection |
| `server/credits/pricing.ts` | Deterministic 1–5 credit price list and classifiers |
| `server/credits/ledger.ts` | `CreditStore` contract + PostgreSQL and in-memory implementations |
| `server/credits/service.ts` | `CreditService`: balance, affordability, charge, usage, plan hook |
| `server/credits/routes.ts` | `GET /api/credits` |
| `server/credits/README.md` | Entitlements, pricing, atomicity, HTTP surface, extension points |
| `server/forms/interpretation/prompts.ts` | Prompts and JSON schemas moved out of the deleted `openai.ts` (byte-identical) |
| `server/forms/interpretation/provider-interpreter.ts` | Vendor-neutral interpreter with the existing strict assessment |
| `db/migrations/007_ai_credits.sql` | `user_entitlement`, `credit_ledger`, `ai_operation` |

**New frontend:** `src/lib/credits.ts`, `src/lib/operation-id.ts`, `src/lib/sign-in-errors.ts`,
`src/app/hooks/useCredits.tsx`, `src/app/hooks/useSignInConfig.ts`.

**Modified backend:** `server/auth.ts` (optional Google social provider, safe account linking),
`server/config.ts` (Google sign-in settings), `server/index.ts` (credit service, operations runner,
`/api/credits`, both routers metered), `server/forms/interpretation/routes.ts` (metered creation and
revision, credits on success responses), `server/forms/edit-engine.ts` + `edit-routes.ts` (metered
edit/revise, corrected target validation), `server/forms/logging.ts` (`form.credits.rejected`),
`server/forms/errors.ts` (credit and provider error statuses), `server/forms/interpretation/interpreter.ts`
(shared failure type).

**Modified frontend:** `src/app/Forms.tsx`, `FormEditWorkspace.tsx` (per-submission `operationId`,
credit adoption, out-of-credits copy), `layouts/WorkspaceLayout.tsx` (sidebar meter, provider
context), `hooks/useWorkspace.ts` (outlet contract), `pages/{AuthPage,AccountPage,OverviewPage}.tsx`,
`src/lib/{forms,form-edit}.ts` (error codes), `src/styles/app.css`.

**Docs:** root `README.md`, `apps/landing/.env.example`, `DEPLOYMENT.md`, `PRODUCTION.md`,
`db/README.md`, `server/forms/interpretation/README.md`.

## 2. Migrations

- **`007_ai_credits.sql`** (new, additive, idempotent): `user_entitlement` (plan, subscription status,
  billing period and per-bucket enablement), `credit_ledger` (append-only: `daily_grant`,
  `monthly_grant`, `ai_consumption`, `manual_adjustment`, `expiration`; signed nonzero `credits`;
  bucket + period key; partial unique indexes for one grant per period and one charge per operation
  and bucket; owner cascade), and `ai_operation` (one row per attempt: operation key/type, provider,
  model, tokens, latency, outcome, error category, credits charged, `UNIQUE (user_id, operation_key)`).
- Migration lists in `db/README.md`, `DEPLOYMENT.md`, `PRODUCTION.md`, root `README.md` and
  `server/forms/interpretation/README.md` now include `007`; the storage tests assert the exact,
  additive, idempotent file list and the `007` contract.
- **Not applied to any real database.** No Neon URL was available; the SQL has never run against
  PostgreSQL in this environment.

## 3. Google sign-in implementation

- Better Auth's built-in Google social provider, configured in `server/auth.ts` from
  `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET`. **Both or neither:** a half-configured pair throws at
  startup; when unset, the social provider object is omitted entirely and the app behaves exactly as
  before.
- Callback: `${BETTER_AUTH_URL}/api/auth/callback/google`. Sign up, sign in, continue and sign out use
  Better Auth's existing session/cookie machinery — email/password is untouched, protected routes and
  the `/api/me` guard are unchanged, and no token is ever stored or read by the browser.
- Account linking uses only Better Auth's supported behavior: linking is enabled, `google` is a
  trusted provider, different emails are refused, and locally-verified email is still required. A
  Google sign-in that collides with an existing password account returns `?error=account_not_linked`;
  the user signs in with the password and links Google explicitly from the Account page
  (`client.linkSocial`). No custom merging code exists.
- `GET /api/sign-in/config` returns `{ providers: { google: boolean } }` only. The auth page renders
  the Google button only when configured, and maps error codes to plain language via
  `oauthErrorMessage` (shared with the Account page); `error_description` is never rendered.
- **Separation from Google Forms:** different Google Cloud client, different environment variables
  (`GOOGLE_CLIENT_ID`/`GOOGLE_CLIENT_SECRET` vs `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`),
  different redirect URIs (`/api/auth/callback/google` vs `/api/providers/google/callback`). Login
  requests identity scopes only; the Forms grant still happens separately in Connections.
- **Not verified live:** no real Google consent screen was exercised.

## 4. Groq implementation

- `GroqProvider` speaks Groq's OpenAI-compatible Chat Completions API
  (`https://api.groq.com/openai/v1/chat/completions`) with `Authorization: Bearer $GROQ_API_KEY`, a
  30-second explicit timeout, a bounded response read, JSON extraction, and structured-output request
  fields where the model supports them.
- Existing prompts and JSON schemas were preserved byte-for-byte (they moved to `prompts.ts`); the
  strict assessment of every result (`assessInterpretation`, the canonical validator and the Google
  layout planner) is unchanged, so a claimed structured output is still fully re-validated.
- **One attempt per call. No internal retry, no request-time vendor fallback** — this is what keeps
  downstream Google actions and credit charges from being duplicated.
- Failure taxonomy preserved and unified: `model_not_configured`, `model_timeout`,
  `model_unavailable`, `model_rate_limited`, `model_provider_error`, `model_invalid_output`, with the
  existing HTTP status map (429/502/503) and safe user-facing sentences. Raw provider bodies are never
  surfaced.
- **Not verified live:** no Groq request was made; model output quality and strict-schema behavior for
  realistic prompts can only be proven with a real key.

## 5. Model and configuration

| Variable | Meaning |
| --- | --- |
| `GROQ_API_KEY` | Primary provider credential; server-only. Blank → explicit `model_not_configured`, never a fabricated draft |
| `GROQ_MODEL` | Optional override; default **`openai/gpt-oss-120b`** |
| `GROQ_REASONING_EFFORT` | Optional `low` / `medium` / `high`, sent only when set |
| `AI_PROVIDER` | Optional explicit `groq` or `openai`; missing credential for the chosen provider is a startup error |
| `AI_MAX_COMPLETION_TOKENS` | Optional 256–32768 ceiling (default 6,000) |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional alternate provider, selected explicitly or when it is the only credential |

`openai/gpt-oss-120b` was chosen deliberately because Groq documents **strict** JSON-schema
constrained decoding only for that model; `GROQ_MODEL` makes the choice configurable without a code
change. `llama-3.3-70b-versatile` was avoided (Groq's Free/Developer sunset notice) rather than
hardcoded.

## 6. Provider abstraction

`AiProvider` (`provider.ts`) is the only interface the pipeline depends on; `FormInterpreter` and the
routes never import a vendor. The registry resolves Groq → OpenAI → a fail-closed unconfigured
stand-in, with no request-time failover. Adding a provider means implementing the interface and
registering it — `server/ai/README.md` documents the contract.

## 7. Credit system

- **Prices are deterministic and server-side** (`pricing.ts`): creation scores from question count and
  conditional logic (≤8 → 2, ≤14 → 3, ≤24 → 4, else 5); edits cost 1 (single change), 2–3 (small
  batch / structural), 4–5 (large or heavy restructuring). The model never influences a price and the
  browser cannot submit one — extra body keys are rejected before the model is called.
- **One logical operation, one charge.** `ai/operations.ts` wraps a whole operation (possibly several
  model calls, validation, corrections) and charges exactly once, only when a validated, usable result
  exists. Failures, timeouts, invalid output, clarifications and honest "unsupported" answers cost
  nothing, and every attempt is still recorded.
- **Affordability first:** a balance that cannot cover the cheapest operation is refused with
  `insufficient_credits` (HTTP 402) before any model call is paid for. Applying an already-reviewed
  edit plan or publishing a confirmed form is a provider write, not an AI operation, and is not
  charged again.

## 8. Entitlements

| Plan | Daily (UTC) | Monthly reserve | Rollover |
| --- | ---: | ---: | --- |
| Free | 20 | — | none |
| Pro | 20 | 500 per billing period | none |

Consumption order is documented in code and tests: **daily first, then monthly**. Daily credits are
keyed by UTC date and monthly credits by the billing period (or UTC month). A plan change cannot keep
spending a bucket the current plan does not grant (a downgrade zeroes the monthly reserve for spend
while keeping its history), and grants are idempotent per period. All entitlement logic lives in
`entitlements.ts` — no scattered `if (user.plan === 'pro')` exists anywhere in routes, engines or UI
(the UI only formats the plan it is told).

## 9. Usage tracking

`ai_operation` records one row per logical operation: user, operation id and key, operation type
(`form_create`, `form_edit`, `form_revise`), provider, model, input/output/total tokens, latency,
outcome (`succeeded` / `failed` / `no_result`), error category and credits charged. Failures and
free outcomes are recorded too. Raw tokens and prices stay server-side; the browser receives only
`plan`, `dailyRemaining`, `monthlyRemaining`, `nextDailyReset` and `nextMonthlyReset`.

## 10. Idempotency

- The browser sends a validated `operationId` per submission (`/^[A-Za-z0-9_-]{8,64}$/`; anything else
  is replaced by a server-generated key). Both AI call sites keep the key on an uncertain network
  failure and settle it only on a definite server outcome, so a retry can never be charged twice.
- `credit_ledger` has a partial unique index on `(user_id, operation_key, bucket)` for consumption
  rows and `ai_operation` has `UNIQUE (user_id, operation_key)`: a replay is detectable at the
  database level, not just in application code.
- The charge itself runs in one transaction that locks the user's entitlement row, so concurrent
  requests cannot race a read-modify-write, double spend or overdraw; the in-memory store mirrors the
  semantics (tested with 12 concurrent claims).

## 11. API surface

| Endpoint | Behavior |
| --- | --- |
| `GET /api/credits` | `200 { credits: { plan, dailyRemaining, monthlyRemaining, nextDailyReset, nextMonthlyReset } }`, `Cache-Control: no-store`; `401 not_authenticated`; `503 storage_unavailable` |
| Successful `/api/forms/interpret`, `/revise`, `/edit/interpret`, `/edit/revise` | Body additionally carries the post-charge `credits` projection |
| Any AI operation the user cannot afford | `402 insufficient_credits`, no model call, no draft, no Google request, nothing charged |

There is no body, no query and no client-settable field on the balance endpoint. Technical rate
limits remain separate and unchanged.

## 12. Tests added and results

| File | Tests | Coverage |
| --- | ---: | --- |
| `test/credits.test.mjs` (new) | 12 | Plans, daily grant, no rollover, Pro monthly overflow, billing-period buckets, downgrade guard, price table, zero-cost and insufficient cases, replay idempotency, concurrency, grant idempotency, public-projection leak check, migration 007 contract |
| `test/ai-operations.test.mjs` (new) | 7 | Multi-call single charge, replay, failure and non-result cost 0, affordability blocks the model call, charge failure withholds the result, usage rows vs public balance, per-operation call scopes |
| `test/credits-routes.test.mjs` (new) | 10 | Balance endpoint and 401, creation charge and replay, complex-creation price, failures free, clarification/unsupported free, 402 before model call, revise as its own charge, Pro daily-then-monthly order, metered edit interpretation, unmetered deployment fallback |
| `test/credits-client.test.mjs` (new) | 4 | Fail-closed balance parsing, reset wording, summary, out-of-credits copy |
| `test/auth-google-signin.test.mjs` (new, Phase 11 Step 1) | 7 | Config gating, both-or-neither credentials, callback URI, link policy, no token storage in the browser |
| `test/ai-provider.test.mjs` (new, Groq step) | 8 | Provider selection, endpoint/auth/body, taxonomy mapping, no retry/fallback |
| Existing suites | — | `interpretation`, `drafts-routes`, `forms-edit`, `forms-page`, `frontend`, storage and deployment tests updated for metering, `operationId` and migration `007` |

**Full run (`npm test`, from `apps/landing`): 327 tests, 327 pass, 0 fail.** The new metered-edit
integration test also caught and fixed a real pre-existing bug: the workspace sends
`target: { kind: 'record' | 'url', … }` while the server accepted only the bare shape, so edit
interpretation would have failed with `400 invalid_request` in production.

## 13. Build result

| Command | Result |
| --- | --- |
| `npm run typecheck` | Passed (`tsc -p .` and `tsc -p tsconfig.server.json`) |
| `npm run build` | Passed; production Vite build ✓ |
| `npm test` | 327/327 passed (build runs as `pretest`) |
| `npm audit --omit=dev` | 0 vulnerabilities |
| `git diff --check` | Clean |

## 14. Required environment variables

**Render API service (server-only, never `VITE_*`):** `DATABASE_URL`, `BETTER_AUTH_SECRET`,
`BETTER_AUTH_URL` (existing); `GROQ_API_KEY` (new, required for live inference) with optional
`GROQ_MODEL`, `GROQ_REASONING_EFFORT`, `AI_PROVIDER`, `AI_MAX_COMPLETION_TOKENS`,
`OPENAI_API_KEY`/`OPENAI_MODEL`; optional Google **sign-in** `GOOGLE_CLIENT_ID` +
`GOOGLE_CLIENT_SECRET` (separate client from `GOOGLE_OAUTH_CLIENT_ID`/`GOOGLE_OAUTH_CLIENT_SECRET`
used for Forms). No credit-related environment variables exist: plans and balances live in
PostgreSQL.

## 15. Manual production setup (not performed here)

1. **Groq:** create an API key, set `GROQ_API_KEY` on Render (leave `GROQ_MODEL` at the default or
   override deliberately). Confirm the account has quota/billing.
2. **Google sign-in (optional):** create a *separate* Google Cloud OAuth client → Web application;
   authorized redirect URI `${BETTER_AUTH_URL}/api/auth/callback/google`; set `GOOGLE_CLIENT_ID` and
   `GOOGLE_CLIENT_SECRET` on Render. Do **not** reuse the Forms client, and add no Forms scopes here.
3. **Database:** back up, then `npm run db:migrate` and `npm run db:migrate:intake` (applies `007`).
   Confirm `user_entitlement`, `credit_ledger`, `ai_operation` exist.
4. **Verify:** `GET /api/credits` returns 20 free credits; one description charges 1–5 and returns the
   new balance; replaying the same `operationId` never charges twice; draining the allowance returns
   `402 insufficient_credits` with no model call and no Google form; failed/clarified attempts appear
   in `ai_operation` with `credit_cost = 0`.
5. **Plans:** there is no payment provider. `CreditService.setPlan` is the deliberate hook for a later
   Bachs.io or admin integration; no route exposes it.

## 16. Known limitations and explicitly unverified items

- **No live Google sign-in** was exercised (no client credentials, no consent screen).
- **No live Groq (or OpenAI) inference** was exercised; model quality, strict-schema compliance,
  latency and real cost are unverified.
- **Migration `007` has never run against PostgreSQL.** The transaction, row lock and partial unique
  indexes were not exercised against Neon; credit tests use the in-memory store, which mirrors the
  semantics.
- **No billing integration.** Plan changes are server-side only; nothing upgrades a user automatically,
  there is no purchase flow, no rollover, and monthly credits reset per period.
- The workspace credit meter is intentionally minimal (sidebar + overview line); there is no usage
  history, admin dashboard or per-operation receipt UI.
- The AI layer is still single-attempt with no fallback; a provider outage means a user-visible error,
  by design.
- Out of scope and untouched: payments/Bachs.io, email/Calder, `/admin`, pricing-page and landing
  redesign, Microsoft Forms creation, Cloudflare migration.
