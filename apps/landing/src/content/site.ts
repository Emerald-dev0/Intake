import { DEFAULT_SITE_URL, normalizeSiteUrl } from '../lib/site-url.ts';

/**
 * Canonical public origin. Builds through Vite inline `VITE_SITE_URL`; tooling that imports this
 * module in Node (for example `vite.config.ts`) resolves the value through `loadEnv` and passes it
 * to the plugins explicitly. The fallback keeps an unconfigured build honest rather than blank.
 */
function viteSiteUrl(): string | undefined {
  const meta = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  return meta?.VITE_SITE_URL;
}

export const SITE_URL = normalizeSiteUrl(viteSiteUrl(), DEFAULT_SITE_URL);

export const SITE_NAME = 'Intake';
export const HOMEPAGE_TITLE = 'Intake — Google Forms, built from a sentence';
export const META_DESCRIPTION = 'Describe the form you need. Intake shows you every question it will ask, you change what you like, and the form appears in your own Google Forms account.';
export const PRODUCT_DESCRIPTION = 'Intake turns a plain-English description into a real Google Form. You see the questions before anything is created, adjust them, and confirm when the form is ready.';

export const CREATOR = {
  name: 'Oluwadare Daniel',
  identity: 'Emerald',
  displayName: 'Oluwadare Daniel — Emerald',
  /** Shown in the footer. Deliberately short and impersonal. */
  credit: 'Emerald',
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
    body: 'Write it the way you would explain it to a colleague. One sentence is usually enough.',
  },
  {
    title: 'See what Intake understood',
    body: 'Your request comes back as a clear list of questions, answer types and choices to check over.',
  },
  {
    title: 'Change anything you like',
    body: 'Ask for adjustments in plain English until the proposal looks exactly the way you want it.',
  },
  {
    title: 'Confirm, and it is real',
    body: 'One click builds the form in your own Google account, or updates the one you picked.',
  },
] as const;

/** Phrases people can actually type. Used by the scrolling example strip on the homepage. */
export const PROMPT_EXAMPLES = [
  'Create a customer feedback form',
  'Build an onboarding survey with three sections',
  'Add a question about follow-up calls',
  'Change the rating question to a dropdown',
  'Make a student club sign-up form',
  'Ask which department they work in',
  'Split the form when someone answers no',
  'Make every question optional except the first',
] as const;

export const FAQS = [
  {
    question: 'What is Intake?',
    answer: 'Intake builds Google Forms from a sentence. You describe what you want to collect, look over the questions it came up with, and confirm when it looks right. The finished form lives in your own Google account.',
  },
  {
    question: 'Do I need a Google account?',
    answer: 'Yes, because the form is created inside Google Forms. You sign in to Intake once, then connect the Google account you want the form to live in. The two steps are separate, so signing in never gives Intake access to your forms by itself.',
  },
  {
    question: 'Can I change the questions before they are created?',
    answer: 'Always. Nothing is created until you say so. Read the proposal, rewrite a question, drop one, add another, reorder them, and keep going until it matches what you had in mind.',
  },
  {
    question: 'Can I edit a form I already have?',
    answer: 'Yes. Pick a form you created with Intake or paste the link to one you already have in Google Forms. Intake reads its current questions, proposes the change you asked for, and updates that same form once you confirm. It never makes a second copy.',
  },
  {
    question: 'Where do the responses go?',
    answer: 'Straight to Google. People answer on the normal Google Forms page, and every response lands in the form you own, ready for Google Sheets or the responses tab. Intake never touches the answers.',
  },
  {
    question: 'What kinds of questions can I create?',
    answer: 'Short answers, paragraphs, multiple choice, checkboxes and dropdowns, along with the section routing that decides which part of the form someone sees next. You can mark questions as required and add a description too.',
  },
  {
    question: 'What does it cost?',
    answer: 'The Free plan is $0 and covers creating and editing forms every day. Pro adds a monthly reserve of credits for heavier months.',
  },
  {
    question: 'How do the credits work?',
    answer: 'A credit is one interpretation of a request. A simple edit costs one credit, a standard form costs two, and longer or branchy forms cost a few more. Each amount is worked out on the server before you confirm anything, and you can see the balance in your workspace at any time.',
  },
] as const;
