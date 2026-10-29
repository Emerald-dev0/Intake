import type { PublicRelease, ReleaseCategory } from '../lib/releases.ts';

/**
 * The releases that shipped before the changelog had pages of its own.
 *
 * This is the bundled fallback for the public changelog: the same releases live in the database
 * once migration `022_release_manager.sql` has run, and the server's copy wins because it can be
 * corrected after publication. The bundled copy exists so the public changelog still reads
 * correctly when the API cannot be reached — a cold database, or a deployment where the migration
 * has not run yet.
 *
 * Every entry below is shipped history that can be checked against this repository. Nothing here
 * describes work that has not happened.
 *
 * House style for a release note: say what changed in plain words, say who it helps, say how to
 * use it, and say plainly what is still missing. No superlatives, no "seamlessly", no roadmap.
 */
export interface BundledRelease extends PublicRelease {
  /** Publication date, `YYYY-MM-DD`. */
  releaseDate: string;
}

export const BUNDLED_RELEASES: BundledRelease[] = [
  {
    slug: 'launch',
    title: 'Intake opens',
    releaseDate: '2026-10-01',
    publishedAt: '2026-10-01T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Describe the form you want in a sentence; Intake drafts it in Google Forms, you read it over, and it lands in the account you connected.',
    highlights: [
      'One sentence in, a complete question list out — answer types, required flags and all.',
      'Nothing reaches Google until you have read the proposal and confirmed it.',
      '20 credits a day for every account, refreshed at 00:00 UTC. No card, no trial clock.',
    ],
    audience: 'For anyone who has ever typed the same fourteen questions into a form editor twice.',
    body: [
      '## One sentence in, a reviewable form out',
      'You describe the form you need and Intake writes it: every question, its answer type, whether it is required, and the order they appear in. You get a proposal to read, not a form that already exists.',
      'That order matters more than it sounds. A form that appears before you have read it is a form you have to undo; a proposal you can edit is a form you can approve.',
      '## Why nothing is created without you',
      'The model that writes the proposal cannot call Google. It proposes a structure, and Intake checks that structure against what Google Forms can actually express — which question types exist, which settings are allowed — before it shows you anything. If a request cannot be expressed in the target, you are told that rather than shown a form that quietly drops half of it.',
      'When you confirm, the form is created in the Google account you connected, and you get a real link to it. Not a preview, not an export file: the form, in your account, with your name on it.',
      '## Getting your first form made',
      'Create an account, connect Google Forms, and describe the form from the home screen. The first one takes a sentence and a click. If your description is vague, Intake asks a clarifying question instead of guessing — and that question costs nothing.',
      'Every account gets 20 credits a day, refreshed at midnight UTC. A credit is one logical operation: one form, or one edit. A failed operation costs nothing, and a clarification costs nothing.',
      '## What was not there yet',
      'Google Forms was the only target at launch. Typeform came later. Microsoft Forms was never a target, because Microsoft does not expose a supported API for creating or editing forms — a Microsoft connection would have been a promise the product could not keep.',
      'At launch, editing meant going to the provider. Intake could create, but not yet revise in place.',
    ].join('\n'),
    links: [
      { label: 'How Intake works', url: '/guides' },
      { label: 'Pricing', url: '/pricing' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'welcome-mail',
    title: 'Every signup gets a proper welcome',
    releaseDate: '2026-10-06',
    publishedAt: '2026-10-06T00:00:00.000Z',
    categories: ['improvement'],
    summary: 'New accounts get a personal email from Daniel explaining what Intake does, what is shipping next, and how to get the first form made.',
    highlights: [
      'Written and sent by a person, not generated from a template.',
      'It names the shipping cadence instead of leaving you to wonder.',
      'One message. After that, silence unless you ask for more.',
    ],
    audience: 'For new accounts deciding whether Intake deserves a second browser tab.',
    body: [
      '## The email you get now',
      'It explains what Intake is in a paragraph, what is being worked on next, and how to get your first form made. It is Daniel’s letter, written out longhand and sent by the same system that sends your password resets.',
      'It is not a drip campaign and it is not a template with your name swapped in. There is one of these, and it arrives once.',
      '## Why we bothered',
      'Most people arrive at a form tool with one job in mind, and the first question is never "what does this tool do" — it is "will this work for me".',
      'That question was being answered by a confirmation screen. The welcome mail answers it properly: what the product does, who it is for, what happens next, and what it does not do yet.',
      '## What it does not do',
      'It does not add you to a mailing list. Product updates are a separate, opt-in list that you can join or leave from the same email, and account and security messages always arrive regardless of what you chose there.',
      'It also does not claim delivery it cannot prove. The send is recorded, and the record shows what the provider accepted, not what an inbox did with it afterwards.',
    ].join('\n'),
    links: [
      { label: 'Privacy', url: '/privacy' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'traffic-analytics',
    title: 'We count visits without watching people',
    releaseDate: '2026-10-12',
    publishedAt: '2026-10-12T00:00:00.000Z',
    categories: ['feature'],
    summary: 'The marketing site now records which pages are read and which buttons are pressed — with no IP address, no cookie, and no identifier.',
    highlights: [
      'Page path, button label, referring site, time zone, campaign tags. That is the entire record.',
      'Country reach without IP addresses: the time zone is enough to place a visit roughly.',
      'A browser that sends Do Not Track is not recorded at all.',
    ],
    audience: 'For us, and for you, if you would rather we did not.',
    body: [
      '## What is recorded',
      'Every public page can report that it was read and which links were pressed. The event carries the page path, the label of the button, the site the visit came from, the browser time zone, and any campaign tags in the URL.',
      'That is the whole of it. There is no IP address, no user agent, no cookie, no device identifier and no account identifier. Two visits from the same computer look like two visits from two computers.',
      '## Country reach, without addresses',
      'We wanted to know which countries the site reaches. An IP address would have answered that and would also have been a location we did not need to keep.',
      'The browser time zone gives a rough answer on its own — enough to tell a reader in Lagos from a reader in Berlin without storing anything that identifies either of them.',
      '## What it does not tell us',
      'No unique visitors. No sessions. No retention. No funnel from first visit to first form.',
      'Those numbers need an identifier to compute, and the only honest way to have one is to keep one. We would rather report the counts we can actually stand behind than publish a dashboard full of numbers that cannot be reproduced.',
      '## Do Not Track is respected',
      'If the browser sends `Do Not Track: 1`, nothing is recorded at all — not the page view, not the click. No consent screen, no cookie to decline, no dark pattern: the browser says no and the answer is no.',
    ].join('\n'),
    links: [
      { label: 'Privacy', url: '/privacy' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'sign-up-is-open',
    title: 'The waiting list is gone',
    releaseDate: '2026-10-24',
    publishedAt: '2026-10-24T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Create an account, connect Google Forms or Typeform, and describe your first form in one sitting. Free plan, 20 credits a day, no card.',
    highlights: [
      'Account, provider connection and first form, in the same tab.',
      'The Free plan gives 20 credits a day, refreshed at 00:00 UTC.',
      'No card, no trial timer, no sales call.',
    ],
    audience: 'For anyone who signed up to wait and would rather just start.',
    body: [
      '## It is open',
      'There is no queue any more. You can create an account and make a form now, and the three things that used to happen separately — signing up, connecting a provider, describing the form — now happen in one sitting, in one tab.',
      'Connecting a provider is still an explicit step, and it stays explicit on purpose. Signing in proves who you are; it does not grant access to your Google account. The connection screen says which permissions are being asked for and what happens if you say no.',
      '## What the Free plan is',
      'Twenty credits a day, refreshed at 00:00 UTC, on every account. A credit is one form or one edit, so a day of ordinary work is comfortably inside twenty.',
      'There is no card to add and no trial that expires into a paid plan. If Intake ever costs money, that will be a separate, deliberate choice with a plan you picked.',
      '## What still needs a provider',
      'Intake creates forms in Google Forms and Typeform today. If you have neither connected, you can still make an account and read around — but the first form needs somewhere to live, and the provider is where it lives.',
    ].join('\n'),
    links: [
      { label: 'Pricing', url: '/pricing' },
      { label: 'Guides', url: '/guides' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'typeform-joins-google-forms',
    title: 'Typeform is now a creation target',
    releaseDate: '2026-10-24',
    publishedAt: '2026-10-24T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Pick Google Forms or Typeform when you describe a form, and the same propose-then-approve flow runs against either one.',
    highlights: [
      'Google Forms and Typeform from one composer, with the same review step in front of both.',
      'Existing Typeform links can be imported, so they sit next to the forms you made.',
      'Editing a Typeform in place is not available yet, and the workspace says so plainly.',
    ],
    audience: 'For teams whose forms already live in Typeform.',
    body: [
      '## One composer, two targets',
      'The provider is a choice you make before you describe the form, not a setting you discover afterwards. Intake proposes the same structure for either, checks it against what that provider can actually express, and shows it to you before anything is created.',
      'Typeform supports a different set of question types and a different way of expressing logic, so a proposal that Typeform cannot represent is adjusted before you see it, rather than failing after you have approved it.',
      '## Bringing what you already have',
      'A Typeform connection can import the links you have already made, so your library holds forms from both providers instead of only the ones Intake created. Imported forms are marked as imports: Intake can read them and link to them, and it says plainly which ones it did not create.',
      '## What is not there yet',
      'Editing a Typeform in place is not implemented. Google Forms can be revised in the account it lives in; a Typeform cannot yet, and the interface says that instead of pretending the two behave the same.',
      'Microsoft Forms remains a connection and nothing more. There is no supported API for creating or editing Microsoft Forms, so a Microsoft connection does not imply that form creation works — and it does not.',
    ].join('\n'),
    links: [
      { label: 'Trust and permissions', url: '/trust' },
      { label: 'Pricing', url: '/pricing' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'every-release-has-a-page',
    title: 'Every release has its own address',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['improvement'],
    summary: 'The changelog is no longer one long list. Every release has a permanent page you can link to, share and keep.',
    highlights: [
      'A permanent URL per release, with canonical and social metadata of its own.',
      'A copy button on every page, because sharing a link should take one click.',
      'Only published releases are public. Drafts never reach the index, a search engine, or a link preview.',
    ],
    audience: 'For anyone who wants to point at one change instead of at the whole history.',
    body: [
      '## Why a list was not enough',
      'A changelog you can only read in place is a changelog you cannot send to anyone. Every entry now has its own address — a permanent link that keeps working when the next release lands underneath it.',
      'That link is shareable: it carries its own title, its own description, its own canonical URL and its own social card, so it looks right when it is pasted into a chat, a community post or a commit message.',
      '## What a release page carries',
      'The publication date, the categories, a summary, the highlights, the full notes and the links that go with the release. The notes have their own table of contents, so a long entry can be read in pieces or linked to by section.',
      'Each page has a copy button for its own address.',
      '## Only what has shipped',
      'A release becomes public when it is published, and until then it does not exist as far as the outside world is concerned. Drafts and unreleased entries are answered with a 404 rather than a forbidden sign — the public API cannot be asked whether a draft exists.',
      'They stay out of the sitemap, out of the social preview, and out of anything a search engine indexes. The releases that predate this change were given pages too, so every entry in the list can be linked directly.',
    ].join('\n'),
    links: [
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'intake-for-developers-page',
    title: 'The developer page, and what it does not promise',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['feature'],
    summary: 'There is now a Developers page, and every capability on it says whether it ships today, is being built, or is not promised.',
    highlights: [
      'One board, three states: shipping, being built, and not promised. Nothing is left vague.',
      'What a cross-origin embed can and cannot inherit is written down, plainly.',
      'One email when developer forms open. Nothing else, and no list you did not ask for.',
    ],
    audience: 'For developers deciding whether to wait for Intake to host their forms.',
    body: [
      '## A page before the product',
      'Intake for Developers is being built. Rather than keep that quiet, the developer page says so on its face: every capability carries a state, and the states are shipping, being built, and not promised.',
      'Webhooks are not promised. An SDK is not promised. Both are plausible and neither exists, so both are written down as things you should not plan around.',
      '## What the page covers',
      'What a form costs when you host it yourself — the renderer, the validation, the storage, the spam control, the exports and the lifecycle — and what Intake for Developers takes off that list.',
      'How the embed works: a permanent URL per form, a snippet to paste, theme tokens for colour, background, text, border, typeface and corner radius, and light, dark and system themes including a transparent background.',
      'And the part that is usually skipped: an iframe pointing at another origin cannot read your page’s stylesheet, your variables or your fonts. That is a browser rule rather than a setting, which is why the theme is configuration and not inheritance.',
      '## The credits do not change',
      'AI summaries of responses run on Intake’s existing 20 daily credits. There is no second wallet for developers, no separate currency, and no conversion rate to memorise. The cost is shown before a summary runs, and a summary that fails does not spend anything.',
      '## How we will keep it honest',
      'The status of each capability is one line in one file, and every change to it ships with a changelog entry — this one included. If a capability starts working, this page says so the day it works, not the day it is convenient.',
    ].join('\n'),
    links: [
      { label: 'Developers', url: '/developers' },
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'hosted-forms-for-developers',
    title: 'Hosted forms, and the address they keep',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['feature'],
    summary: 'A developer can now build a form, publish it at a permanent address and put it in a page — with the answers checked on the server.',
    highlights: [
      'A form keeps its address for good, so a snippet pasted into a page keeps working.',
      'Answers are checked against the version that was live, and a retry never sends the same person twice.',
      'The theme is a setting, not an inheritance: an iframe cannot read your CSS, so the colours are configuration.',
    ],
    audience: 'For developers who want a form in their product without a form system in their repo.',
    body: [
      '## What you can do now',
      'Make a project, make a form in it, write the questions, and publish it. The form gets an address of its own — /forms/your-project/your-form — and a snippet you can paste into a page to embed it there instead.',
      'The questions you can ask are the usual ones: a line of text, a paragraph, an email, a number, a date, a dropdown, one choice, several choices, or a box to tick. Each one can carry a label, a line of help text and a required flag.',
      '## The address does not move',
      'Editing a published form does not move it and does not rewrite it. A published version is frozen: the next edit becomes the next version, and the one people are answering stays exactly as it was. A snippet you pasted into a page last month still points at the same form, and the answers are still read against the version that was live when they arrived.',
      '## What the server checks',
      'Every answer is checked on the server against the published version: required questions answered, email addresses that look like email addresses, choices that are actually on the form, and nothing else smuggled in under a question that does not exist.',
      'A retry is the same answer and not a second one. Each form makes one key when it loads and reuses it, so a double tap or a connection that drops halfway leaves one response, not two.',
      'Nothing is stored that was not asked for. The referrer and the browser’s user agent are kept, shortened, because they answer “how did people find this form” without keeping a list of who visited.',
      '## The look of it',
      'A form that lives in an iframe on somebody else’s page cannot inherit that page’s stylesheet, its variables or its fonts. That is the browser’s rule, not a setting, so the theme is configuration: primary colour, background, text, border, typeface and corner radius, in light, dark or system, with a transparent background if you would rather your own page showed through.',
      '## What is still to come',
      'Answers are being stored, and the inbox to read them — with search, filters and a CSV export — is the next piece. Webhooks are not promised yet, and neither is an SDK: both are on the developer page under “not promised”, which is where they will stay until they are real.',
    ].join('\n'),
    links: [
      { label: 'Developers', url: '/developers' },
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'the-response-inbox',
    title: 'The inbox, and a number you can trust',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['feature'],
    summary: 'The answers to a hosted form can now be read, searched and exported — with a count that comes from the database rather than from the page.',
    highlights: [
      'The count is counted by the database, so "12 answers" means twelve answers.',
      'Search finds a word anywhere in the answers, not just in one column.',
      'The CSV has the same columns as the table, and a value that a spreadsheet would treat as a formula is neutralised on the way out.',
    ],
    audience: 'For developers who have a form collecting answers and would rather not build a dashboard to read them.',
    body: [
      '## Reading the answers',
      'Every form has an inbox now. The questions are the columns, the answers are the rows, and the newest answer is at the top. There is a search box for the word somebody wrote, and paging when there are more answers than fit on one screen.',
      '## The count is the count',
      'The number of answers is counted by the database, not by counting the rows that happen to be on screen, and not by a model that might round it. It is the same number whether you are looking at the first page, the last page, or a search that matched one answer.',
      '## The export is the table',
      'The CSV file has the same columns as the table, in the same order, with the time of each answer in front. It is built by the server, not by the browser, so it works the same however many answers there are.',
      'One small piece of care: a value that starts with a character a spreadsheet would read as a formula is escaped on the way out. An answer should never be able to run something in the file you open next.',
      '## Whose answers are whose',
      'An answer is readable by the account that owns the form and by nobody else. Somebody else asking for it gets the same answer a nonexistent form would get: nothing, and no confirmation that it ever existed.',
    ].join('\n'),
    links: [
      { label: 'Developers', url: '/developers' },
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'summarise-the-answers',
    title: 'What the answers sound like',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['feature'],
    summary: 'The answers to a hosted form can now be summarised — in three of the credits you already have, with the exact counts counted beside the interpretation.',
    highlights: [
      'Three credits, from the same balance as everything else. There is no second wallet.',
      'The counts are counted from the rows; the model is never asked for a number.',
      'A failed summary costs nothing, and the same answers are never summarised twice on your dime.',
    ],
    audience: 'For developers who have a hundred answers and do not want to read all of them.',
    body: [
      '## A summary, not a statistic',
      'Press the button and Intake reads the answers and says what they sound like: the themes, the things people keep mentioning, the tone. It is labelled as an interpretation, because that is what it is.',
      'The counts sit next to it and are exact, because they are counted from the rows rather than written by a model. Ask for a summary of two hundred answers and the table above it still says how many answers there were.',
      '## It costs three credits, from the balance you have',
      'A summary is an operation like any other: the same 20 daily credits, the same buckets, the same price list, the same rules about what happens when the balance runs out. There is no developer wallet and no developer currency, and the page shows the cost before you ask and the receipt after.',
      'If the model does not answer, you pay nothing. The charge happens when there is a usable summary, not when the request is made.',
      '## Asking again is free',
      'The key of the operation is worked out from the answers themselves, so asking for a summary of the same answers twice does not take a second three credits — it says that you have already paid for it. When new answers arrive, the next summary is a new operation, and it costs again.',
      '## What the model is allowed to see',
      'The answers to that form, and nothing else: no account details, no other form, no other customer. The number of answers read is capped, each answer is trimmed, and the whole prompt has a size limit, so a form with a great many answers cannot become a great many credits.',
      'The model is also told not to write a number. “Most people mention pricing” is allowed; “42% mention pricing” is not, because it would be a guess sitting next to a count that is not.',
    ].join('\n'),
    links: [
      { label: 'Developers', url: '/developers' },
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'your-usage-numbers',
    title: 'What your forms did, in three numbers',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Every project now reports the answers it accepted, the requests it refused and the bytes it stored — over the last thirty days, per project and in total.',
    highlights: [
      'Three counters, counted as they happen: answers accepted, requests refused, bytes stored.',
      'Per project and in total, over thirty days.',
      'The same numbers an operator sees, so the two can be compared rather than believed.',
    ],
    audience: 'For developers who want to know what a form is doing without reading every answer.',
    body: [
      '## Three numbers',
      'The workspace now reports what your projects did: how many answers were accepted, how many requests were refused, and how much was stored. Thirty days at a time, per project and in total.',
      '## Refused counts as refused',
      'A request that did not become an answer is counted as refused — a bad answer, a question the form does not have, a value of the wrong shape. That is the number you want when something is being sent at you, and it is counted only for a project that exists, so a request for an address that does not is not quietly put on somebody else.',
      '## Where the numbers come from',
      'They are counted by Intake, as the answers arrive. An operator can compare them with what the hosting, the database and the model provider report, and the two should agree — which is the point of counting them here rather than estimating them somewhere else.',
      'They are deliberately plain: a number of answers, a number of refusals, a number of bytes. No addresses, no user agents, no notes.',
    ].join('\n'),
    links: [
      { label: 'Developers', url: '/developers' },
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'be-told-about-new-answers',
    title: 'Ask to hear about new answers',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['feature'],
    summary: 'A developer can now ask to be emailed when one of their forms has new answers — every N answers, or a daily digest. Off until you turn it on.',
    highlights: [
      'Off by default. Nobody is told anything until you say so.',
      'Every N answers, or a daily digest — never one email per answer.',
      'The notice goes to you, about your own form. Nobody who filled it in is ever written to.',
    ],
    audience: 'For developers who want to know that something came in without watching the inbox.',
    body: [
      '## Off until you ask',
      'There is a setting per project: email me when this project has new answers. It is off until you turn it on, and there is no version of this that is on by default.',
      '## One note, not one per answer',
      'You can choose every N answers — ten, say — or a daily digest. The point of a threshold is that three answers make one note rather than three, so a busy form does not become a flood.',
      'The notice goes through the same mail system as every other message from Intake: the same delivery log, the same suppression list, and the same rule that the same notice is never sent twice. If a notice cannot be sent, the count is left alone and the next answer tries again.',
      '## Your form, your answers',
      'The notice is about your own form and goes to you. Nobody who filled the form in is ever written to from this — there is no way to make that happen, and no setting that would.',
    ].join('\n'),
    links: [
      { label: 'Developers', url: '/developers' },
      { label: 'Changelog', url: '/changelog' },
    ],
    heroImageUrl: null,
  },
];

export function bundledReleaseBySlug(slug: string): BundledRelease | null {
  return BUNDLED_RELEASES.find(release => release.slug === slug) ?? null;
}

/** Merge the bundled notes with the live ones. The server's copy wins for the same slug. */
export function mergeReleases(live: PublicRelease[], bundled: BundledRelease[] = BUNDLED_RELEASES): PublicRelease[] {
  const bySlug = new Map<string, PublicRelease>();
  for (const release of bundled) bySlug.set(release.slug, release);
  for (const release of live) bySlug.set(release.slug, release);
  return [...bySlug.values()].sort((a, b) => (b.releaseDate ?? '').localeCompare(a.releaseDate ?? ''));
}

export function releaseCategories(release: PublicRelease): ReleaseCategory[] {
  return release.categories ?? [];
}
