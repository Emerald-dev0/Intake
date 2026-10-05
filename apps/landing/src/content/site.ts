export const SITE_URL = 'https://intake-six-blue.vercel.app';
export const SITE_NAME = 'Intake';
export const HOMEPAGE_TITLE = 'Intake — AI-Powered Google Forms Creation & Editing';
export const META_DESCRIPTION = 'Create and edit Google Forms with AI. Describe a form or requested change, review Intake’s proposal, and confirm before it is applied in your connected Google account.';
export const PRODUCT_DESCRIPTION = 'Intake is an AI-assisted workspace for creating and editing real Google Forms from natural-language requests. It turns a prompt into a structured proposal for review; Intake changes Google Forms only after you explicitly confirm.';

export const CREATOR = {
  name: 'Oluwadare Daniel',
  identity: 'Emerald',
  displayName: 'Oluwadare Daniel — Emerald',
  github: 'https://github.com/Emerald-dev0',
  profiles: [
    'https://x.com/Dev_emeraldX',
    'https://www.tiktok.com/@emerald_dev1',
    'https://www.instagram.com/emerald_dev1/',
    'https://www.linkedin.com/in/emerald_dev/',
    'https://github.com/Emerald-dev0',
  ],
} as const;

export const WORKFLOW_STEPS = [
  {
    title: 'Describe what you need',
    body: 'Tell Intake in plain language what a new form should collect or what should change in an existing Google Form.',
  },
  {
    title: 'Intake understands the request',
    body: 'Server-side AI turns the request into a structured form proposal and checks it against supported Google Forms capabilities.',
  },
  {
    title: 'Review the proposal',
    body: 'Inspect the proposed questions or supported edits. Revise the draft if needed; Google Forms is not changed during this step.',
  },
  {
    title: 'Confirm before applying',
    body: 'Authorize Google separately, then confirm. Intake creates a real Google Form or applies supported edits to that same existing form.',
  },
] as const;

export const FAQS = [
  {
    question: 'What is Intake?',
    answer: 'Intake is a natural-language control layer for real Google Forms. Describe a form or a change, review the structured proposal, and confirm before Intake creates or updates a form in your connected Google account.',
  },
  {
    question: 'What does Intake do?',
    answer: 'Intake uses server-side AI to turn a plain-language request into a structured Google Forms proposal. It can create a new form or prepare supported edits to an existing form, with review and explicit confirmation before anything is applied.',
  },
  {
    question: 'Can Intake create Google Forms?',
    answer: 'Yes. When the Intake service and Google Forms connection are configured, Intake creates a real Google Form in your authorized Google account after you review the proposal and confirm. The examples on this page are illustrative and do not create forms.',
  },
  {
    question: 'Can Intake edit existing Google Forms?',
    answer: 'Yes. Choose a form from your Intake library or provide its Google Forms edit URL. Intake reads its current structure and proposes supported changes; after you confirm, it updates that same form rather than making a replacement. Your Google account needs editor access.',
  },
  {
    question: 'How does Intake create a Google Form?',
    answer: 'Describe the form in plain language. Intake interprets the request, validates a structured proposal against supported form capabilities, and shows you a draft to review or revise. Connect Google separately, then confirm to create the real form in that account.',
  },
  {
    question: 'Do I need a Google account?',
    answer: 'Yes, to create or edit a Google Form. You also need an Intake account. Signing in to Intake is separate from authorizing the Google account that owns the form or has editor access.',
  },
  {
    question: 'Does Intake replace Google Forms?',
    answer: 'No. Intake is a natural-language way to create and manage Google Forms, not another hosted form platform. Google hosts the responder page and collects responses; Intake stores form specifications and management metadata, not respondent answers.',
  },
  {
    question: 'Can I review changes before they are applied?',
    answer: 'Yes. Intake shows a structured proposal before creating or editing a Google Form. Drafting and revising do not change Google Forms; the provider operation happens only after you explicitly confirm the reviewed proposal.',
  },
  {
    question: 'Is Intake free?',
    answer: 'The Free plan is $0 and includes 20 daily AI credits, Google Forms connection, AI creation and editing, a form library, and review-before-apply. Pro is displayed at $6.99 per month or $59.99 per year with an additional 500 monthly credits, but checkout and plan changes are not available yet.',
  },
  {
    question: 'What are Intake AI credits?',
    answer: 'Credits measure successful AI-powered creation and editing interpretations. A simple edit costs 1 credit, a standard creation of about six questions costs 2, and larger or conditional creations cost 3–5. Failed, unsupported, or clarification-needed interpretations are not charged; applying an already-reviewed form costs no additional AI credits.',
  },
  {
    question: 'What is the difference between Intake and a normal AI form builder?',
    answer: 'Intake does not just generate a form on its own platform. It turns natural-language requests into reviewable proposals for actual Google Forms, can propose supported changes to forms you already have, and waits for your confirmation before applying them.',
  },
  {
    question: 'Which Google Forms question types does Intake support?',
    answer: 'Supported question types include short answer, paragraph, one-answer multiple choice, checkboxes, and dropdowns. Email and phone requests become ordinary text fields without format-specific validation. Number, date, and rating controls are not supported. Conditional requests are limited to supported Google Forms section-routing patterns; unsupported requests are flagged instead of applied.',
  },
  {
    question: 'Can I upgrade to Pro now?',
    answer: 'Not yet. Pro is listed at $6.99 per month or $59.99 per year, but Intake does not process payments or allow self-service plan changes yet. The displayed prices do not start a subscription.',
  },
  {
    question: 'Does Intake create Microsoft Forms?',
    answer: 'No. Intake’s implemented form creation and editing workflows are for Google Forms. Microsoft Forms creation and editing are not available.',
  },
] as const;
