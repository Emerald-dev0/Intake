# Internal administration console

The `/admin` console is an operator-only, read-only surface. It does not create an admin role-management product and it does not rely on client state for permission decisions.

## Access control

1. Better Auth resolves the current signed-in session on every `/api/admin/*` request.
2. The API re-reads the session user's current `id`, `name`, `email`, and `emailVerified` from the Better Auth `"user"` row.
3. The database email must be verified, then compared case-insensitively for exact equality with server-only `ADMIN_EMAILS` entries. An unverified sign-up cannot claim an allowlisted address.
4. Missing/malformed allowlist entries grant no access. Unauthenticated requests receive 401; signed-in non-admins or unverified accounts receive 403.

Configure `ADMIN_EMAILS=owner@example.com,ops@example.com` on the API service only, for existing Better Auth accounts whose email verification has been independently completed. This checkout has no email-delivery/verification service; if the operator provisions the verification state out of band, do so through the trusted database/admin process and do not treat an unverified public sign-up as identity proof. Do not use a `VITE_` prefix. The web client receives only the authorized admin's display identity after the API check. Every API request, including direct requests that skip the React route, performs the same check. There are no admin mutation endpoints in this phase.

The `/admin` document has a separate noindex HTML entry, and `/api/admin/*` responses set `X-Robots-Tag` and `Cache-Control: no-store`. These are supplemental privacy controls; authentication and the allowlist are the security boundary.

## API

All routes are mounted under `/api/admin` and independently require the admin session/allowlist check:

| Route | Purpose |
| --- | --- |
| `GET /access` | Confirms authorization and returns the signed-in admin's display identity. |
| `GET /overview?range=today\|7d\|30d` | UTC Better Auth, form-record and recorded AI aggregates. |
| `GET /users?q=&page=&limit=` | Server-side prefix search and paginated user summaries. |
| `GET /users/:userId` | Safe account, auth-method, plan/credit-unavailable, form, provider and AI summary. |
| `GET /ai` | Filtered, paginated Groq operation metadata and provider-reported token totals. |
| `GET /credits` | Explicit unavailable result because there is no credit ledger in this checkout. |
| `GET /forms` | Searchable, paginated Intake record metadata; form titles/content and provider URLs are omitted. |
| `GET /providers` | Aggregate OAuth status and server configuration booleans. |
| `GET /system` | Database readiness evidence, configuration state, rate-limit table and migration status. |
| `GET /activity` | A bounded feed derived from user, form, provider-authorization and AI-operation records. |
| `GET /errors` | Recorded AI failures and incomplete form records only. |

The shared PostgreSQL rate-limit store protects admin reads independently of customer-operation ceilings: analytics 30/minute, searches 60/minute, and other reads 120/minute per admin identity. A limiter-store outage fails closed with 503. Query results are paginated (10/25/50/100 rows); search and filter parameters are bounded and parameterized. The overview has no process-local cache; queries execute against current database records.

## Data source boundaries

- **Users and sessions:** Better Auth `"user"` and `"session"`. “Last session update” and overview activity are based on Better Auth session `updatedAt`, not a claim that every page visit is tracked. Only unexpired sessions updated in the selected UTC range count as session activity.
- **Authentication methods:** only Better Auth `account.providerId` is selected. Password hashes, OAuth account tokens, session tokens, verification secrets and Better Auth internals are not returned.
- **Forms:** existing `form` records. “Created” is the saved form-record status. Incomplete partial creations are visible. Admin responses omit form titles, descriptions, specifications, provider URLs, and respondent data; search uses owner identity and opaque form IDs only. Updated record counts are not individual edit-event counts, and failures that occurred before a record was saved are not measurable.
- **Providers:** existing `provider_connection` status only. Token/ciphertext columns are not selected. OAuth configuration is not proof of live provider availability; no Google/Microsoft health probe runs. Disconnect history and persisted provider failures do not exist here.
- **AI:** the application calls Groq (`GROQ_MODEL`, default `openai/gpt-oss-20b`; this is a Groq-hosted model ID). Migration `007_ai_operations.sql` starts recording interpreter-operation metadata and token counts returned by Groq. Failed preflight operations (for example, missing configuration) may be recorded even when no external call occurs; absent provider usage remains unavailable, not zero. It stores no prompts, specifications, response content, raw provider errors, or credentials. The usage writer is best-effort so telemetry-storage failure does not break the user's form request. The dashboard shows migration `007`'s recorded `applied_at` as the earliest tracking-availability date; this is not proof of the first stored event. Pre-migration history cannot be reconstructed.
- **Cost and credits:** no credit ledger, daily/monthly balance, plan/entitlement, pricing schedule, subscription, or billing provider is present in this checkout. These are reported as unavailable, never as zero or inferred Free/Pro users. No estimated cost is calculated from hard-coded model prices.
- **Errors/activity:** no centralized persisted route/provider error log or resolution workflow exists. The error view therefore reports only the records it can prove: failed AI operations and saved incomplete forms. It explicitly identifies generic API errors, provider failures and resolution tracking as unavailable. The activity feed is derived from existing source rows rather than a duplicate event table; provider disconnects and credit events cannot be reconstructed.

## Database changes

Run Better Auth migrations first, then `npm run db:migrate:intake`. The additive `007_ai_operations.sql` creates metadata-only interpreter-operation records and indexes aligned to the current admin query patterns: user/date searches, date-bounded usage, session activity, form activity and user prefix search. It does not modify existing Better Auth, provider, draft or form data. It requires the existing `"user"`, `"session"`, `account`, `form`, and `provider_connection` tables already established by migrations `001`–`006`.

No migration has been applied to the production database by this repository change. The API reports the recorded migration status under `/admin/system`; an operator must apply `007` before AI history will be available. Admin user/form/system screens can still identify missing sources instead of presenting false zeroes where their schema checks allow it.

## Intentionally deferred

Bachs.io billing and revenue/MRR/ARR, Calder email monitoring, plan/entitlement management, credit grants/consumption/adjustments, support impersonation, feature flags, centralized provider/API logs, error resolution state, and product analytics are not implemented. Admin operations are read-only until a separately reviewed audit/action model exists.
