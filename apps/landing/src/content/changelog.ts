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
 */
export interface BundledRelease extends PublicRelease {
  /** Publication date, `YYYY-MM-DD`. */
  releaseDate: string;
}

export const BUNDLED_RELEASES: BundledRelease[] = [
  {
    slug: 'launch',
    title: 'Launch',
    releaseDate: '2026-10-01',
    publishedAt: '2026-10-01T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Intake opens: create and edit Google Forms from a description, with daily free credits for everyone.',
    body: [
      '## What changed',
      'Intake opened to the public. You describe the form you need in plain English, Intake comes back with a full list of questions, answer types and required flags, and one confirmation creates the form in the Google account you connected.',
      '',
      '## Why it matters',
      'Building a form no longer means opening an editor and typing every question, every choice and every required toggle by hand. The review step stays in front of it: nothing is created until you approve the proposal.',
      '',
      '## How to use it',
      'Sign up, connect Google, and describe the form you want from the home screen. Your first form takes one sentence and one click.',
      '',
      '## Limitations and availability',
      'Google Forms was the only provider at launch. The Free plan includes 20 credits a day, refreshed at 00:00 UTC, and no card is required.',
    ].join('\n'),
    links: [
      { label: 'How Intake works', url: '/guides' },
      { label: 'Pricing', url: '/pricing' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'welcome-mail',
    title: 'Welcome mail',
    releaseDate: '2026-10-06',
    publishedAt: '2026-10-06T00:00:00.000Z',
    categories: ['improvement'],
    summary: 'Every new signup gets a personal welcome from Daniel, with the shipping cadence spelled out.',
    body: [
      '## What changed',
      'New accounts receive a welcome email that explains what Intake does, what is shipping next, and how to get their first form made. It is written and sent by a person rather than generated from a template.',
      '',
      '## Why it matters',
      'A new account starts with a decision to make: connect a provider, or write a description first. The welcome mail answers the question that otherwise sits unanswered in a confirmation screen.',
      '',
      '## How to use it',
      'Sign up with an email address and the message arrives with your account. It links straight to the workspace.',
      '',
      '## Limitations and availability',
      'Account and security messages always arrive. This release covers the welcome message only — optional product updates are a separate, opt-in list.',
    ].join('\n'),
    links: [
      { label: 'Privacy', url: '/privacy' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'traffic-analytics',
    title: 'Traffic analytics',
    releaseDate: '2026-10-12',
    publishedAt: '2026-10-12T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Anonymous pageview and click analytics on the marketing site, with country reach that never touches IP addresses.',
    body: [
      '## What changed',
      'The marketing site now records which pages are read and which calls to action are pressed. The record is deliberately thin: the page path, the button label, the referring site, the browser time zone and any campaign tags. No IP address, no user agent, no cookie, no identifier.',
      '',
      '## Why it matters',
      'Country reach is the one thing a small team genuinely needs from traffic data, and it can be had without keeping anything about the person who asked. Time zone is enough to place a visit roughly; it is not enough to identify one.',
      '',
      '## How to use it',
      'Nothing to do. If your browser sends a Do Not Track header, nothing is recorded at all.',
      '',
      '## Limitations and availability',
      'The counts are aggregates. Intake does not and will not report unique visitors, sessions or retention, because it cannot compute them honestly from the data it keeps.',
    ].join('\n'),
    links: [
      { label: 'Privacy', url: '/privacy' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'sign-up-is-open',
    title: 'Sign-up is open',
    releaseDate: '2026-10-24',
    publishedAt: '2026-10-24T00:00:00.000Z',
    categories: ['feature'],
    summary: 'No more list to join: create an Intake account, connect a provider and build the first form in the same sitting. Free plan, 20 credits a day, no card.',
    body: [
      '## What changed',
      'The waiting list is gone. An account can be created, a provider connected and the first form described without leaving the browser tab, and the workspace is where the account lands.',
      '',
      '## Why it matters',
      'Intake used to ask for an email address before it could show any value. Now the first form is one sentence away from a real account, with the Free plan already running.',
      '',
      '## How to use it',
      'Create an account, connect Google or Typeform, and describe the form. Daily credits start immediately and refresh at 00:00 UTC.',
      '',
      '## Limitations and availability',
      'The Free plan includes 20 credits a day. Pro is not on sale yet; the pricing page says so plainly.',
    ].join('\n'),
    links: [
      { label: 'Pricing', url: '/pricing' },
      { label: 'Guides', url: '/guides' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'typeform-joins-google-forms',
    title: 'Typeform joins Google Forms',
    releaseDate: '2026-10-24',
    publishedAt: '2026-10-24T00:00:00.000Z',
    categories: ['feature'],
    summary: 'Describe a form once and create it in Google Forms or Typeform, with the same review step before anything is created. The workspace was rebuilt around a single composer, and Typeform links can be imported into your library.',
    body: [
      '## What changed',
      'Intake can now write to Typeform as well as Google Forms. You pick the target when you describe the form, and the same approval-first composer handles both. Existing Typeform links can be imported into the library so they sit next to everything else you have made.',
      '',
      '## Why it matters',
      'The provider is a choice, not a migration. A team that lives in Typeform can keep its Typeform and still get the proposal-then-approve workflow, and a team that uses both can move between them without learning two products.',
      '',
      '## How to use it',
      'Connect Typeform, describe the form, and choose Typeform as the target. The proposal appears first, exactly as it does for Google Forms.',
      '',
      '## Limitations and availability',
      'Creating and importing work today. Editing a Typeform in place is not available yet — Google Forms can still be edited in place — and the workspace says so rather than implying otherwise.',
    ].join('\n'),
    links: [
      { label: 'Trust and permissions', url: '/trust' },
      { label: 'Pricing', url: '/pricing' },
    ],
    heroImageUrl: null,
  },
  {
    slug: 'every-release-has-a-page',
    title: 'Every release now has its own page',
    releaseDate: '2026-10-29',
    publishedAt: '2026-10-29T00:00:00.000Z',
    categories: ['improvement'],
    summary: 'The changelog is no longer one long list: every release has a permanent page you can link to, share and keep.',
    body: [
      '## What changed',
      'Each release now has its own address — a permanent link that does not change when the index grows. The page carries the publication date, the categories, the full notes, the links that go with the release, and the social preview a link needs to look right when it is shared. Older entries were given the same pages, so every release listed here can be linked directly.',
      '',
      '## Why it matters',
      'A list can only be read in place. A page can be sent to someone, posted in a community, quoted in a release note, or bookmarked for later, and it keeps working when the next release arrives.',
      '',
      '## How to use it',
      'Open the changelog, pick a release, and copy its link. Every release page has a copy button for exactly this.',
      '',
      '## Limitations and availability',
      'Only published releases are public. Drafts, releases waiting for review and cancelled releases are never listed, never linked and never shareable.',
    ].join('\n'),
    links: [
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
