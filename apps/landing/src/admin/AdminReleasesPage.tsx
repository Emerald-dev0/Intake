import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { adminPost, AdminApiError } from './api';
import { useAdminQuery, type QueryState } from './useAdminQuery';
import type {
  ReleaseCategory, ReleaseChecklistItem, ReleaseDetailData, ReleaseListItem, ReleaseRecord, ReleaseSource,
  ReleaseStatus,
} from './types';

/**
 * The Release Manager.
 *
 * An internal tool inside the existing operator console: the same allowlist, the same verified
 * session, the same panel-and-table layout as every other admin page. It prepares, reviews,
 * approves and publishes the changelog — and the public changelog only ever shows what was
 * published here.
 */

const STATUS_LABELS: Record<ReleaseStatus, string> = {
  draft: 'Draft',
  in_review: 'In review',
  approved: 'Approved',
  awaiting_deployment: 'Awaiting deployment',
  published: 'Published',
  cancelled: 'Cancelled',
};

const STATUS_TONES: Record<ReleaseStatus, 'ok' | 'warn' | 'bad' | 'muted'> = {
  draft: 'muted',
  in_review: 'warn',
  approved: 'warn',
  awaiting_deployment: 'warn',
  published: 'ok',
  cancelled: 'muted',
};

const CATEGORY_LABELS: Record<ReleaseCategory, string> = {
  feature: 'Feature',
  improvement: 'Improvement',
  fix: 'Fix',
  security: 'Security',
};

const CATEGORIES: ReleaseCategory[] = ['feature', 'improvement', 'fix', 'security'];

const FILTERS: Array<{ value: ReleaseStatus | 'all'; label: string }> = [
  { value: 'all', label: 'All' },
  { value: 'draft', label: 'Draft' },
  { value: 'in_review', label: 'In review' },
  { value: 'approved', label: 'Approved' },
  { value: 'awaiting_deployment', label: 'Awaiting deployment' },
  { value: 'published', label: 'Published' },
  { value: 'cancelled', label: 'Cancelled' },
];

function dateTime(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date) + ' UTC';
}

function Heading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: React.ReactNode }) {
  return <div className="admin-page-heading"><div><span className="admin-overline">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="admin-heading-action">{action}</div>}</div>;
}

function Panel({ title, eyebrow, description, action, children, className = '' }: {
  title: string; eyebrow?: string; description?: string; action?: React.ReactNode; children: React.ReactNode; className?: string;
}) {
  return (
    <section className={`admin-panel ${className}`}>
      <header className="admin-panel-header">
        <div>{eyebrow && <span className="admin-overline">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>
        {action && <div>{action}</div>}
      </header>
      {children}
    </section>
  );
}

function StatusPill({ label, tone = 'muted' }: { label: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' }) {
  return <span className={`admin-pill ${tone}`}>{label}</span>;
}

function QueryLoading({ label = 'Loading releases…' }: { label?: string }) {
  return <div className="admin-loading" role="status"><i className="admin-spinner" />{label}</div>;
}

function QueryError({ state, retry }: { state: Extract<QueryState<unknown>, { status: 'error' }>; retry: () => void }) {
  const denied = state.statusCode === 403;
  return (
    <div className="admin-state-card error" role="alert">
      <strong>{denied ? 'Administrator access required' : state.statusCode === 429 ? 'Rate limit reached' : 'Releases unavailable'}</strong>
      <p>{state.message}</p>
      <button className="admin-button" onClick={retry}>Retry</button>
    </div>
  );
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="admin-empty"><strong>{title}</strong><p>{detail}</p></div>;
}

/** Deletes are rare and deliberate, so they get their own helper rather than a POST that means "remove". */
async function adminDelete(path: `/api/admin${string}`): Promise<void> {
  const response = await fetch(path, { method: 'DELETE', credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { message?: string; error?: string } | null;
    throw new AdminApiError(response.status, body?.message ?? body?.error ?? 'The request could not be completed.');
  }
}

export function AdminReleasesPage() {
  const [status, setStatus] = useState<ReleaseStatus | 'all'>('all');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState('');
  const navigate = useNavigate();
  const query = useAdminQuery<{ items: ReleaseListItem[]; total: number; page: number; pageSize: number; totalPages: number }>(
    `/api/admin/releases${status === 'all' ? '' : `?status=${status}`}`,
  );

  const create = useCallback(async () => {
    if (creating) return;
    setCreating(true);
    setCreateError('');
    try {
      const response = await adminPost<{ release: ReleaseRecord }>('/api/admin/releases', {
        title: 'Untitled release',
        summary: '',
        body: '',
        categories: ['improvement'],
      });
      navigate(`/admin/releases/${response.release.id}`);
    } catch (error) {
      setCreateError(error instanceof AdminApiError ? error.message : 'The draft could not be created.');
      setCreating(false);
    }
  }, [creating, navigate]);

  return (
    <>
      <Heading
        kicker="INTAKE / RELEASES"
        title="Release Manager"
        description="Prepare, review, approve and publish the public changelog. Only published releases are visible to the public."
        action={<button className="admin-button primary" onClick={() => void create()} disabled={creating}>{creating ? 'Creating…' : 'New draft'}</button>}
      />
      {createError && <p className="admin-inline-error" role="alert">{createError}</p>}
      <Panel
        title="Releases"
        eyebrow="LIST"
        description="Every announcement, with the state it is in and where it came from."
        action={
          <label className="admin-field compact" htmlFor="release-status">
            <span>State</span>
            <select id="release-status" value={status} onChange={event => setStatus(event.target.value as ReleaseStatus | 'all')}>
              {FILTERS.map(filter => <option key={filter.value} value={filter.value}>{filter.label}</option>)}
            </select>
          </label>
        }
      >
        {query.state.status === 'loading' && <QueryLoading />}
        {query.state.status === 'error' && <QueryError state={query.state} retry={query.refresh} />}
        {query.state.status === 'ready' && query.state.data.items.length === 0 && (
          <EmptyState title="No releases yet" detail="A draft appears here as soon as one is written. Nothing is public until it is published." />
        )}
        {query.state.status === 'ready' && query.state.data.items.length > 0 && (
          <div className="admin-table-scroll">
            <table className="admin-table admin-table--releases">
              <thead>
                <tr>
                  <th scope="col">Release</th>
                  <th scope="col">State</th>
                  <th scope="col">Categories</th>
                  <th scope="col">Date</th>
                  <th scope="col">Sources</th>
                  <th scope="col">Updated</th>
                </tr>
              </thead>
              <tbody>
                {query.state.data.items.map(item => (
                  <tr key={item.id}>
                    <td>
                      <strong><Link to={`/admin/releases/${item.id}`}>{item.title || 'Untitled release'}</Link></strong>
                      <small>{item.summary || 'No summary yet.'}</small>
                      <code>/changelog/{item.slug}</code>
                    </td>
                    <td><StatusPill label={STATUS_LABELS[item.status]} tone={STATUS_TONES[item.status]} /></td>
                    <td>
                      <div className="admin-pills">
                        {item.categories.map(category => <StatusPill key={category} label={CATEGORY_LABELS[category]} />)}
                      </div>
                    </td>
                    <td>{item.releaseDate ?? '—'}</td>
                    <td>
                      {item.sourceCount} linked
                      {item.hasDeployment && <small>Deployment: {item.deploymentState ?? 'unknown'}</small>}
                    </td>
                    <td>{dateTime(item.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Panel>
    </>
  );
}

function ChecklistRow({ item, onDecide, busy }: {
  item: ReleaseChecklistItem;
  onDecide: (key: string, decision: 'confirmed' | 'unconfirmed' | 'not_applicable') => void;
  busy: boolean;
}) {
  const tone = item.status === 'verified' || item.status === 'confirmed' ? 'ok'
    : item.status === 'blocked' ? 'bad'
      : item.status === 'unconfirmed' ? 'warn' : 'muted';
  const label = item.status === 'verified' ? 'Verified'
    : item.status === 'confirmed' ? 'Confirmed'
      : item.status === 'unconfirmed' ? 'Not confirmed'
        : item.status === 'not_applicable' ? 'Not applicable'
          : item.status === 'blocked' ? 'Blocked' : 'Unknown';
  return (
    <li className="admin-release__check">
      <div>
        <strong>{item.label}</strong>
        <small>{item.detail}</small>
      </div>
      <div className="admin-release__check-side">
        <StatusPill label={label} tone={tone} />
        {item.kind === 'manual' && (
          <span className="admin-release__check-actions">
            <button className="admin-button" disabled={busy} onClick={() => onDecide(item.key, 'confirmed')}>Confirm</button>
            <button className="admin-button" disabled={busy} onClick={() => onDecide(item.key, 'not_applicable')}>N/A</button>
          </span>
        )}
      </div>
    </li>
  );
}

export function AdminReleaseDetailPage() {
  const { releaseId = '' } = useParams();
  const query = useAdminQuery<ReleaseDetailData>(`/api/admin/releases/${releaseId}`);
  const [draft, setDraft] = useState<Partial<ReleaseRecord>>({});
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{ tone: 'ok' | 'error'; text: string } | null>(null);
  const [busyAction, setBusyAction] = useState('');
  const [shareText, setShareText] = useState('');
  const [sourceKind, setSourceKind] = useState<'pull_request' | 'commit' | 'release' | 'deployment'>('pull_request');
  const [sourceRef, setSourceRef] = useState('');
  const [pullRequestForDraft, setPullRequestForDraft] = useState('');

  const release = query.state.status === 'ready' ? query.state.data.release : null;

  useEffect(() => {
    if (!release) return;
    setDraft({
      title: release.title,
      summary: release.summary,
      body: release.body,
      slug: release.slug,
      categories: release.categories,
      releaseDate: release.releaseDate,
      links: release.links,
      heroImageUrl: release.heroImageUrl,
      shareText: release.shareText,
    });
    setShareText(release.shareText ?? '');
  }, [release?.id, release?.updatedAt]);

  const value = useCallback(<K extends keyof ReleaseRecord>(key: K, fallback: ReleaseRecord[K]) => {
    const current = draft[key];
    return (current === undefined ? fallback : current) as ReleaseRecord[K];
  }, [draft]);

  const run = useCallback(async (label: string, work: () => Promise<void>) => {
    setBusyAction(label);
    setMessage(null);
    try {
      await work();
    } catch (error) {
      const text = error instanceof AdminApiError ? error.message : 'The request could not be completed.';
      setMessage({ tone: 'error', text });
    } finally {
      setBusyAction('');
    }
  }, []);

  const save = useCallback(async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage(null);
    try {
      await adminPost<{ release: ReleaseRecord }>(`/api/admin/releases/${releaseId}`, {
        title: draft.title,
        summary: draft.summary,
        body: draft.body,
        slug: draft.slug,
        categories: draft.categories,
        releaseDate: draft.releaseDate,
        links: draft.links,
        heroImageUrl: draft.heroImageUrl,
        shareText: draft.shareText,
      });
      setMessage({ tone: 'ok', text: 'Saved.' });
      query.refresh();
    } catch (error) {
      const text = error instanceof AdminApiError ? error.message : 'The release could not be saved.';
      setMessage({ tone: 'error', text });
    } finally {
      setSaving(false);
    }
  }, [draft, releaseId, query]);

  const transition = useCallback((action: string) => run(action, async () => {
    await adminPost(`/api/admin/releases/${releaseId}/state`, { action });
    setMessage({ tone: 'ok', text: `Recorded: ${action.replace('_', ' ')}.` });
    query.refresh();
  }), [releaseId, run, query]);

  const decide = useCallback((key: string, decision: 'confirmed' | 'unconfirmed' | 'not_applicable') => run(`check-${key}`, async () => {
    await adminPost(`/api/admin/releases/${releaseId}/checklist`, { key, decision });
    query.refresh();
  }), [releaseId, run, query]);

  const generateShare = useCallback(() => run('share', async () => {
    const response = await adminPost<{ text: string }>(`/api/admin/releases/${releaseId}/share`, {
      title: draft.title ?? release?.title,
      summary: draft.summary ?? release?.summary,
    });
    setShareText(response.text);
  }), [releaseId, draft.title, draft.summary, release, run]);

  const copyShare = useCallback(() => run('copy', async () => {
    if (!navigator.clipboard?.writeText) throw new AdminApiError(0, 'This browser did not allow clipboard access.');
    await navigator.clipboard.writeText(shareText);
    setMessage({ tone: 'ok', text: 'Share copy copied to the clipboard.' });
  }), [shareText, run]);

  const addSource = useCallback(() => run('source', async () => {
    await adminPost(`/api/admin/releases/${releaseId}/sources`, { kind: sourceKind, pullRequest: sourceRef, commit: sourceRef, tag: sourceRef, ref: sourceRef });
    setSourceRef('');
    query.refresh();
  }), [releaseId, sourceKind, sourceRef, run, query]);

  const removeSource = useCallback((source: ReleaseSource) => run(`remove-${source.id}`, async () => {
    await adminDelete(`/api/admin/releases/${releaseId}/sources/${source.id}`);
    query.refresh();
  }), [releaseId, run, query]);

  const generateDraft = useCallback(() => run('draft', async () => {
    const response = await adminPost<{ draft: { title: string; summary: string; body: string; categories: ReleaseCategory[] }; classification: string }>(
      `/api/admin/releases/${releaseId}/draft`,
      { pullRequest: pullRequestForDraft, apply: true },
    );
    setDraft(current => ({
      ...current,
      title: response.draft.title,
      summary: response.draft.summary,
      body: response.draft.body,
      categories: response.draft.categories,
    }));
    setMessage({ tone: 'ok', text: `Draft written from the pull request. ${response.classification} Edit it before saving.` });
  }), [releaseId, pullRequestForDraft, run]);

  const status = release?.status;
  const canPublish = status === 'approved' || status === 'awaiting_deployment';

  const readiness = query.state.status === 'ready' ? query.state.data.readiness : null;

  if (query.state.status === 'loading') return <QueryLoading />;
  if (query.state.status === 'error') return <QueryError state={query.state} retry={query.refresh} />;
  if (!release) return <EmptyState title="Release unavailable" detail="That release no longer exists." />;

  const data = query.state.data;

  return (
    <>
      <Heading
        kicker="INTAKE / RELEASES"
        title={release.title || 'Untitled release'}
        description={`/changelog/${release.slug}`}
        action={<Link className="admin-button" to="/admin/releases">Back to releases</Link>}
      />
      <div className="admin-release__statusline">
        <StatusPill label={STATUS_LABELS[release.status]} tone={STATUS_TONES[release.status]} />
        <span className="admin-muted">
          {release.publishedAt ? `Published ${dateTime(release.publishedAt)}` : `Updated ${dateTime(release.updatedAt)}`}
        </span>
        <Link className="admin-muted" to={`/admin/releases/${release.id}/preview`} target="_blank" rel="noreferrer">Preview the public page ↗</Link>
      </div>
      {message && <p className={message.tone === 'ok' ? 'admin-release__message' : 'admin-inline-error'} role="status">{message.text}</p>}

      <div className="admin-release__grid">
        <div>
          <Panel title="Announcement" eyebrow="CONTENT" description="What the reader sees on the public release page.">
            <form className="admin-release__form" onSubmit={save}>
              <label className="admin-field" htmlFor="release-title">
                <span>Title</span>
                <input id="release-title" value={value('title', '')} onChange={event => setDraft(current => ({ ...current, title: event.target.value }))} />
              </label>
              <label className="admin-field" htmlFor="release-slug">
                <span>Slug · permanent link</span>
                <input id="release-slug" value={value('slug', '')} onChange={event => setDraft(current => ({ ...current, slug: event.target.value }))} disabled={release.status === 'published'} />
                <small className="admin-muted">{release.status === 'published' ? 'Frozen: this link is permanent once published.' : 'Lowercase words separated by hyphens.'}</small>
              </label>
              <label className="admin-field" htmlFor="release-summary">
                <span>Summary</span>
                <textarea id="release-summary" rows={3} value={value('summary', '')} onChange={event => setDraft(current => ({ ...current, summary: event.target.value }))} />
              </label>
              <label className="admin-field" htmlFor="release-date">
                <span>Publication date</span>
                <input id="release-date" type="date" value={value('releaseDate', '') ?? ''} onChange={event => setDraft(current => ({ ...current, releaseDate: event.target.value || null }))} />
              </label>
              <fieldset className="admin-release__categories">
                <legend>Categories</legend>
                {CATEGORIES.map(category => {
                  const selected = value('categories', []).includes(category);
                  return (
                    <label key={category}>
                      <input
                        type="checkbox"
                        checked={selected}
                        onChange={event => setDraft(current => {
                          const list = new Set(current.categories ?? release.categories);
                          if (event.target.checked) list.add(category); else list.delete(category);
                          return { ...current, categories: [...list] };
                        })}
                      />
                      <span>{CATEGORY_LABELS[category]}</span>
                    </label>
                  );
                })}
              </fieldset>
              <label className="admin-field" htmlFor="release-body">
                <span>Release notes</span>
                <textarea id="release-body" rows={14} value={value('body', '')} onChange={event => setDraft(current => ({ ...current, body: event.target.value }))} />
                <small className="admin-muted">Sections: “## What changed”, “## Why it matters”, “## How to use it”, “## Limitations and availability”. TODO markers block publication.</small>
              </label>
              <div className="admin-form-actions">
                <button className="admin-button primary" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Save'}</button>
              </div>
            </form>
          </Panel>

          <Panel title="Links" eyebrow="REFERENCES" description="Documentation and product links shown with the release.">
            <div className="admin-release__links-editor">
              {(draft.links ?? release.links).map((link, index) => (
                <div key={`${link.url}-${index}`} className="admin-release__link-row">
                  <input
                    aria-label={`Link ${index + 1} label`}
                    value={link.label}
                    onChange={event => setDraft(current => {
                      const links = [...(current.links ?? release.links)];
                      links[index] = { ...links[index], label: event.target.value };
                      return { ...current, links };
                    })}
                  />
                  <input
                    aria-label={`Link ${index + 1} URL`}
                    value={link.url}
                    onChange={event => setDraft(current => {
                      const links = [...(current.links ?? release.links)];
                      links[index] = { ...links[index], url: event.target.value };
                      return { ...current, links };
                    })}
                  />
                  <button
                    type="button"
                    className="admin-button"
                    onClick={() => setDraft(current => ({ ...current, links: (current.links ?? release.links).filter((_entry, position) => position !== index) }))}
                  >
                    Remove
                  </button>
                </div>
              ))}
              <button
                type="button"
                className="admin-button"
                onClick={() => setDraft(current => ({ ...current, links: [...(current.links ?? release.links), { label: '', url: '' }] }))}
              >
                Add link
              </button>
            </div>
          </Panel>
        </div>

        <div>
          <Panel title="Workflow" eyebrow="STATE" description="A release is only public once it is published.">
            <div className="admin-release__actions">
              <button className="admin-button" disabled={status !== 'draft' || busyAction !== ''} onClick={() => void transition('submit')}>Send for review</button>
              <button className="admin-button primary" disabled={status !== 'in_review' || busyAction !== ''} onClick={() => void transition('approve')}>Approve</button>
              <button className="admin-button" disabled={status !== 'in_review' || busyAction !== ''} onClick={() => void transition('reject')}>Send back</button>
              <button className="admin-button" disabled={status !== 'approved' || busyAction !== ''} onClick={() => void transition('revoke_approval')}>Withdraw approval</button>
              <button className="admin-button" disabled={status !== 'approved' || busyAction !== ''} onClick={() => void transition('await_deployment')}>Await deployment</button>
              <button className="admin-button primary" disabled={!canPublish || busyAction !== '' || (readiness ? !readiness.ready : true)} onClick={() => void transition('publish')}>Publish</button>
              <button className="admin-button" disabled={status === 'published' || status === 'cancelled' || busyAction !== ''} onClick={() => void transition('cancel')}>Cancel</button>
              <button className="admin-button" disabled={status !== 'cancelled' || busyAction !== ''} onClick={() => void transition('restore')}>Restore as draft</button>
            </div>
            <p className="admin-note">
              Publishing is refused until the checklist is complete. A linked deployment must have been observed as successful — a merged pull request is not a deployment.
            </p>
          </Panel>

          <Panel title="Checklist" eyebrow="READINESS" description="Automatic checks are read from real state. Manual checks need your confirmation.">
            <ul className="admin-release__checklist">
              {data.checklist.map(item => (
                <ChecklistRow key={item.key} item={item} onDecide={decide} busy={busyAction !== ''} />
              ))}
            </ul>
          </Panel>

          <Panel
            title="GitHub"
            eyebrow="SOURCE"
            description={data.github.configured ? `Linked to ${data.github.repository ?? 'the configured repository'}.` : 'The GitHub integration is not configured on this server.'}
          >
            {!data.github.configured && (
              <p className="admin-note">
                Set <code>GITHUB_TOKEN</code> and <code>GITHUB_REPOSITORY</code> on the API to link pull requests, commits and deployments. Until then the release can still be written by hand and linked by URL.
              </p>
            )}
            <div className="admin-release__source-form">
              <label className="admin-field" htmlFor="source-kind">
                <span>Link a source</span>
                <select id="source-kind" value={sourceKind} onChange={event => setSourceKind(event.target.value as typeof sourceKind)}>
                  <option value="pull_request">Pull request</option>
                  <option value="commit">Commit</option>
                  <option value="release">Release</option>
                  <option value="deployment">Deployment</option>
                </select>
              </label>
              <label className="admin-field" htmlFor="source-ref">
                <span>{sourceKind === 'pull_request' ? 'Number or URL' : sourceKind === 'commit' ? 'SHA' : sourceKind === 'release' ? 'Tag' : 'Branch or ref'}</span>
                <input id="source-ref" value={sourceRef} onChange={event => setSourceRef(event.target.value)} placeholder={sourceKind === 'pull_request' ? '#21' : ''} />
              </label>
              <button className="admin-button" disabled={!sourceRef.trim() || busyAction !== ''} onClick={() => void addSource()}>Link</button>
            </div>
            <ul className="admin-release__sources">
              {data.sources.map(source => (
                <li key={source.id}>
                  <div>
                    <strong>{source.title || `${source.kind.replace('_', ' ')} ${source.externalId ?? ''}`.trim()}</strong>
                    <small>
                      {source.kind.replace('_', ' ')} · {source.provider}
                      {source.state ? ` · ${source.state}` : ''}
                      {source.deploymentState ? ` · deployment ${source.deploymentState}` : ''}
                    </small>
                    {source.url && <a href={source.url} target="_blank" rel="noreferrer">Open source ↗</a>}
                  </div>
                  <button className="admin-button" onClick={() => void removeSource(source)} disabled={busyAction !== ''}>Remove</button>
                </li>
              ))}
              {data.sources.length === 0 && <li className="admin-muted">No sources linked yet.</li>}
            </ul>
            {data.github.configured && (
              <div className="admin-release__source-form">
                <label className="admin-field" htmlFor="draft-pr">
                  <span>Write the draft from a pull request</span>
                  <input id="draft-pr" value={pullRequestForDraft} onChange={event => setPullRequestForDraft(event.target.value)} placeholder="#21" />
                </label>
                <button className="admin-button" disabled={!pullRequestForDraft.trim() || busyAction !== ''} onClick={() => void generateDraft()}>Generate draft</button>
              </div>
            )}
          </Panel>

          <Panel title="Share" eyebrow="ANNOUNCEMENT" description="Copy for a social post. Edit it before you post it anywhere.">
            <textarea className="admin-release__share" rows={7} value={shareText} onChange={event => setShareText(event.target.value)} aria-label="Share copy" />
            <div className="admin-form-actions">
              <button className="admin-button" onClick={() => void generateShare()} disabled={busyAction !== ''}>Write copy</button>
              <button className="admin-button primary" onClick={() => void copyShare()} disabled={!shareText || busyAction !== ''}>Copy</button>
              <a className="admin-button" href={data.previewUrl} target="_blank" rel="noreferrer">Permanent link ↗</a>
              <Link className="admin-button" to={`/admin/releases/${release.id}/preview`} target="_blank" rel="noreferrer">Preview ↗</Link>
            </div>
            <p className="admin-note">The link is permanent once published. Intake does not post anywhere; this only prepares the text.</p>
          </Panel>

          <Panel title="History" eyebrow="AUDIT" description="Every administrative action on this release.">
            <ul className="admin-release__audit">
              {data.audit.map(entry => (
                <li key={entry.id}>
                  <strong>{entry.action.replace(/_/g, ' ')}</strong>
                  <small>{entry.detail ?? ''}</small>
                  <small>{entry.actorName ?? 'System'} · {dateTime(entry.createdAt)}</small>
                </li>
              ))}
              {data.audit.length === 0 && <li className="admin-muted">Nothing recorded yet.</li>}
            </ul>
          </Panel>
        </div>
      </div>
    </>
  );
}
