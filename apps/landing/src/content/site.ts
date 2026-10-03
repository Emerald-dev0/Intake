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
    title: 'Describe the form or change',
    body: 'Tell Intake in natural language what a new form should collect or what you want to change in an existing Google Form.',
  },
  {
    title: 'Intake interprets your request',
    body: 'Server-side AI turns the request into a structured form proposal and checks it against supported Google Forms capabilities.',
  },
  {
    title: 'Review and revise the proposal',
    body: 'Inspect the proposed questions and supported edits. You can ask Intake to revise the draft; Google Forms is not changed during this step.',
  },
  {
    title: 'Authorize the right Google account',
    body: 'Sign in to Intake, then separately connect the Google account that owns the form or has editor access. Choose a form from your library or provide its Google Forms edit URL when editing.',
  },
  {
    title: 'Confirm before anything is applied',
    body: 'After your explicit confirmation, Intake creates a new Google Form or applies supported changes to the same existing form in that connected account.',
  },
] as const;

export const FAQS = [
  {
    question: 'What is Intake?',
    answer: 'Intake is an AI-assisted workspace for creating and editing Google Forms from natural-language requests. It turns your description into a structured proposal; you review it and confirm before Intake creates a new form or applies supported edits to an existing form in your Google account.',
  },
  {
    question: 'How do I create a Google Form with AI using Intake?',
    answer: 'Describe the form in plain language. Intake interprets the request, generates and validates a structured form plan, and shows you a draft to review and revise. Connect your Google account separately, then explicitly confirm to create the real Google Form. The landing-page demos are scripted and do not create forms.',
  },
  {
    question: 'Does Intake create real Google Forms?',
    answer: 'Yes. When the service is configured and you have authorized Google, Intake creates a real form in that connected Google account only after you review the proposal and confirm. Google hosts the responder form and responses; this website’s demos do not make provider calls.',
  },
  {
    question: 'Can Intake edit an existing Google Form?',
    answer: 'Yes. Intake can load a form from your Intake library or a Google Forms edit URL, read its current structure, and prepare supported changes in a reviewable draft. After you confirm, Intake updates that same form rather than creating a replacement. Your connected Google account must have editor access.',
  },
  {
    question: 'Which Google Forms question types does Intake support?',
    answer: 'Current creation supports short answer, paragraph, multiple choice (one answer), checkboxes (multiple answers), and dropdown questions. Email or phone requests become ordinary text fields without format-specific validation. Number, date, and rating controls are not supported. Conditional requests are limited to section-routing patterns Google Forms can express; unsupported rules are flagged instead of applied.',
  },
  {
    question: 'Do I need a Google account?',
    answer: 'Yes, to create or edit a Google Form. You also need an Intake account. Signing in to Intake does not authorize Google access; connect the Google account that owns the form or has permission to edit it.',
  },
  {
    question: 'Does Intake create Microsoft Forms?',
    answer: 'No. Intake’s implemented form creation and editing workflow is for Google Forms. Intake does not claim or offer Microsoft Forms creation or editing.',
  },
  {
    question: 'Does Intake replace Google Forms?',
    answer: 'No. Intake is a natural-language creation and editing layer for Google Forms, not a hosted respondent-form service. Google continues to host the form and collect responses. Intake stores form specifications and management metadata, not respondent answers.',
  },
  {
    question: 'How does Intake use AI?',
    answer: 'Server-side AI interprets a request and proposes a structured form specification or supported edits. Intake validates that proposal against its form rules and Google Forms capabilities. The model cannot access your Google credentials or call Google Forms; a provider change happens only after your explicit confirmation.',
  },
  {
    question: 'Does Intake apply changes automatically?',
    answer: 'No. Interpreting or revising a request changes only the Intake draft. Intake contacts Google Forms to create or update a form only after you explicitly confirm the reviewed proposal.',
  },
  {
    question: 'Who is Intake for?',
    answer: 'Intake is for students, researchers, educators, event organizers, community groups, and small businesses that need to create or update Google Forms without manually configuring every question.',
  },
] as const;
