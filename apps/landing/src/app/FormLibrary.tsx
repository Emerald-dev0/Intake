import { useEffect, useRef, useState, type FormEvent } from 'react';
import type { ProviderLoad } from './Connections';
import {
  parseLibraryFormList,
  parseLibraryForm,
  parseFormList,
  type PublicLibraryForm,
  type PublicFormSummary,
} from '../lib/forms';

export interface FormLibraryProps {
  providers: ProviderLoad;
  reloadProviders: () => void;
  onSelectMode?: (mode: 'create' | 'edit', formRecordId?: string) => void;
  initialForms?: PublicFormSummary[];
}

type ActiveFilter = 'active' | 'archived' | 'all';
type SourceFilter = 'all' | 'created' | 'imported';
type SortOption = 'newest' | 'oldest' | 'title_asc' | 'title_desc' | 'updated' | 'synced';

interface LiveStatusResult {
  status: 'accessible' | 'reconnection_required' | 'inaccessible' | 'missing' | 'unavailable' | 'unknown';
  message: string;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

function formatDateTime(value: string | null | undefined): string {
  if (!value) return 'Unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Recently';
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function FormLibrary({
  providers,
  reloadProviders,
  onSelectMode,
  initialForms,
}: FormLibraryProps) {
  const [forms, setForms] = useState<PublicLibraryForm[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters & Sorting state
  const [searchQuery, setSearchQuery] = useState('');
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>('all');
  const [archiveFilter, setArchiveFilter] = useState<ActiveFilter>('active');
  const [sortOption, setSortOption] = useState<SortOption>('newest');

  // Modals state
  const [inspectingForm, setInspectingForm] = useState<PublicLibraryForm | null>(null);
  const [liveChecking, setLiveChecking] = useState(false);
  const [liveStatus, setLiveStatus] = useState<LiveStatusResult | null>(null);

  const [importOpen, setImportOpen] = useState(false);
  const [importUrl, setImportUrl] = useState('');
  const [importBusy, setImportBusy] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);

  const [deleteConfirmOpen, setDeleteConfirmOpen] = useState(false);
  const [deleteBusy, setDeleteBusy] = useState(false);

  const alive = useRef(true);
  const google = providers.providers?.find(provider => provider.id === 'google');
  const isGoogleConnected = google?.status === 'connected';

  useEffect(() => {
    alive.current = true;
    return () => { alive.current = false; };
  }, []);

  async function loadLibrary() {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (searchQuery.trim()) params.set('query', searchQuery.trim());
      if (sourceFilter !== 'all') params.set('source', sourceFilter);
      if (archiveFilter === 'archived') params.set('archived', 'true');
      else if (archiveFilter === 'all') params.set('archived', 'all');
      else params.set('archived', 'false');
      if (sortOption !== 'newest') params.set('sort', sortOption);

      const url = `/api/forms/library?${params.toString()}`;
      const response = await fetch(url, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });

      if (!alive.current) return;

      if (response.ok) {
        const body = await response.json().catch(() => null);
        const parsed = parseLibraryFormList(body);
        if (parsed) {
          setForms(parsed);
          setLoading(false);
          return;
        }
      }

      // Fallback to /api/forms if /api/forms/library returned error or 404
      const fallbackRes = await fetch('/api/forms', {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });

      if (!alive.current) return;

      if (fallbackRes.ok) {
        const fallbackBody = await fallbackRes.json().catch(() => null);
        const parsedFallback = parseFormList(fallbackBody);
        if (parsedFallback) {
          const libraryAdapted: PublicLibraryForm[] = parsedFallback.map(form => ({
            ...form,
            description: null,
            source: 'created',
            lastSyncedAt: null,
            archivedAt: null,
            updatedAt: form.createdAt,
          }));
          setForms(libraryAdapted);
          setLoading(false);
          return;
        }
      }

      throw new Error('Could not load library forms');
    } catch {
      if (alive.current) {
        if (initialForms && initialForms.length > 0) {
          setForms(initialForms.map(f => ({
            ...f,
            description: null,
            source: 'created',
            lastSyncedAt: null,
            archivedAt: null,
            updatedAt: f.createdAt,
          })));
          setLoading(false);
        } else {
          setError('Intake could not load your form library. This does not mean your forms are gone.');
          setLoading(false);
        }
      }
    }
  }

  useEffect(() => {
    void loadLibrary();
  }, [searchQuery, sourceFilter, archiveFilter, sortOption]);

  async function checkLiveStatus(formId: string) {
    if (liveChecking) return;
    setLiveChecking(true);
    setLiveStatus(null);
    try {
      const response = await fetch(`/api/forms/library/${encodeURIComponent(formId)}/refresh`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      });
      const data = await response.json().catch(() => null);
      if (!alive.current) return;

      if (data && typeof data.status === 'string') {
        const status = data.status as LiveStatusResult['status'];
        let message = 'Form verified accessible in Google Forms.';
        if (status === 'missing') {
          message = 'Google Forms could not find this form (404). It may have been deleted or moved.';
        } else if (status === 'inaccessible') {
          message = 'Your connected Google account does not have permission to access or edit this form.';
        } else if (status === 'reconnection_required') {
          message = 'Google connection needs attention. Reconnect Google to verify live access.';
          reloadProviders();
        } else if (status === 'unavailable') {
          message = 'Google Forms could not be reached right now. Your Intake local record is preserved.';
        } else if (status === 'accessible') {
          message = 'Form is accessible and accepting responses in Google Forms. Local metadata refreshed.';
          if (data.form) {
            const updated = parseLibraryForm(data.form);
            if (updated) {
              setForms(prev => prev.map(f => f.id === updated.id ? updated : f));
              setInspectingForm(updated);
            }
          }
        }
        setLiveStatus({ status, message });
      } else {
        setLiveStatus({
          status: 'unknown',
          message: 'Could not verify status with Google Forms. Your local record is preserved.',
        });
      }
    } catch {
      if (alive.current) {
        setLiveStatus({
          status: 'unavailable',
          message: 'Google Forms could not be reached. Local metadata preserved.',
        });
      }
    } finally {
      if (alive.current) setLiveChecking(false);
    }
  }

  async function toggleArchive(form: PublicLibraryForm) {
    const isArchived = Boolean(form.archivedAt);
    const endpoint = isArchived ? 'unarchive' : 'archive';
    try {
      const response = await fetch(`/api/forms/library/${encodeURIComponent(form.id)}/${endpoint}`, {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
      });
      if (response.ok) {
        const now = new Date().toISOString();
        const updated: PublicLibraryForm = {
          ...form,
          archivedAt: isArchived ? null : now,
          updatedAt: now,
        };
        setForms(prev => prev.map(f => f.id === form.id ? updated : f));
        if (inspectingForm?.id === form.id) {
          setInspectingForm(updated);
        }
      }
    } catch {
      // ignore transient network error
    }
  }

  async function handleRemove(formId: string) {
    if (deleteBusy) return;
    setDeleteBusy(true);
    try {
      const response = await fetch(`/api/forms/library/${encodeURIComponent(formId)}`, {
        method: 'DELETE',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (response.ok) {
        setForms(prev => prev.filter(f => f.id !== formId));
        setDeleteConfirmOpen(false);
        setInspectingForm(null);
      }
    } finally {
      if (alive.current) setDeleteBusy(false);
    }
  }

  async function submitImport(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!importUrl.trim() || importBusy) return;
    setImportBusy(true);
    setImportError(null);
    try {
      const response = await fetch('/api/forms/library/import', {
        method: 'POST',
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json', 'content-type': 'application/json' },
        body: JSON.stringify({ url: importUrl.trim() }),
      });
      const data = await response.json().catch(() => null);
      if (!alive.current) return;

      if (response.ok && data?.form) {
        const imported = parseLibraryForm(data.form);
        if (imported) {
          setForms(prev => {
            const filtered = prev.filter(f => f.id !== imported.id);
            return [imported, ...filtered];
          });
          setImportOpen(false);
          setImportUrl('');
          setInspectingForm(imported);
          return;
        }
      }

      setImportError(data?.error?.message ?? data?.error ?? 'Could not import form. Verify the URL and your Google connection.');
      if (data?.code === 'provider_not_connected' || data?.code === 'provider_reauthorization_required') {
        reloadProviders();
      }
    } catch {
      if (alive.current) setImportError('Failed to import form due to network error.');
    } finally {
      if (alive.current) setImportBusy(false);
    }
  }

  function clearFilters() {
    setSearchQuery('');
    setSourceFilter('all');
    setArchiveFilter('active');
    setSortOption('newest');
  }

  const hasActiveFilters = searchQuery.trim() !== '' || sourceFilter !== 'all' || archiveFilter !== 'active' || sortOption !== 'newest';

  return (
    <div className="library-container" aria-label="Form library workspace">
      <div className="page-heading library-head">
        <div className="eyebrow">03 / FORM LIBRARY</div>
        <h1>Your Forms</h1>
        <div className="heading-description">
          Find, inspect, open, and continue editing forms created through Intake or imported from your connected Google account.
        </div>
      </div>

      {!isGoogleConnected && (
        <div className="form-banner warn" role="status" style={{ marginBottom: 24 }}>
          <p>
            Your Google account is not connected. Saved forms remain available in your library, but live status verification and editing with Intake require reconnecting.
          </p>
          <a href="/app/connections" className="btn btn-ghost btn-sm">Manage connections →</a>
        </div>
      )}

      {/* Toolbar */}
      <div className="library-toolbar">
        <div className="library-search-wrap">
          <label htmlFor="library-search" className="sr-only">Search forms</label>
          <input
            id="library-search"
            type="search"
            className="library-search-input"
            placeholder="Search forms by title or description…"
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
          />
          {searchQuery && (
            <button
              type="button"
              className="library-search-clear"
              aria-label="Clear search query"
              onClick={() => setSearchQuery('')}
            >
              ✕
            </button>
          )}
        </div>

        <div className="library-controls">
          <label htmlFor="filter-source" className="sr-only">Filter by source</label>
          <select
            id="filter-source"
            className="library-select"
            value={sourceFilter}
            onChange={e => setSourceFilter(e.target.value as SourceFilter)}
          >
            <option value="all">All sources</option>
            <option value="created">Created via Intake</option>
            <option value="imported">Imported</option>
          </select>

          <label htmlFor="filter-status" className="sr-only">Filter by status</label>
          <select
            id="filter-status"
            className="library-select"
            value={archiveFilter}
            onChange={e => setArchiveFilter(e.target.value as ActiveFilter)}
          >
            <option value="active">Active forms</option>
            <option value="archived">Archived forms</option>
            <option value="all">All forms</option>
          </select>

          <label htmlFor="sort-order" className="sr-only">Sort by</label>
          <select
            id="sort-order"
            className="library-select"
            value={sortOption}
            onChange={e => setSortOption(e.target.value as SortOption)}
          >
            <option value="newest">Recently added</option>
            <option value="updated">Recently updated</option>
            <option value="title_asc">Alphabetical (A–Z)</option>
            <option value="title_desc">Alphabetical (Z–A)</option>
            <option value="synced">Recently verified</option>
          </select>

          <div className="library-primary-actions">
            <button
              type="button"
              className="btn btn-ghost btn-sm"
              onClick={() => { setImportOpen(true); setImportError(null); }}
            >
              Import form ↗
            </button>
            <button
              type="button"
              className="btn btn-accent btn-sm"
              onClick={() => onSelectMode ? onSelectMode('create') : window.location.assign('/app/forms')}
            >
              Create form →
            </button>
          </div>
        </div>
      </div>

      {hasActiveFilters && (
        <div className="library-filter-summary">
          <span>
            Showing {forms.length} {forms.length === 1 ? 'form' : 'forms'} matching current filters
          </span>
          <button type="button" className="library-clear-link" onClick={clearFilters}>
            Clear filters
          </button>
        </div>
      )}

      {/* Main Content States */}
      {loading && (
        <div className="forms-panel draft-loading" role="status">
          <span className="spin" /> Loading your form library…
        </div>
      )}

      {error && !loading && (
        <div className="form-banner bad" role="alert">
          <p>{error}</p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={() => void loadLibrary()}>
            Try again
          </button>
        </div>
      )}

      {!loading && !error && forms.length === 0 && !hasActiveFilters && (
        <div className="library-empty">
          <div className="library-empty-icon" aria-hidden>▤</div>
          <h2>Your form library is empty</h2>
          <p>
            Forms you create with Intake or import from your Google account will appear here. You can reopen them, inspect live provider status, and continue editing anytime.
          </p>
          <div className="library-empty-actions">
            <button
              type="button"
              className="btn btn-accent"
              onClick={() => onSelectMode ? onSelectMode('create') : window.location.assign('/app/forms')}
            >
              Create your first form →
            </button>
            <button
              type="button"
              className="btn btn-ghost"
              onClick={() => { setImportOpen(true); setImportError(null); }}
            >
              Import an existing Google Form
            </button>
          </div>
        </div>
      )}

      {!loading && !error && forms.length === 0 && hasActiveFilters && (
        <div className="library-empty">
          <h2>No matching forms found</h2>
          <p>
            No forms match your current search query or filter selection.
          </p>
          <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>
            Clear all filters
          </button>
        </div>
      )}

      {!loading && !error && forms.length > 0 && (
        <ul className="library-grid" aria-label="Forms list">
          {forms.map(form => {
            const isArchived = Boolean(form.archivedAt);
            const isIncomplete = form.status === 'incomplete';
            const externalUrl = form.responderUrl || form.editUrl;

            return (
              <li key={form.id} className={`library-card ${isArchived ? 'archived' : ''}`}>
                <div className="library-card-top">
                  <div className="library-card-badges">
                    <span className="library-badge provider">
                      <span aria-hidden>G</span> Google Forms
                    </span>
                    <span className="library-badge source">
                      {form.source === 'imported' ? 'Imported' : 'Intake'}
                    </span>
                  </div>
                  <span className={`status-pill ${isArchived ? '' : isIncomplete ? 'warn' : 'ok'}`}>
                    {isArchived ? 'Archived' : isIncomplete ? 'Incomplete' : 'Published'}
                  </span>
                </div>

                <h3 className="library-card-title">{form.title}</h3>
                {form.description && (
                  <p className="library-card-desc">{form.description}</p>
                )}

                <div className="library-card-meta">
                  <span>Created {formatDate(form.createdAt)}</span>
                  {form.updatedAt && form.updatedAt !== form.createdAt && (
                    <span>Updated {formatDate(form.updatedAt)}</span>
                  )}
                  {form.lastSyncedAt && (
                    <span>Verified {formatDate(form.lastSyncedAt)}</span>
                  )}
                </div>

                <div className="library-card-actions">
                  {externalUrl && (
                    <a
                      href={externalUrl}
                      target="_blank"
                      rel="noreferrer"
                      className="btn btn-ghost btn-sm"
                    >
                      Open form <span aria-hidden>↗</span>
                    </a>
                  )}
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      if (onSelectMode) {
                        onSelectMode('edit', form.id);
                      } else {
                        window.location.assign(`/app/forms?mode=edit&form=${form.id}`);
                      }
                    }}
                  >
                    Edit with Intake
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => {
                      setInspectingForm(form);
                      setLiveStatus(null);
                    }}
                  >
                    View details
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      {/* Form Details Modal */}
      {inspectingForm && (
        <div
          className="library-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="details-title"
          onClick={e => {
            if (e.target === e.currentTarget) setInspectingForm(null);
          }}
        >
          <div className="library-modal">
            <button
              type="button"
              className="library-modal-close"
              aria-label="Close form details"
              onClick={() => setInspectingForm(null)}
            >
              ✕
            </button>

            <div>
              <span className="library-modal-legend">FORM DETAILS</span>
              <h2 id="details-title">{inspectingForm.title}</h2>
            </div>

            {inspectingForm.description && (
              <p className="library-modal-desc">{inspectingForm.description}</p>
            )}

            <div className="library-details-list">
              <div className="library-detail-row">
                <span>Provider:</span>
                <strong>Google Forms</strong>
              </div>
              <div className="library-detail-row">
                <span>Google Form ID:</span>
                <strong>{inspectingForm.providerFormId}</strong>
              </div>
              <div className="library-detail-row">
                <span>Source:</span>
                <strong>{inspectingForm.source === 'imported' ? 'Imported from Google' : 'Created through Intake'}</strong>
              </div>
              <div className="library-detail-row">
                <span>Status:</span>
                <strong>{inspectingForm.status === 'created' ? 'Published' : 'Incomplete'}</strong>
              </div>
              <div className="library-detail-row">
                <span>Created:</span>
                <strong>{formatDateTime(inspectingForm.createdAt)}</strong>
              </div>
              <div className="library-detail-row">
                <span>Last Updated:</span>
                <strong>{formatDateTime(inspectingForm.updatedAt)}</strong>
              </div>
              {inspectingForm.lastSyncedAt && (
                <div className="library-detail-row">
                  <span>Last Verified:</span>
                  <strong>{formatDateTime(inspectingForm.lastSyncedAt)}</strong>
                </div>
              )}
            </div>

            {/* Live Status Check Box */}
            <div className="library-live-status-box">
              <div className="library-live-status-head">
                <span className="forms-legend">GOOGLE FORMS CONNECTION</span>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={liveChecking}
                  onClick={() => checkLiveStatus(inspectingForm.id)}
                >
                  {liveChecking ? 'Checking…' : 'Check live status ↻'}
                </button>
              </div>
              {liveStatus ? (
                <p className="library-live-status-msg" role="status">
                  <strong>{liveStatus.status === 'accessible' ? '✓ ' : '⚠ '}</strong>
                  {liveStatus.message}
                </p>
              ) : (
                <p className="library-live-status-msg">
                  Verify that this form remains accessible in your connected Google account and refresh metadata.
                </p>
              )}
            </div>

            {/* Links and Actions */}
            <div className="library-modal-actions">
              {inspectingForm.responderUrl && (
                <a
                  href={inspectingForm.responderUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-accent btn-sm"
                >
                  Open responder form ↗
                </a>
              )}
              {inspectingForm.editUrl && (
                <a
                  href={inspectingForm.editUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="btn btn-ghost btn-sm"
                >
                  Open in Google Forms ↗
                </a>
              )}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => {
                  const id = inspectingForm.id;
                  setInspectingForm(null);
                  if (onSelectMode) onSelectMode('edit', id);
                  else window.location.assign(`/app/forms?mode=edit&form=${id}`);
                }}
              >
                Edit with Intake →
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => void toggleArchive(inspectingForm)}
              >
                {inspectingForm.archivedAt ? 'Restore to active library' : 'Archive form'}
              </button>
            </div>

            {/* Removal Danger Zone */}
            <div className="library-danger-zone">
              <p>
                Removing this form deletes the record from Intake. It does <strong>not</strong> delete the form in your Google account.
              </p>
              <button
                type="button"
                className="btn btn-ghost btn-sm library-btn-danger"
                onClick={() => setDeleteConfirmOpen(true)}
              >
                Remove from Intake
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Remove Confirmation Dialog */}
      {deleteConfirmOpen && inspectingForm && (
        <div
          className="library-modal-backdrop"
          role="alertdialog"
          aria-modal="true"
          aria-labelledby="confirm-remove-title"
          onClick={e => {
            if (e.target === e.currentTarget && !deleteBusy) setDeleteConfirmOpen(false);
          }}
        >
          <div className="library-modal" style={{ maxWidth: 480 }}>
            <div>
              <span className="library-modal-legend">CONFIRM REMOVAL</span>
              <h2 id="confirm-remove-title">Remove from Intake Library?</h2>
            </div>
            <p className="library-modal-desc">
              Are you sure you want to remove <strong>{inspectingForm.title}</strong> from your Intake library?
            </p>
            <div className="form-banner warn" style={{ margin: 0 }}>
              <p>
                <strong>The external Google Form will NOT be deleted.</strong> You can still open and manage it directly in Google Forms, or re-import it later.
              </p>
            </div>
            <div className="forms-actions" style={{ justifyContent: 'flex-end', marginTop: 12 }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                disabled={deleteBusy}
                onClick={() => setDeleteConfirmOpen(false)}
              >
                Keep in library
              </button>
              <button
                type="button"
                className="btn btn-accent btn-sm library-btn-danger"
                disabled={deleteBusy}
                onClick={() => handleRemove(inspectingForm.id)}
              >
                {deleteBusy ? 'Removing…' : 'Yes, remove from Intake'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Import Modal */}
      {importOpen && (
        <div
          className="library-modal-backdrop"
          role="dialog"
          aria-modal="true"
          aria-labelledby="import-title"
          onClick={e => {
            if (e.target === e.currentTarget && !importBusy) setImportOpen(false);
          }}
        >
          <div className="library-modal">
            <button
              type="button"
              className="library-modal-close"
              aria-label="Close import dialog"
              disabled={importBusy}
              onClick={() => setImportOpen(false)}
            >
              ✕
            </button>

            <div>
              <span className="library-modal-legend">IMPORT AN EXISTING FORM</span>
              <h2 id="import-title">Import from Google Forms</h2>
            </div>

            <p className="library-modal-desc">
              Paste the edit URL of a form in your connected Google account (e.g. <code>https://docs.google.com/forms/d/FORM_ID/edit</code>). Intake will verify access, add it to your library, and allow you to inspect or edit it naturally.
            </p>

            <form onSubmit={submitImport} className="library-import-form">
              <label htmlFor="import-url" className="sr-only">Google Forms URL</label>
              <input
                id="import-url"
                type="url"
                className="library-import-input"
                placeholder="https://docs.google.com/forms/d/.../edit"
                value={importUrl}
                onChange={e => setImportUrl(e.target.value)}
                disabled={importBusy}
                required
              />

              {importError && (
                <div className="form-banner bad" role="alert" style={{ margin: 0 }}>
                  <p>{importError}</p>
                </div>
              )}

              <div className="forms-actions" style={{ justifyContent: 'flex-end', marginTop: 8 }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  disabled={importBusy}
                  onClick={() => setImportOpen(false)}
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="btn btn-accent btn-sm"
                  disabled={importBusy || !importUrl.trim()}
                >
                  {importBusy ? 'Importing…' : 'Import form →'}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
