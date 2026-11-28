import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import type { PublicLibraryForm } from '../../lib/forms';
import { SHEETS_CAPABILITY } from '../../lib/connections';
import { openSpreadsheetPicker, type PickerToken } from '../../lib/picker';

/**
 * Keeping a form's responses in a spreadsheet.
 *
 * The screen answers four questions in order, without ever showing a provider's insides: what will
 * this do, may Intake have the permission, is it happening now, and what do I do when it is not.
 * Everything a person sees comes from one server call — the browser is never asked to reason about
 * a schedule, a cursor or a Google error code.
 *
 * There are two ways to choose a destination, and they are deliberately not one button: a file
 * Intake makes (it may initialise that, because it made it), or a file the person already has (it
 * may only append to one worksheet of that, and only after saying what will happen).
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
  | 'worksheet_missing'
  | 'worksheet_unsuitable'
  | 'questions_changed';

interface WorksheetSummary {
  sheetId: number;
  title: string;
  rowCount: number;
  columnCount: number;
}

interface WorksheetAssessment {
  verdict: 'empty' | 'compatible' | 'unsuitable';
  reason: string | null;
  existingRows: number;
  existingIds: number;
}

interface SheetSyncView {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  spreadsheetTitle: string | null;
  destination: 'created' | 'selected';
  sheetId: number;
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
  canPick: boolean;
  pickerProblem: string | null;
  sync: SheetSyncView | null;
}

/** What the server said about a spreadsheet somebody picked, and about one worksheet in it. */
interface Inspection {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string | null;
  worksheets: WorksheetSummary[];
  worksheet: WorksheetSummary | null;
  assessment: WorksheetAssessment | null;
  header: string[];
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
        body: 'It was deleted, or moved somewhere Intake cannot reach. Nothing can be written to it any more. You can start a new spreadsheet instead, or choose another existing one — Intake never deletes or moves files in your Drive.',
      };
    case 'worksheet_missing':
      return {
        title: 'The worksheet is gone',
        body: 'This tab was deleted or renamed in a way that replaced it, so there is nowhere to write. Everything already in the spreadsheet is untouched. Choose a worksheet to sync into, or connect a different spreadsheet.',
      };
    case 'worksheet_unsuitable':
      return {
        title: 'That worksheet no longer looks like Intake’s table',
        body: 'Its header row has changed, and Intake will not write over somebody’s columns. Choose another worksheet, or connect a different spreadsheet.',
      };
    case 'questions_changed':
      return {
        title: 'The form’s questions changed',
        body: 'Answers that arrive now would land under column headings that describe different questions, so Intake stopped rather than mislabel them. Start a new spreadsheet, or choose a worksheet with the current set of questions.',
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

/** What the assessment means, in the sentence shown before somebody confirms. */
function assessmentCopy(assessment: WorksheetAssessment | null, replacing: boolean): string {
  if (!assessment) return 'Intake will check this worksheet before anything is written to it.';
  if (assessment.verdict === 'empty') {
    return replacing
      ? 'This worksheet is empty. Intake will write its header row and start filling it from the beginning — every response to this form, in order.'
      : 'This worksheet is empty. Intake will write its header row and add every response to this form, starting with the ones you already have.';
  }
  if (assessment.verdict === 'compatible') {
    const already = assessment.existingIds > 0
      ? ` ${formatNumber(assessment.existingIds)} response${assessment.existingIds === 1 ? '' : 's'} are already in it; Intake will skip those and add only what is missing.`
      : '';
    return `This worksheet already holds this form’s table, so it will be used as it is.${already}`;
  }
  return assessment.reason ?? 'This worksheet already contains other data, so Intake cannot use it.';
}

export function SheetSync({ form, onClose, isPro, canSyncSheets, needsReconnect, returnTo }: SheetSyncProps) {
  const [body, setBody] = useState<SheetSyncBody | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<'create' | 'enable' | 'sync' | 'disable' | 'connect' | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Choosing an existing spreadsheet is its own small flow: pick a file, pick a worksheet, confirm.
  const [chooserOpen, setChooserOpen] = useState(false);
  const [picking, setPicking] = useState(false);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [inspecting, setInspecting] = useState(false);
  const [pickerNote, setPickerNote] = useState<string | null>(null);
  const [replacing, setReplacing] = useState(false);
  const [acknowledged, setAcknowledged] = useState(false);

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
      const payload = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown; state?: SheetsState; sync?: SheetSyncView; canSync?: boolean; canPick?: boolean; pickerProblem?: string | null };
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
        setBody({
          state: payload.state,
          canSync: payload.canSync !== false,
          canPick: payload.canPick === true,
          pickerProblem: payload.pickerProblem ?? null,
          sync: payload.sync ?? null,
        });
      } else {
        await load();
      }
    } catch {
      if (mounted.current) setError('Network error. Nothing was changed.');
    } finally {
      if (mounted.current) setBusy(null);
    }
  }

  /** Read a picked spreadsheet, and optionally one worksheet inside it, before committing to it. */
  async function inspect(spreadsheetId: string, sheetId?: number) {
    setInspecting(true);
    setPickerNote(null);
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/sheets/inspect`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(sheetId === undefined ? { spreadsheetId } : { spreadsheetId, sheetId }),
      });
      if (response.status === 401) {
        window.location.replace('/auth/sign-in?reason=session_expired');
        return;
      }
      const payload = await response.json().catch(() => ({})) as Partial<Inspection> & { error?: unknown; code?: unknown };
      if (!response.ok) {
        // The picked file cannot be used: say why, and let them pick again without losing the panel.
        setPickerNote(typeof payload.error === 'string' ? payload.error : 'Intake could not read that spreadsheet.');
        if (!inspection) setInspection(null);
        return;
      }
      if (!mounted.current) return;
      setInspection(payload as Inspection);
    } catch {
      if (mounted.current) setPickerNote('Network error while reading that spreadsheet. Try again.');
    } finally {
      if (mounted.current) setInspecting(false);
    }
  }

  /** Open Google's chooser, then inspect whatever comes back. */
  async function pickExisting(isReplace: boolean) {
    setChooserOpen(true);
    setPicking(true);
    setPickerNote(null);
    setAcknowledged(false);
    setReplacing(isReplace);
    setInspection(null);
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/sheets/picker`, {
        credentials: 'same-origin',
        cache: 'no-store',
        headers: { accept: 'application/json' },
      });
      if (response.status === 401) {
        window.location.replace('/auth/sign-in?reason=session_expired');
        return;
      }
      if (!response.ok) {
        const payload = await response.json().catch(() => ({})) as { error?: unknown };
        setPickerNote(typeof payload.error === 'string' ? payload.error : 'Google’s file chooser is not available right now.');
        setPicking(false);
        return;
      }
      const token = await response.json() as PickerToken;
      if (!mounted.current) return;

      // Google's dialog is asynchronous and can be dismissed; the screen waits for one decision.
      const outcome = await openSpreadsheetPicker(token);
      if (!mounted.current) return;
      if (outcome.kind === 'cancelled') { setPicking(false); return; }
      if (outcome.kind === 'failed') { setPickerNote(outcome.message); setPicking(false); return; }

      await inspect(outcome.spreadsheetId);
    } catch {
      if (mounted.current) setPickerNote('Network error. Nothing was changed.');
    } finally {
      if (mounted.current) setPicking(false);
    }
  }

  /** Commit the selected destination. The server inspects it again in the request that writes. */
  async function connect(replace: boolean) {
    if (!inspection?.worksheet) return;
    setBusy('connect');
    setError(null);
    try {
      const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/sheets/connect`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify({
          spreadsheetId: inspection.spreadsheetId,
          sheetId: inspection.worksheet.sheetId,
          ...(replace ? { replace: true } : {}),
        }),
      });
      if (response.status === 401) {
        window.location.replace('/auth/sign-in?reason=session_expired');
        return;
      }
      const payload = await response.json().catch(() => ({})) as { error?: unknown; code?: unknown; state?: SheetsState; sync?: SheetSyncView; canSync?: boolean; canPick?: boolean; pickerProblem?: string | null };
      if (!response.ok) {
        if (payload.code === 'worksheet_unsuitable') {
          // The server looked again and disagreed with what the screen showed. Say so, keep the flow.
          setPickerNote(typeof payload.error === 'string' ? payload.error : 'That worksheet cannot be used.');
          await inspect(inspection.spreadsheetId, inspection.worksheet.sheetId);
          return;
        }
        if (payload.code === 'already_enabled') { await load(); setInspection(null); return; }
        if (payload.code === 'destination_change_unconfirmed') {
          setError('Confirm the change before switching this form to another spreadsheet.');
          return;
        }
        setError(typeof payload.error === 'string' ? payload.error : 'That did not work. Try again.');
        return;
      }
      if (!mounted.current) return;
      setInspection(null);
      setAcknowledged(false);
      setChooserOpen(false);
      if (payload.state) {
        setBody({
          state: payload.state,
          canSync: payload.canSync !== false,
          canPick: payload.canPick === true,
          pickerProblem: payload.pickerProblem ?? null,
          sync: payload.sync ?? null,
        });
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
                Intake can keep your answers in a Google Sheet. One row per response: the response’s
                ID, when it was submitted, the respondent’s email when the form collects it, then one
                column per question in the order the form asks them.
              </p>
              <p>
                You can let Intake <strong>create a spreadsheet for you</strong>, or
                <strong> connect one you already have</strong> and it will add the rows to a worksheet
                you choose.
              </p>
              <p>
                To do either, Google asks for one permission: letting Intake
                <strong> create and update spreadsheets it made itself</strong>. It cannot open,
                read or change any other file in your Drive, and it cannot see the rest of your
                sheets. Choosing an existing spreadsheet works through Google’s own file chooser —
                the file you pick is the only one Intake is then allowed to touch.
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
              {sync && <DestinationSummary sync={sync} />}
              <p className="provider-note">
                This runs in the background, so you can close this window. A form with years of
                answers takes a few minutes; the spreadsheet fills up as it goes.
              </p>
              {sync?.spreadsheetUrl && (
                <p className="provider-note">
                  <a href={sync.spreadsheetUrl} target="_blank" rel="noopener noreferrer">Open the spreadsheet</a>
                </p>
              )}
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
              <DestinationSummary sync={sync} />
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
              {(state === 'destination_unavailable' || state === 'questions_changed') && (
                <div className="forms-actions" style={{ justifyContent: 'flex-start' }}>
                  <button className="btn btn-accent" onClick={() => void act('create')} disabled={busy !== null}>
                    {busy === 'create' ? <><span className="spin" /> Creating…</> : 'Start a new spreadsheet'}
                  </button>
                  {body?.canPick && (
                    <button className="btn btn-ghost btn-sm" onClick={() => void pickExisting(true)}>
                      Choose an existing spreadsheet
                    </button>
                  )}
                </div>
              )}
              {(state === 'worksheet_missing' || state === 'worksheet_unsuitable') && (
                <div className="forms-actions" style={{ justifyContent: 'flex-start' }}>
                  <button className="btn btn-accent btn-sm" onClick={() => void pickExisting(true)} disabled={!body?.canPick}>
                    Choose a worksheet to sync into
                  </button>
                  {!body?.canPick && <span className="provider-note">{body?.pickerProblem ?? 'Choosing an existing spreadsheet is not set up on this server.'}</span>}
                </div>
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
              <DestinationSummary sync={sync} />
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
              {body?.canPick && !replacing && (
                <button className="btn btn-ghost btn-sm" onClick={() => void pickExisting(true)} disabled={busy !== null}>
                  Change destination
                </button>
              )}
            </div>
          )}

          {state === 'not_enabled' && body?.canSync === true && !chooserOpen && (
            <div className="forms-actions" style={{ justifyContent: 'flex-start', marginTop: 16 }}>
              <button className="btn btn-accent" onClick={() => void act('create')} disabled={busy !== null}>
                {busy === 'create' ? <><span className="spin" /> Creating the spreadsheet…</> : 'Create the spreadsheet'}
              </button>
              <button className="btn btn-ghost" onClick={() => void pickExisting(false)} disabled={busy !== null || !body?.canPick}>
                Connect an existing spreadsheet
              </button>
            </div>
          )}

          {state === 'not_enabled' && body?.canPick === false && body.pickerProblem && (
            <p className="provider-note">{body.pickerProblem}</p>
          )}

          {/* Choosing an existing spreadsheet: file, then worksheet, then an explicit yes. */}
          {chooserOpen && (
            <ExistingSpreadsheetFlow
              inspection={inspection}
              inspecting={inspecting}
              picking={picking}
              note={pickerNote}
              replacing={replacing && !!sync}
              liveSyncEnabled={!!sync?.enabled}
              acknowledged={acknowledged}
              busy={busy === 'connect'}
              onAcknowledge={setAcknowledged}
              onChooseFile={() => void pickExisting(replacing)}
              onChooseWorksheet={sheetId => inspection && void inspect(inspection.spreadsheetId, sheetId)}
              onCancel={() => {
                setInspection(null); setReplacing(false); setPickerNote(null);
                setAcknowledged(false); setChooserOpen(false);
              }}
              onConnect={() => void connect(replacing && !!sync)}
            />
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

/** Which file, and which tab, the rows are going into. */
function DestinationSummary({ sync }: { sync: SheetSyncView }) {
  const title = sync.spreadsheetTitle ?? 'This spreadsheet';
  return (
    <p className="sheets-destination" data-destination={sync.destination}>
      <span className="sheets-destination-kind">
        {sync.destination === 'selected' ? 'SPREADSHEET YOU CHOSE' : 'SPREADSHEET INTAKE CREATED'}
      </span>
      <span className="sheets-destination-name">
        {title} <span className="sheets-destination-tab">· tab “{sync.sheetTitle}”</span>
      </span>
    </p>
  );
}

interface ExistingSpreadsheetFlowProps {
  inspection: Inspection | null;
  inspecting: boolean;
  picking: boolean;
  note: string | null;
  replacing: boolean;
  liveSyncEnabled: boolean;
  acknowledged: boolean;
  busy: boolean;
  onAcknowledge: (value: boolean) => void;
  onChooseFile: () => void;
  onChooseWorksheet: (sheetId: number) => void;
  onCancel: () => void;
  onConnect: () => void;
}

/**
 * The second destination path, as its own small dialog section.
 *
 * Nothing here can write to a file without the server agreeing: the worksheet list comes from a
 * metadata read the server performed, the verdict comes from the server's own inspection, and the
 * connect request is inspected again before a single cell is touched.
 */
function ExistingSpreadsheetFlow(props: ExistingSpreadsheetFlowProps) {
  const { inspection, inspecting, picking, note, replacing, liveSyncEnabled, acknowledged, busy } = props;
  const chosen = inspection?.worksheet ?? null;
  const assessment = inspection?.assessment ?? null;
  const unsuitable = assessment?.verdict === 'unsuitable';
  const canConfirm = !!chosen && !!assessment && !unsuitable && (!liveSyncEnabled || acknowledged) && !busy;

  return (
    <section className="sheets-chooser" aria-labelledby="sheets-chooser-title">
      <h3 id="sheets-chooser-title">
        {replacing ? 'Choose a different destination' : 'Connect an existing spreadsheet'}
      </h3>

      {note && <div className="form-banner bad" role="alert"><p>{note}</p></div>}

      {picking && (
        <p className="sheets-chooser-status" role="status"><span className="spin" /> Waiting for Google’s file chooser…</p>
      )}

      {!picking && !inspection && (
        <p className="sheets-chooser-status">
          Google will open its own file chooser. Only spreadsheets can be picked, and the one you
          choose is the only file Intake can then add rows to.
        </p>
      )}

      {inspection && (
        <>
          <p className="sheets-chooser-file">
            <strong>{inspection.title || 'Untitled spreadsheet'}</strong>
            {inspection.spreadsheetUrl && (
              <a href={inspection.spreadsheetUrl} target="_blank" rel="noopener noreferrer">Open ↗</a>
            )}
          </p>

          <fieldset className="sheets-chooser-sheets">
            <legend>Which worksheet should the answers go into?</legend>
            {inspection.worksheets.map(sheet => (
              <label key={sheet.sheetId} className={`sheets-sheet-option${chosen?.sheetId === sheet.sheetId ? ' chosen' : ''}`}>
                <input
                  type="radio"
                  name={`sheet-${inspection.spreadsheetId}`}
                  checked={chosen?.sheetId === sheet.sheetId}
                  onChange={() => props.onChooseWorksheet(sheet.sheetId)}
                />
                <span className="sheets-sheet-name">{sheet.title}</span>
                <span className="sheets-sheet-meta">{sheet.rowCount > 0 ? `${formatNumber(sheet.rowCount)} rows` : 'empty grid'}</span>
              </label>
            ))}
          </fieldset>

          {inspecting && (
            <p className="sheets-chooser-status" role="status"><span className="spin" /> Checking what is in that worksheet…</p>
          )}

          {!inspecting && chosen && assessment && (
            <div className={`sheets-verdict ${assessment.verdict}`} role="status">
              <p>{assessmentCopy(assessment, replacing)}</p>
              {assessment.verdict !== 'unsuitable' && (
                <p className="provider-note">
                  Columns Intake will use: {inspection.header.map(title => `“${title}”`).join(', ')}.
                </p>
              )}
            </div>
          )}

          {!inspecting && !chosen && (
            <p className="provider-note">Pick a worksheet to see whether Intake can use it.</p>
          )}

          {liveSyncEnabled && !unsuitable && (
            <label className="sheets-acknowledge">
              <input type="checkbox" checked={acknowledged} onChange={event => props.onAcknowledge(event.target.checked)} />
              <span>
                I understand this form will stop adding to its current spreadsheet. Nothing in that
                file is deleted or changed — it keeps every row it already has — and this new
                destination starts from the beginning.
              </span>
            </label>
          )}
        </>
      )}

      <div className="forms-actions" style={{ justifyContent: 'flex-start' }}>
        <button className="btn btn-ghost btn-sm" onClick={props.onChooseFile} disabled={picking || busy}>
          {inspection ? 'Choose a different file' : 'Open Google’s file chooser'}
        </button>
        {inspection && (
          <button className="btn btn-accent btn-sm" onClick={props.onConnect} disabled={!canConfirm}>
            {busy ? <><span className="spin" /> Connecting…</> : (replacing ? 'Switch to this worksheet' : 'Connect this worksheet')}
          </button>
        )}
        <button className="btn btn-ghost btn-sm" onClick={props.onCancel} disabled={busy}>Cancel</button>
      </div>
    </section>
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
    case 'worksheet_missing': return 'Worksheet missing';
    case 'worksheet_unsuitable': return 'Worksheet changed';
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
