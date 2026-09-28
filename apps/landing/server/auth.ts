import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';

// Better Auth owns identity, credential accounts and sessions. The same Neon
// Postgres database can later hold Intake resources, but provider OAuth grants
// must NEVER be inferred from Better Auth accounts.
const { DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL } = process.env;
if (!DATABASE_URL || !BETTER_AUTH_URL || !BETTER_AUTH_SECRET || BETTER_AUTH_SECRET.length < 32) {
  throw new Error('Set DATABASE_URL, BETTER_AUTH_URL, and BETTER_AUTH_SECRET (at least 32 characters). See .env.example.');
}

export const pool = new Pool({ connectionString: DATABASE_URL, max: 10 });
export const auth = betterAuth({
  database: pool,
  baseURL: BETTER_AUTH_URL,
  secret: BETTER_AUTH_SECRET,
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  // Only same-origin requests from the configured public URL are trusted.
  trustedOrigins: [BETTER_AUTH_URL],
});
