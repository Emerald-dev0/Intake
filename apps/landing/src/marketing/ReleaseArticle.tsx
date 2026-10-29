import { ReleaseMarkdown, releaseSections } from '../lib/release-markdown';
import { categoryLabel, formatReleaseDate, type PublicRelease } from '../lib/releases';

/**
 * The body of a release: the announcement as the reader sees it.
 *
 * Shared by the public release page and the operator's preview, so an administrator reads exactly
 * what a reader will read — the same highlights, the same sections, the same links — before the
 * release is published.
 */

export function ReleaseCategories({ categories }: { categories: PublicRelease['categories'] }) {
  if (!categories.length) return null;
  return (
    <ul className="mk-release__categories" aria-label="Categories">
      {categories.map(category => <li key={category}>{categoryLabel(category)}</li>)}
    </ul>
  );
}

/**
 * The highlights: what changed, in a few lines, before the full notes.
 *
 * A reader who stops after the highlights should still know whether this release concerns them.
 */
export function ReleaseHighlights({ highlights }: { highlights?: PublicRelease['highlights'] | null }) {
  // A release published before the highlights existed simply has none; the page must not care.
  const list = highlights ?? [];
  if (!list.length) return null;
  return (
    <section className="mk-release__highlights" aria-labelledby="mk-release-highlights">
      <h2 id="mk-release-highlights">What changed</h2>
      <ul>
        {list.map(highlight => <li key={highlight}>{highlight}</li>)}
      </ul>
    </section>
  );
}

/** The table of contents for the notes, when there are enough sections to be worth one. */
export function ReleaseContents({ body }: { body: string }) {
  const sections = releaseSections(body).filter(section => section.level === 2);
  if (sections.length < 3) return null;
  return (
    <nav className="mk-release__contents" aria-labelledby="mk-release-contents">
      <h2 id="mk-release-contents">In this release</h2>
      <ul>
        {sections.map(section => (
          <li key={section.id}><a href={`#${section.id}`}>{section.title}</a></li>
        ))}
      </ul>
    </nav>
  );
}

export function ReleaseArticle({ release, notice }: { release: PublicRelease; notice?: string | null }) {
  return (
    <div className="mk-release">
      <div className="mk-release__meta">
        <span className="mk-release__date">{formatReleaseDate(release.releaseDate)}</span>
        <ReleaseCategories categories={release.categories} />
      </div>
      {notice && <p className="mk-changelog__notice" role="status">{notice}</p>}
      {release.audience && (
        <p className="mk-release__audience"><span className="mk-release__audience-label">Who this is for</span> {release.audience}</p>
      )}
      {release.heroImageUrl && (
        <figure className="mk-release__media">
          <img src={release.heroImageUrl} alt={`Screenshot for ${release.title}`} loading="lazy" />
        </figure>
      )}
      <ReleaseHighlights highlights={release.highlights} />
      <ReleaseContents body={release.body} />
      <ReleaseMarkdown body={release.body} className="mk-release__body" />
      {release.links.length > 0 && (
        <nav className="mk-release__links" aria-label="Links for this release">
          <h2>Links</h2>
          <ul>
            {release.links.map(link => {
              const external = !link.url.startsWith('/');
              return (
                <li key={link.url}>
                  <a href={link.url} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>{link.label}</a>
                </li>
              );
            })}
          </ul>
        </nav>
      )}
    </div>
  );
}
