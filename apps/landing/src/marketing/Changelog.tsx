import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { BUNDLED_RELEASES, bundledReleaseBySlug, mergeReleases } from '../content/changelog';
import { changelogCardUrl, formatReleaseDate, loadPublishedRelease, loadPublishedReleases, RELEASE_CATEGORIES, type PublicRelease, type ReleaseCategory } from '../lib/releases';
import { filterReleases, groupReleasesByDate, type ReleaseCategoryFilter } from '../lib/release-search';
import { ReleaseArticle, ReleaseCategories } from './ReleaseArticle';
import { HubShell } from './HubShell';
import { releaseSchema } from './usePageMeta';

/**
 * The public changelog.
 *
 * The index lists every published release; each release has its own permanent page. The pages are
 * rendered from the API when it answers and from the bundled notes when it does not, and the page
 * says which of the two happened rather than quietly showing a shorter list.
 *
 * The index is a place to look things up, not only to scroll: the newest release is shown on its
 * own, and the rest can be searched and narrowed by category. The search runs in the browser over
 * the releases the page already holds, and it is written into the address so a search can be
 * shared like any other link.
 */

/** Copy a link. The button only claims success when the clipboard actually accepted the text. */
function CopyLinkButton({ url }: { url: string }) {
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');

  const copy = useCallback(async () => {
    try {
      if (!navigator.clipboard?.writeText) throw new Error('Clipboard unavailable');
      await navigator.clipboard.writeText(url);
      setState('copied');
    } catch {
      setState('failed');
    }
  }, [url]);

  return (
    <div className="mk-release__share">
      <button type="button" className="mk-button mk-button--secondary" onClick={() => void copy()}>
        Copy link
      </button>
      <span className="mk-release__share-url">{url}</span>
      <span role="status" aria-live="polite" className="mk-release__share-state">
        {state === 'copied' ? 'Link copied.' : state === 'failed' ? 'Copying failed — select the link and copy it manually.' : ''}
      </span>
    </div>
  );
}

/**
 * The newest release, shown on its own.
 *
 * The card a pasted link shows is drawn from this release, so the panel shows the same picture
 * the reader will see in a chat. When the card cannot be drawn, the panel is simply the words.
 */
function FeaturedRelease({ release }: { release: PublicRelease }) {
  const [cardFailed, setCardFailed] = useState(false);
  // A release that shipped before the highlights existed simply has none; the panel must not care.
  const highlights = (release.highlights ?? []).slice(0, 3);

  return (
    <article className="mk-changes-hero">
      <div className="mk-changes-hero__body">
        <p className="mk-changes-hero__label">
          <span className="mk-changes-hero__flag">Latest release</span>
          <span>{formatReleaseDate(release.releaseDate)}</span>
        </p>
        <h2 className="mk-changes-hero__title">
          <Link to={`/changelog/${release.slug}`}>{release.title}</Link>
        </h2>
        <p className="mk-changes-hero__summary">{release.summary}</p>
        {highlights.length > 0 && (
          <ul className="mk-changes-hero__highlights">
            {highlights.map(highlight => <li key={highlight}>{highlight}</li>)}
          </ul>
        )}
        <div className="mk-changes-hero__cta">
          <Link className="mk-button" to={`/changelog/${release.slug}`}>Read the release →</Link>
          <ReleaseCategories categories={release.categories} />
        </div>
      </div>
      {!cardFailed && (
        <figure className="mk-changes-hero__media">
          <img
            src={changelogCardUrl(release.slug)}
            alt={`The card for ${release.title}`}
            loading="lazy"
            onError={() => setCardFailed(true)}
          />
        </figure>
      )}
    </article>
  );
}

/** One release in the list: when it shipped, what it was, and what it changed. */
function ReleaseRow({ release }: { release: PublicRelease }) {
  return (
    <li className="mk-changes-item">
      <span className="mk-changes-item__dot" aria-hidden="true" />
      <div className="mk-changes-item__body">
        <p className="mk-changes-item__date">
          <time dateTime={release.releaseDate ?? undefined}>{formatReleaseDate(release.releaseDate)}</time>
        </p>
        <h3 className="mk-changes-item__title">
          <Link to={`/changelog/${release.slug}`}>{release.title}</Link>
        </h3>
        <p className="mk-changes-item__summary">{release.summary}</p>
        <ReleaseCategories categories={release.categories} />
      </div>
    </li>
  );
}

export function ChangelogPage() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; releases: PublicRelease[]; live: boolean }>({ status: 'loading' });
  const [params, setParams] = useSearchParams();

  const query = params.get('q') ?? '';
  const categoryParam = params.get('c') ?? 'all';
  const category: ReleaseCategoryFilter = (RELEASE_CATEGORIES as readonly string[]).includes(categoryParam)
    ? categoryParam as ReleaseCategory
    : 'all';

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadPublishedReleases(controller.signal).then(result => {
      if (!active) return;
      setState({ status: 'ready', releases: mergeReleases(result.releases), live: result.live });
    });
    return () => { active = false; controller.abort(); };
  }, []);

  // The search lives in the address, so a reader can share the releases they found.
  const writeParams = useCallback((nextQuery: string, nextCategory: ReleaseCategoryFilter) => {
    const next = new URLSearchParams();
    if (nextQuery.trim()) next.set('q', nextQuery.trim());
    if (nextCategory !== 'all') next.set('c', nextCategory);
    setParams(next, { replace: true });
  }, [setParams]);

  const visible = useMemo(
    () => (state.status === 'ready' ? filterReleases(state.releases, query, category) : []),
    [state, query, category],
  );
  const groups = useMemo(() => groupReleasesByDate(visible), [visible]);
  const featured = state.status === 'ready' && state.releases.length > 0 ? state.releases[0] : null;
  const searching = query.trim().length > 0 || category !== 'all';

  return (
    <HubShell
      path="/changelog"
      title="Changelog — what Intake shipped | Intake"
      description="Every Intake release with its own permanent page: what changed, why it matters, and how to use it. Launch, Google Forms and Typeform creation, the developer platform, and everything since."
      eyebrow="CHANGELOG"
      heading={<>What shipped, and what is next.</>}
      lede="New capabilities land every week. This page is the record — and the update list hears about each one first."
      analyticsPath="/changelog"
      image={changelogCardUrl()}
    >
      <section className="mk-section" aria-label="The latest release">
        <div className="mk-container">
          {state.status === 'loading' && (
            <div className="mk-changes-hero mk-changes-hero--loading" aria-busy="true">
              <span className="mk-skeleton-line" /><span className="mk-skeleton-line short" />
            </div>
          )}
          {featured && <FeaturedRelease release={featured} />}
        </div>
      </section>

      <section className="mk-section" aria-label="Every release">
        <div className="mk-container">
          {state.status === 'ready' && !state.live && (
            <p className="mk-changelog__notice" role="status">
              Live releases could not be loaded just now, so this is the release history recorded in the site bundle.
            </p>
          )}

          <div className="mk-changes-tools">
            <div className="mk-changes-search">
              <label className="mk-visually-hidden" htmlFor="mk-changes-search-input">Search the releases</label>
              <input
                id="mk-changes-search-input"
                type="search"
                className="mk-changes-search__input"
                placeholder="Search releases — inbox, Typeform, credits…"
                value={query}
                autoComplete="off"
                onChange={event => writeParams(event.target.value, category)}
              />
            </div>
            <div className="mk-changes-filters" role="group" aria-label="Filter by kind of release">
              {(['all', ...RELEASE_CATEGORIES] as ReleaseCategoryFilter[]).map(option => (
                <button
                  key={option}
                  type="button"
                  className="mk-changes-filter"
                  aria-pressed={category === option}
                  onClick={() => writeParams(query, option)}
                >
                  {option === 'all' ? 'Everything' : option}
                </button>
              ))}
            </div>
          </div>

          {state.status === 'loading' && (
            <ol className="mk-changes-list" aria-busy="true" aria-label="Loading releases">
              {[0, 1, 2].map(index => (
                <li key={index} className="mk-changes-item mk-changes-item--loading">
                  <span className="mk-skeleton-line" /><span className="mk-skeleton-line short" />
                </li>
              ))}
            </ol>
          )}

          {state.status === 'ready' && state.releases.length === 0 && (
            <div className="mk-empty">
              <strong>No releases have been published yet.</strong>
              <p>The first one will appear here as soon as it ships.</p>
            </div>
          )}

          {state.status === 'ready' && state.releases.length > 0 && visible.length === 0 && (
            <div className="mk-empty">
              <strong>Nothing matched{query.trim() ? ` “${query.trim()}”` : ' that filter'}.</strong>
              <p>Try a shorter word, or clear the search to see every release again.</p>
              <p>
                <button type="button" className="mk-button mk-button--secondary" onClick={() => writeParams('', 'all')}>
                  Show every release
                </button>
              </p>
            </div>
          )}

          {state.status === 'ready' && visible.length > 0 && (
            <>
              <p className="mk-changes-count" role="status">
                {searching
                  ? `${visible.length} of ${state.releases.length} releases`
                  : `${state.releases.length} releases`}
              </p>
              {groups.map(group => (
                <section key={group.date} className="mk-changes-group" aria-label={formatReleaseDate(group.date)}>
                  <h2 className="mk-changes-group__date">{formatReleaseDate(group.date)}</h2>
                  <ol className="mk-changes-list">
                    {group.releases.map(release => <ReleaseRow key={release.slug} release={release} />)}
                  </ol>
                </section>
              ))}
            </>
          )}
        </div>
      </section>
    </HubShell>
  );
}

export function ReleaseDetailPage() {
  const { slug = '' } = useParams();
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'ready'; release: PublicRelease; live: boolean }
    | { status: 'missing' }
    | { status: 'unavailable' }
  >({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    setState({ status: 'loading' });
    loadPublishedRelease(slug, controller.signal).then(result => {
      if (!active) return;
      if (result === undefined) {
        // The changelog could not be reached. A release that shipped is still in the notes bundled
        // with the site, so the reader is shown it and told where it came from — the same thing
        // the index does when the live releases cannot be loaded.
        const bundled = bundledReleaseBySlug(slug);
        if (bundled) { setState({ status: 'ready', release: bundled, live: false }); return; }
        setState({ status: 'unavailable' });
        return;
      }
      if (result === null) {
        const bundled = bundledReleaseBySlug(slug);
        setState(bundled ? { status: 'ready', release: bundled, live: false } : { status: 'missing' });
        return;
      }
      setState({ status: 'ready', release: result, live: true });
    });
    return () => { active = false; controller.abort(); };
  }, [slug]);

  if (state.status === 'loading') {
    return (
      <HubShell path={`/changelog/${slug}`} title="Loading release — Intake changelog" description="Loading this release from the Intake changelog." eyebrow="CHANGELOG" heading={<>Loading the release…</>} lede="Fetching the full notes for this release.">
        <section className="mk-section" aria-label="Release">
          <div className="mk-container"><div className="mk-changelog__skeleton"><span className="mk-skeleton-line" /><span className="mk-skeleton-line short" /></div></div>
        </section>
      </HubShell>
    );
  }

  if (state.status === 'missing') {
    return (
      <HubShell path={`/changelog/${slug}`} title="Release not found — Intake changelog" description="That release is not part of the public changelog." eyebrow="CHANGELOG" heading={<>That release is not here.</>} lede="It may have been renamed, or it may never have been published. Everything that has shipped is on the changelog index.">
        <section className="mk-section" aria-label="Release not found">
          <div className="mk-container">
            <p><Link to="/changelog" className="mk-button mk-button--secondary">Back to the changelog</Link></p>
          </div>
        </section>
      </HubShell>
    );
  }

  if (state.status === 'unavailable') {
    return (
      <HubShell path={`/changelog/${slug}`} title="Changelog unavailable — Intake" description="The Intake changelog could not be loaded just now." eyebrow="CHANGELOG" heading={<>The changelog could not be loaded.</>} lede="Nothing is shown rather than something guessed. Try again in a moment.">
        <section className="mk-section" aria-label="Changelog unavailable">
          <div className="mk-container">
            <p><Link to="/changelog" className="mk-button mk-button--secondary">Back to the changelog</Link></p>
          </div>
        </section>
      </HubShell>
    );
  }

  const release = state.release;
  const path = `/changelog/${release.slug}`;
  const canonicalUrl = typeof window === 'undefined' ? path : `${window.location.origin}${path}`;

  return (
    <HubShell
      path={path}
      title={`${release.title} — Intake changelog`}
      description={release.summary}
      eyebrow="CHANGELOG"
      heading={<>{release.title}</>}
      lede={release.summary}
      article={{ publishedTime: release.publishedAt }}
      image={release.heroImageUrl ?? changelogCardUrl(release.slug)}
      schema={releaseSchema({
        path,
        name: release.title,
        description: release.summary,
        publishedTime: release.publishedAt,
      })}
    >
      <section className="mk-section" aria-label="Release">
        <div className="mk-container">
          <ReleaseArticle
            release={release}
            notice={state.live ? null : 'This release is shown from the notes bundled with the site because the live changelog could not be reached.'}
          />
          <CopyLinkButton url={canonicalUrl} />
          <p className="mk-release__back"><Link to="/changelog">← Back to the changelog</Link></p>
        </div>
      </section>
    </HubShell>
  );
}

export { BUNDLED_RELEASES };
