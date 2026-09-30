# PR 04: Routing and deployment foundation

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

Frontend documents are public static HTML. ProtectedLayout verifies `/api/me` before rendering workspace content, redirects only on 401, and displays a retryable error on outages. Focus/pageshow revalidate sessions; successful sign-out clears UI state. This is not authorization: every backend operation must independently authenticate and check ownership.

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
| Optional `VITE_SITE_URL` | `https://intake-six-blue.vercel.app` |

Set variables for the intended deployment scope and redeploy. No actual Render URL or linked Vercel project was supplied.

`vercel.json` uses documented route `env` expansion for `${BACKEND_URL}` (not shell interpolation in rewrites): https://vercel.com/docs/project-configuration/vercel-json#routes. The API rule reserves `/api` and `/api/*`; a single non-API rewrite supplies the SPA fallback. Static files retain filesystem precedence. Unknown frontend routes show React's not-found page. Do not add individual page rules or deploy Express as a Vercel function.

## Render settings

Apply root `render.yaml` to the existing service; avoid creating an accidental duplicate:

- Root `apps/landing`; build `npm ci`; start `npm start`; Node 22.x.
- Health `/api/health` is process liveness, not database readiness.
- Set TLS `DATABASE_URL`, random 32+ character `BETTER_AUTH_SECRET`, and `BETTER_AUTH_URL=https://intake-six-blue.vercel.app` (the exact public frontend origin).
- Render supplies `PORT`; server binds `0.0.0.0`; local default is 3001.
- Run `npm run db:migrate` against the intended Neon database before release, then `npm run db:migrate:intake`. The second command applies `db/migrations/*.sql` in order: `001` (provider connections), `002_forms.sql` (created forms), and `003_form_drafts.sql` (user-owned proposals and atomic creation claims). Migrations are additive and idempotent. The new describe/review/confirm workflow requires `003` before it can save a draft or create a form. If `002` is missing, the engine may still create a real Google form but cannot record it in Recent forms.
- Provider variables (`GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`, `PROVIDER_TOKEN_KEY`) and the optional `OPENAI_MODEL` / required-for-inference `OPENAI_API_KEY` belong **only on Render**, not the public Vite frontend. Blank `OPENAI_API_KEY` returns an explicit `model_not_configured` error; it must not fabricate a specification. Blank provider variables give an honest "not configured" state; never fake a grant.

Render deliberately returns 404 for frontend routes. `/api/*` is no-store; unknown API routes return JSON 404, never frontend HTML.

## Sessions and OAuth

Browser → Vercel `/api/*` → Render → Better Auth → Neon.

Existing Better Auth defaults are retained: HttpOnly, SameSite=Lax, path `/`, host-only cookies (no Domain), Secure with HTTPS `BETTER_AUTH_URL`. A proxied host-only cookie belongs to the Vercel origin as seen by the browser. No cross-site cookie setting, wildcard trust/CORS, or Domain rewriting is needed. Trusted origin stays the exact frontend URL. Use a separate backend with a matching public origin for authenticated previews rather than trusting arbitrary preview domains against production auth.

This configuration analysis is not production session verification. Check real Set-Cookie/Cookie forwarding at the Vercel edge before release.

PR 03 provider OAuth is integrated and mounted at `/api/providers`. Preserve callbacks at `{BETTER_AUTH_URL}/api/providers/google/callback` and `{BETTER_AUTH_URL}/api/providers/microsoft/callback`; the Vercel proxy preserves paths and query strings, so callbacks stay backend operations. Register those exact URIs in Google Cloud and Microsoft Entra. PR 03's provider tests pass locally (memory-store, PKCE/state/encryption); real provider redirects through the Vercel edge are not verified.

Phase 5's form engine is still mounted at `/api/forms` (`POST` directly creates from a structured spec, `GET` lists recent forms). Phase 6 adds `/api/forms/interpret`, `/api/forms/revise`, `/api/forms/draft/:id` and `/api/forms/confirm`; the workspace uses these to describe, review, revise, and explicitly confirm a real form. It requires migration `003` and `OPENAI_API_KEY` for live inference. The existing `/api` rule proxies all of these paths; no new `vercel.json` rule is needed, and `/app/forms` is covered by the SPA fallback. Two things to know behind the proxy:

- All form-related POSTs and draft DELETEs require an `Origin` (or `Referer`) equal to the origin of `BETTER_AUTH_URL`, checked before the body is read. The proxy must forward that header.
- Creating a form makes up to four sequential Google calls (create, one or two `batchUpdate`s, publish), each with a 20-second timeout. Normally this takes a few seconds. If the proxy or the browser gives up first, Render still finishes and records the form, and it appears under Recent forms. The Google **Forms API must be enabled** in the Cloud project that owns the OAuth client, or the workspace reports that it is not enabled.

Provider tokens never appear in a response or a log line. Operators trace one attempt through its `requestId` (returned in the response and the `X-Request-Id` header, and present on every `form.create.*` log line). Details: [server/forms/README.md](server/forms/README.md).

## Production acceptance checklist

1. Directly open and refresh `/`, `/auth/sign-in`, `/auth/sign-up`: correct pages, no Vercel 404, CSS/JS/assets load.
2. Signed out, directly open and refresh `/app`, `/app/connections`, `/app/account`: sign-in, not workspace content or hosting 404.
3. Sign up with a test account. Inspect successful `/api/auth/sign-up/email` and Set-Cookie: HttpOnly, Secure, SameSite=Lax, no Render Domain. Do not log token values.
4. Verify `/app`, refresh and a new `/app` tab retain the session. `/api/me` and `/api/auth/get-session` return the authenticated user through Vercel.
5. Sign out: session invalidated; `/api/me` returns 401; protected pages/browser back no longer show account content. Sign in again and repeat.
6. Test authenticated `/api/providers`, Google/Microsoft connect, callback, status and disconnect through the Vercel origin. Unauthorized requests must fail; responses must not expose tokens.
7. `/api/unknown` must be backend JSON 404; `/api/health` must be JSON. Upstream failures must not become SPA HTML. API responses must not be cached between users.
8. Form creation, only after the Google Forms API is enabled, all three migrations applied, and a live model key configured: signed out, `POST /api/forms/interpret` returns 401. Signed in, describe a registration form. Inspect the proposed questions, limitations and routing; verify **no Google form exists yet**. Revise, then connect Google separately in Connections if needed. Explicitly click **Create form**: expect real **Open form** and **Edit form** links, a published form in Google that accepts a test response, a `form` row and a `form_draft` with a created result. Re-submit `/api/forms/confirm` with the same draft/version: it must replay the same provider form id. Then revoke Intake in the Google account and try a new draft: expect a connection-renewal prompt, not a fabricated link.

## Validation scope and remaining work

`npm test` builds first. Tests cover registered routes, rendered auth/protected pages with mocked sessions, outage-vs-401 behavior, API paths, source boundary checks, direct/repeated requests to the production Vite output, local proxy method/query/cookie-header forwarding, and API-only Express failure behavior.

These tests do not verify the actual Vercel edge, browser cookie persistence, Neon sign-up/sign-in, or provider OAuth. Chromium download failed with TLS/network errors; rendered tests use jsdom instead. An HTTP attempt against the supplied production sign-up URL also failed TLS establishment. No deployment or production authentication verification was performed. PR 03's provider tests pass locally but real Google/Microsoft OAuth redirects through Vercel are unverified. Phase 5 tests exercise the form engine against a Google Forms API emulator; Phase 6 tests mock model inference, exercise the draft API and use jsdom for the new workspace. None needs an account, OAuth credential, Neon, paid inference or Vercel. They do **not** verify live model quality, that Google will accept the adapter's requests in a real account, migrations `002`/`003` on Neon, or the Vercel proxy against a deployed API. There is no lint script.
