/**
 * Google **sign-in** (authentication) configuration.
 *
 * This is deliberately separate from Google Forms **connection** authorization:
 *
 * | Concern | Credentials | Callback | Grants |
 * | --- | --- | --- | --- |
 * | Sign in to Intake (`Continue with Google`) | `GOOGLE_CLIENT_ID` / `GOOGLE_CLIENT_SECRET` | `/api/auth/callback/google` (Better Auth) | identity only (`openid email profile`) |
 * | Let Intake create the user's Google Forms | `GOOGLE_OAUTH_CLIENT_ID` / `GOOGLE_OAUTH_CLIENT_SECRET` | `/api/providers/google/callback` | `https://www.googleapis.com/auth/forms.body` |
 *
 * Using the social-login credentials must never grant Forms access, and connecting
 * Forms must never be required to create an Intake account. See
 * `server/providers/README.md` and `server/sign-in/README.md`.
 */
import { isPlaceholderValue } from '../config';

export interface GoogleSignInConfig {
  clientId: string;
  clientSecret: string;
}

export interface GoogleSocialProviders {
  google: GoogleSignInConfig;
}

const MAX_CREDENTIAL = 512;

/**
 * Returns the Google sign-in credentials, or `null` when sign-in is intentionally not configured.
 *
 * A half-configured provider is treated as an operator error instead of silently disabling the
 * button: an inconsistent deployment must fail loudly at startup, not confuse users at the
 * callback. Blank values in `.env` mean "not configured"; the UI then hides Google sign-in
 * entirely rather than offering a button that cannot work.
 */
export function readGoogleSignInConfig(env: NodeJS.ProcessEnv = process.env): GoogleSignInConfig | null {
  const clientId = env.GOOGLE_CLIENT_ID?.trim() ?? '';
  const clientSecret = env.GOOGLE_CLIENT_SECRET?.trim() ?? '';
  if (!clientId && !clientSecret) return null;
  if (!clientId || !clientSecret) {
    throw new Error('Google sign-in is half configured: set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET, or neither. These are sign-in credentials and are unrelated to GOOGLE_OAUTH_CLIENT_ID.');
  }
  if (clientId.length > MAX_CREDENTIAL || clientSecret.length > MAX_CREDENTIAL || /\s/.test(clientId) || /\s/.test(clientSecret)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must be single credential values without whitespace.');
  }
  if (isPlaceholderValue(clientId) || isPlaceholderValue(clientSecret)) {
    throw new Error('GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET must not be placeholder values.');
  }
  if (clientId === clientSecret) {
    throw new Error('GOOGLE_CLIENT_SECRET must be the Google OAuth client secret, not a copy of the client id.');
  }
  return { clientId, clientSecret };
}

/** Better Auth `socialProviders` fragment, or `undefined` when Google sign-in is not configured. */
export function googleSocialProviders(env: NodeJS.ProcessEnv = process.env): GoogleSocialProviders | undefined {
  const config = readGoogleSignInConfig(env);
  if (!config) return undefined;
  // No `accessType`, no `prompt: consent`, no Forms scope: Intake asks Google for identity only.
  // Google still requires an explicit account choice for a signed-out browser, and Better Auth
  // stores the resulting session in the same HttpOnly cookie as email/password sign-in.
  return { google: { clientId: config.clientId, clientSecret: config.clientSecret } };
}

/**
 * Better Auth account-linking policy for Intake.
 *
 * Google is the only trusted provider. Intake has **no email-verification flow**, so including
 * `email-password` here would let anyone register an unverified password account for someone
 * else's address and then inherit that person's Google-linked account. Trusting only `google`
 * means:
 *
 * - a brand-new Google email creates a normal Intake account;
 * - returning Google users sign in to their existing account;
 * - an existing password account with the same email is **never** silently merged. Better Auth
 *   rejects the callback with `account_not_linked`, and the user can sign in with their password
 *   and link Google explicitly (an action they confirm themselves).
 *
 * `requireLocalEmailVerified` stays at its safe default (`true`) for the same reason.
 */
export const ACCOUNT_LINKING_POLICY: {
  enabled: boolean;
  trustedProviders: string[];
  allowDifferentEmails: boolean;
  requireLocalEmailVerified: boolean;
} = {
  enabled: true,
  trustedProviders: ['google'],
  allowDifferentEmails: false,
  requireLocalEmailVerified: true,
};

/** Serialisable sign-in capability list. Contains no ids, secrets, or URLs. */
export function publicSignInConfig(env: NodeJS.ProcessEnv = process.env): { providers: { google: boolean } } {
  return { providers: { google: readGoogleSignInConfig(env) !== null } };
}
