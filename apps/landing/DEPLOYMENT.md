# PR 04: Routing and deployment foundation

## Code ownership

- `src/main.tsx`: BrowserRouter and Suspense entry.
- `src/app/routes.tsx`: single route tree; add future pages under `/app` without new hosting rules.
- `src/app/pages`: auth UI, Overview, Connections, Account.
- `src/app/layouts`: shared session guard and workspace shell.
- `src/app/hooks`: session context.
- `src/components`: reusable UI; `src/lib/api.ts`, `src/lib/auth.ts` and `src/lib/connections.ts`: same-origin, token-free browser API contracts.
- `src/App.tsx`, `src/sections`, `src/mobile`, `src/reel`: preserved landing page/demo.
- `server/auth.ts`: Better Auth and Neon Pool; `server/index.ts`: API-only Express.
- `server/providers`: server-only provider OAuth boundary (PR 03): token cipher, PKCE/OAuth, stores, service and routes mounted at `/api/providers`. Never import from the browser.
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
- Run `npm run db:migrate` against the intended Neon database before release.
- Provider variables (`GOOGLE_OAUTH_*`, `MICROSOFT_OAUTH_*`, `PROVIDER_TOKEN_KEY`) belong only on Render. Blank provider variables give an honest "not configured" state; never fake a grant.

Render deliberately returns 404 for frontend routes. `/api/*` is no-store; unknown API routes return JSON 404, never frontend HTML.

## Sessions and OAuth

Browser → Vercel `/api/*` → Render → Better Auth → Neon.

Existing Better Auth defaults are retained: HttpOnly, SameSite=Lax, path `/`, host-only cookies (no Domain), Secure with HTTPS `BETTER_AUTH_URL`. A proxied host-only cookie belongs to the Vercel origin as seen by the browser. No cross-site cookie setting, wildcard trust/CORS, or Domain rewriting is needed. Trusted origin stays the exact frontend URL. Use a separate backend with a matching public origin for authenticated previews rather than trusting arbitrary preview domains against production auth.

This configuration analysis is not production session verification. Check real Set-Cookie/Cookie forwarding at the Vercel edge before release.

PR 03 provider OAuth is integrated and mounted at `/api/providers`. Preserve callbacks at `{BETTER_AUTH_URL}/api/providers/google/callback` and `{BETTER_AUTH_URL}/api/providers/microsoft/callback`; the Vercel proxy preserves paths and query strings, so callbacks stay backend operations. Register those exact URIs in Google Cloud and Microsoft Entra. PR 03's provider tests pass locally (memory-store, PKCE/state/encryption); real provider redirects through the Vercel edge are not verified.

## Production acceptance checklist

1. Directly open and refresh `/`, `/auth/sign-in`, `/auth/sign-up`: correct pages, no Vercel 404, CSS/JS/assets load.
2. Signed out, directly open and refresh `/app`, `/app/connections`, `/app/account`: sign-in, not workspace content or hosting 404.
3. Sign up with a test account. Inspect successful `/api/auth/sign-up/email` and Set-Cookie: HttpOnly, Secure, SameSite=Lax, no Render Domain. Do not log token values.
4. Verify `/app`, refresh and a new `/app` tab retain the session. `/api/me` and `/api/auth/get-session` return the authenticated user through Vercel.
5. Sign out: session invalidated; `/api/me` returns 401; protected pages/browser back no longer show account content. Sign in again and repeat.
6. Test authenticated `/api/providers`, Google/Microsoft connect, callback, status and disconnect through the Vercel origin. Unauthorized requests must fail; responses must not expose tokens.
7. `/api/unknown` must be backend JSON 404; `/api/health` must be JSON. Upstream failures must not become SPA HTML. API responses must not be cached between users.

## Validation scope and remaining work

`npm test` builds first. Tests cover registered routes, rendered auth/protected pages with mocked sessions, outage-vs-401 behavior, API paths, source boundary checks, direct/repeated requests to the production Vite output, local proxy method/query/cookie-header forwarding, and API-only Express failure behavior.

These tests do not verify the actual Vercel edge, browser cookie persistence, Neon sign-up/sign-in, or provider OAuth. Chromium download failed with TLS/network errors; rendered tests use jsdom instead. An HTTP attempt against the supplied production sign-up URL also failed TLS establishment. No deployment or production authentication verification was performed. PR 03's provider tests pass locally but real Google/Microsoft OAuth redirects through Vercel are unverified. There is no lint script.
