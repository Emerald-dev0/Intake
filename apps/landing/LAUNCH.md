# Launch runbook — first production deployment

This is the ordered procedure for taking Intake from this repository to a real, reachable deployment,
plus the verification, rollback and operational facts that go with it.

It is written for the deployment state of **Phase 15**: the code is complete, but no Render service,
Neon database, Google Cloud client or Groq key existed yet. Everything below is meant to be executed
once, in order, by the project owner.

Conventions used here:

- `<SITE_ORIGIN>` — the origin users open, for example `https://intake.example.com` or
  `https://intake-six-blue.vercel.app`. It is configured in **two** places that must agree:
  `VITE_SITE_URL` (frontend build: canonical URL, Open Graph, robots, sitemap) and `BETTER_AUTH_URL`
  (API: sessions, trusted origin, OAuth callbacks). See [Domains](#domains-and-canonical-urls).
- `<RENDER_ORIGIN>` — the API service URL Render assigns, for example `https://intake-api.onrender.com`.
  It is never opened in a browser by a user; the Vercel proxy reaches it.
- Secret values are never written into this file, into `.env` files committed to Git, or into logs.
- **No test result in this repository proves live behaviour.** Section 8 separates what the automated
  script can check from what a human must do against real Google and Groq.

---

## 1. Order of operations

| # | Step | Where | Section |
| --- | --- | --- | --- |
| 1 | Create the Neon project and note both connection strings | Neon | [2](#2-neon-postgresql) |
| 2 | Create the Google Cloud project, APIs and **two** OAuth clients | Google Cloud | [3](#3-google-cloud) |
| 3 | Create the Groq API key | Groq | [4](#4-groq) |
| 4 | Create the Render web service and set server variables | Render | [5](#5-render-api-service) |
| 5 | Deploy the API, confirm `/api/health` | Render | [5](#5-render-api-service) |
| 6 | Run Better Auth migrations, then Intake migrations | your machine → Neon | [6](#6-migrations) |
| 7 | Create the Vercel project, set `BACKEND_URL` and `VITE_SITE_URL`, deploy | Vercel | [7](#7-vercel-frontend) |
| 8 | Attach the domain, then complete the Google callback URLs | Vercel + Google Cloud | [3](#3-google-cloud), [9](#9-domains-and-canonical-urls) |
| 9 | Run `npm run preflight -- --db` and `npm run verify:production` | your machine | [8](#8-verification) |
| 10 | Create the operator account, verify it, allowlist it, run the admin checks | site + Neon + Render | [8.4](#84-admin-console) |
| 11 | Walk the manual Google/Groq checklist with a throwaway Google account | site + Google | [8.3](#83-manual-live-integration-checklist-google--groq) |

Do not skip step 6 before step 7: without migrations the API starts but sign-up, credits and forms all
fail closed with `storage_unavailable`.

---

## 2. Neon PostgreSQL

1. Create a Neon project (PostgreSQL 15+). Keep the region close to the Render region: every API
   request that touches sessions, drafts, credits or the limiter crosses this connection.
2. Copy **two** connection strings from the Neon dashboard:
   - the **pooled** string (host contains `-pooler`) → runtime `DATABASE_URL`;
   - the **direct** string → used only for migrations from your machine.
3. Both must include `sslmode=require`. Production startup refuses a URL without
   `sslmode=require|verify-ca|verify-full`, and refuses a URL without a database name.
4. Connection pool: the API sets `max: 10` per process (`server/auth.ts`). Keep Render on a single
   instance for launch ([11](#11-single-instance-constraint)), which keeps total connections well
   inside Neon's limits. Do not raise `max` without measuring.
5. Nothing else is created by hand. `provider_connection`, `form`, `form_draft`, `form_edit_draft`,
   `api_rate_limit`, `user_entitlement`, `credit_ledger` and `ai_operation` all come from migrations.

### Backup and recovery reality

- Neon's **point-in-time restore** window depends on the plan (commonly hours on free, longer on paid)
  and is the primary recovery tool. Confirm the current window for the plan you choose; do not assume.
- Branches can be used to snapshot before a risky migration: create a branch, run migrations against
  the branch, verify, then promote/re-run against the main branch.
- If the database becomes unavailable: the API still answers `/api/health` (liveness) but sessions,
  drafts, credits, forms and rate limits fail closed — protected reads return `503`, and AI/provider
  work is refused before any external call. Nothing is silently faked.
- The limiter table (`api_rate_limit`) is disposable operational data: losing it removes counters and
  fail-closes expensive operations until migration `006` is restored. It holds no user data.
- `credit_ledger` is append-only and is the source of truth for balances. Restoring a database rolls
  balances back with it; do not "repair" balances by hand without a reviewed ledger entry
  (`manual_adjustment`).

---

## 3. Google Cloud

Two authorizations, **two separate OAuth clients**, never merged:

| Concern | Client | Redirect URI | Scopes |
| --- | --- | --- | --- |
| Sign in to Intake ("Continue with Google") | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `<SITE_ORIGIN>/api/auth/callback/google` | identity only: `openid`, `email`, `profile` |
| Let Intake create/edit the user's Google Forms | `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | `<SITE_ORIGIN>/api/providers/google/callback` | `https://www.googleapis.com/auth/forms.body` |

`BETTER_AUTH_URL` equals `<SITE_ORIGIN>`, so both redirect URIs are exactly the strings above. Do not
guess different paths, and do not add a trailing slash. `localhost` and a custom domain are different
origins: add the local URIs too if you develop locally, but keep production values distinct.

### Steps

1. Create one Google Cloud project (for example `intake-production`).
2. **APIs & Services → Library**: enable **Google Forms API**. Without it, creation fails with a clear
   "not enabled" error from the API — the connection still works, so this is easy to misdiagnose.
3. **OAuth consent screen**:
   - App name: `Intake`. Support email: a mailbox you actually monitor.
   - Authorized domain: the registrable domain of `<SITE_ORIGIN>` (for example `example.com`). A
     `*.vercel.app` origin has no authorized domain you control — verification requires a real domain.
   - App home page and privacy policy URL: pages on your own domain. Google verification requires the
     privacy policy to be reachable from the app home page and to describe what data is accessed.
   - User type: **External**.
   - Scopes: add `openid`, `email`, `profile` and `https://www.googleapis.com/auth/forms.body`.
     Request nothing else. Intake does not use Drive, Gmail or Calendar scopes.
4. **Credentials → Create credentials → OAuth client ID → Web application** (twice):
   - `Intake sign-in` → authorized redirect URI `<SITE_ORIGIN>/api/auth/callback/google`.
   - `Intake Google Forms` → authorized redirect URI `<SITE_ORIGIN>/api/providers/google/callback`.
5. Put each pair on **Render only**. Never on Vercel, never as a `VITE_` variable.

### Publishing status and the verification requirement (read before promising persistence)

`forms.body` is a **sensitive** scope. Two consequences apply until the consent screen is verified:

- **100-user cap.** An app in *Testing* (or published but unverified) can be authorized by at most 100
  Google accounts in the project's lifetime. Identity-only scopes are exempt, so Google **sign-in**
  keeps working for anyone once published; the Forms client is the constrained one.
- **7-day refresh tokens.** With an *External* user type and a *Testing* publishing status, Google
  issues refresh tokens that expire after seven days. After that, the Forms connection requires
  reauthorization — Intake will report `reauthorization_required` and clear the unusable ciphertext.
  This is a Google rule, not an Intake bug, and it directly limits "the connection survives" testing
  during Phase 15. Moving the consent screen to *In production* (with verification for the sensitive
  scope) is what removes it.
- While in *Testing*, add each test Google account under **Test users**. Unlisted accounts cannot
  authorize the Forms client.

**Do not attempt to bypass verification.** Plan for it: it is the step that turns Intake from a
"works on my Google account" demo into a product other people can use.

---

## 4. Groq

1. Create an API key in the Groq console, scoped to a project you can rotate.
2. Set `GROQ_API_KEY` on Render only, plus `GROQ_MODEL` (default `openai/gpt-oss-120b`, a strict
   JSON-schema model). Optional: `GROQ_REASONING_EFFORT=low|medium|high`.
3. The key must never appear in Vercel, in browser JavaScript, in an API response or in a log line.
   `npm run preflight` fails if a `VITE_`-prefixed variable looks like a credential.
4. There is no request-time vendor failover. If you also set `AI_PROVIDER=groq`, a missing key is a
   startup error on purpose.

---

## 5. Render API service

Create the service from the repository's `render.yaml` (New → Blueprint, or an existing Web Service
with the same settings).

| Setting | Value |
| --- | --- |
| Root directory | `apps/landing` |
| Build command | `npm ci` |
| Start command | `npm start` |
| Health check path | `/api/health` |
| Instance count | **1** ([11](#11-single-instance-constraint)) |
| Node | `NODE_VERSION=22.22.3` (any 22.x ≥ 22.12) |

Environment variables (server-only; secret values are entered in the dashboard):

| Variable | Required | Notes |
| --- | --- | --- |
| `NODE_ENV` | yes | `production`. Enables production validation and HSTS. |
| `DATABASE_URL` | yes | Neon **pooled** string with `sslmode=require`. |
| `BETTER_AUTH_SECRET` | yes | ≥32 random characters, unique per environment. Rotating it invalidates sessions. |
| `BETTER_AUTH_URL` | yes | Exactly `<SITE_ORIGIN>`, HTTPS, no trailing slash. |
| `PROVIDER_TOKEN_KEY` | strongly recommended | 32+ random bytes. Without it, provider tokens are encrypted with a key derived from `BETTER_AUTH_SECRET`, so rotating that secret forces every user to reconnect Google. |
| `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | for Forms | Forms connection client. |
| `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | for sign-in | Identity client; both or neither — a half-configured pair is a startup error. |
| `GROQ_API_KEY` | yes | Interpretation. Missing → `model_not_configured`, no charge, no fake form. |
| `GROQ_MODEL` | optional | Default `openai/gpt-oss-120b`. |
| `ADMIN_EMAILS` | optional | Comma-separated, exact, server-only allowlist for `/admin`. Empty denies everyone. |
| `API_TRUST_PROXY_HOPS` | optional | Keep `0` until the real chain is verified in a request ([10](#10-trust-proxy)). |
| `PORT` | supplied by Render | The server binds `0.0.0.0`. |
| `MICROSOFT_OAUTH_*` | do not set | Connection only; Microsoft Forms create/edit is not implemented. |
| `OPENAI_API_KEY`, `AI_PROVIDER` | do not set | Only for an explicit alternate vendor. |

Verify the environment **before** trusting it:

```bash
cd apps/landing
npm run preflight            # validates this shell's environment, prints no secret values
npm run preflight -- --db    # additionally checks connectivity, tables and applied migrations
```

`npm run preflight -- --json` is suitable for a deploy script. Exit code 1 means at least one check
failed; warnings are decisions, not errors.

---

## 6. Migrations

Run from `apps/landing`, against the **direct** Neon connection string, in this order:

```bash
# 1. Better Auth tables: "user", "session", "account", "verification"
DATABASE_URL='postgresql://…direct…' npm run db:migrate

# 2. Intake tables, in filename order, each in its own transaction and recorded in
#    intake_schema_migration
DATABASE_URL='postgresql://…direct…' npm run db:migrate:intake
```

Then confirm the real schema (read-only):

```bash
DATABASE_URL='postgresql://…' npm run preflight -- --db
```

Expected: all 12 tables present and the applied migration ids listed. `db/migrate.ts` refuses to run
before the Better Auth `"user"` table exists, applies each file exactly once, and rolls back a file
that fails — do not paste migration SQL into the Neon console by hand.

Safety notes specific to these migrations:

- Migrations are additive and idempotent by `intake_schema_migration`. Re-running is a no-op.
- `006_production_hardening.sql` intentionally **fails** if historical edit drafts reference another
  user's form. On a fresh database it cannot. If it fails on real data, investigate the rows — never
  delete them to make the migration pass.
- `007_ai_credits.sql` archives a legacy `ai_operation` table to `ai_operation_legacy_phase12` rather
  than dropping it. It creates no rows; the first credit read or AI operation issues that period's
  grant.
- There is no `down` migration. See [12](#12-rollback) before changing schema on production data.

---

## 7. Vercel frontend

| Setting | Value |
| --- | --- |
| Root directory | `apps/landing` |
| Framework | Vite |
| Install command | `npm ci` |
| Build command | `npm run build` |
| Output directory | `dist` |
| Node | 22.x (`engines.node` is `22.x`) |

Environment variables:

| Variable | Scope | Purpose |
| --- | --- | --- |
| `BACKEND_URL` | Production (server-side, consumed by `vercel.json` routes) | The Render HTTPS origin, no trailing slash, no path. |
| `VITE_SITE_URL` | Production (build-time, public) | Canonical origin for `<link rel="canonical">`, Open Graph, JSON-LD, `robots.txt` and `sitemap.xml`. Optional; unset falls back to the documented default in `src/lib/site-url.ts`. |

Never place `DATABASE_URL`, `BETTER_AUTH_SECRET`, `PROVIDER_TOKEN_KEY`, `GOOGLE_*`, `GROQ_API_KEY` or
`OPENAI_API_KEY` on Vercel — not even as non-`VITE_` variables "for safety". The frontend has no
server runtime that needs them.

What `vercel.json` does, in order: baseline security headers on every response (`continue: true`, so
routing is unaffected), `/api/*` → `${BACKEND_URL}/api/*` with `Cache-Control: no-store`,
`/app|/admin|/auth` → the noindex `private.html` document, `/pricing` → its own document, static
files, then the SPA fallback for public routes. `VITE_SITE_URL` is validated at build time: a value
that is not an exact lowercase HTTPS origin (path, trailing slash, query, credentials) fails the build
instead of shipping wrong metadata.

---

## 8. Verification

### 8.1 Automated, non-destructive

```bash
cd apps/landing
npm run verify:production -- --base-url <SITE_ORIGIN>          # anonymous checks
INTAKE_VERIFY_EMAIL=smoke@yourdomain.test INTAKE_VERIFY_PASSWORD='…' \
  npm run verify:production -- --base-url <SITE_ORIGIN>        # + sessions, credits, admin denial
npm run verify:production -- --base-url <SITE_ORIGIN> --json    # machine-readable
```

It checks, without creating data: liveness and deep (database) health, JSON-404 behaviour behind the
proxy, the API security-header baseline, the frontend header route, anonymous 401s on every protected
route, admin denial, the boolean-only sign-in config, absence of wildcard CORS, that Better Auth can
reach PostgreSQL, the public documents, canonical/robots/sitemap agreement, the session cookie flags
(`HttpOnly`, `Secure`, `SameSite=Lax`, host-only), session persistence, the credits projection,
wrong-password rejection, normal-user admin denial, and sign-out invalidation. Opt-in flags add a
cross-account ownership check (`--cross-user` with `--email-b`/`--password-b`), one metered
interpretation (`--ai-check`, **spends credits**) and the OAuth-start limiter (`--rate-limit-check`,
which will leave that account rate-limited for the scope window).

Exit code 1 on any failure. This never proves Google Forms behaviour.

### 8.2 Automated, in-repo

```bash
npm run typecheck && npm run build && npm test
```

`npm test` builds the production bundle first and runs the full suite (unit, route, security,
migration-contract and client tests). It uses mocked model responses and a stateful Google Forms
emulator: green here means the code paths are covered, **not** that live Google or Groq agree.

### 8.3 Manual live integration checklist (Google + Groq)

Use a throwaway Google account that is added as a **test user** on the Forms client. Record the date,
the Google account, the site URL and the result for each line. Do not use a personal primary account.

| # | Step | Expected |
| --- | --- | --- |
| 1 | Open `<SITE_ORIGIN>` | Marketing homepage loads over HTTPS; no console errors; `/pricing` renders with its own canonical. |
| 2 | Sign up with email/password | Straight into the workspace; refresh keeps the session; `/api/me` returns your email. |
| 3 | Sign out, sign in again | Session invalidated, then restored; browser back shows no account data. |
| 4 | "Continue with Google" | Google consent (identity only, no Forms wording), then workspace. |
| 5 | Public account check | Creating and editing are refused with a clear "connect Google Forms" state, not a fake form. |
| 6 | Connections → Connect Google Forms | Consent screen lists the Forms scope; callback returns success; connection shows the Google address. |
| 7 | Refresh the workspace | The connection persists; no repeated consent. |
| 8 | Describe: "Create a customer feedback form." | A structured proposal appears **without** a Google form existing yet; credits drop once, by the server-reported amount. |
| 9 | Confirm | Real **Open form** and **Edit form** links appear; the form exists in Google Forms and accepts a test response. |
| 10 | Re-submit the same confirmation (double-click / replay) | No second form is created; the same provider form id replays. |
| 11 | Edit: "Change the title." | Proposal only; Google unchanged until confirmation. |
| 12 | Confirm the edit | The title changes in Google; the form id and responder URL stay the same. |
| 13 | Edit: "Change the satisfaction question to a 1–10 rating." | Supported change proposed and applied; or a clear unsupported/limitation message — never a silent no-op. |
| 14 | Edit: "Add a question asking whether the user wants follow-up." | New question appears in the correct position after confirmation. |
| 15 | Unsupported request (for example Drive file uploads or email notifications) | Explicit refusal with the limitation explained; nothing created, nothing charged. |
| 16 | Credits: drain the balance in a test account, then request another operation | `402 insufficient_credits` before any model call; no draft, no Google change, no ledger consumption. |
| 17 | Fail the model (temporarily blank `GROQ_API_KEY` on Render, or use an invalid key in a staging service) | A useful error, `credit_ledger` unchanged, `ai_operation` at `credit_cost = 0`, no partial Google form. |
| 18 | Wait past the access-token lifetime (or revoke Intake in the Google account) | Refresh happens transparently; after revocation Intake reports `reauthorization_required` and asks to reconnect instead of looping. |
| 19 | `/app/account` and `/app` | Real balances, reset instants, connection state, library entries. |
| 20 | Sign out, sign in, reload everywhere | State persists; nothing is lost between sessions. |

Notes that keep this test honest:

- Step 18 involves the 7-day Testing-status refresh-token expiry described in
  [3](#publishing-status-and-the-verification-requirement-read-before-promising-persistence).
- Google Forms API responses are the only proof that steps 9, 12, 13, 14 and 18 worked. A mocked test
  never substitutes for opening the real form.
- Take a screenshot of the created form and the Intake library entry; that pair is the evidence that
  the provider form id, edit URL and responder URL line up.

### 8.4 Admin console

1. Sign in with the operator account, then make it eligible. `ADMIN_EMAILS` alone is not enough:
   admin access additionally requires `"emailVerified" = true` on the Better Auth user, and this
   phase ships no email delivery. Verify it deliberately:

   ```sql
   -- Neon SQL editor, after the account exists and you have confirmed you own the mailbox
   UPDATE "user" SET "emailVerified" = true WHERE email = 'owner@example.com';
   ```

   Never do this for an address you do not control; never trust a client-supplied flag.

2. Set `ADMIN_EMAILS=owner@example.com` on Render and redeploy.
3. Visit `/admin` while signed in: overview, users, AI usage, credits, forms, providers, system,
   activity and errors must render real data, paginate and filter, and never show tokens, ciphertext,
   prompts, model output or auth hashes.
4. Signed out, `/admin` and `/api/admin/*` must deny (`401`); signed in as a normal account, `403`.

### 8.5 What is still unproven after a green run

- Google Forms create/edit against the real API is **manual only** (8.3).
- AI output quality and prompt adherence are manual only; the automated check proves a proposal
  round-trips, not that it is a good proposal.
- Neon's PITR window, plan limits and regional latency are plan-specific facts you must confirm in
  the Neon dashboard.

---

## 9. Domains and canonical URLs

`<SITE_ORIGIN>` is the single origin users open. Keep these two values equal:

- `VITE_SITE_URL` (Vercel build variable) — canonical/OG/JSON-LD/robots/sitemap.
- `BETTER_AUTH_URL` (Render) — sessions, trusted origin, CSRF checks, both OAuth callbacks.

Both a `*.vercel.app` host and your own domain work. Switching later is one value in each place plus
new redirect URIs in Google Cloud; the fallback default in `src/lib/site-url.ts` means an unconfigured
build still emits a real origin rather than a placeholder.

If the domain is on Cloudflare (or any DNS provider):

- Frontend: `A`/`CNAME` records exactly as Vercel's domain panel instructs. If you proxy through
  Cloudflare, use **Full (strict)** TLS and leave WebSockets/HTTP2 enabled; do not put a Cloudflare
  Worker in front of `/api/*`.
- **Do not** proxy the Render service with a second public hostname that the browser calls directly:
  that breaks the same-origin cookie model that this architecture relies on. The browser must only
  ever call `<SITE_ORIGIN>/api/*`.
- DNSSEC, WAF and rate limiting at Cloudflare are optional; if you enable Bot Fight Mode or a WAF,
  confirm that Google's OAuth callback and the Vercel proxy are not challenged.
- The API's own headers are independent of Cloudflare's. HSTS is set by both the API and the frontend
  header route; only enable it once you are sure every hostname on the domain serves HTTPS.

---

## 10. Trust proxy

`API_TRUST_PROXY_HOPS` defaults to `0`, which ignores forwarded addresses entirely. That is the safe
default: with it, per-IP limits are grouped behind the proxy while per-user limits still work.

Only raise it after you have verified the real chain (Vercel edge → Render edge → your process) by
inspecting the `X-Forwarded-For` header your API actually receives. Too many trusted hops lets a
client spoof its address and defeat network limits; too few groups users together. Admin limits are
per authenticated administrator and are unaffected. Record the number you chose and why.

---

## 11. Single instance constraint

Run **one** Render instance at launch.

Provider access/refresh tokens are refreshed behind an in-process coalescing lock. There is no
cross-instance lease, so two instances can race a rotating Google refresh token and one request can
lose, forcing a reconnect. Rate limits, drafts, claims and credits are all database-backed and would
survive horizontal scaling, but the token refresh path would not.

If you must scale out later, the fix is a short-lived distributed lock (for example a
`token_refresh_lease` row with `SELECT … FOR UPDATE SKIP LOCKED` and a TTL) around the refresh, and
only then raise the instance count. Until that exists, keep autoscaling off.

---

## 12. Rollback

Rollback is per service; there is no single button.

**Frontend (Vercel).** Deployments are immutable: open Deployments, pick the last known-good one,
"Promote to Production". Verify `<SITE_ORIGIN>/` and `<SITE_ORIGIN>/pricing`, then
`npm run verify:production -- --base-url <SITE_ORIGIN>`. Note that a promoted build keeps the current
`VITE_SITE_URL`, so canonical URLs stay correct.

**Backend (Render).** Use "Rollback" on the last successful deploy (or re-deploy the previous commit).
Then confirm `/api/health` and `/api/health?deep=1`, and run the automated verification script. An API
rollback must stay schema-compatible: migrations are additive, so an older API version keeps working
against a newer schema. If the old API cannot tolerate the new columns, that is a schema rollback —
read on.

**Database.** Treat this as the last resort.

1. There are no down-migrations. Do not hand-write `DROP`.
2. Before any risky migration, create a Neon branch or rely on PITR; record the timestamp.
3. To undo a schema change, restore a branch at the pre-migration point and switch `DATABASE_URL` to
   it, then re-run migrations from that point. Accept that rows written after the restore point are
   lost — say so to users rather than pretending otherwise.
4. Never reset a production database with a development command (`db:migrate:intact` is additive;
   nothing in this repository drops data, keep it that way).

**Secrets.** If a key leaks, rotate it at the provider, update Render, redeploy, and remember that
rotating `BETTER_AUTH_SECRET` invalidates sessions and (without `PROVIDER_TOKEN_KEY`) all stored
provider grants. Rotating `PROVIDER_TOKEN_KEY` invalidates stored grants too — both are deliberate
user-visible reconnections, not silent failures.

Incident order: stop the bleeding (rollback or feature-disable) → confirm health → run the automated
smoke → investigate the failing release → only then redeploy.

---

## 13. Free-tier and plan reality

Do not present free tiers as unlimited production infrastructure. Confirm each of these in the
provider dashboards at launch time; they change.

| Service | What to expect | Effect on Intake |
| --- | --- | --- |
| Render free web service | Spins down after idle; next request pays a cold start | First request after idle can take tens of seconds — including the OAuth callback. Users may need to retry; keep-alive pings are a legitimate workaround but check the plan's terms. |
| Render | Single instance, limited build minutes, log retention | Matches the launch constraint; log history is short, so capture important incidents when they happen. |
| Neon free | Storage and compute-hour limits; scales to zero after idle | Cold starts add database latency; PITR window is short — confirm the actual window. |
| Vercel Hobby | Bandwidth and build limits; **commercial use is restricted** on Hobby | If Intake takes money or runs a business, verify the plan terms before launch. |
| Google Cloud OAuth | Free, but 100-user cap and 7-day refresh tokens while unverified | See [3](#publishing-status-and-the-verification-requirement-read-before-promising-persistence). |
| Groq | Rate limits and quotas by tier | Interpretation failures surface as useful errors, never as fake results; watch AI latency in the admin console. |
| Cloudflare | Free DNS/TLS is sufficient | Do not add Workers; the architecture is deliberate. |

The launch configuration is one frontend, one API instance, one database. Scale when measurements say
so, not in advance.

---

## 14. Staging versus production

Separate environments are worth it as soon as you change schema or OAuth config regularly. Minimum
clean split:

- **Production** — its own Neon project, Render service, Vercel project, Google Cloud project and
  Groq key. `NODE_ENV=production`.
- **Staging/preview** — a second Render service with a separate Neon branch/database and, ideally, a
  second Google Cloud project. Preview deployments must never point `BETTER_AUTH_URL` at a wildcard
  preview domain: trusted origins are exact, and a random preview host must not be able to act as a
  session origin for production auth.
- Development stays local (`npm run dev:api` + `npm run dev`, `BETTER_AUTH_URL=http://localhost:5173`).

Never point a staging service at the production database, and never use production Google credentials
for throwaway tests. Test accounts should be obviously identifiable (for example
`smoke+<purpose>@yourdomain`).

---

## 15. Out of scope in this phase

Deliberately not implemented, and the UI says so rather than faking it:

- **Payments** (Bachs.io, checkout, webhooks, recurring billing, cancellation, failed-payment
  handling). Plans change only through a deliberate server-side `user_entitlement` update. The pricing
  monthly/annual switch is display-only.
- **Email** (OTP, password reset, verification, welcome, lifecycle). There is no transactional email,
  which is exactly why admin eligibility needs the deliberate verification step in 8.4.
- **Microsoft Forms creation/editing.** Microsoft has no supported Forms create/edit API. A Microsoft
  connection is a connection, not a capability; the UI must not claim otherwise.
- **Multi-instance token refresh** ([11](#11-single-instance-constraint)).
