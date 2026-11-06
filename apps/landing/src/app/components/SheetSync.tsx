import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicLibraryForm } from '../../lib/forms';
import { SHEETS_CAPABILITY } from '../../lib/connections';

/**
 * Keeping a form's responses in a spreadsheet.
 *
 * The screen exists to answer four questions in order, without ever showing a provider's insides:
 * what will this do, may Intake have the permission, is it happening now, and what do I do when it
 * is not. Everything the person sees comes from one server call — the browser is never asked to
 * reason about a schedule, a cursor or a Google error code.
 */

type SheetsState =
  | 'awaiting_authorization'
  | 'reconnect_required'
  | 'not_enabled'
  | 'disabled'
  | 'initial'
  | 'syncing'
  | 'up_to_date'
  | 'delayed'
  | 'failed'
  | 'permission_revoked'
  | 'destination_unavailable'
  | 'questions_changed';

interface SheetSyncView {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  sheetTitle: string;
  enabled: boolean;
  syncedCount: number;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  nextSyncAt: string | null;
}

interface SheetSyncBody {
  state: SheetsState;
  canSync: boolean;
  sync: SheetSyncView | null;
}

interface SheetSyncProps {
  form: PublicLibraryForm;
  onClose: () => void;
  isPro: boolean;
  /** Whether the spreadsheet permission is already allowed. null means the server has not said. */
  canSyncSheets: boolean | null;
  /** Whether the Google connection itself has to be made again first. */
  needsReconnect: boolean;
  /** Where this person lands after Google's screen. */
  returnTo: string;
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat().format(value);
}

/** A date and time a person can read, in their own timezone. */
function formatWhen(iso: string | null): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return null;
  return date.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
}

/**
 * Why a sync is not running, in words that name the next step rather than the exception.
 * Nothing here repeats a provider message or a stack trace: a person cannot act on either.
 */
function problemCopy(state: SheetsState): { title: string; body: string } | null {
  switch (state) {
    case 'delayed':
      return {
        title: 'Taking a short break',
        body: 'Google was busy or briefly unreachable, so Intake paused this sync. It tries again on its own — usually within a few minutes. Nothing was lost, and nothing was written twice.',
      };
    case 'permission_revoked':
      return {
        title: 'Google no longer lets Intake update the spreadsheet',
        body: 'The permission you gave Intake was removed, or it expired. Allow it again and syncing picks up exactly where it stopped. Answers that were already in the spreadsheet stay there.',
      };
    case 'destination_unavailable':
      return {
        title: 'The spreadsheet cannot be opened',
        body: 'It was deleted, or moved somewhere Intake cannot reach. Nothing can be written to it any more. You can start a new spreadsheet instead — Intake never deletes or moves files in your Drive.',
      };
    case 'questions_changed':
      return {
        title: 'The form’s questions changed',
        body: 'Answers that arrive now would land under column headings that describe different questions, so Intake stopped rather than mislabel them. Start a new spreadsheet to sync with the current set of questions.',
      };
    case 'failed':
      return {
        title: 'Syncing stopped',
        body: 'Something went wrong that Intake could not fix by trying again. Look at your Google connection, then start a new spreadsheet if the problem continues.',
      };
    default:
      return null;
  }
}

export function SheetSync({ form, onClose, isPro, canSyncSheets, needsReconnect, returnTo }: SheetSyncProps) {
  const [body, setBody] = useState<SheetSyncBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'create' | 'enable' | 'sync' | 'disable' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const mounted = useRef(true);

  const load = useCallback(async () => {
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/sheets`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (response.status === 401) {
        window.location.replace('/auth/sign-in?reason=session_expired');
        return;
      }
      if (!response.ok) {
        setError('Intake could not read the state of this sync. Try again.');
        setLoading(false);
        return;
      }
      const next = await response.json() as SheetSyncBody;
      if (!mounted.current) return;
      setBody(next);
      setError(null);
    } catch {
      if (mounted.current) setError('Network error. Try again.');
    } finally {
      if (mounted.current) setLoading(false);
    }
  }, [form.id]);

  /** One write action at a time, with the server's answer replacing what is on screen. */
  async function act(kind: 'create' | 'enable' | 'sync' | 'disable') {
    setBusy(kind);
    setError(null);
    try {
      const base = `/api/forms/${encodeURIComponent(form.id)}/sheets`;
      const path = kind === 'enable' || kind === 'sync' ? `${base}/${kind}` : base;
      const method = kind === 'disable' ? 'DELETE' : 'POST';
      const response = await fetch(path, { method, credentials: 'same-origin', headers: { accept: 'application/json' } });

      if (response.status === 401) {
        window.location.replace('/auth/sign-in?reason=session_expired');
        return;
      }
      const payload = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown; state?: SheetsState; sync?: SheetSyncView; canSync?: boolean };
      if (!response.ok) {
        // A "create" that collides with an existing sync just means it is already set up: show it.
        if (payload.code === 'already_enabled') { await load(); return; }
        if (payload.code === 'sheets_scope_required') { setError('Intake needs the spreadsheet permission before it can do that.'); return; }
        if (payload.code === 'reauthorization_required') { setError('Reconnect Google Forms first, then try again.'); return; }
        if (payload.code === 'pro_required') { setError('Spreadsheet syncing is part of Pro.'); return; }
        setError(typeof payload.error === 'string' ? payload.error : 'That did not work. Try again.');
        return;
      }
      if (!mounted.current) return;
      if (payload.state) {
        setBody({ state: payload.state, canSync: payload.canSync !== false, sync: payload.sync ?? null });
      } else {
        await load();
      }
    } catch {
      if (mounted.current) setError('Network error. Nothing was changed.');
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  useEffect(() => {
    mounted.current = true;
    void load();
    return () => { mounted.current = false; };
  }, [load]);

  // While a first or next sync is running the screen watches it, so a person who leaves the tab
  // open sees the count move instead of a spinner that never ends. This is a read, and it stops as
  // soon as the sync is not in progress.
  const watching = body?.state === 'initial' || body?.state === 'syncing';
  useEffect(() => {
    if (!watching) return;
    const timer = setInterval(() => { void load(); }, 5000);
    return () => clearInterval(timer);
  }, [watching, load]);

  if (!isPro) {
    return (
      <Modal title="Sync to a spreadsheet" onClose={onClose}>
        <div className="insights-pro-required">
          <h2>Sync to a spreadsheet</h2>
          <p>Keeping every response in a spreadsheet that updates itself is part of Pro.</p>
          <a href="/app/billing" className="btn btn-accent">View plans</a>
          <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
        </div>
      </Modal>
    );
  }

  const state = body?.state ?? (needsReconnect ? 'reconnect_required' : canSyncSheets === false ? 'awaiting_authorization' : 'not_enabled');
  const sync = body?.sync ?? null;
  const problem = problemCopy(state);
  const canCreate = body?.canSync ?? (canSyncSheets === true && !needsReconnect);
  const lastSync = formatWhen(sync?.lastSyncedAt ?? null);
  const nextTry = formatWhen(sync?.nextSyncAt ?? null);

  return (
    <Modal title="Sync to a spreadsheet" onClose={onClose}>
      <div className="insights-header">
        <h2 id="sheets-title">{form.title}</h2>
        <span className="insights-meta">{stateLabel(state, sync)}</span>
      </div>

      {loading && <div className="insights-loading" role="status"><span className="spin" /> Checking the spreadsheet…</div>}

      {!loading && (
        <>
          {error && <div className="form-banner bad" role="alert"><p>{error}</p></div>}

          {/* The permission explanation comes before the button, always. */}
          {(state === 'not_enabled' || state === 'awaiting_authorization') && (
            <section className="sheets-intro">
              <p>
                Intake can keep your answers in a Google Sheet it creates for this form. One row per
                response: the response’s ID, when it was submitted, the respondent’s email when the
                form collects it, then one column per question in the order the form asks them.
              </p>
              <p>
                To do that Google asks for one permission: letting Intake
                <strong> create and update spreadsheets it made itself</strong>. It cannot open,
                read or change any other file in your Drive, and it cannot see the rest of your
                sheets. The spreadsheet will be yours, in your Drive, and Intake keeps only a note
                that it belongs to this form.
              </p>
              <p className="provider-note">
                Syncing is not instant. Intake checks for new responses every minute while a form is
                active, and every few minutes while it is quiet, so a new answer usually appears
                within a minute or two. Your answers still live in Google Forms — Intake does not
                keep a copy of the answers themselves; it does record which response IDs it has
                written, so it never writes one twice.
              </p>
              {state === 'awaiting_authorization' || body?.canSync === false ? (
                <>
                  <GrantForm capability={SHEETS_CAPABILITY} returnTo={returnTo} label="Allow spreadsheet access" />
                  <div className="forms-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                    <a href="/app/connections" className="btn btn-ghost btn-sm">Manage connections</a>
                    <button className="btn btn-ghost btn-sm" onClick={onClose}>Not now</button>
                  </div>
                </>
              ) : null}
            </section>
          )}

          {state === 'reconnect_required' && (
            <section className="sheets-intro">
              <p>
                Intake cannot use your Google account right now, so it cannot create or update the
                spreadsheet. Connect again and Google will show the permissions it already knows
                about.
              </p>
              <GrantForm returnTo={returnTo} label="Connect Google Forms" connect />
              <div className="forms-actions" style={{ justifyContent: 'flex-start', marginTop: 12 }}>
                <a href="/app/connections" className="btn btn-ghost btn-sm">Manage connections</a>
                <button className="btn btn-ghost btn-sm" onClick={onClose}>Not now</button>
              </div>
            </section>
          )}

          {(state === 'initial' || state === 'syncing') && (
            <section className="sheets-progress">
              <div className="sheets-progress-line" role="status" aria-live="polite">
                <span className="spin" />
                <span>
                  {state === 'initial'
                    ? 'Writing the answers you already have…'
                    : `Adding answers… ${formatNumber(sync?.syncedCount ?? 0)} written so far.`}
                </span>
              </div>
              <p className="provider-note">
                This runs in the background, so you can close this window. A form with years of
                answers takes a few minutes; the spreadsheet fills up as it goes.
              </p>
            </section>
          )}

          {(state === 'up_to_date' || state === 'delayed') && sync && (
            <section className="sheets-status">
              <dl className="sheets-facts">
                <div>
                  <dt>Responses in the spreadsheet</dt>
                  <dd>{formatNumber(sync.syncedCount)}</dd>
                </div>
                <div>
                  <dt>Last synced</dt>
                  <dd>{lastSync ?? 'not yet'}</dd>
                </div>
                <div>
                  <dt>Next check</dt>
                  <dd>{nextTry ?? 'shortly'}</dd>
                </div>
              </dl>
              {sync.spreadsheetUrl && (
                <p>
                  <a className="btn btn-accent btn-sm" href={sync.spreadsheetUrl} target="_blank" rel="noopener noreferrer">
                    Open the spreadsheet
                  </a>
                </p>
              )}
            </section>
          )}

          {problem && (
            <section className="sheets-problem">
              <div className="form-banner bad" role="alert">
                <p><strong>{problem.title}</strong></p>
                <p>{problem.body}</p>
              </div>
              {state === 'permission_revoked' && (
                <GrantForm capability={SHEETS_CAPABILITY} returnTo={returnTo} label="Allow spreadsheet access again" />
              )}
              {state === 'destination_unavailable' && (
                <button className="btn btn-accent" onClick={() => void act('create')} disabled={busy !== null}>
                  {busy === 'create' ? <><span className="spin" /> Creating…</> : 'Start a new spreadsheet'}
                </button>
              )}
              {state === 'questions_changed' && (
                <button className="btn btn-accent" onClick={() => void act('create')} disabled={busy !== null}>
                  {busy === 'create' ? <><span className="spin" /> Creating…</> : 'Start a new spreadsheet'}
                </button>
              )}
              {state === 'failed' && (
                <div className="forms-actions" style={{ justifyContent: 'flex-start' }}>
                  <button className="btn btn-accent btn-sm" onClick={() => void act('sync')} disabled={busy !== null}>Try again now</button>
                  <a className="btn btn-ghost btn-sm" href="/app/connections">Check the connection</a>
                </div>
              )}
              {sync?.spreadsheetUrl && state !== 'questions_changed' && (
                <p className="provider-note">
                  <a href={sync.spreadsheetUrl} target="_blank" rel="noopener noreferrer">Open the spreadsheet</a> — it is still in your Drive, unchanged.
                </p>
              )}
            </section>
          )}

          {state === 'disabled' && sync && (
            <section className="sheets-status">
              <p>
                Syncing is switched off. The spreadsheet and everything already written to it are
                untouched — Intake is simply not adding to it.
              </p>
              <div className="forms-actions" style={{ justifyContent: 'flex-start' }}>
                <button className="btn btn-accent btn-sm" onClick={() => void act('enable')} disabled={busy !== null || !canCreate}>
                  {busy === 'enable' ? <><span className="spin" /> Resuming…</> : 'Resume syncing'}
                </button>
                {sync.spreadsheetUrl && (
                  <a className="btn btn-ghost btn-sm" href={sync.spreadsheetUrl} target="_blank" rel="noopener noreferrer">Open the spreadsheet</a>
                )}
              </div>
            </section>
          )}

          {/* The standing controls: only while a sync is live and healthy. */}
          {sync && sync.enabled && (state === 'up_to_date' || state === 'delayed' || state === 'failed') && (
            <div className="forms-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
              <button className="btn btn-ghost btn-sm" onClick={() => void act('sync')} disabled={busy !== null}>
                {busy === 'sync' ? <><span className="spin" /> Asking…</> : 'Check for new responses now'}
              </button>
              <button className="btn btn-ghost btn-sm" onClick={() => void act('disable')} disabled={busy !== null}>
                {busy === 'disable' ? 'Stopping…' : 'Stop syncing'}
              </button>
            </div>
          )}

          {state === 'not_enabled' && body?.canSync === true && (
            <div className="forms-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
              <button className="btn btn-accent" onClick={() => void act('create')} disabled={busy !== null}>
                {busy === 'create' ? <><span className="spin" /> Creating the spreadsheet…</> : 'Create the spreadsheet'}
              </button>
            </div>
          )}

          <p className="provider-note sheets-footnote">
            Stopping a sync never deletes the spreadsheet — it is your file. Removing Intake’s
            permission in your Google account stops it too, and Intake will say so here rather than
            failing quietly.
          </p>
        </>
      )}

      <div className="insights-footer">
        <button className="btn btn-ghost" onClick={onClose}>Close</button>
      </div>
    </Modal>
  );
}

function Modal({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  return (
    <div className="insights-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="sheets-title">
      <div className="insights-modal" onClick={event => event.stopPropagation()}>
        <button className="insights-modal-close" onClick={onClose} aria-label={`Close ${title}`}>✕</button>
        {children}
      </div>
    </div>
  );
}

/** The one-line answer to "what is it doing right now". */
function stateLabel(state: SheetsState, sync: SheetSyncView | null): string {
  switch (state) {
    case 'awaiting_authorization': return 'Permission needed';
    case 'reconnect_required': return 'Google disconnected';
    case 'not_enabled': return 'Not set up';
    case 'disabled': return 'Switched off';
    case 'initial': return 'First sync running';
    case 'syncing': return `Syncing — ${formatNumber(sync?.syncedCount ?? 0)} written`;
    case 'up_to_date': return 'Up to date';
    case 'delayed': return 'Retrying shortly';
    case 'permission_revoked': return 'Permission removed';
    case 'destination_unavailable': return 'Spreadsheet unavailable';
    case 'questions_changed': return 'Questions changed';
    case 'failed': return 'Stopped';
  }
}

/**
 * The one action that starts an authorization. A plain form post: the browser has to navigate to
 * Google's screen, and a fetch would download it instead of showing it.
 */
function GrantForm({ capability, returnTo, label, connect = false }: { capability?: string; returnTo: string; label: string; connect?: boolean }) {
  const action = connect
    ? `/api/providers/google/connect?return_to=${encodeURIComponent(returnTo)}`
    : `/api/providers/google/extend?capability=${encodeURIComponent(capability ?? SHEETS_CAPABILITY)}&return_to=${encodeURIComponent(returnTo)}`;
  return (
    <form method="POST" action={action}>
      <button className="btn btn-accent" type="submit">{label}</button>
    </form>
  );
}
