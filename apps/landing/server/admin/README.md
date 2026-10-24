# Internal administration console

The `/admin` console is operator-only. Every route re-verifies the session and
allowlist; everything else is read-only. Two exceptions exist, both deliberate and
both narrow:

- **Plan settings** — daily allowances and prices are editable by design, strictly
  validated, and rate-limited, because the dashboard is the supported way to change
  them without a redeploy.
- **Composed mail** — an operator may write a note and send it to selected accounts,
  one message per recipient. Previewing never sends; a send must carry the render it
  was approved from and the recipient count the operator confirmed. See
  [docs/MAIL.md](../../docs/MAIL.md).

Neither creates an admin role-management product, and neither relies on client state
for permission decisions.

## Access control

1. Better Auth resolves the current signed-in session on every `/api/admin/*` request.
2. The API re-reads the session user's current `id`, `name`, `email`, and `emailVerified` from the Better Auth `"user"` row.
3. The database email must be verified, then compared case-insensitively for exact equality with server-only `ADMIN_EMAILS` entries. An unverified sign-up cannot claim an allowlisted address.
4. Missing/malformed allowlist entries grant no access. Unauthenticated requests receive 401; signed-in non-admins or unverified accounts receive 403.

Configure `ADMIN_EMAILS=owner@example.com,ops@example.com` on the API service only, for existing Better Auth accounts whose email verification has been independently completed. This checkout has no email-delivery/verification service; if the operator provisions the verification state out of band, do so through the trusted database/admin process and do not treat an unverified public sign-up as identity proof. Do not use a `VITE_` prefix. The web client receives only the authorized admin's display identity after the API check. Every API request, including direct requests that skip the React route, performs the same check. The only admin mutation endpoints are plan settings (`PUT /billing/settings`) and composed mail (`POST /mail/preview`, `POST /mail/send`); everything else is read-only.

The `/admin` document has a separate noindex HTML entry, and `/api/admin/*` responses set `X-Robots-Tag` and `Cache-Control: no-store`. These are supplemental privacy controls; authentication and the allowlist are the security boundary.

## API

All routes are mounted under `/api/admin` and independently require the admin session/allowlist check:

| Route | Purpose |
| --- | --- |
| `GET /access` | Confirms authorization and returns the signed-in admin's display identity. |
| `GET /overview?range=today\|7d\|30d` | UTC Better Auth, form-record and recorded AI aggregates. |
| `GET /users?q=&page=&limit=` | Server-side prefix search and paginated user summaries. |
| `GET /users/:userId` | Safe account, auth-method, explicitly unavailable plan/credit-balance, form, provider and AI summary. |
| `GET /ai` | Filtered logical-operation metadata, provider-reported token totals and recorded credits consumed; dollar estimates remain unavailable. |
| `GET /credits` | Per-user balance and ledger analytics are explicitly unavailable in the admin surface; per-operation credits are shown under `/ai`. |
| `GET /forms` | Searchable, paginated Intake record metadata; form titles/content and provider URLs are omitted. |
| `GET /providers` | Aggregate OAuth status and server configuration booleans. |
| `GET /system` | Database readiness evidence, configuration state, rate-limit table and migration status. |
| `GET /activity` | A bounded feed derived from user, form, provider-authorization and AI-operation records. |
| `GET /errors` | Recorded AI failures and incomplete form records only. |
| `GET /analytics?range=today\|7d\|30d` | Privacy-first traffic: page views, CTA clicks, referrer hosts, UTM sources, approximate countries, signups and forms created. Backed by `site_events` (migrations 013–014); no IPs, user agents, cookies or visitor identifiers are collected, so visits means events. |
| `GET /billing/settings` | Effective plan allowances and prices (admin-saved row when present, code defaults otherwise), plus where they came from. |
| `PUT /billing/settings` | Replace all seven settings at once: free/pro daily credits and Pro/pack prices in cents. Whole numbers in range only; partial updates rejected. Writes the `billing_settings` row and refreshes grants, checkout and plan display immediately. Actor is the verified session email. |

The shared PostgreSQL rate-limit store protects admin reads independently of customer-operation ceilings: analytics 30/minute, searches 60/minute, and other reads 120/minute per admin identity. A limiter-store outage fails closed with 503. Query results are paginated (10/25/50/100 rows); search and filter parameters are bounded and parameterized. The overview has no process-local cache; queries execute against current database records.

## Data source boundaries

- **Users and sessions:** Better Auth `"user"` and `"session"`. “Last session update” and overview activity are based on Better Auth session `updatedAt`, not a claim that every page visit is tracked. Only unexpired sessions updated in the selected UTC range count as session activity.
- **Authentication methods:** only Better Auth `account.providerId` is selected. Password hashes, OAuth account tokens, session tokens, verification secrets and Better Auth internals are not returned.
- **Forms:** existing `form` records. “Created” is the saved form-record status. Incomplete partial creations are visible. Admin responses omit form titles, descriptions, specifications, provider URLs, and respondent data; search uses owner identity and opaque form IDs only. Updated record counts are not individual edit-event counts, and failures that occurred before a record was saved are not measurable.
- **Providers:** existing `provider_connection` status only. Token/ciphertext columns are not selected. OAuth configuration is not proof of live provider availability; no Google/Microsoft health probe runs. Disconnect history and persisted provider failures do not exist here.
- **AI:** the application records logical operation metadata and provider-reported token counts in the shared `ai_operation` table. Failed preflight operations (for example, missing configuration) may be recorded even when no external call occurs; absent provider usage remains unavailable, not zero. It stores no prompts, specifications, response content, raw provider errors, or credentials. The usage writer is best-effort so telemetry-storage failure does not break the user's form request. Recorded credits consumed are actual per-operation charges; estimated dollar cost remains unavailable. The admin dashboard uses migration `007_ai_credits.sql`'s recorded `applied_at` as the earliest tracking-availability date; this is not proof of the first stored event. Pre-migration usage is reconstructed only from the metadata safely backfilled by `008_ai_operation_compat.sql`, with historical credit cost set to zero because the old telemetry schema did not establish charges.
- **Plans and credit balances:** the customer application has server-owned plan, entitlement and credit-ledger data, but the admin surface deliberately does not query user balances or aggregate plan/credit grants. Those admin metrics are returned as explicitly unavailable, never as zero or inferred Free/Pro users. The admin does not provide billing, MRR/ARR, manual adjustments, or estimated dollar cost calculated from hard-coded model prices.
- **Traffic:** `POST /api/analytics/event` accepts only `{kind: pageview|click}` on allowlisted public paths (`/`, `/pricing`) with short labels, host-only referrers, short UTM tags and a validated browser timezone; oversized optional tags truncate, malformed events are rejected, anonymous senders are network-rate-limited, and collection failures always answer 202 without breaking the page. Only the marketing pages beacon; workspace, auth and admin routes never report. Country reach prefers the `cf-ipcountry` / `x-vercel-ip-country` edge headers and falls back to timezone approximation (unknown stays empty); the dashboard says which it is showing.
- **Errors/activity:** no centralized persisted route/provider error log or resolution workflow exists. The error view therefore reports only the records it can prove: failed AI operations and saved incomplete forms. It explicitly identifies generic API errors, provider failures and resolution tracking as unavailable. The activity feed is derived from existing source rows rather than a duplicate event table. Provider disconnects are not persisted as events; customer credit grants and charges are held in the ledger but are not included in this admin activity feed.

## Database changes

Run Better Auth migrations first, then `npm run db:migrate:intake`. Migration `007_ai_credits.sql` creates the customer entitlement, ledger and logical-operation schema. The historical `007_ai_operations.sql` identifier is retained as a no-op so migration history remains compatible. `008_ai_operation_compat.sql` archives the earlier Phase 12 telemetry table and safely backfills its metadata into the logical-operation table without deleting the source. `009_admin_indexes.sql` adds indexes for the read-only query paths; it does not create a competing operation schema. `010_email.sql` and `011_billing.sql` hold delivery and billing records, `012_billing_settings.sql` holds the single admin-editable allowances row (seeded with code defaults), and `013_site_analytics.sql` holds the privacy-first traffic events behind `/analytics`, and `020_admin_mail.sql` holds the composed-mail send log (counts only, never message bodies). These migrations rely on the Better Auth, provider, draft and form tables established by `001`–`006`.

This repository change has not applied migrations to the production database. Apply the ordered migration sequence before rollout and verify it under `/admin/system`. Until then, the admin reports missing sources explicitly rather than presenting false zeroes; `/ai` history requires the current logical-operation schema, and legacy telemetry is available only after `008` runs.

## Intentionally deferred

Admin-side billing and revenue/MRR/ARR, Calder email monitoring, manual credit grants or adjustments, support impersonation, feature flags, centralized provider/API logs, error-resolution state, and product analytics are not implemented. Customer-side plans, entitlements and credit consumption remain server-authoritative. Plan allowances and prices are the only admin-editable *settings* (see `PUT /billing/settings`); opening paid billing itself stays a code flag. Composed mail is the only way an admin can reach a customer directly, and it has no scheduling, drafting, retrying, tracking or reply handling. Every other admin operation is read-only.
