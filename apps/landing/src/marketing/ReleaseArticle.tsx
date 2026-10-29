import { ReleaseMarkdown } from '../lib/release-markdown';
import { categoryLabel, formatReleaseDate, type PublicRelease } from '../lib/releases';

/**
 * The body of a release: the announcement as the reader sees it.
 *
 * Shared by the public release page and the operator's preview, so an administrator reads exactly
 * what a reader will read — the same heading, the same categories, the same links — before the
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

export function ReleaseArticle({ release, notice }: { release: PublicRelease; notice?: string | null }) {
  return (
    <div className="mk-release">
      <div className="mk-release__meta">
        <span className="mk-release__date">{formatReleaseDate(release.releaseDate)}</span>
        <ReleaseCategories categories={release.categories} />
      </div>
      {notice && <p className="mk-changelog__notice" role="status">{notice}</p>}
      {release.heroImageUrl && (
        <figure className="mk-release__media">
          <img src={release.heroImageUrl} alt={`Screenshot for ${release.title}`} loading="lazy" />
        </figure>
      )}
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
