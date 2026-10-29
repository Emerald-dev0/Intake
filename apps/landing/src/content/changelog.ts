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
