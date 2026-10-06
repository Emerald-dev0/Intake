import 'dotenv/config';
import { betterAuth } from 'better-auth';
import { Pool } from 'pg';
import { readCoreServerConfig } from './config';
import { ACCOUNT_LINKING_POLICY, googleSocialProviders } from './sign-in/google';
import { safeHook } from './email/bridge';

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

/** Shared by the auth config and the reset-email copy so the two can never disagree. */
export const RESET_TOKEN_SECONDS = 30 * 60;

export const pool = new Pool({ connectionString: serverConfig.databaseUrl, max: 10 });
export const auth = betterAuth({
  database: pool,
  baseURL: serverConfig.publicOrigin,
  secret: serverConfig.authSecret,
  emailAndPassword: {
    enabled: true,
    minPasswordLength: 8,
    // 30 minutes: long enough to find the email and act, short enough to limit exposure.
    resetPasswordTokenExpiresIn: RESET_TOKEN_SECONDS,
    // A password reset is a security event: every other session is signed out.
    revokeSessionsOnPasswordReset: true,
    /**
     * Better Auth generates, stores, expires and single-uses the reset token. Intake owns the
     * delivery: this hook is the only place a reset link is ever emailed, and the link points at
     * Intake, never at the provider (mission §10).
     */
    sendResetPassword: async ({ user, token }) => {
      await safeHook('sendPasswordReset', hooks => hooks.sendPasswordReset({
        userId: user.id,
        email: user.email,
        name: user.name ?? null,
        token,
      }));
    },
    onPasswordReset: async ({ user }) => {
      await safeHook('onPasswordReset', hooks => hooks.onPasswordReset(user.id));
    },
  },
  databaseHooks: {
    // Emails are best-effort by construction: a delivery failure must never block authentication.
    session: {
      create: {
        after: async session => {
          await safeHook('onNewSession', hooks => hooks.onNewSession({
            userId: session.userId,
            networkSubject: typeof session.ipAddress === 'string' ? session.ipAddress : 'unknown',
          }));
        },
      },
    },
    account: {
      create: {
        after: async account => {
          if (account.providerId !== 'google') return;
          await safeHook('onAccountLinked', hooks => hooks.onAccountLinked({ userId: account.userId, providerId: 'google' }));
        },
      },
      delete: {
        after: async account => {
          if (account.providerId !== 'google') return;
          await safeHook('onAccountUnlinked', hooks => hooks.onAccountUnlinked({ userId: account.userId, providerId: 'google' }));
        },
      },
    },
  },
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
