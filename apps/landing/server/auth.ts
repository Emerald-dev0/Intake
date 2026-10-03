import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { readCoreServerConfig } from './config';
import { ACCOUNT_LINKING_POLICY, googleSocialProviders } from './sign-in/google';

// Better Auth owns identity, credential accounts and sessions. Provider OAuth
// grants live in provider_connection and must NEVER be inferred from these
// accounts. See server/providers/README.md.
export const serverConfig = readCoreServerConfig();

// Google sign-in is optional configuration: without GOOGLE_CLIENT_ID and
// GOOGLE_CLIENT_SECRET the email/password flow is unchanged and the UI hides the
// Google button. These credentials are identity-only and separate from the
// Google Forms connection credentials. See server/sign-in/README.md.
const socialProviders = googleSocialProviders(process.env);
export const googleSignInEnabled = socialProviders !== undefined;

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
  // Omitted entirely when unconfigured, so no provider is ever advertised without credentials.
  ...(socialProviders ? { socialProviders } : {}),
  // Explicit, safe account linking. See ACCOUNT_LINKING_POLICY for why password
  // accounts are never implicitly merged into a Google sign-in.
  account: { accountLinking: ACCOUNT_LINKING_POLICY },
});
