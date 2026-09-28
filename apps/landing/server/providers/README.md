# Provider connections

Intake login and provider authorization are different questions.

| Question | Mechanism | Storage |
| --- | --- | --- |
| Who is this Intake user? | Better Auth email/password session | `user`, `session`, `account` |
| Which external account may Intake operate? | Explicit OAuth grant, started by the signed-in user | `provider_connection` |

Signing in with an email, or any future social login, does **not** grant Forms access. A Better Auth `account` row is never treated as a provider connection.

This stage stores authorization. It does not create, edit, or pretend to create forms.

## Flow

1. An authenticated user opens **Connections**.
2. They choose Connect Google or Connect Microsoft. The button is a same-origin `POST` so a cross-site page cannot start the grant with a Lax session cookie, and the server also checks `Origin`.
3. The server stores a single-use transaction: hashed `state`, hashed `nonce`, and an encrypted PKCE verifier. The redirect URI is derived only from `BETTER_AUTH_URL`.
4. The browser goes to the provider. Tokens are never put in the browser by Intake.
5. The provider redirects to `/api/providers/:provider/callback` with a code, not a token.
6. The callback requires the same Intake session, a matching unexpired state, PKCE, and a successful token exchange. The code is not written to the next URL (`Referrer-Policy: no-referrer`).
7. The connection is stored for that user only. A different external account than the one already connected is a conflict; disconnect first.
8. Disconnect deletes the Intake row. Google revocation is attempted at `https://oauth2.googleapis.com/revoke`. Microsoft has no supported per-app token revocation endpoint, so the UI says so and links to the account permissions pages.

Future form operations should call `getProviderConnection(userId, provider)` from `server/providers/service.ts`. That helper is server-only. It refreshes an expired access token when a refresh token exists, and it never has an HTTP route. A rejected refresh is marked `reauthorization_required` and the ciphertext is cleared.

## Data model

`provider_connection` — one row per Intake user per provider (`google` or `microsoft`):

- owner `user_id`
- external account id, email, and label when the provider verified them
- status: `connected`, `expired`, or `reauthorization_required`
- granted scopes
- encrypted access and refresh tokens, plus access-token expiry
- created, updated, last authorized, last refreshed

`provider_oauth_transaction` — short-lived authorization attempts. The raw state and verifier are not stored. Transactions expire after 10 minutes and are single-use. A state that belongs to another user is consumed and rejected so it cannot be attached to the wrong Intake account.

Apply with `npm run db:migrate:intake` after Better Auth's migration. See `db/README.md`.

## Credentials at rest

Tokens are encrypted with AES-256-GCM before insert. The associated data is `user id + provider + field`, so a ciphertext cannot be moved to another user or column and still decrypt.

Key material, in order:

1. `PROVIDER_TOKEN_KEY` if set (recommended in production). Generate with `openssl rand -base64 32`.
2. Otherwise an HKDF-SHA256 key derived from `BETTER_AUTH_SECRET` (salt `intake-provider-tokens`, info `v1`).

Changing the key makes existing tokens unreadable. Intake then marks the connection as needing reauthorization and clears the ciphertext. Rotating `BETTER_AUTH_SECRET` has the same effect unless a dedicated `PROVIDER_TOKEN_KEY` is set. Neon disk encryption is additional; it is not a substitute for this.

Access tokens, refresh tokens, authorization codes, PKCE verifiers, and client secrets are not written to logs. Log lines pass through a redactor, but new logs must still avoid those values.

## Environment

See `apps/landing/.env.example`. Do not commit real values. Empty variables mean **not configured**. The connect button is not shown, and the server will not redirect to the provider or invent a connection.

| Variable | Required | Purpose |
| --- | --- | --- |
| `GOOGLE_OAUTH_CLIENT_ID` | For Google connect | Web client id from Google Cloud |
| `GOOGLE_OAUTH_CLIENT_SECRET` | For Google connect | Web client secret |
| `MICROSOFT_OAUTH_CLIENT_ID` | For Microsoft connect | Entra application (client) id |
| `MICROSOFT_OAUTH_CLIENT_SECRET` | For Microsoft connect | Entra client secret |
| `MICROSOFT_OAUTH_TENANT` | No | `common` (default), `organizations`, `consumers`, or a tenant GUID |
| `PROVIDER_TOKEN_KEY` | No | Dedicated encryption key. Recommended before production |
| `BETTER_AUTH_URL` | Yes | Public origin. Redirect URIs are built only from this |
| `BETTER_AUTH_SECRET` | Yes | Session secret. Also the fallback encryption input |

Redirect URIs to register, with no trailing slash on the origin:

- `{BETTER_AUTH_URL}/api/providers/google/callback`
- `{BETTER_AUTH_URL}/api/providers/microsoft/callback`

Local development uses `http://localhost:5173`. A cloud preview or production host must use its exact HTTPS origin in `BETTER_AUTH_URL` **and** in the provider console. `localhost` and `127.0.0.1` are different origins. A changed domain requires new redirect URIs and a restart.

This repository does not contain OAuth client secrets. The cloud agent cannot create a Google Cloud project or an Entra app registration. Until those consoles are configured, Connections shows **Setup required**.

## Google Cloud setup (manual)

1. Create or choose a Google Cloud project.
2. Enable the **Google Forms API**.
3. Configure the OAuth consent screen. Add the scopes below. While the app is in testing, add each Google account that will connect as a test user.
4. Create an OAuth client ID of type **Web application**.
5. Add the Google redirect URI above as an authorized redirect URI.
6. Put the client id and secret in the server environment. Never in `VITE_` variables, source, or git.

Scopes requested:

- `openid`
- `email`
- `https://www.googleapis.com/auth/forms.body` — create and edit the user's Google Forms

Not requested: Gmail, Drive, Calendar, Contacts, Sheets, or `forms.responses.readonly`. `forms.body` is a sensitive scope. A public production app may need Google verification before users outside the test-user list can consent. That verification is a Google Cloud console step, not something this repository can complete.

The authorization URL uses PKCE (`S256`), `access_type=offline`, and `prompt=consent select_account` so the user picks a Google account explicitly and Intake can receive a refresh token. The Intake email is not sent as `login_hint`.

## Microsoft Entra setup (manual)

1. Register an application in Microsoft Entra.
2. Supported account types: any organizational directory and personal Microsoft accounts, if `MICROSOFT_OAUTH_TENANT` stays `common`. A single-tenant app must set `MICROSOFT_OAUTH_TENANT` to that tenant GUID.
3. Add a **Web** redirect URI matching the Microsoft callback above.
4. Create a client secret and put it in the environment. Secrets expire; rotate them in Entra and the environment together.
5. Do not add Microsoft Graph application permissions. This flow uses only the delegated OIDC scopes `openid`, `profile`, `email`, and `offline_access`.

`offline_access` is how Microsoft issues a refresh token. It is not access to mail or files. Identity comes from a signature-checked ID token (audience, nonce, expiry, and issuer). Intake does not call Microsoft Graph.

Microsoft does not offer a supported API to revoke only this application's refresh token. `revokeSignInSessions` revokes every session for the user and is not used. Disconnect removes the Intake copy and tells the user how to remove the app at:

- personal accounts: `https://account.live.com/consent/Manage`
- work or school: `https://myapplications.microsoft.com/`

## What the Forms APIs actually allow

Checked against provider documentation on 2026-09-28. No form API client is implemented in this PR.

### Google Forms API

Official references: [forms.create](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms/create), [Form resource](https://developers.google.com/workspace/forms/api/reference/rest/v1/forms), [API changes](https://developers.google.com/workspace/forms/api/guides/api-changes-to-google-forms).

Supported by the API with `forms.body`, for a later PR:

- Create a form. Only `info.title` and `info.documentTitle` are copied on create. Description, items, and settings must be added afterward with `batchUpdate`.
- Add and update questions, including required questions. Question kinds in the REST resource include short/long text, radio, checkbox, dropdown, scale, date, time, rating, file upload, grids, and page breaks.
- Choice questions can navigate to a section (`goToSectionId` / `goToAction`) for radio and dropdown. That is section routing, not per-question show/hide. Checkboxes cannot branch.
- Read the form, including `responderUri` (the responder link) and `formId`.
- Publish. After 30 June 2026, forms created by the API are unpublished by default and do not accept responses until `forms.setPublishSettings`.

Not available with the scopes this PR requests:

- Deleting a form, changing who can access it, or updating `documentTitle` after create. The Form resource says those are Drive API operations. `drive` and `drive.file` also satisfy `forms.create`, but they are broader than Forms and are not requested. Adding sharing later means a new scope and a fresh consent.
- Reading responses. That is `forms.responses.readonly`, intentionally not requested.

The editor URL `https://docs.google.com/forms/d/{formId}/edit` is the conventional Docs URL, not a field the API returns.

### Microsoft Forms

There is no supported Microsoft Graph API for creating or editing Forms. `https://learn.microsoft.com/en-us/graph/api/resources/forms-overview` is not a published page. The only Forms-related Graph permission in the permissions reference is `OrgSettings-Forms.ReadWrite.All`, which reads and writes organization-wide Forms settings and requires admin consent. Intake does not request it.

An undocumented `forms.office.com/formapi` surface is used by the Forms website and by some internal scripts. It is not a supported API. This codebase does not call it and will not fake a Microsoft form.

A Microsoft connection therefore records which account the user authorized. It does not enable form creation. The Connections screen says that.

## Local development and deployment

1. Complete the Better Auth / Neon setup in the root README.
2. Run `npm run db:migrate` and then `npm run db:migrate:intake`.
3. Add provider credentials only if you have completed the console setup. Restart the server.
4. Sign in, open `/app/connections`, and connect. Use a Google account that is a test user while the consent screen is in testing.

Deployment must keep `BETTER_AUTH_URL` equal to the public HTTPS origin, serve the Express process (not the Vite `dist` folder alone), and keep client secrets in the host's environment. Redirect URIs in Google Cloud and Entra must match that origin exactly. Provider HTTP calls are server-side only.

## What the next PR should build

Form operations, behind the provider boundary, using `getProviderConnection` for a live access token. Google first: create, `batchUpdate`, `setPublishSettings`, and return `responderUri`. Do not add Drive scopes unless that PR actually shares or deletes forms. Microsoft form creation stays blocked until Microsoft publishes a supported API — do not fill that gap with the undocumented form API or a simulated form.
