# PR 04: Routing and deployment foundation

> **First deployment?** Follow [LAUNCH.md](LAUNCH.md) instead: it is the ordered Neon → Google Cloud →
> Groq → Render → Vercel → migrations → verification procedure, with the rollback and free-tier
> reality that this file only summarises. Everything below documents how the routing and deployment
> contracts are built.

## Code ownership

- `src/main.tsx`: BrowserRouter and Suspense entry.
- `src/app/routes.tsx`: single route tree; add future pages under `/app` without new hosting rules.
- `src/app/pages`: auth UI, Overview, Connections, Forms, Account.
- `src/app/layouts`: shared session guard and workspace shell.
- `src/app/hooks`: session context.
- `src/components`: reusable UI; `src/lib/api.ts`, `src/lib/auth.ts` and `src/lib/connections.ts`: same-origin, token-free browser API contracts.
- `src/App.tsx`, `src/sections`, `src/mobile`, `src/reel`: preserved landing page/demo.
- `server/auth.ts`: Better Auth and Neon Pool; `server/index.ts`: API-only Express.
- `server/providers`: server-only provider OAuth boundary (PR 03): token cipher, PKCE/OAuth, stores, service and routes mounted at `/api/providers`. Never import from the browser.
- `server/forms`: server-only form creation engine (Phase 5): validator, Google adapter, storage and routes mounted at `/api/forms`. It reads credentials only through `server/providers`. Never import from the browser; `src/lib/forms.ts` is the browser-safe contract.
- `db`: database workflow; never import server or database modules into the browser.

Frontend documents are static HTML. ProtectedLayout verifies `/api/me` before rendering the normal workspace; `/admin` is served from a dedicated noindex entry and checks `/api/admin/access` before displaying the console. Static delivery is not authorization: every `/api/admin/*` request independently verifies the Better Auth session and server-side email allowlist, as do other backend operations.

## Vercel settings

Apply to the existing frontend project:

| Setting | Value |
| --- | --- |
| Root | `apps/landing` |
| Framework | Vite |
| Node | 22.x, at least 22.12 |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| `BACKEND_URL` | Actual Render HTTPS origin, no path/trailing slash |
| `VITE_SITE_URL` | Optional build-time canonical origin (canonical link, Open Graph, JSON-LD, `robots.txt`, `sitemap.xml`). Unset falls back to the documented default in `src/lib/site-url.ts`. Must be an exact lowercase HTTPS origin; a malformed value fails the build. |

Set variables for the intended deployment scope and redeploy. No actual Render URL or linked Vercel project settings were supplied.

The canonical, Open Graph, X and Schema.org origin is resolved once at build time: `VITE_SITE_URL` when the operator sets it, otherwise the documented default (`DEFAULT_SITE_URL` in `src/lib/site-url.ts`). Preview hostnames are never substituted automatically, and a value that is not an exact lowercase HTTPS origin (path, trailing slash, query, credentials, uppercase host) fails the build rather than shipping wrong metadata. `robots.txt` and `sitemap.xml` are generated into `dist/` from that same origin, so there is no second place to update. Keep the frontend origin and the API's `BETTER_AUTH_URL` on the same origin — the auth/CSRF/callback origin is exact, not a pattern. The sitemap lists `/` and `/pricing`; robots exclusions and `noindex` headers/meta reduce indexing of private surfaces but are not access control.

`vercel.json` uses documented route `env` expansion for `${BACKEND_URL}` (not shell interpolation in rewrites): https://vercel.com/docs/project-configuration/vercel-json#routes. A first header-only route applies the baseline frontend security headers (`X-Content-Type-Options`, `Referrer-Policy`, `X-Frame-Options: DENY`, `Permissions-Policy`, HSTS) with `"continue": true`, which is the documented way to attach headers in the `routes` pipeline without terminating routing. The API route reserves `/api` and `/api/*`; a specific noindex document route handles `/auth`, `/app`, and `/admin`; `/pricing` maps to its own crawlable `pricing.html`; then a filesystem pass-through serves static files before one generic public SPA fallback. Keep these in the single low-level `routes` pipeline rather than mixing it with Vercel's `rewrites` or top-level `headers`. Unknown frontend routes show React's not-found page. Do not add further per-page rules or deploy Express as a Vercel function.

## Render settings

Apply root `render.yaml` to the existing service; avoid creating an accidental duplicate:

- Root `apps/landing`; build `npm ci`; start `npm start`; Node 22.x.
- Health `/api/health` is process liveness (always 200). `GET /api/health?deep=1` additionally probes PostgreSQL with a bounded read and returns 503 `{ok:false,database:'unavailable'}` when it cannot, without exposing credentials, hosts or versions. Use the deep form for readiness checks and `npm run preflight -- --db` for migration-level verification.
- Set TLS `DATABASE_URL`, random 32+ character `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL=https://intake-six-blue.vercel.app` (the exact public frontend origin). Set server-only `ADMIN_EMAILS` to a comma-separated list of exact, independently verified Better Auth administrator accounts; an empty allowlist denies everyone, malformed entries never authorize, and `emailVerified` must be true. This checkout does not send verification email. Never expose it as `VITE_ADMIN_EMAILS`. Production startup rejects insecure/placeholder auth/database values.
- Render supplies `PORT`; server validates it and binds `0.0.0.0`; local default is 3001. `API_TRUST_PROXY_HOPS` defaults to 0; change it only after verifying the exact proxy chain, as described in [PRODUCTION.md](PRODUCTION.md).
- Use a PostgreSQL 15+ Neon project. Run `npm run db:migrate` against the intended database before release, then `npm run db:migrate:intake`. The second command applies `db/migrations/*.sql` in filename order: `001` provider connections, `002` owned form records, `003` creation drafts/one-shot claims, `004` edit snapshots/claims, `005` library metadata, `006` distributed abuse controls plus composite edit-draft ownership, `007_ai_credits` entitlements/ledger/logical operations, the historical `007_ai_operations` no-op, `008_ai_operation_compat` archive-and-backfill for Phase 12 telemetry, and `009_admin_indexes`. Migrations are tracked and additive; the compatibility migration preserves the legacy table and maps only safe operation metadata. `006` intentionally fails if historical edit/form ownership is inconsistent; investigate rather than deleting or rewriting rows. `007` adds no rows for existing accounts: the first credit read issues that UTC day's grant. The edit workflow uses the already-requested Google `forms.body` scope, selects Intake records or a user-supplied strict Google Forms URL, and does not request Drive-wide discovery permission.
- Provider variables (`GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`, `PROVIDER_TOKEN_KEY`), the Google **sign-in** pair (`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`) and the AI credentials (`GROQ_API_KEY`, optional `GROQ_MODEL`, optional `OPENAI_API_KEY`/`AI_PROVIDER`) belong **only on Render**, not the public Vite frontend. Blank `GROQ_API_KEY` returns an explicit `model_not_configured` error; it must not fabricate a specification. Blank provider variables give an honest "not configured" state; never fake a grant. Google sign-in credentials must be a *different* Google Cloud client from the Forms connection: register `${BETTER_AUTH_URL}/api/auth/callback/google` for sign-in and keep `${BETTER_AUTH_URL}/api/providers/google/callback` for the Forms grant.

Render deliberately returns 404 for frontend routes. `/api/*` is no-store; unknown API routes return JSON 404, never frontend HTML.

## Sessions and OAuth

Browser → Vercel `/api/*` → Render → Better Auth → Neon.

Existing Better Auth defaults are retained: HttpOnly, SameSite=Lax, path `/`, host-only cookies (no Domain), Secure with HTTPS `BETTER_AUTH_URL`. A proxied host-only cookie belongs to the Vercel origin as seen by the browser. No cross-site cookie setting, wildcard trust/CORS, or Domain rewriting is needed. Trusted origin stays the exact frontend URL. Use a separate backend with a matching public origin for authenticated previews rather than trusting arbitrary preview domains against production auth.

This configuration analysis is not production session verification. Check real Set-Cookie/Cookie forwarding at the Vercel edge before release.

PR 03 provider OAuth is integrated and mounted at `/api/providers`. Preserve callbacks at `{BETTER_AUTH_URL}/api/providers/google/callback` and `{BETTER_AUTH_URL}/api/providers/microsoft/callback`; the Vercel proxy preserves paths and query strings, so callbacks stay backend operations. Register those exact URIs in Google Cloud and Microsoft Entra. PR 03's provider tests pass locally (memory-store, PKCE/state/encryption); real provider redirects through the Vercel edge are not verified.

The form engine and library are mounted at `/api/forms`. Production composition returns 405 for direct structured `POST /api/forms`; creation must use `/api/forms/interpret`, `/api/forms/revise`, `/api/forms/draft/:id`, and explicit `/api/forms/confirm` so a validated, server-owned reviewed draft and durable one-shot claim are always present. Live inference requires migration `003` and a model credential (`GROQ_API_KEY`, or `OPENAI_API_KEY`); production abuse controls require migration `006`. The existing `/api` rule proxies all of these paths; no new `vercel.json` rule is needed, and `/app/forms` is covered by the SPA fallback. Two things to know behind the proxy:

- All form-related POSTs and draft DELETEs require an `Origin` (or `Referer`) equal to the origin of `BETTER_AUTH_URL`, checked before the body is read. The proxy must forward that header.
- Creating a form makes up to four sequential Google calls (create, one or two `batchUpdate`s, publish), each with a 20-second timeout. Normally this takes a few seconds. If the proxy or the browser gives up first, Render still finishes and records the form, and it appears under Recent forms. The Google **Forms API must be enabled** in the Cloud project that owns the OAuth client, or the workspace reports that it is not enabled.

Provider tokens never appear in a response or a log line. Operators trace one attempt through its `requestId` (returned in the response and the `X-Request-Id` header, and present on every `form.create.*` log line). Details: [server/forms/README.md](server/forms/README.md).

Admin APIs are mounted under `/api/admin`: overview, paginated users/detail, AI operations, credits availability, form records, providers, system, activity and structured recorded failures. `ADMIN_EMAILS` is checked against the current database user identity for every route. Admin search/analytics use the shared PostgreSQL limiter with dedicated `admin.*` scopes. See [server/admin/README.md](server/admin/README.md) for data boundaries and source limitations. Do not call providers configured/live based only on stored OAuth client settings, and do not claim historical AI activity before migration `007`.

## Production acceptance checklist

1. Directly open and refresh `/`, `/pricing`, `/auth/sign-in`, `/auth/sign-up`: correct pages, no Vercel 404, CSS/JS/assets load. `/pricing` must show the dedicated title/canonical and the monthly/annual toggle must update $6.99/month, $59.99/year, and the $23.89 annual savings accurately; its toggle is display-only and checkout must not be implied.
2. Signed out, directly open and refresh `/app`, `/app/connections`, `/app/account`: sign-in, not workspace content or hosting 404.
3. Sign up with a test account. Inspect successful `/api/auth/sign-up/email` and Set-Cookie: HttpOnly, Secure, SameSite=Lax, no Render Domain. Do not log token values.
4. Verify `/app`, refresh and a new `/app` tab retain the session. `/api/me` and `/api/auth/get-session` return the authenticated user through Vercel.
5. Sign out: session invalidated; `/api/me` returns 401; protected pages/browser back no longer show account content. Sign in again and repeat.
6. Test authenticated `/api/providers`, Google/Microsoft connect, callback, status and disconnect through the Vercel origin. Unauthorized requests must fail; responses must not expose tokens.
7. `/api/unknown` must be backend JSON 404; `/api/health` must be JSON. Upstream failures must not become SPA HTML. API responses must not be cached between users.
8. AI credits, after migrations `007` and `008`: signed in, `GET /api/credits` returns server-reported `plan`, subscription status, available/daily/monthly balances and limits, reset instants, plus the bounded `costGuide`, with `Cache-Control: no-store`; signed out it returns 401. Submit one description: the response carries a post-charge balance and `operationCost` receipt; remaining drops by the server-calculated 1–5 credits (a standard ~6-question form costs 2). Submit the same request with the same `operationId` twice: the second call must not reduce the balance further. Drain the available balance in a test account and confirm a new operation is refused with `402 insufficient_credits` and **no** model call, draft or Google form. Confirm failed or clarification-only attempts change nothing in `credit_ledger` and appear in `ai_operation` with `credit_cost = 0`.
9. Form creation, only after the Google Forms API is enabled, migrations `001`–`009` are applied, and a live model key is configured: signed out, `POST /api/forms/interpret` returns 401. Signed in, describe a registration form. Inspect the proposed questions, limitations and routing; verify **no Google form exists yet**. Revise, then connect Google separately in Connections if needed. Explicitly click **Create form**: expect real **Open form** and **Edit form** links, a published form in Google that accepts a test response, a `form` row and a `form_draft` with a created result. Re-submit `/api/forms/confirm` with the same draft/version: it must replay the same provider form id.
10. Existing-form editing: select that Recent form or paste a known standard Google Forms edit URL. Inspect fresh question data, prepare and revise a proposal, confirm that preview/revision alone never changes Google, then explicitly confirm a safe title or question edit. Verify the exact provider form ID and responder URL stay unchanged and the `form_edit_draft` stores the verified current snapshot. Revoke Intake or switch the connected Google account before confirming another draft; expect reauthorization/account mismatch handling, never a write through the wrong account.

## Validation scope and remaining work

`npm test` builds first. Tests cover registered routes, rendered auth/protected pages with mocked sessions, admin 401/403/allowlist/session-expiry/forgery/rate-limit behavior, safe admin query projections and aggregates, API paths, source boundary checks, direct/repeated requests to the production Vite output (including the admin noindex document), local proxy method/query/cookie-header forwarding, and API-only Express failure behavior.

These tests do not verify the actual Vercel edge, browser cookie persistence, Neon sign-up/sign-in, provider OAuth, or a live Google form. Rendered tests use jsdom rather than a downloaded browser. No deployment or production authentication verification is implied. Google OAuth redirects through Vercel remain a live checklist item. Form and edit tests exercise the provider boundary against a stateful Google Forms API emulator; interpretation is stubbed, and the workspace is tested locally. None needs a provider account, OAuth credential, Neon, paid inference, or Vercel. They do **not** verify live model quality, real Google sign-in, real Groq inference, migrations `001`–`009` on Neon, proxy/client-IP behavior, or the Vercel proxy against a deployed API. Credit tests exercise the store contract with an in-memory store: the PostgreSQL transaction and row-lock behavior of `007`, legacy telemetry backfill in `008`, and admin indexes in `009` are unverified against a real database. No payment provider is integrated, so plans can only be changed with the server-side hook. There is no lint script or repository CI workflow. Security controls, rate limits, recovery procedures, and remaining limitations are catalogued in [PRODUCTION.md](PRODUCTION.md).
