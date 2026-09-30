# Database workflow

Better Auth manages the Intake login schema on Neon PostgreSQL. Provider connections are separate tables and are not login accounts.

From `apps/landing`, with a real `DATABASE_URL` and the other required auth variables:

1. `npm run db:migrate` — Better Auth creates or updates `user`, `session`, `account` (email credentials), and `verification`.
2. `npm run db:migrate:intake` — applies `db/migrations/*.sql` after the `"user"` table exists. It is idempotent: each file is applied once, in order, inside a transaction, and recorded.
   - `001_provider_connections.sql` creates `provider_connection` and `provider_oauth_transaction`.
   - `002_forms.sql` creates `form`: one row per form Intake created in a connected provider account.
   - `003_form_drafts.sql` creates `form_draft`: a validated, user-owned current specification, optimistic revision version and atomic one-shot creation claim. No conversation transcript or credentials.

`npm run db:generate` writes a reviewable Better Auth SQL snapshot to `db/auth.sql`. It does not apply it, and it does not include Intake provider tables. Do not point Better Auth at the provider tables.

No migration was applied in the cloud agent environment: no Neon connection was provided. Do not claim the database is initialized until both commands succeed against the real project.

Provider tokens are stored only as application-level ciphertext (`access_token_ciphertext`, `refresh_token_ciphertext`). Queries that serve the browser must not select those columns into a client response. Ownership is `user_id` referencing `"user"(id)` with `ON DELETE CASCADE`, and one connection per provider per user (`UNIQUE (user_id, provider)`).

Forms are recorded in `form`: `user_id` references `"user"(id)` with `ON DELETE CASCADE` (ownership), with the provider, the external account id, the provider form id (`UNIQUE (provider, provider_form_id)`), title, edit and responder URLs, status (`created` or `incomplete`), the request id, and the specification that produced the form. The provider stays the source of truth: the table holds no credentials and no respondent data. Queries that list forms for the browser select named summary columns only, never the specification or the external account id. Deleting a user removes their `form` rows but not the forms in Google; Intake has no Drive scope with which to delete them. See `server/forms/README.md`.

Proposed forms are in `form_draft` under the same Intake user id. The draft API returns **that user's** specification for review, but never exposes another user's draft, connection or provider account id. Revision and confirmation use `user_id` plus version/status predicates. A successful or ambiguous attempt is never reset for a blind retry; an unfinished `creating` state after a crash needs manual investigation. See `server/forms/interpretation/README.md`.
