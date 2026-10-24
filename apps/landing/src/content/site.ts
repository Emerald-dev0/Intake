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
export const HOMEPAGE_TITLE = 'Intake, AI form builder for Google Forms and Typeform — describe it, review it, done';
export const META_DESCRIPTION = 'Intake is an AI form builder that creates Google Forms and Typeforms from a plain-English description — and edits the Google Forms you already have. Free plan includes 20 daily credits. You approve every question before anything is created.';
export const PRODUCT_DESCRIPTION = 'Intake turns a plain-English description into a real form in your own Google Forms or Typeform account. You see the questions before anything is created, adjust them, and confirm when the form is ready.';

export const CREATOR = {
  name: 'Oluwadare Daniel',
  identity: 'Emerald',
  displayName: 'Oluwadare Daniel — Emerald',
  /** Shown in the footer. Deliberately short and impersonal. */
  credit: 'Emerald',
  /** Personal site behind the footer credit. */
  site: 'https://emerald.pxxl.click',
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
    body: 'One click builds the form in the Google Forms or Typeform account you chose, or updates the Google Form you picked.',
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

/** Worked example proposals for the signup-free hero demo. Clearly labelled as examples. */
export interface DemoQuestion { title: string; kind: string; detail?: string }
export interface DemoProposal { prompt: string; questions: DemoQuestion[] }
export const HERO_DEMO_PROMPTS: DemoProposal[] = [
  {
    prompt: 'RSVP for my birthday',
    questions: [
      { title: 'Your name', kind: 'Short answer' },
      { title: 'How many people are coming?', kind: 'Multiple choice', detail: 'Just me · Me + 1 · Me + 2 · A crowd' },
      { title: 'Dietary needs or allergies', kind: 'Paragraph' },
      { title: 'Song request for the playlist', kind: 'Short answer' },
    ],
  },
  {
    prompt: 'Customer feedback survey',
    questions: [
      { title: 'Overall satisfaction', kind: 'Multiple choice', detail: 'Very satisfied · Satisfied · Neutral · Dissatisfied' },
      { title: 'What did you like most?', kind: 'Paragraph' },
      { title: 'What could we improve?', kind: 'Paragraph' },
      { title: 'Would you recommend us?', kind: 'Multiple choice', detail: 'Yes · No' },
    ],
  },
  {
    prompt: 'Student club sign-up',
    questions: [
      { title: 'Full name', kind: 'Short answer' },
      { title: 'Email address', kind: 'Short answer' },
      { title: 'Department', kind: 'Dropdown', detail: 'Sciences · Arts · Engineering · Other' },
      { title: 'Which teams interest you?', kind: 'Checkboxes', detail: 'Events · Media · Outreach · Welfare' },
    ],
  },
];

/** The before/after proof: one prompt, the question list it produced. */
export const PROOF_EXAMPLE: DemoProposal = {
  prompt: 'Teacher parent check-in: ask who the student is, how contactable the parent is, and whether anything changed at home this term.',
  questions: [
    { title: "Student's full name", kind: 'Short answer' },
    { title: 'Class', kind: 'Dropdown', detail: 'JSS 1 · JSS 2 · JSS 3 · SS 1 · SS 2 · SS 3' },
    { title: 'Best number to reach you on', kind: 'Short answer' },
    { title: 'Preferred contact time', kind: 'Multiple choice', detail: 'Morning · Afternoon · Evening' },
    { title: 'Anything changed at home this term we should know about?', kind: 'Paragraph' },
  ],
};

export interface UseCase { audience: string; headline: string; body: string; prompt: string }
export const USE_CASES: UseCase[] = [
  {
    audience: 'Teachers',
    headline: 'Quizzes and parent check-ins without the setup',
    body: 'Class surveys, homework collection, and parent contact forms from one description. Required flags and answer types come out right.',
    prompt: 'Weekly homework check for JSS 2 maths: name, class, which questions were hard, and what to revise',
  },
  {
    audience: 'Event organizers',
    headline: 'RSVPs that ask the follow-up questions for you',
    body: 'Headcounts, dietary needs, plus-ones, and song requests. Branching handles the “if yes, then what” logic.',
    prompt: 'RSVP for our end-of-year dinner: name, headcount, dietary needs, and a song request',
  },
  {
    audience: 'HR teams',
    headline: 'Onboarding and pulse surveys in minutes',
    body: 'Department, role, satisfaction scales, and open feedback. Section routing keeps long surveys readable.',
    prompt: 'New-hire onboarding survey with department, role, satisfaction rating, and what felt confusing',
  },
  {
    audience: 'Clinics',
    headline: 'Intake forms that respect the front desk',
    body: 'Patient details, visit reason, and consent confirmations as clean required fields. Responses stay in your Google account.',
    prompt: 'New patient visit form: full name, phone, reason for visit, and consent to be contacted',
  },
  {
    audience: 'Student orgs',
    headline: 'Sign-ups and feedback between lectures',
    body: 'Club registration, event feedback, and election ballots described once and shared the same day.',
    prompt: 'Drama club auditions sign-up: name, email, preferred role, and availability this weekend',
  },
];

export interface CompareRow { label: string; intake: string; googleAi: string; typeformAi: string; chatgpt: string }
export const COMPARISON_ROWS: CompareRow[] = [
  { label: 'Lives in your own account', intake: 'Yes — a real Google Form or Typeform', googleAi: 'Yes, Google Forms only', typeformAi: 'Yes, Typeform only', chatgpt: 'No — you copy text by hand' },
  { label: 'You approve questions first', intake: 'Always, before anything exists', googleAi: 'Draft-first, then you fix it', typeformAi: 'Draft-first, then you fix it', chatgpt: 'No form at all, just text' },
  { label: 'Edits your existing forms', intake: 'Google Forms, in place, no copies', googleAi: 'Limited', typeformAi: 'Within Typeform only', chatgpt: 'No — retype everything' },
  { label: 'Free plan', intake: '$0, 20 credits daily', googleAi: 'Needs a paid Workspace plan', typeformAi: 'Free tier is limited', chatgpt: 'Free, but manual work' },
  { label: 'Speaks the provider’s language', intake: 'Google sections and routing · Typeform logic jumps', googleAi: 'Native, but basic', typeformAi: 'Typeform features, not Google’s', chatgpt: 'Describes them; builds nothing' },
];

export interface ComingSoon { title: string; body: string }
export const COMING_SOON: ComingSoon[] = [
  { title: 'Typeform editing', body: 'Change a Typeform in place the way Google Forms already works today. Creation and import are live; editing is the next step.' },
  { title: 'Responses inside Intake', body: 'Read answers and simple summaries without opening Google Forms or Typeform.' },
  { title: 'Telegram and WhatsApp', body: 'Describe a form from chat and get the link back in the same thread.' },
  { title: 'Quiz mode', body: 'Self-marking quizzes with answer keys and points, from one description.' },
];

export interface ChangelogEntry { date: string; title: string; body: string }
export const CHANGELOG: ChangelogEntry[] = [
  { date: '2026-10-01', title: 'Launch', body: 'Intake opens: create and edit Google Forms from a description, with daily free credits for everyone.' },
  { date: '2026-10-06', title: 'Welcome mail', body: 'Every new signup gets a personal welcome from Daniel, with the shipping cadence spelled out.' },
  { date: '2026-10-12', title: 'Traffic analytics', body: 'Anonymous pageview and click analytics on the marketing site, with country reach that never touches IP addresses.' },
  { date: '2026-10-24', title: 'Typeform joins Google Forms', body: 'Describe a form once and create it in Google Forms or Typeform, with the same review step before anything is created. The workspace was rebuilt around a single composer, and Typeform links can be imported into your library.' },
];

export const FAQS = [
  {
    question: 'What is Intake?',
    answer: 'Intake is an AI form builder. You describe what you want to collect, look over the questions it came up with, and confirm when it looks right — then the finished form is created in your own Google Forms or Typeform account, never on some other platform. The Free plan includes 20 daily credits, and Google Forms you already own can be edited in place.',
  },
  {
    question: 'Can AI create a Google Form?',
    answer: 'Yes. Intake takes a sentence like “customer feedback survey with a rating and a comments box” and turns it into a real Google Form with typed questions, choices, and required flags. You review the full question list first and change anything, then confirm once. Creation happens only after your approval, and the form appears in your own Google account.',
  },
  {
    question: 'How do I make a Google Form from text?',
    answer: 'Write one description of what the form should collect, for example “RSVP for my birthday with name, headcount, and dietary needs”. Intake converts it into a proposed question list. Read it, adjust wording, drop or add questions, then confirm. Intake builds the Google Form for you in under a minute, without you touching the Forms editor at all.',
  },
  {
    question: 'Is there a free AI Google Forms generator?',
    answer: 'Intake is free during launch: $0 with 20 credits renewed every day, no card required. A standard form costs about 2 credits and a simple edit costs 1, so the daily allowance covers real daily use. You can even preview a proposed question list on the homepage without signing up; an account is only needed to create the form.',
  },
  {
    question: 'Do I need a Google account?',
    answer: 'You need the account of whichever provider you create in. Sign in to Intake once, then connect Google (for Google Forms) or Typeform — connecting is a separate step, so signing in never gives Intake access to your forms by itself. Either connection can be removed at any time, and you never need both.',
  },
  {
    question: 'What permissions does Intake need?',
    answer: 'Two separate things. Signing in uses only your basic identity (name, email, profile) and never touches your forms. Creating forms uses one extra permission per provider, requested only when you press Connect: Google Forms asks for forms.body (create and edit forms you own); Typeform asks for forms:write and forms:read (create and list your forms), plus accounts:read so the account can be named and offline so the connection does not expire after a week. Intake never asks for Gmail, Drive, Calendar, Contacts, Sheets, webhooks or the right to read your responses, and you can disconnect at any time.',
  },
  {
    question: 'Can Intake read my form responses?',
    answer: 'No. Intake never requests a responses scope from Google or Typeform, so it has no technical way to read answers submitted to your forms. Responses go straight to the provider and land in the form you own, ready for the responses tab or a spreadsheet. Intake only ever handles the form structure: titles, questions, choices, and settings.',
  },
  {
    question: 'Do I need to sign up to try it?',
    answer: 'Not to see how it works. The homepage prompt box shows you a proposed question list for sample requests with no account. Signing up is free and takes a minute, and you only need an account when you want Intake to actually create or edit a form in your Google or Typeform account.',
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
    answer: 'Straight to the provider you chose. People answer on the normal Google Forms page or Typeform page, and every response lands in the form you own, ready for its responses tab or a spreadsheet. Intake never touches the answers.',
  },
  {
    question: 'What kinds of questions can I create?',
    answer: 'Short answers, paragraphs, multiple choice, checkboxes and dropdowns, along with the branching that decides which part of the form someone sees next — Google sections and routing, or Typeform logic jumps, whichever target you chose. You can mark questions as required and add a description too.',
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
