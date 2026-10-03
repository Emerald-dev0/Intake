# Production security and recovery guide

This guide describes the controls implemented in this repository. It is not evidence that a particular Render, Vercel, Neon, Google, Microsoft, or OpenAI deployment has been configured correctly. Complete the live checks in `DEPLOYMENT.md` before calling a release production-ready.

## Required release order

1. Use Node 22.12 or newer and PostgreSQL 15 or newer, then install with `npm ci`. Migration `006` uses PostgreSQL 15's column-specific `ON DELETE SET NULL` syntax.
2. Set the API-service variables below. Keep every non-`VITE_` secret off the browser/Vercel frontend.
3. Back up the intended database and run Better Auth migrations with `npm run db:migrate`.
4. Run `npm run db:migrate:intake`. Migration `006_production_hardening.sql` adds distributed abuse-control storage and validates that every edit draft's optional form record belongs to the same user. Migration `007_ai_credits.sql` adds `user_entitlement`, `credit_ledger` and `ai_operation`; it is additive and issues no grants by itself (the first credit read or AI operation issues that period's grant). Neither migration rewrites or deletes application rows. `006` intentionally fails if historical ownership data violates that constraint; investigate rather than bypassing or deleting records.
5. Run `npm run typecheck`, `npm test`, and `npm audit --omit=dev` from `apps/landing`.
6. Deploy the API, then the frontend proxy. Verify the acceptance checklist in `DEPLOYMENT.md` with non-production accounts and forms.

## Configuration contract

The API validates core settings before constructing auth, encryption, or the listener.

| Variable | Requirement |
| --- | --- |
| `DATABASE_URL` | PostgreSQL URL with a database name. Production requires `sslmode=require`, `verify-ca`, or `verify-full`. |
| `BETTER_AUTH_SECRET` | Unique, non-placeholder secret of at least 32 characters. Never rotate it without considering sessions and the token-key rule below. |
| `BETTER_AUTH_URL` | Exact public frontend origin, with no credentials/path/query/hash. HTTPS is mandatory in production. This is also the CSRF/trusted origin and OAuth callback origin. |
| `PORT` | Optional integer from 1–65535; defaults to 3001 locally. |
| `API_TRUST_PROXY_HOPS` | Optional integer from 0–4; defaults to 0. Set only to the verified number of trusted reverse-proxy hops. A wrong value can make network rate limiting ineffective or group users under one proxy address. |
| `PROVIDER_TOKEN_KEY` | Strongly recommended dedicated 32+ byte random key for provider-token encryption. If omitted, a key is derived from `BETTER_AUTH_SECRET`; rotating that secret then invalidates stored provider grants. |
| `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET` | Required for Google connection and Forms access. Register the exact callback under `BETTER_AUTH_URL`. |
| `MICROSOFT_OAUTH_CLIENT_ID`, `MICROSOFT_OAUTH_CLIENT_SECRET` | Optional connection support only; Microsoft Forms creation/editing is not implemented. |
| `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` | Optional Google **sign-in** (identity only). Both or neither; a half-configured pair is a startup error. Register exactly `${BETTER_AUTH_URL}/api/auth/callback/google`. Use a different Google Cloud client from the Forms connection below. |
| `GROQ_API_KEY` | Primary AI provider credential, server-only. Missing configuration fails visibly (`model_not_configured`) and never fabricates a draft. |
| `GROQ_MODEL` | Optional; default `openai/gpt-oss-120b` (Groq strict JSON-schema model). |
| `GROQ_REASONING_EFFORT` | Optional `low`, `medium`, or `high`. |
| `AI_PROVIDER` | Optional explicit `groq` or `openai`. A missing credential for the chosen provider is a startup error; there is no request-time failover. |
| `AI_MAX_COMPLETION_TOKENS` | Optional 256–32768 ceiling per model call; default 6000. |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | Optional alternate provider, used only when explicitly selected or when it is the sole credential. |

AI credits have no environment variables: plan, grants and spend live in PostgreSQL (`user_entitlement`, `credit_ledger`, `ai_operation`) and are read and written only by the server. There is no billing integration yet, so changing a plan is a deliberate server-side operation, never a client request.

Do not prefix secrets with `VITE_`, place tokens in URLs, log environment objects, or expose the API service directly under a different browser origin. Browser calls use same-origin relative `/api` paths through the frontend proxy; the API does not enable wildcard CORS.

## Security boundaries

- Better Auth owns login and session cookies. Each provider, draft, form, edit, and library route independently resolves the session; a browser-supplied user/account/connection id is never authoritative.
- PostgreSQL lookups and mutations include the owner. Migration `006` also binds `(user_id, form_record_id)` to the same owned form at the database layer.
- OAuth uses short-lived, hashed, single-use state bound to user and provider, plus PKCE. Success, denial, and cancellation callbacks all consume valid state before their result is accepted. Redirect-following is disabled for OAuth/token/identity and Google Forms HTTP calls.
- Provider access and refresh tokens are encrypted with authenticated encryption and owner/provider/field additional authenticated data. They are server-only and omitted from responses and safe logs.
- Provider and model response bodies are bounded (1 MB OAuth/identity/JWKS, 5 MB Google Forms, and the model-specific bound). API JSON bodies are route-bounded; declared auth bodies over 64 KiB are rejected before credential hashing.
- The model can only propose typed data. Output passes strict parsing, the canonical form validator, provider capability planning, current-provider-state checks for edits, server-owned draft persistence, version checks, and explicit confirmation. Production disables direct structured `POST /api/forms`; creation goes through a reviewed persisted draft.
- API responses are `no-store` and carry request IDs plus baseline anti-sniffing/framing/referrer/permissions headers. Session and global errors use safe projections and redacted logging.

## Technical abuse controls

These are operational abuse ceilings, not plans, billing quotas, or user entitlements. They use the existing PostgreSQL database so decisions are shared across API processes. Only keyed SHA-256 HMAC subject digests and counters are stored; raw user ids, IP addresses, request bodies, prompts, and credentials are not stored in the limiter table. The validated auth secret is used as the HMAC key; rotating it starts fresh limiter buckets.

| Scope | Per signed-in user | Per derived network address | Window |
| --- | ---: | ---: | ---: |
| OAuth start | 8 | 800 | 10 minutes |
| OAuth callback | 20 | 2,000 | 10 minutes |
| AI interpretation/revision | 8 | 800 | 10 minutes |
| Confirmed form creation | 12 | 1,200 | 10 minutes |
| Provider-backed reads/import/refresh | 30 | 3,000 | 10 minutes |
| Confirmed edits / OAuth disconnect | 20 | 2,000 | 10 minutes |

Expensive model/provider operations fail closed if limiter storage is unavailable. A rejection uses HTTP 429 and `Retry-After`; a limiter outage uses a retryable 503 before external work. Model interpretation also retains one in-flight call per user per process. Confirmed write limits apply only while a draft is ready and before its atomic claim, so replaying a terminal result does not create or mutate anything and does not consume a write attempt.

`API_TRUST_PROXY_HOPS=0` deliberately ignores forwarded addresses. Verify the actual proxy chain before changing it. Monitor whether many users resolve to one proxy address; if they do, the network ceiling is shared. Do not trust arbitrary `X-Forwarded-For` input.

## AI credits and entitlements

Credits are user entitlements (what a plan allows), separate from the technical abuse controls above (how fast a user may ask). Both are enforced server-side and both fail closed. Free accounts receive 20 credits per UTC day; Pro adds a 500-credit monthly reserve for the billing period. Nothing rolls over, consumption takes daily credits first, and every reset instant is computed on the server.

- Prices are decided by Intake from the *validated* result, never from raw model output and never from a request field: 1 credit for a simple change, 2 for a normal creation or moderate edit, 3–5 for large or conditional operations. One logical operation is one charge no matter how many internal model calls, validations or corrections it takes.
- Failed, timed-out, invalid, clarifying or unsupported AI attempts cost nothing. Publishing an already-reviewed draft against the Google Forms API costs nothing extra; the charge belongs to the AI operation, not the provider write.
- `credit_ledger` is append-only and is the source of truth (`daily_grant`, `monthly_grant`, `ai_consumption`, `manual_adjustment`, `expiration`); `ai_operation` records one row per attempt with provider, model, tokens, latency, outcome, error category and credits charged. A charge runs in one transaction that locks the user's `user_entitlement` row, so concurrent requests cannot overdraw or double charge, and no balance can go negative.
- `GET /api/credits` returns only `plan`, `dailyRemaining`, `monthlyRemaining`, `nextDailyReset` and `nextMonthlyReset`, with `Cache-Control: no-store`. Successful AI responses repeat that projection so the workspace meter stays current. An exhausted account gets HTTP 402 `insufficient_credits` before any model call, with nothing charged, created or changed.
- If credit storage is unavailable, the operation is refused with `storage_unavailable`; Intake never charges without a durable ledger row and never gives credits away when it cannot record them.
- A user who is downgraded stops being able to spend a monthly reserve the current plan does not grant; historical ledger rows are kept, not deleted.
- No payment provider is integrated. `CreditService.setPlan` is the deliberate hook for future Bachs.io or admin work; no route exposes it, and no admin dashboard or purchase flow exists in this phase.

Operational queries:

```sql
-- Current balance per bucket for one user (grants minus consumption, per bucket)
SELECT bucket, SUM(credits) AS remaining FROM credit_ledger WHERE user_id = $1 GROUP BY bucket;

-- Why a specific operation was charged (or not)
SELECT operation_key, operation_type, provider, model, outcome, error_category, credit_cost, latency_ms
FROM ai_operation WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20;

-- Accounts whose plan grants a bucket that is not enabled by their current plan
SELECT user_id, plan, daily_enabled, monthly_enabled FROM user_entitlement
WHERE plan = 'free' AND monthly_enabled;
```

Do not hand-edit `credit_ledger` rows to fix a balance: add a `manual_adjustment` entry with an operator note in the deployment log, so the audit trail stays intact.

## Failure and recovery rules

| Condition | Behavior | Operator/user action |
| --- | --- | --- |
| Model/provider unavailable before any provider write | Safe retryable error; no success is claimed. | Respect `Retry-After` when present and retry deliberately. |
| Google rejects creation before a form exists | Draft may return to ready only when the outcome is definitively `not_created`. | Correct connection/configuration, then confirm the same draft. |
| Creation times out or connection drops with unknown outcome | Draft remains blocked/creating; no blind retry. | Search the user's Google Forms and Intake library, correlate the request ID, and reconcile manually. |
| Questions/routing/publish fail after form creation | Incomplete record and real edit link are retained; the same draft cannot run again. | Open the partial Google Form and repair or remove it manually. Intake never deletes it automatically. |
| Edit current state/revision changed | Draft is stale; no provider mutation. | Re-inspect and prepare a new edit against fresh state. |
| Edit times out after a mutation may have reached Google | Outcome is blocked/unknown; no blind retry. | Inspect the exact Google form and prepare a fresh proposal only after verifying state. |
| Provider succeeds but the result cannot be persisted | Durable claim remains locked, preventing a duplicate. | Reconcile provider state and database state using the request ID; do not reset claims casually. |
| User has no affordable credits | Request is refused before the model call with 402 `insufficient_credits`; nothing is charged, created or changed. | Wait for the daily reset shown in the workspace, or change the plan deliberately; do not retry in a loop. |
| Credit ledger or entitlements unavailable | The AI operation is refused with a retryable 503 `storage_unavailable`; nothing is charged. | Restore database availability (migration `007` must be applied) and retry deliberately. No model call was made. |
| Usage recording fails after a successful charge | The user keeps their result; the failure is logged safely and never fails the request. | Inspect application logs; the ledger row remains the source of truth for what was charged. |
| Refresh token is rejected/revoked | Ciphertext is cleared and reconnection is required. | Reconnect the same external account. |
| Disconnect revocation fails | Local credentials are still removed; response states revocation was not confirmed. | Revoke Intake from the provider security console if required. |
| Archive/remove library record | Changes local metadata only. | External Google Forms remain untouched and can be re-imported. |

The API coalesces concurrent token refreshes for one user/provider within a process. There is no cross-instance refresh lease; two instances can still race a rotating refresh token. A losing request can require reconnection. Keep this limitation in mind when scaling horizontally.

## Data validation and operational queries

Before migration `006`, this read-only query should return no rows:

```sql
SELECT d.id, d.user_id AS draft_owner, f.user_id AS form_owner
FROM form_edit_draft d
JOIN form f ON f.id = d.form_record_id
WHERE d.form_record_id IS NOT NULL AND d.user_id <> f.user_id;
```

Never "fix" a mismatch by deleting provider forms. Preserve evidence, determine the correct owner from application records, and make a reviewed database repair before rerunning the migration.

The `api_rate_limit` table is ephemeral operational data. The application periodically removes rows expired for more than one day. Losing that table during an incident removes counters and causes operations to fail closed until migration `006` is restored; it does not lose forms, drafts, users, or provider connections.

## Local verification record (2026-10-01)

Run from `apps/landing` unless noted:

| Command | Result |
| --- | --- |
| `npm ci` | Passed; 305 packages installed, 306 audited, 0 vulnerabilities reported. |
| `npm run typecheck` | Passed for browser and server TypeScript projects. |
| `npm test` | Passed; production Vite prebuild succeeded and 278/278 mocked/local tests passed with 0 failures, skips, or cancellations. |
| `npm run build` | Passed; TypeScript checks and production Vite build completed. |
| `npm audit --omit=dev` | Passed; 0 vulnerabilities reported. |
| `git diff --check` (repository root) | Passed. |

Credit behavior was verified with `node --test --import tsx`: plans, grants, no-rollover, daily-first consumption, the downgrade guard, pricing, idempotent replay, concurrent consumption and the public projection (`test/credits.test.mjs`); one-charge-per-logical-operation, affordability pre-checks and zero cost for failures/non-results (`test/ai-operations.test.mjs`); the HTTP surface, 402 behavior and usage rows (`test/credits-routes.test.mjs`); and fail-closed client balance parsing with the out-of-credits wording (`test/credits-client.test.mjs`). These run against the in-memory store; the PostgreSQL transaction and index behavior of `007` was not exercised against Neon.

There is no lint script. Migration `001` through `006` was additionally applied to an ephemeral in-memory PGlite/PostgreSQL-compatible database outside the repository; `006` re-applied idempotently, both new constraints were validated, a historical cross-owner edit reference was rejected, and deleting a referenced form set only `form_record_id` to null while preserving the draft owner. This is useful SQL-semantic coverage but is **not** a Neon migration or production-data test.

## Known limitations and verification gaps

- `/api/health` proves process liveness only. It does not check Neon, providers, the model, migration level, or Vercel proxy correctness.
- There is no repository CI workflow, lint script, centralized monitoring, automated reconciliation job, cross-instance token-refresh lock, or automatic provider-state repair.
- Fixed-window limits can produce boundary bursts. Network identity depends on a correctly verified proxy depth.
- OAuth revocation is best-effort. Microsoft revocation and Microsoft Forms create/edit are not claimed as supported.
- The application stores form structure/metadata, not respondent answers. Provider and model services still receive the data required for their operations under their own policies.
- Mocked tests cannot verify real cookie forwarding, Neon behavior, cloud headers, OAuth dashboards, provider scopes/consent, Google API semantics, AI-provider availability/quality, or external service quotas. Google **sign-in** was never exercised against Google's consent screen with real credentials, and no live Groq (or OpenAI) completion was made from this repository.
- Credit tests use the in-memory store. The PostgreSQL transaction, per-user row lock and partial unique indexes in `007_ai_credits.sql` were not exercised against a real database, and no plan has ever been changed by a billing provider.
- Migrations, live sign-in, OAuth, real forms, edits, real inference, and recovery drills must be exercised against non-production resources before release. No test result in this repository substitutes for those checks.
