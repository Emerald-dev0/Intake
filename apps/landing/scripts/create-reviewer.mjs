/**
 * Provision a dedicated Google OAuth verification reviewer account.
 *
 * Usage:
 *   REVIEWER_EMAIL=reviewer@example.com REVIEWER_PASSWORD=SecureP@ssw0rd123! node scripts/create-reviewer.mjs
 *
 * The script uses the existing Better Auth sign-up API — the same code path
 * as the public sign-up form. No credentials are hardcoded in source.
 *
 * The account is created as a standard user with no admin privileges.
 * It can sign in to Intake but cannot access another user's data.
 */

import 'dotenv/config';
import { Pool } from 'pg';
import { betterAuth } from 'better-auth';

const email = process.env.REVIEWER_EMAIL?.trim();
const password = process.env.REVIEWER_PASSWORD;

if (!email || !email.includes('@')) {
  console.error('REVIEWER_EMAIL must be a valid email address.');
  process.exit(1);
}
if (!password || password.length < 12) {
  console.error('REVIEWER_PASSWORD must be at least 12 characters.');
  process.exit(1);
}

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 1,
});

const auth = betterAuth({
  database: pool,
  baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:5173',
  secret: process.env.BETTER_AUTH_SECRET,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 12,
    requireEmailVerification: false,
  },
});

async function main() {
  const existing = await pool.query(
    'SELECT id FROM "user" WHERE email = $1',
    [email],
  );
  if (existing.rowCount > 0) {
    console.log(`Reviewer account ${email} already exists. Skipping.`);
    await pool.end();
    return;
  }

  const result = await auth.api.signUpEmail({
    body: {
      email,
      password,
      name: 'Google Reviewer',
    },
  });

  if (result.user) {
    console.log(`Reviewer account created: ${email}`);
    console.log('The reviewer can now sign in at the application URL.');
  } else {
    console.error('Failed to create reviewer account:', result);
    process.exit(1);
  }
}

main()
  .catch((error) => {
    console.error('Provisioning failed:', error);
    process.exit(1);
  })
  .finally(() => pool.end());