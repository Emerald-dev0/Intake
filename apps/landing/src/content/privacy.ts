/**
 * Privacy policy content for the public `/privacy` page.
 *
 * Google OAuth verification requires this page to live on the operator's own
 * domain, be reachable from the homepage, and describe what Google user data
 * is accessed. Keep every statement below true to the implementation:
 * sign-in is identity-only, the Forms grant is a separate explicit step, and
 * respondent answers are never touched by Intake.
 */

// Update this to a mailbox you actually monitor. It should match the support
// email on the Google Cloud OAuth consent screen.
export const PRIVACY_CONTACT_EMAIL = 'oluwadare458@gmail.com';

export const PRIVACY_TITLE = 'Intake Privacy Policy';
export const PRIVACY_DESCRIPTION =
  'How Intake uses your account, your Google authorization, and your form drafts — and what it never touches.';
export const PRIVACY_EFFECTIVE_DATE = '11 October 2026';

export const PRIVACY_SECTIONS = [
  {
    heading: 'What Intake does',
    body: [
      'Intake turns a plain-English description into a real Google Form. You describe what you want to collect, review the proposed questions, and confirm. The finished form lives in your own Google account, and responses go straight to Google.',
      'Intake does not host respondent forms and does not collect form responses. People answer on the normal Google Forms page.',
    ],
  },
  {
    heading: 'Google sign-in (identity only)',
    body: [
      'When you use “Continue with Google”, Intake receives only your basic identity: name, email address, and profile information (the openid, email, and profile scopes).',
      'Signing in never gives Intake access to your Google Forms, Drive, Gmail, Calendar, Contacts, or Sheets. Forms access requires the separate connection step below.',
    ],
  },
  {
    heading: 'Google Forms connection (your choice)',
    body: [
      'Connecting Google Forms is a separate action you start from Connections in the workspace, after you are signed in. It requests a single additional scope: https://www.googleapis.com/auth/forms.body — permission to create and edit the Google Forms you own.',
      'Intake does not request Drive, Gmail, Calendar, Contacts, Sheets, or forms.responses.readonly scopes. It cannot read form responses, delete forms, change sharing, or access any other Google service.',
      'The grant stores an encrypted access token and refresh token for your Intake account only. Tokens are encrypted with AES-256-GCM before they reach the database and are never sent to the browser, written to logs, or shared with third parties.',
    ],
  },
  {
    heading: 'What Intake stores',
    body: [
      'Your Intake account (email, name, session), your form drafts and the forms you created through Intake (titles, questions, provider form ids and links), credit usage records, and — only if you connect — your encrypted Google authorization described above.',
      'Intake never stores form responses. Answers submitted by your respondents land in the Google Form you own and stay there.',
    ],
  },
  {
    heading: 'What Intake shares',
    body: [
      'Nothing is sold. Google tokens are used only to call the Google Forms API on your behalf after you confirm an action. No Google user data is shared with advertisers, analytics vendors, or AI providers beyond the form specification Intake itself generates for the operation you asked for.',
      'Intake’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
    ],
  },
  {
    heading: 'Disconnecting and deletion',
    body: [
      'You can disconnect Google Forms at any time from Connections. Disconnecting deletes Intake’s stored authorization immediately and attempts to revoke the grant at Google. You can also remove Intake from your Google account permissions page at any time.',
      'Deleting your Intake account removes your drafts, library entries, and stored authorizations. Forms already created in your Google account stay in your Google account until you delete them there.',
    ],
  },
  {
    heading: 'Security and retention',
    body: [
      'Sessions are HTTP-only cookies, secure on HTTPS. Every form operation verifies that the signed-in user owns the form. Authorization data is encrypted at rest; changing the encryption key marks stored grants as needing reauthorization rather than decrypting them incorrectly.',
      'Operational logs never include tokens, secrets, prompts, or model output. Data is kept only while your account exists and as needed to operate the service.',
    ],
  },
  {
    heading: 'How long data is kept',
    body: [
      'Your account, drafts, library entries, and credit ledger are kept while your account exists. OAuth transactions (the single-use login handshake) expire after 10 minutes and are then unusable.',
      'If you disconnect Google, the stored authorization is deleted immediately and revocation is attempted at Google. If you delete your Intake account, your drafts, library entries, and stored authorizations are removed with it.',
      'Aggregated, de-identified operational records (such as credit ledger entries needed for accounting integrity) may be retained as required for the security and bookkeeping of the service.',
    ],
  },
  {
    heading: 'Your rights and choices',
    body: [
      'You can review your connection state, library, and credit balance at any time in the workspace. You can disconnect Google, delete individual drafts, and request deletion of your account and its data.',
      'You can withdraw Google authorization at any moment — from Connections inside Intake, or directly from your Google account permissions page (https://myaccount.google.com/permissions). Withdrawal takes effect immediately for future operations; forms already created stay in your Google account.',
      'To exercise a privacy right or ask what data Intake holds about you, write to the contact address below.',
    ],
  },
  {
    heading: 'Children’s privacy',
    body: [
      'Intake is not directed at children under 13, and does not knowingly collect personal information from them. If you believe a child has provided personal data, contact us and it will be deleted promptly.',
    ],
  },
  {
    heading: 'Changes and contact',
    body: [
      'If this policy changes materially, the effective date above will be updated and continuing to use Intake means you accept the updated policy.',
      `Questions about privacy or your data: ${PRIVACY_CONTACT_EMAIL}.`,
    ],
  },
] as const;
