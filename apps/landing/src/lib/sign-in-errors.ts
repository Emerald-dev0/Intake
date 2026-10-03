/**
 * User-facing wording for OAuth failures.
 *
 * Better Auth redirects a failed sign-in to the error callback URL with a machine-readable
 * `?error=<code>`. Raw codes, provider descriptions and payloads are never rendered: each code maps to
 * one plain sentence here, and anything unknown gets a neutral message.
 */

const OAUTH_ERRORS: Record<string, string> = {
  access_denied: 'Google sign-in was cancelled. Nothing was changed.',
  account_not_linked: 'An Intake account already uses this email with a password. Sign in with your password, then link Google from your account page.',
  email_not_verified: 'Google did not confirm this email address, so Intake did not sign you in.',
  unable_to_get_user_info: 'Google sign-in could not be completed. Nothing was changed. Please try again.',
  invalid_code: 'That Google sign-in attempt expired. Please try again.',
  state_not_found: 'That Google sign-in attempt could not be verified. Please start again from this page.',
  oauth_provider_not_found: 'Google sign-in is not available on this Intake server.',
  email_not_found: 'Google did not share an email address, so Intake cannot create an account for it.',
  unable_to_link_account: 'Intake could not link this Google account safely. Nothing was changed.',
  account_already_linked_to_different_user: 'That Google account is already linked to a different Intake account.',
  email_does_not_match: 'That Google account uses a different email than the Intake account you are signed in to.',
  internal_server_error: 'Google sign-in could not be completed right now. Please try again.',
};

export function oauthErrorMessage(code: string): string {
  return OAUTH_ERRORS[code] ?? 'Google sign-in could not be completed. Nothing was changed. Please try again.';
}
