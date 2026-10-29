import { useCallback, useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { BUNDLED_RELEASES, bundledReleaseBySlug, mergeReleases } from '../content/changelog';
import { formatReleaseDate, loadPublishedRelease, loadPublishedReleases, type PublicRelease } from '../lib/releases';
import { ReleaseArticle, ReleaseCategories } from './ReleaseArticle';
import { HubShell } from './HubShell';
import { releaseSchema } from './usePageMeta';

/**
 * The public changelog.
 *
 * The index lists every published release; each release has its own permanent page. The pages are
 * rendered from the API when it answers and from the bundled notes when it does not, and the page
 * says which of the two happened rather than quietly showing a shorter list.
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

export function ChangelogPage() {
  const [state, setState] = useState<{ status: 'loading' } | { status: 'ready'; releases: PublicRelease[]; live: boolean }>({ status: 'loading' });

  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    loadPublishedReleases(controller.signal).then(result => {
      if (!active) return;
      setState({ status: 'ready', releases: mergeReleases(result.releases), live: result.live });
    });
    return () => { active = false; controller.abort(); };
  }, []);

  return (
    <HubShell
      path="/changelog"
      title="Changelog — what Intake shipped | Intake"
      description="Every Intake release with its own permanent page: what changed, why it matters, and how to use it. Launch, Google Forms and Typeform creation, and everything since."
      eyebrow="CHANGELOG"
      heading={<>What shipped, and what is next.</>}
      lede="New capabilities land every week. This page is the record — and the update list hears about each one first."
      analyticsPath="/changelog"
    >
      <section className="mk-section" aria-label="Releases">
        <div className="mk-container">
          {state.status === 'loading' && (
            <ol className="mk-changelog" aria-busy="true" aria-label="Loading releases">
              {[0, 1, 2].map(index => (
                <li key={index} className="mk-changelog__skeleton"><span className="mk-skeleton-line" /><span className="mk-skeleton-line short" /></li>
              ))}
            </ol>
          )}
          {state.status === 'ready' && state.releases.length === 0 && (
            <div className="mk-empty">
              <strong>No releases have been published yet.</strong>
              <p>The first one will appear here as soon as it ships.</p>
            </div>
          )}
          {state.status === 'ready' && state.releases.length > 0 && (
            <>
              {!state.live && (
                <p className="mk-changelog__notice" role="status">
                  Live releases could not be loaded just now, so this is the release history recorded in the site bundle.
                </p>
              )}
              <ol className="mk-changelog">
                {state.releases.map(release => (
                  <li key={release.slug}>
                    <span className="mk-changelog__date">{formatReleaseDate(release.releaseDate)}</span>
                    <div>
                      <h2>
                        <Link to={`/changelog/${release.slug}`}>{release.title}</Link>
                      </h2>
                      <p>{release.summary}</p>
                      <ReleaseCategories categories={release.categories} />
                    </div>
                  </li>
                ))}
              </ol>
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
      if (result === undefined) { setState({ status: 'unavailable' }); return; }
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
      image={release.heroImageUrl}
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
