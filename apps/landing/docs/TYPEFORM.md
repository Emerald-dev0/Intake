# Typeform setup and deployment

Everything needed to take Typeform from "Setup required" in Connections to a working
create-a-form flow in production. Written against the code in this repository, not against
Typeform marketing pages — every endpoint, scope and environment name below is what the server
actually sends.

- **Server code:** `server/providers/registry.ts` (OAuth endpoints, scopes), `server/providers/service.ts`
  (start/exchange/refresh), `server/forms/providers/typeform/*` (Create API adapter, planner)
- **Database:** `db/migrations/019_typeform_provider.sql`
- **UI:** `src/app/Connections.tsx`, `src/app/Forms.tsx`, `src/lib/connections.ts`
- **Verification:** `test/forms-typeform-*.test.mjs`, `test/providers.test.mjs`

## 1. What the integration does, and what it does not

| Capability | Status |
| --- | --- |
| Create a Typeform from a described draft | Supported (`POST https://api.typeform.com/forms`) |
| Import an existing Typeform by link (`form.typeform.com/to/{id}`) | Supported |
| List, inspect, archive, remove a Typeform record in the library | Supported |
| Verify live status of a Typeform record | Supported via `GET /forms/{id}` |
| Edit an existing Typeform from Intake | Supported, with limits. Titles, descriptions, required state, options, new questions and reordering (on forms without logic). See §1a |
| Read or store Typeform responses | **Not supported.** No responses scope is requested |
| Webhooks, workspaces, themes, images | **Not requested** |
| Microsoft Forms creation | Not supported — Microsoft publishes no Forms create/edit API |

There is **no mock mode**. If the two environment values are missing, the provider row renders
"Setup required" and the connect route returns `not_configured`; nothing else changes.

## 1a. Editing a Typeform: what Intake will and will not do

Typeform has no operation API. `PATCH /forms/{id}` only reaches form-level properties (title,
settings, theme, workspace); Typeform's own FAQ states there is no endpoint that changes a single
question. Editing therefore means: retrieve the whole form, change it, `PUT` it back — and `PUT`
**overwrites**. Any field left out of the payload is deleted, together with the answers already
collected for it, and an omitted theme is replaced by a fresh copy of the default.

Intake's rules follow from that:

| Operation | Allowed | Why |
| --- | --- | --- |
| Rename the form | Yes | `title` on the same `PUT` |
| Change the form description | Yes | It lives on the welcome screen; that one property is rewritten |
| Change a question's title, description, required state | Yes | Field properties, echoed back with the field's id and ref |
| Change a choice question's options | Yes | Labels rewritten in place; the existing choice objects are kept |
| Add a question | Yes | Appended or inserted at the requested index |
| Reorder questions | Only when the form has **no logic jumps** | Jumps address fields by ref; order is part of the flow |
| Delete a question | **No** | Deleting a field discards its responses, and Intake does not request `responses:read` to warn you |
| Change a question's type | **No** | Typeform cannot retype a field in place; answers would be orphaned |

The safety model, in order:

1. **Compile from a fresh read.** The `PUT` body is built from the form as it exists immediately
   before the write — never from a stored snapshot and never from model output. Settings, logic,
   welcome and thank-you screens, theme and every untouched field are deep-copied back verbatim.
2. **Refuse staleness.** The snapshot the proposal was prepared against is compared field by field
   with the fresh read (and its `updatedAt`). Any difference stops the edit with `edit_stale`;
   nothing is written and no credit is spent twice.
3. **Refuse unsafe operations by name**, with an explanation, before anything is built.
4. **One `PUT`, never a retry.** If the response is lost, a single read decides whether it landed.
5. **Verify what came back.** The returned form must contain every field it started with, in the
   proposed order when a move was requested, with the proposed values present. A missing field
   blocks the proposal (`provider_error`, outcome `partial`) rather than offering a retry.

Known limits: the gap between the confirming read and the `PUT` cannot be made atomic, because
Typeform offers no revision precondition (Google's `requiredRevisionId` has no equivalent). Intake
narrows it to one round trip and says so; a person editing in Typeform's builder in that instant can
still be overwritten. Typeform's own FAQ adds that pressing **Publish** in their builder later
overwrites API changes, which no API can prevent.

## 2. Before you start

- A Typeform account that owns (or can create) the forms you want to test with.
- A reachable HTTPS origin for production. `BETTER_AUTH_URL` must be that exact origin, with no path,
  query, hash or trailing slash, because the redirect URI is built from it:

  ```
  {BETTER_AUTH_URL}/api/providers/typeform/callback
  ```

- Access to the API service environment (Render → the API service → **Environment**).
- `BETTER_AUTH_SECRET` and, ideally, `PROVIDER_TOKEN_KEY` already set. Both encrypt stored tokens.

## 3. Register the Typeform app (once)

1. Sign in at <https://admin.typeform.com/>.
2. Top-left, open the organization drop-down → **Developer Apps** → **Register a new app**.
3. Fill in:
   - **App name:** `Intake`
   - **App website:** your production origin, e.g. `https://intake.example.com`
   - **Redirect URI(s):** `https://intake.example.com/api/providers/typeform/callback`
     - Register the local URI too if you develop locally:
       `http://localhost:5173/api/providers/typeform/callback`
     - Typeform matches the value **exactly** — scheme, host, port and path. `localhost` and
       `127.0.0.1` are different values, and a trailing slash is a different value.
4. **Register app**.
5. Copy the **client ID** from the Developer Apps panel.
6. Copy the **client secret** from the dialog shown once after registration. Store it in your
   password manager before closing. If it is lost: **Edit app → Regenerate client secret**, then
   update the server (a stale secret fails the token exchange with `invalid_client`).

You do **not** configure scopes in the Typeform console. Intake asks for them at connect time, so the
consent screen shows exactly what the code requests (see §5).

## 4. Configure the environment

Set these on the **API service only**. Never on the static/Vite host, because anything prefixed
`VITE_` is compiled into the public bundle.

```bash
TYPEFORM_OAUTH_CLIENT_ID=...
TYPEFORM_OAUTH_CLIENT_SECRET=...
```

`BETTER_AUTH_URL` must already be set — the callback URI is derived from it and is also checked
against the stored transaction when the callback arrives.

**Local development**

```bash
cd apps/landing
cp .env.example .env.local     # if you do not have one yet
# add the two TYPEFORM_ values, then:
npm run dev                    # Vite on :5173, API on :3001
```

Change the redirect URI in the Typeform app if you switch ports.

**Render** — `render.yaml` already declares both keys with `sync: false`, so they are set in the
dashboard and never committed:

```yaml
- key: TYPEFORM_OAUTH_CLIENT_ID
  sync: false
- key: TYPEFORM_OAUTH_CLIENT_SECRET
  sync: false
```

**Vercel** — nothing to add. The static site only calls same-origin `/api/*`, which the Render
service handles.

## 5. Scopes, and why each one exists

| Scope | Used for | Notes |
| --- | --- | --- |
| `accounts:read` | `GET /me` at connect time | Labels the connection with the account's email/name. Without it the identity lookup fails and the connection is refused |
| `forms:read` | `GET /forms`, `GET /forms/{id}` | Import, library listing, live status |
| `forms:write` | `POST /forms` | The actual creation |
| `offline` | Refresh token | **Not a permission.** Typeform only issues a refresh token when `offline` is requested, and access tokens last one week |

Not requested: `responses:*`, `webhooks:*`, `workspaces:*`, `themes:*`, `images:*`.

## 6. How the connect flow behaves

```
POST /api/providers/typeform/connect
  └─ creates a single-use state + PKCE-free transaction row (10 min TTL, bound to user + provider)
  └─ 302 → https://api.typeform.com/oauth/authorize
           ?client_id=…&redirect_uri=…%2Fcallback&response_type=code
           &scope=accounts:read+forms:read+forms:write+offline&state=…

GET /api/providers/typeform/callback?code=…&state=…
  └─ the state must match the stored hash, be unexpired, and be unused
  └─ POST https://api.typeform.com/oauth/token   (code, client_id, client_secret, redirect_uri)
  └─ GET  https://api.typeform.com/me            → { id, email, name }
  └─ tokens encrypted (AES-GCM, bound to user + provider) and the connection saved
  └─ 302 → /app/connections?result=connected
```

Deliberate differences from the Google flow:

- **No PKCE challenge and no OIDC `nonce`.** Typeform documents
  `client_id`/`redirect_uri`/`scope`/`state` and a confidential-client token exchange, so the server
  sends exactly that (`pkce: false`, `oidcNonce: false` in the registry). Google and Microsoft keep
  both.
- **No `scope` in the token response.** Typeform does not document one, so the requested scopes are
  stored instead of treating the absent field as "nothing granted".
- **No revocation endpoint.** Disconnect deletes Intake's stored grant and tells the user to remove
  the app from their Typeform account. Intake never claims a revocation it did not perform.
- **EU accounts need no configuration.** The API client routes `eu_` tokens to `api.typeform.eu` and
  `tfp_` tokens to `api.eu.typeform.com`; everything else uses `api.typeform.com`.

Refresh happens automatically when the access token is within its refresh window. Typeform rotates
the refresh token on every use; the new one is re-encrypted and saved, and concurrent reads for the
same user/provider are coalesced so a rotated token is not submitted twice.

## 7. Deploy checklist

Order matters: the migration must be applied before the first connection can be stored.

1. **Migrate.** Apply `db/migrations/019_typeform_provider.sql`:

   ```bash
   npm run db:migrate:intake    # Intake's own migrations (includes 019)
   npm run db:migrate           # Better Auth's schema, unchanged by this work
   ```

   It only widens CHECK constraints, so it is safe on a live database and needs no backfill.
2. **Set the environment.** Both `TYPEFORM_OAUTH_CLIENT_ID` and `TYPEFORM_OAUTH_CLIENT_SECRET`.
3. **Deploy / restart the API service.** Environment changes are not picked up without a restart.
4. **Check preflight.** Run the preflight script with the service environment loaded:

   ```bash
   npm run preflight -- --db      # configuration + database connectivity and migrations
   ```

   It must report the provider row as configured. Unset values produce a warning that names the two
   variables.
5. **Register the redirect URI** for the exact production origin (step 3) — a deploy to a new domain
   means a new redirect URI and a restart.
6. **Connect once, by hand.** Sign in → Connections → **Connect Typeform** → approve → the row shows
   the account email and the scopes.
7. **Create three drafts and confirm each**: a simple form, one with a conditional follow-up (this
   exercises logic jumps), and a long one. Open each in Typeform and check the questions, then archive
   one from the library to exercise removal of the local record only.
8. **Run the checks**

   ```bash
   cd apps/landing
   npm run typecheck
   npx tsx --test test/forms-typeform-adapter.test.mjs test/forms-typeform-wiring.test.mjs test/providers.test.mjs
   npm run verify:production -- --base-url https://your-domain      # read-only by default
   ```

## 8. Troubleshooting

| Symptom | Cause | Fix |
| --- | --- | --- |
| Connections shows **Setup required** | One or both env values missing, too short, or placeholder-looking | Set the real values, restart, and re-run `npm run preflight` |
| Consent screen: `redirect_uri` mismatch | URI differs by scheme, host, port, trailing slash, or is not registered | Register the exact `{BETTER_AUTH_URL}/api/providers/typeform/callback` |
| Callback returns `invalid_callback` | State expired (10 min), already used, or `BETTER_AUTH_URL` changed after the flow started | Start the connect flow again from Connections |
| `not_configured` after callback | Secret regenerated in Typeform, or the server has an old value | Update the secret, restart, reconnect |
| `insufficient_permissions` | The user denied `forms:read`/`forms:write` on the consent screen | Reconnect and grant both; nothing is stored when they are missing |
| Connection shows **Reconnect required** after ~a week | `offline` was not granted, so no refresh token was issued | Disconnect, reconnect, and grant the full scope list |
| Creating a form fails with `provider_permission_denied` | The (free) Typeform plan limit for created forms | Check the plan, or delete a test form and retry |
| Draft says `provider_not_supported` | The request targeted Microsoft (or an unknown provider) | Creation targets are Google Forms and Typeform only |
| Typeform import returns 400 | Link contained a query string, a hash, or was not `form.typeform.com/to/{id}` | Paste the canonical share link |
| A Typeform edit is refused as unsupported | Expected for deletes, type changes, or reordering a form with logic | Make that change in Typeform; Intake explains why and changes nothing |

Server logs are redacted: `provider.token exchange rejected` records the provider error code only —
never the code, verifier, tokens or secrets.

## 9. Rollback

1. Remove `TYPEFORM_OAUTH_CLIENT_ID` / `TYPEFORM_OAUTH_CLIENT_SECRET` and restart. The provider row
   returns to "Setup required"; existing Typeform connections become unusable but are not destroyed.
2. To remove stored grants, delete the user's Typeform rows:
   `DELETE FROM provider_connection WHERE provider = 'typeform';`
   Forms and drafts already recorded stay in the library and keep their links.
3. `019` is additive and does not need to be reversed. Do **not** narrow the constraints while
   Typeform rows exist — that migration would fail.

## 10. Security notes

- The client secret lives only in the server environment. The authorization URL never contains it,
  and the browser never sees it.
- Without PKCE, the single-use `state` + exact `redirect_uri` check + server-side secret are what
  protect the code exchange. Keep `BETTER_AUTH_URL` exact, and do not proxy the callback through a
  second host.
- Access and refresh tokens are encrypted at rest with a key derived from `BETTER_AUTH_SECRET` (or
  `PROVIDER_TOKEN_KEY` when set) and an AAD bound to the owning user and provider, so a copied
  ciphertext cannot be replayed for another user.
- Disconnecting never deletes a Typeform; it only removes Intake's access.
