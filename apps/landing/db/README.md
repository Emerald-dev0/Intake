# Database workflow

Better Auth manages the Intake login schema on Neon PostgreSQL. Provider connections are separate tables and are not login accounts.

From `apps/landing`, with a real `DATABASE_URL` and the other required auth variables:

1. `npm run db:migrate` — Better Auth creates or updates `user`, `session`, `account` (email credentials), and `verification`.
2. `npm run db:migrate:intake` — applies `db/migrations/*.sql` after the `"user"` table exists. This creates `provider_connection` and `provider_oauth_transaction`.

`npm run db:generate` writes a reviewable Better Auth SQL snapshot to `db/auth.sql`. It does not apply it, and it does not include Intake provider tables. Do not point Better Auth at the provider tables.

No migration was applied in the cloud agent environment: no Neon connection was provided. Do not claim the database is initialized until both commands succeed against the real project.

Provider tokens are stored only as application-level ciphertext (`access_token_ciphertext`, `refresh_token_ciphertext`). Queries that serve the browser must not select those columns into a client response. Ownership is `user_id` referencing `"user"(id)` with `ON DELETE CASCADE`, and one connection per provider per user (`UNIQUE (user_id, provider)`).
