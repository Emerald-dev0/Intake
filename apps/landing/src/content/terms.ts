/**
 * Terms of service content for the public `/terms` page.
 *
 * Google OAuth branding asks for a terms link alongside the homepage and
 * privacy policy. Keep every statement below true to the implementation:
 * Free during launch, credits metered server-side, Google Forms only.
 */
import { PRIVACY_CONTACT_EMAIL } from './privacy';

export const TERMS_CONTACT_EMAIL = PRIVACY_CONTACT_EMAIL;

export const TERMS_TITLE = 'Intake Terms of Service';
export const TERMS_DESCRIPTION =
  'The rules for using Intake: what the service does, what it costs, and what is expected of you.';
export const TERMS_EFFECTIVE_DATE = '11 October 2026';

export const TERMS_SECTIONS = [
  {
    heading: 'The service',
    body: [
      'Intake turns a plain-English description into a real Google Form in your own Google account. You review every proposal and confirm before anything is created or changed. Intake does not host respondent forms and never collects form responses.',
      'Intake is provided as-is during launch. Features, limits, and pricing may change as the product develops.',
    ],
  },
  {
    heading: 'Accounts',
    body: [
      'You need an Intake account to use the workspace, and a Google account to create forms. You are responsible for keeping your sign-in credentials private and for all activity under your account.',
      'One account per person. Sharing accounts, reselling access, or circumventing credit limits may lead to suspension.',
    ],
  },
  {
    heading: 'Plans and credits',
    body: [
      'Intake is free during launch: every account receives daily credits refreshed at 00:00 UTC. Each interpretation costs a server-determined amount (1–5 credits); failed, unsupported, or clarification requests cost nothing.',
      'Daily credits do not roll over. Paid plans and credit packs described on the pricing page are coming soon and are not on sale yet; anything marked display-only is informational, not an offer.',
    ],
  },
  {
    heading: 'Google integration',
    body: [
      'Connecting Google is optional and entirely your choice. Sign-in uses identity scopes only; creating or editing forms requires your separate, explicit Google authorization with the forms.body scope, granted per session in Google’s own consent screen.',
      'You can disconnect Google at any time from Connections. Forms already created remain in your Google account, governed by Google’s own terms.',
      'You must only connect Google accounts you own or are authorized to use, and only create forms you have the right to create.',
    ],
  },
  {
    heading: 'Acceptable use',
    body: [
      'Do not use Intake to collect sensitive personal data you have no right to collect, to deceive respondents, to spam, to probe or abuse the service, or to violate any law. Do not attempt to access other users’ accounts, drafts, forms, or data.',
      'Instructions typed into Intake are treated as untrusted input: attempts to manipulate the service through prompt injection are a violation of these terms.',
    ],
  },
  {
    heading: 'Intellectual property',
    body: [
      'Intake’s software, design, and content belong to its creator. Your form specifications and the forms created in your Google account are yours.',
      'Do not copy, resell, or misrepresent the service as your own.',
    ],
  },
  {
    heading: 'Liability',
    body: [
      'To the maximum extent permitted by law, Intake is provided without warranties of any kind, and liability is limited to the amount you paid for the service — which, during free launch, is zero.',
      'Intake is not responsible for the content of forms you create, the responses you receive, or actions taken by Google on your account.',
    ],
  },
  {
    heading: 'Suspension and termination',
    body: [
      'Abuse, non-payment if paid plans apply, or violation of these terms may lead to suspension or deletion of your account, with stored authorizations revoked. You may stop using Intake and delete your account at any time.',
    ],
  },
  {
    heading: 'Changes and contact',
    body: [
      'If these terms change materially, the effective date above will be updated and continued use means you accept the updated terms.',
      `Questions about these terms: ${TERMS_CONTACT_EMAIL}.`,
    ],
  },
] as const;
