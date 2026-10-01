import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { readCoreServerConfig } from './config';

// Better Auth owns identity, credential accounts and sessions. Provider OAuth
// grants live in provider_connection and must NEVER be inferred from these
// accounts. See server/providers/README.md.
export const serverConfig = readCoreServerConfig();

export const pool = new Pool({ connectionString: serverConfig.databaseUrl, max: 10 });
export const auth = betterAuth({
  database: pool,
  baseURL: serverConfig.publicOrigin,
  secret: serverConfig.authSecret,
  emailAndPassword: { enabled: true, minPasswordLength: 8 },
  // Better Auth has stricter built-in rules for sign-in/sign-up/password routes. Keep it explicitly
  // enabled in every environment; production does not depend on an implicit NODE_ENV default.
  rateLimit: { enabled: true, window: 60, max: 100 },
  // Only same-origin requests from the configured public URL are trusted.
  trustedOrigins: [serverConfig.publicOrigin],
});
