# OAuth Scope Audit — Intake

## Currently Requested Scopes

| Scope | When requested | Purpose |
|-------|---------------|---------|
| `openid` | Google sign-in + Google Forms connect | Identifies the Google account |
| `email` | Google sign-in + Google Forms connect | Shows the connected account's email in the UI |
| `https://www.googleapis.com/auth/forms.body` | Google Forms connect | Create and edit Google Forms in the user's account |
| `https://www.googleapis.com/auth/forms.responses.readonly` | Optional extend endpoint only | Read aggregated response summaries (not individual responses) |

## Scope-by-Scope Analysis

### `https://www.googleapis.com/auth/forms.body`

**Used by:** `server/providers/registry.ts` — default Google Forms connection scopes.

**Why it's necessary:** This is the write scope for the Google Forms API. Intake creates new forms (`forms.create`), retrieves form structure (`forms.get`), and applies batch updates (`forms.batchUpdate`) using this scope. Without it, the core feature — creating and editing Google Forms — cannot function.

**Where it's used in code:**
- `server/forms/providers/google/client.ts` — all Forms API calls (create, get, batchUpdate, setPublishSettings)
- `server/providers/service.ts` — `startAuthorization()` includes this scope in the consent request
- `server/providers/registry.ts` — `googleDefinition().scopes` and `requiredScopes`

### `https://www.googleapis.com/auth/forms.body.readonly`

**Used by:** Not currently requested anywhere in the codebase.

**Finding:** This scope is **not used**. The `forms.get` API call (used to read form structure for editing) is authorized under `forms.body` (the write scope), which inherently includes read access. Requesting `forms.body.readonly` separately would be redundant — it provides no additional functionality and would add an unnecessary permission to the consent screen.

**Recommendation:** Do not add this scope. The existing `forms.body` scope already covers all read operations Intake performs.

### `https://www.googleapis.com/auth/forms.responses.readonly`

**Used by:** `server/providers/service.ts` — the `responses` capability in `OPTIONAL_SCOPE_SETS`, requested via the `/api/providers/google/extend?capability=responses` endpoint.

**Why it's requested:** This scope enables the optional "response summaries" feature. When a user explicitly opts in via the extend endpoint, Intake can call `forms.responses.list` to aggregate response data (counts, averages, top phrases). Individual responses are never stored or displayed — only aggregated statistics.

**Where it's used in code:**
- `server/forms/providers/google/client.ts` — `listResponses()` method (only called after explicit opt-in)
- `server/forms/insights/routes.ts` — `GET /api/forms/:id/insights` (gated behind Pro + scope check)
- `server/providers/service.ts` — `OPTIONAL_SCOPE_SETS`, the capability map the extend endpoint resolves
- `src/app/components/Insights.tsx` — the panel that offers the permission, as a plain form post

**Note:** This scope is **never requested during the initial connection**. It is only added when the user explicitly enables response summaries through the extend endpoint. The consent screen shows it as an optional addition. Because Google merges scopes into an existing grant (`include_granted_scopes`), the granted set is the union of what was granted before and what was granted now — the connection's stored scopes are that union, never just the newest request.

### `https://www.googleapis.com/auth/drive.file`

**Used by:** The optional `sheets` capability — keeping a form's responses in a Google Sheet, and the
Google Picker used to choose an existing spreadsheet.

**Finding:** This is the **narrowest** scope that can do the job, and it is the only Drive-shaped scope
in the repository. It is per-file: it reaches files Intake created, plus files the person explicitly
opens with the app — and for the Picker, Google documents the act of picking as that grant. Creating
forms does not need it (the Forms API deals in forms, not Drive files), so it is never requested
during the ordinary Google Forms connection: it arrives as a separate, optional authorization the
person triggers from the spreadsheet panel.

- `spreadsheets` is *sensitive* and would grant every spreadsheet in the account. Not requested.
- `drive` and `drive.readonly` are *restricted*, would require a security assessment, and would let
  Intake enumerate a person's whole Drive. Not requested, not needed.
- The Picker itself needs **no** additional scope. It runs in the browser with the same short-lived
  access token the server already holds, plus a public, origin-restricted API key.

**Recommendation:** Keep. It is the correct minimum for both writing rows and choosing an existing
file; nothing broader would be accepted for this feature.

## Summary

| Scope | Currently requested? | Actually used? | Recommendation |
|-------|---------------------|----------------|----------------|
| `forms.body` | Yes (default) | Yes — create, read, update forms | Keep |
| `forms.body.readonly` | No | No — redundant with `forms.body` | Do not add |
| `forms.responses.readonly` | Yes (optional extend) | Yes — response summaries, and the rows a sheet sync writes | Keep (optional) |
| `drive.file` | Yes (optional `sheets` extend, and the Picker) | Yes — append rows to one spreadsheet, and list only the file the person picked | Keep — narrowest possible; never requested with the base connection |

## Consent Screen

When a reviewer connects a Google account, the consent screen shows:

1. **Confirm the Google account you connect** (`openid`)
2. **See the email address of that Google account** (`email`)
3. **Create and edit your Google Forms** (`forms.body`)

The `forms.responses.readonly` scope is not shown during initial connection. It only appears if the user later enables response summaries through the optional extend flow, which is reached from Response Insights in the library or from the Manage panel on Connections.
