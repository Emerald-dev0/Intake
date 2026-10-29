/**
 * Public release contract.
 *
 * The changelog is served by the API, but the page must also work when the API cannot be reached
 * (a cold database, a migration that has not run yet). So the client keeps two states: the live
 * releases the server returned, and the release notes bundled with the site. The bundled notes are
 * the fallback, never a second source of truth: when the API answers, its entries win.
 *
 * This module is shared with the server (see `server/releases/contracts.ts`), which is why the
 * category vocabulary lives here and nowhere else.
 */

export const RELEASE_CATEGORIES = ['feature', 'improvement', 'fix', 'security'] as const;
export type ReleaseCategory = typeof RELEASE_CATEGORIES[number];

export interface ReleaseLink {
  label: string;
  url: string;
}

export interface PublicRelease {
  slug: string;
  title: string;
  summary: string;
  body: string;
  categories: ReleaseCategory[];
  /** Publication date shown to the reader, `YYYY-MM-DD`. */
  releaseDate: string | null;
  publishedAt: string | null;
  links: ReleaseLink[];
  heroImageUrl: string | null;
  /**
   * The short version: what actually changed, in a few lines. A reader who stops here should still
   * know whether the release affects them.
   */
  highlights: string[];
  /** One line naming who the release is for. */
  audience: string | null;
}

export function categoryLabel(category: ReleaseCategory): string {
  switch (category) {
    case 'feature': return 'Feature';
    case 'improvement': return 'Improvement';
    case 'fix': return 'Fix';
    case 'security': return 'Security';
    default: return category;
  }
}

/** The maximum number of highlights a release may carry. */
export const RELEASE_HIGHLIGHT_LIMIT = 6;

export function formatReleaseDate(value: string | null): string {
  if (!value) return 'Undated';
  const parsed = new Date(`${value.slice(0, 10)}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric', month: 'long', day: 'numeric' }).format(parsed);
}

/**
 * Load the published releases. The result says whether the server answered: when it did not, the
 * caller shows the bundled notes and says so, rather than presenting a shorter list as if it were
 * the whole history.
 */
export async function loadPublishedReleases(signal?: AbortSignal): Promise<{ releases: PublicRelease[]; live: boolean }> {
  try {
    const response = await fetch('/api/releases', {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (!response.ok) return { releases: [], live: false };
    const body = await response.json() as { releases?: PublicRelease[] };
    if (!Array.isArray(body.releases)) return { releases: [], live: false };
    return { releases: body.releases, live: true };
  } catch {
    return { releases: [], live: false };
  }
}

/** Load one published release. `null` means “not published”; `undefined` means “could not ask”. */
export async function loadPublishedRelease(slug: string, signal?: AbortSignal): Promise<PublicRelease | null | undefined> {
  try {
    const response = await fetch(`/api/releases/${encodeURIComponent(slug)}`, {
      credentials: 'same-origin',
      cache: 'no-store',
      headers: { accept: 'application/json' },
      signal,
    });
    if (response.status === 404) return null;
    if (!response.ok) return undefined;
    const body = await response.json() as { release?: PublicRelease };
    return body.release ?? null;
  } catch {
    return undefined;
  }
}
