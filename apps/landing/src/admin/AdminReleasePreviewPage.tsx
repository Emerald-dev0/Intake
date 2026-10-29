import { Link, useParams } from 'react-router-dom';
import { useAdminQuery } from './useAdminQuery';
import { ReleaseArticle } from '../marketing/ReleaseArticle';
import type { PublicRelease } from '../lib/releases';

/**
 * The public preview of a release, before it is published.
 *
 * It renders the same component the public page renders, from the same payload the public endpoint
 * will return, so what the operator reads here is what a reader will read. It lives inside the
 * operator console, which the robots file disallows, so a draft is never indexable.
 */
export function AdminReleasePreviewPage() {
  const { releaseId = '' } = useParams();
  const query = useAdminQuery<{ release: PublicRelease; url: string }>(`/api/admin/releases/${releaseId}/preview`);

  if (query.state.status === 'loading') {
    return <div className="admin-loading" role="status"><i className="admin-spinner" />Loading the preview…</div>;
  }
  if (query.state.status === 'error') {
    return (
      <div className="admin-state-card error" role="alert">
        <strong>The preview could not be loaded</strong>
        <p>{query.state.message}</p>
        <button className="admin-button" onClick={query.refresh}>Retry</button>
      </div>
    );
  }

  const { release, url } = query.state.data;
  return (
    <div className="admin-release__preview">
      <div className="admin-release__preview-bar">
        <span className="admin-pill warn">Preview · not published</span>
        <span className="admin-muted">This is what the release page will show at {url}</span>
        <Link className="admin-button" to={`/admin/releases/${releaseId}`}>Back to the release</Link>
      </div>
      <div className="marketing-page">
        <main id="main-content" tabIndex={-1}>
          <section className="mk-section mk-hub-head">
            <div className="mk-container">
              <span className="mk-eyebrow">CHANGELOG</span>
              <h1>{release.title}</h1>
              <p className="mk-hub-lede">{release.summary}</p>
            </div>
          </section>
          <section className="mk-section" aria-label="Release preview">
            <div className="mk-container">
              <ReleaseArticle release={release} />
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}
