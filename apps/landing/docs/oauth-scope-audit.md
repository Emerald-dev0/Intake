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

**Used by:** `server/providers/service.ts` — `OPTIONAL_SCOPES` via the `/api/providers/google/extend` endpoint.

**Why it's requested:** This scope enables the optional "response summaries" feature. When a user explicitly opts in via the extend endpoint, Intake can call `forms.responses.list` to aggregate response data (counts, averages, top phrases). Individual responses are never stored or displayed — only aggregated statistics.

**Where it's used in code:**
- `server/forms/providers/google/client.ts` — `listResponses()` method (only called after explicit opt-in)
- `server/forms/insights/routes.ts` — `GET /api/forms/:id/insights` (gated behind Pro + scope check)
- `server/providers/service.ts` — `OPTIONAL_SCOPES` constant, used by the extend endpoint

**Note:** This scope is **never requested during the initial connection**. It is only added when the user explicitly enables response summaries through the extend endpoint. The consent screen shows it as an optional addition.

### `https://www.googleapis.com/auth/drive.file`

**Used by:** Not currently requested.

**Finding:** This scope is **not used** and is **not needed**. Intake creates forms directly in the user's Google account via the Forms API (`forms.create`). Forms created this way are already accessible to the user without Drive API access. The `drive.file` scope would only be needed if Intake accessed forms through the Drive API (e.g., searching for forms by file ID), which it does not do.

**Recommendation:** Do not add this scope. It would expand Intake's access without providing any functional benefit.

## Summary

| Scope | Currently requested? | Actually used? | Recommendation |
|-------|---------------------|----------------|----------------|
| `forms.body` | Yes (default) | Yes — create, read, update forms | Keep |
| `forms.body.readonly` | No | No — redundant with `forms.body` | Do not add |
| `forms.responses.readonly` | Yes (optional extend) | Yes — aggregated summaries only | Keep (optional) |
| `drive.file` | No | No — not needed | Do not add |

## Consent Screen

When a reviewer connects a Google account, the consent screen shows:

1. **Confirm the Google account you connect** (`openid`)
2. **See the email address of that Google account** (`email`)
3. **Create and edit your Google Forms** (`forms.body`)

The `forms.responses.readonly` scope is not shown during initial connection. It only appears if the user later enables response summaries through the optional extend flow.
