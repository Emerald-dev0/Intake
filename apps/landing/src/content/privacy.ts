/**
 * Privacy policy content for the public `/privacy` page.
 *
 * Google OAuth verification requires this page to live on the operator's own
 * domain, be reachable from the homepage, and describe what Google user data
 * is accessed. Keep every statement below true to the implementation:
 * sign-in is identity-only, the Forms grant is a separate explicit step, and
 * reading respondent answers needs a second, optional permission that Intake
 * only ever asks for on request.
 */

// Update this to a mailbox you actually monitor. It should match the support
// email on the Google Cloud OAuth consent screen.
export const PRIVACY_CONTACT_EMAIL = 'support@intake.calder.click';

export const PRIVACY_TITLE = 'Intake Privacy Policy';
export const PRIVACY_DESCRIPTION =
  'How Intake uses your account, your Google authorization, and your form drafts — and what it never keeps.';
export const PRIVACY_EFFECTIVE_DATE = '6 November 2026';

export const PRIVACY_SECTIONS = [
  {
    heading: 'What Intake does',
    body: [
      'Intake turns a plain-English description into a real Google Form. You describe what you want to collect, review the proposed questions, and confirm. The finished form lives in your own Google account, and responses go straight to Google.',
      'Intake does not host respondent forms and does not collect form responses. People answer on the normal Google Forms page.',
      'If you turn on Response Insights, Intake reads the answers to the one form you opened it for, so it can count them and show you the summary. It reads them at that moment; it does not write them down or keep a copy.',
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
      'Connecting Google Forms is a separate action you start from Connections in the workspace, after you are signed in. It requests one scope: https://www.googleapis.com/auth/forms.body — permission to create and edit the Google Forms you own.',
      'Reading the answers to your forms needs a second, separate permission: https://www.googleapis.com/auth/forms.responses.readonly. Intake does not ask for it when you connect. It is only requested when you open Response Insights and choose to allow it, and Google adds it to the permission you already gave rather than replacing it. If you say no, everything else keeps working and your existing access is unchanged.',
      'Keeping a form’s answers in a spreadsheet needs a third, separate permission: https://www.googleapis.com/auth/drive.file. It is the narrowest permission Google offers for this job, and it reaches only files Intake created itself. Intake does not ask for it when you connect, and it does not ask for it when you read responses; it is requested only when you set up spreadsheet syncing for a particular form. Intake cannot browse your Drive, open a spreadsheet it did not create, read a document or a photo, or see anything else you keep there. It never asks for the broader Drive scope or for the spreadsheets scope, which would cover every spreadsheet you own.',
      'Intake never requests Gmail, Calendar, Contacts, or any other Google service. It creates and edits forms, and — if you ask it to — creates a spreadsheet of its own for a form and appends rows to that spreadsheet. It does not delete forms, and it does not delete spreadsheets: turning syncing off leaves the file exactly as it is, in your Drive.',
      'The grant stores an encrypted access token and refresh token for your Intake account only. Tokens are encrypted with AES-256-GCM before they reach the database and are never sent to the browser, written to logs, or shared with third parties.',
    ],
  },
  {
    heading: 'What Intake stores',
    body: [
      'Your Intake account (email, name, session), your form drafts and the forms you created through Intake (titles, questions, provider form ids and links), credit usage records, and — only if you connect — your encrypted Google authorization described above.',
      'Intake never stores form responses. Answers submitted by your respondents land in the Google Form you own and stay there. When you open Response Insights, the counts, averages and common phrases you see are worked out from those answers each time, and those are not written down either. When you download responses as a CSV, Intake reads them from Google while it writes the file and keeps no copy: the file is the only copy you get, and it goes to your computer, not to a table we own.',
      'When you turn on spreadsheet syncing for a form, Intake keeps a small amount of coordination state so it can do the job without copying your answers: which form the spreadsheet belongs to, the spreadsheet and worksheet it writes to, the timestamp of the last response it wrote, when it should check next, the last error if there was one, and the list of response IDs it has already written. Response IDs identify a response; they are not the answers, and no answer, no respondent email, no token and no copy of a response is stored in those tables. The IDs exist so Intake never writes the same response into your spreadsheet twice, and they are deleted when you delete the form or start a new spreadsheet.',
    ],
  },
  {
    heading: 'What Intake shares',
    body: [
      'Nothing is sold. Google tokens are used only to call the Google Forms API on your behalf after you confirm an action. The description you wrote is sent to the AI provider solely to generate the proposal you asked for. Intake does not allow its providers to use Google user data for advertising, sale, or training generalized models, and no human reads your forms except support staff when you explicitly ask for help.',
      'Intake’s use of information received from Google APIs adheres to the Google API Services User Data Policy, including the Limited Use requirements.',
    ],
  },
  {
    heading: 'Voluntary lists and anonymous analytics',
    body: [
      'Creating an account stores your name, email address and password hash so you can sign in, and the welcome-email processing status so your welcome note can be delivered and retried if it fails. If you also ask to hear about Pro or new providers, Intake stores only your email address and which list you joined. You will hear about each shipped item once — nothing else — and every message explains how to leave the list. One deletion request removes you entirely.',
      'The public site records anonymous pageviews and button clicks to understand what visitors need. No IP addresses, cookies, or identifiers are stored with these events, and they can never be traced back to you or your account.',
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
