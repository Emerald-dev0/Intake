import type { PublicRelease, ReleaseCategory } from './releases';

/**
 * Finding a release in the changelog.
 *
 * The changelog is a list a reader wants to search, not a list they want to scroll. The search
 * runs in the browser over the releases the page already has — the ones the API returned and the
 * ones bundled with the site — so it works whether the API answered or not, and it never sends a
 * reader's question to a server that does not need it.
 *
 * The matching is deliberately plain: every word of the search has to appear somewhere in the
 * release, in any order. That is enough to find "inbox" or "Typeform" without turning up a
 * release that mentions neither.
 */

export type ReleaseCategoryFilter = ReleaseCategory | 'all';

/** The text a release is searched by: its title, its summary, its notes and its label. */
export function releaseSearchText(release: PublicRelease): string {
  return [
    release.title,
    release.summary,
    release.audience ?? '',
    release.slug.replace(/-/g, ' '),
    ...(release.highlights ?? []),
    release.body,
  ]
    .join('\n')
    .toLowerCase();
}

/** Words are letters and digits. Everything else is punctuation between them. */
const TOKEN = /[a-z0-9]+/g;

function tokens(text: string): string[] {
  return text.toLowerCase().match(TOKEN) ?? [];
}

/**
 * Every word of the search has to appear in the release.
 *
 * A word matches a word that starts with it, so "inbox" finds "the-response-inbox" and "csv"
 * finds "CSV". It does not match a word that merely contains it: "at" does not find "create".
 */
function matchesWords(haystack: string[], words: string[]): boolean {
  return words.every(word => haystack.some(token => token.startsWith(word)));
}

/**
 * The releases that match a search and a category.
 *
 * An empty search matches everything; a category of "all" does not narrow anything.
 */
export function filterReleases(releases: PublicRelease[], text: string, category: ReleaseCategoryFilter = 'all'): PublicRelease[] {
  const words = tokens(text);
  return releases.filter(release => {
    if (category !== 'all' && !(release.categories ?? []).includes(category)) return false;
    if (!words.length) return true;
    return matchesWords(tokens(releaseSearchText(release)), words);
  });
}

/**
 * The releases of one day, newest day first.
 *
 * The changelog reads as a diary: what shipped, and when. Grouping by day keeps that visible
 * instead of hiding it in a column of dates.
 */
export function groupReleasesByDate(releases: PublicRelease[]): { date: string; releases: PublicRelease[] }[] {
  const groups = new Map<string, PublicRelease[]>();
  for (const release of releases) {
    const date = release.releaseDate ?? 'undated';
    const group = groups.get(date);
    if (group) group.push(release);
    else groups.set(date, [release]);
  }
  return [...groups.entries()]
    .sort(([first], [second]) => second.localeCompare(first))
    .map(([date, entries]) => ({ date, releases: entries }));
}
