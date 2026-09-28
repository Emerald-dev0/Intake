# Database workflow

Better Auth manages the current Neon PostgreSQL auth schema. Run `npm run db:migrate` from `apps/landing` with a real Neon `DATABASE_URL` and the remaining required environment variables. The CLI compares the configured auth model to the live database and applies changes. `npm run db:generate` writes a reviewable SQL snapshot here against that same connection. No migration was applied in the cloud agent environment: no Neon connection was provided. Do not claim this database is initialized until the migration runs successfully against the real project.

The auth schema contains only identity, credentials, sessions and verification; future provider connections are **not** login accounts and will have their own ownership and authorization design in a later PR.
