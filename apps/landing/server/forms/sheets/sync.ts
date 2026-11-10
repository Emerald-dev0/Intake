/**
 * Keeping a form's answers in a spreadsheet, without ever writing one twice.
 *
 * ## The problem
 *
 * Google has no transaction that spans "append these rows" and "record that we appended them".
 * Any of these can happen:
 *
 *   - the append lands and the process dies before the bookkeeping;
 *   - the append lands and the bookkeeping query fails;
 *   - the append request times out and we genuinely do not know whether it landed;
 *   - two workers pick up the same form at the same time.
 *
 * A retry after any of those, if it trusted its own database, would write the same answers twice.
 *
 * ## The answer
 *
 * The spreadsheet is the ledger, not the database. Every run begins by reading the destination's
 * own Response ID column, and anything already there is skipped — regardless of what the database
 * believes. So the failure window closes without a distributed transaction:
 *
 *   1. read the ids in the sheet            (source of truth for "what has been written")
 *   2. fetch new responses from the form    (cursor is an inclusive lower bound)
 *   3. drop every response whose id is in (1)
 *   4. append the rest, in bounded chunks, with RAW input
 *   5. record the ids and advance the cursor — bookkeeping that only makes step (1) cheaper
 *
 * If step 4 succeeds and step 5 does not, the next run's step 1 sees the rows and skips them. If
 * step 4 fails in a way that leaves the outcome unknown, the cursor is *not* advanced and nothing
 * is recorded, so the next run reconciles against the sheet again. That is why an append is never
 * retried inside a run: a blind second attempt is exactly how duplicates are made.
 *
 * ## The cursor
 *
 * `cursor_last_submitted` is the newest `lastSubmittedTime` that has been fully dealt with. It is
 * used as an *inclusive* lower bound (`timestamp >= …`), because two responses can share an
 * instant and an exclusive bound would drop the second one. Re-reading the boundary row costs one
 * row and step (3) makes it free.
 *
 * ## Concurrency
 *
 * A run holds a lease and a `run_id`. Every write it makes is fenced on that id, so a worker whose
 * lease expired cannot finish over a newer run's result. One form, one run, at a time.
 */

import type { PublicLibraryForm } from '../../../src/lib/forms';
import { hasScope } from '../../providers/oauth';
import { SHEETS_SCOPE, type AuthorizedConnection } from '../../providers/service';
import type { GoogleFormItemResource, GoogleFormResponse, GoogleFormsClient } from '../providers/google/client';
import { GoogleFormsApiError } from '../providers/google/client';
import { withRetry } from '../providers/google/retry';
import { METADATA_HEADERS, responseCells, type ExportQuestion } from '../insights/export';
import { GoogleSheetsApiError, type GoogleSheetsClient } from './client';
import { StaleSyncRunError, type SheetSyncErrorCode, type SheetSyncRecord, type SheetsSyncStore } from './store';

/** How many responses one run will write before handing back to the scheduler. */
export const MAX_ROWS_PER_RUN = 2_000;
/** How many responses one Google Forms page asks for. */
export const DEFAULT_PAGE_SIZE = 500;
/** Rows per append call. Large enough to be efficient, small enough to stay well inside quotas. */
export const ROWS_PER_APPEND = 400;
/** A quiet form is checked every five minutes; a form that just produced rows is checked again in one. */
export const IDLE_INTERVAL_MS = 5 * 60 * 1000;
export const ACTIVE_INTERVAL_MS = 60 * 1000;
/** Ceiling for retrying a temporary failure, so a broken feed does not hammer Google. */
export const MAX_RETRY_DELAY_MS = 30 * 60 * 1000;

export type SyncableForm = Pick<PublicLibraryForm, 'id' | 'title' | 'provider' | 'status' | 'providerFormId'>;

export interface SheetsSyncDeps {
  syncs: SheetsSyncStore;
  google: GoogleFormsClient;
  sheets: GoogleSheetsClient;
  getConnection: (userId: string) => Promise<AuthorizedConnection>;
  getForm: (userId: string, formId: string) => Promise<{ ok: true; form: SyncableForm } | { ok: false }>;
  now?: () => Date;
  /** A label only. Response text, emails and tokens never reach a log line. */
  onError?: (label: string) => void;
  maxRowsPerRun?: number;
  pageSize?: number;
  rowsPerAppend?: number;
  sleep?: (ms: number) => Promise<void>;
}

export type SyncOutcome = 'up_to_date' | 'more' | 'deferred' | 'failed';

export interface SyncResult {
  outcome: SyncOutcome;
  written: number;
  /** Total rows this sync has written over its lifetime, as the database counts them. */
  syncedCount: number;
  errorCode: SheetSyncErrorCode | null;
}

function isQuestion(item: unknown): item is GoogleFormItemResource & { questionId: string; title: string } {
  return !!item && typeof item === 'object' && 'kind' in item && (item as GoogleFormItemResource).kind === 'question'
    && typeof (item as GoogleFormItemResource).questionId === 'string'
    && typeof (item as GoogleFormItemResource).title === 'string';
}

function questionsOf(items: readonly GoogleFormItemResource[] | undefined): ExportQuestion[] {
  return (items ?? []).filter(isQuestion).map(item => ({ id: item.questionId, title: item.title }));
}

/** The header row a sheet is created with, and the one it is checked against afterwards. */
export function headerFor(questions: readonly ExportQuestion[]): string[] {
  return [...METADATA_HEADERS, ...questions.map(question => question.title)];
}

/**
 * What the header describes, as one comparable string.
 *
 * Ids as well as titles: renaming a question changes what the column means, and reordering them
 * changes which column is which. Both deserve a deliberate restart rather than a silent shift.
 */
export function headerSignature(questions: readonly ExportQuestion[]): string {
  return JSON.stringify(questions.map(question => [question.id, question.title]));
}

function submittedAt(response: GoogleFormResponse): Date | null {
  const value = response.lastSubmittedTime ?? response.createTime;
  if (!value) return null;
  const parsed = Date.parse(value);
  return Number.isFinite(parsed) ? new Date(parsed) : null;
}

function laterOf(current: Date | null, candidate: Date | null): Date | null {
  if (!candidate) return current;
  if (!current) return candidate;
  return candidate.getTime() > current.getTime() ? candidate : current;
}

/** A temporary failure gets a growing delay, capped. A form is never dropped for being slow. */
export function retryDelayMs(attempt: number): number {
  const step = Math.min(MAX_RETRY_DELAY_MS, 30_000 * 2 ** Math.max(0, Math.min(10, attempt - 1)));
  // Jitter, so a Google outage does not bring every form back at the same second.
  return step + Math.floor(Math.random() * 5_000);
}

/**
 * What a Google failure means for the schedule.
 *
 * A refusal is permanent until somebody reconnects, so it is not retried in a loop; everything else
 * is temporary and gets a delay. `malformed_response` is treated as temporary because the answer we
 * got was not the one the API documents — usually a transient gateway page.
 */
export function classifyFailure(error: unknown): { code: SheetSyncErrorCode; permanent: boolean } {
  if (error instanceof GoogleSheetsApiError) {
    const { httpStatus } = error.info;
    if (httpStatus === 401 || httpStatus === 403) return { code: 'permission_revoked', permanent: true };
    if (httpStatus === 404) return { code: 'destination_unavailable', permanent: true };
    // A deleted tab answers 400 with a range it cannot parse; so does a spreadsheet that is gone.
    if (httpStatus === 400) return { code: 'destination_unavailable', permanent: true };
    if (httpStatus === 429) return { code: 'rate_limited', permanent: false };
    return { code: 'sheets_unavailable', permanent: false };
  }
  if (error instanceof GoogleFormsApiError) {
    const { httpStatus } = error.info;
    if (httpStatus === 401 || httpStatus === 403) return { code: 'permission_revoked', permanent: true };
    if (httpStatus === 404) return { code: 'form_unavailable', permanent: true };
    return { code: 'forms_unavailable', permanent: false };
  }
  return { code: 'internal_error', permanent: false };
}

/**
 * Run one sync to completion, or to the point where it safely stops.
 *
 * `runId` comes from the claim that took the lease. Every write is fenced on it.
 */
export async function runSync(sync: SheetSyncRecord, runId: string, deps: SheetsSyncDeps): Promise<SyncResult> {
  const now = deps.now ?? (() => new Date());
  const maxRows = deps.maxRowsPerRun ?? MAX_ROWS_PER_RUN;
  const pageSize = deps.pageSize ?? DEFAULT_PAGE_SIZE;
  const rowsPerAppend = deps.rowsPerAppend ?? ROWS_PER_APPEND;
  const attempts = sync.attempt;

  /** Everything that stops a run early goes through here, so one shape describes every stop. */
  async function stop(input: { code: SheetSyncErrorCode; permanent: boolean }): Promise<SyncResult> {
    const retryAt = input.permanent
      ? new Date(now().getTime() + 24 * 60 * 60 * 1000)
      : new Date(now().getTime() + retryDelayMs(attempts));
    try {
      await deps.syncs.fail(sync.id, runId, {
        status: input.permanent ? 'failed' : 'delayed',
        code: input.code,
        retryAt,
      });
    } catch (error) {
      if (!(error instanceof StaleSyncRunError)) deps.onError?.('Sheet sync failure could not be recorded');
    }
    return { outcome: input.permanent ? 'failed' : 'deferred', written: 0, syncedCount: sync.syncedCount, errorCode: input.code };
  }

  // 1. The grant has to still cover the spreadsheet, and it has to still be usable.
  const connection = await deps.getConnection(sync.userId).catch(() => null);
  if (!connection || connection.ok !== true || !hasScope(connection.scopes, SHEETS_SCOPE)) {
    return stop({ code: 'permission_revoked', permanent: true });
  }
  const token = connection.accessToken;

  // 2. The form has to still belong to this person and still be a finished Google form.
  const found = await deps.getForm(sync.userId, sync.formId).catch(() => null);
  if (!found || !found.ok || found.form.provider !== 'google' || found.form.status !== 'created' || !found.form.providerFormId) {
    return stop({ code: 'form_unavailable', permanent: true });
  }
  const form = found.form;
  const formId = form.providerFormId;

  const read = <T>(operation: () => Promise<T>) => withRetry(operation, deps.sleep ? { sleep: deps.sleep } : {});

  let resource: Awaited<ReturnType<GoogleFormsClient['getForm']>>;
  let metadata: Awaited<ReturnType<GoogleSheetsClient['getSpreadsheet']>>;
  try {
    // Reads are safe to retry: they cannot write anything.
    [resource, metadata] = await Promise.all([
      read(() => deps.google.getForm(token, formId)),
      read(() => deps.sheets.getSpreadsheet(token, sync.spreadsheetId)),
    ]);
  } catch (error) {
    return stop(classifyFailure(error));
  }

  // The worksheet is found by its numeric id, so renaming a tab changes nothing. A tab that has
  // been deleted is its own answer: the file is fine, and the fix is to pick another worksheet.
  const sheet = metadata.sheets.find(candidate => candidate.sheetId === sync.sheetId);
  if (!sheet) return stop({ code: 'worksheet_missing', permanent: true });
  const sheetTitle = sheet.title;

  // The file and the tab may have been renamed since they were chosen. Nothing depends on the
  // names — the worksheet is found by id — but the panel shows them, so they follow the truth.
  if (sheetTitle !== sync.sheetTitle || metadata.title !== sync.spreadsheetTitle) {
    await deps.syncs.retitle(sync.id, { sheetTitle, spreadsheetTitle: metadata.title }).catch(() => {});
  }

  const questions = questionsOf(resource.items);
  const signature = headerSignature(questions);
  const expectedHeader = headerFor(questions);

  let state: Awaited<ReturnType<GoogleSheetsClient['readSheetState']>>;
  try {
    state = await read(() => deps.sheets.readSheetState(token, sync.spreadsheetId, sheetTitle));
  } catch (error) {
    return stop(classifyFailure(error));
  }

  const alreadyInSheet = new Set(state.responseIds);
  const sameRow = (a: string[], b: string[]) => a.length === b.length && a.every((cell, index) => b[index] === cell);
  const headerMatches = sameRow(state.header, expectedHeader);
  /** The header row this form last wrote. Distinguishes "the questions changed" from "somebody
   *  replaced the columns", which need different words and different fixes. */
  const previousHeader = (() => {
    try {
      const items = JSON.parse(sync.headerSignature ?? '[]');
      return Array.isArray(items) && items.every(item => item && typeof item.id === 'string' && typeof item.title === 'string')
        ? headerFor(items as Array<{ id: string; title: string }>)
        : null;
    } catch {
      return null;
    }
  })();

  // 3. A sheet whose header no longer describes this form cannot receive more rows. With no data in
  // it, the header is simply written again; with data, the columns would silently mislabel answers,
  // so the sync stops and says why.
  let wroteHeader = false;
  if (!headerMatches) {
    // A blank worksheet is the state Connect leaves a fresh destination in until its header is
    // written; writing it here is the same initialisation, not an overwrite.
    const blank = alreadyInSheet.size === 0 && state.header.every(cell => cell.trim() === '');
    if (sync.destination === 'selected' && !blank) {
      // A worksheet Intake did not create is somebody's own table. If it still holds the header this
      // form wrote, the questions changed; anything else means the columns were replaced, and
      // neither is a reason to write over them.
      const stillOurs = previousHeader !== null && sameRow(state.header, previousHeader);
      return stop({ code: stillOurs ? 'questions_changed' : 'worksheet_unsuitable', permanent: true });
    }
    if (alreadyInSheet.size > 0) return stop({ code: 'questions_changed', permanent: true });
    try {
      await deps.sheets.writeHeader(token, sync.spreadsheetId, sheetTitle, expectedHeader);
      wroteHeader = true;
    } catch (error) {
      return stop(classifyFailure(error));
    }
  }

  // 4. Read the form's responses from the cursor forward, inclusive of the cursor instant.
  const since = sync.cursorLastSubmitted ? sync.cursorLastSubmitted.toISOString() : undefined;
  const present = new Set(alreadyInSheet);
  const pending: GoogleFormResponse[] = [];
  /** Ids the sheet already had: already written, even if this database did not know it yet. */
  const reconciled: string[] = [];
  let considered: Date | null = null;
  let pageToken: string | undefined;
  let more = false;

  for (let page = 0; page < 20; page += 1) {
    let batch: Awaited<ReturnType<GoogleFormsClient['listResponses']>>;
    try {
      // eslint-disable-next-line no-await-in-loop
      batch = await read(() => deps.google.listResponses(token, formId, { pageSize, pageToken, since }));
    } catch (error) {
      return stop(classifyFailure(error));
    }
    let capped = false;
    for (const response of batch.responses) {
      // Already written — by an earlier run, or by a run that died before its bookkeeping.
      if (present.has(response.responseId)) {
        considered = laterOf(considered, submittedAt(response));
        reconciled.push(response.responseId);
        continue;
      }
      if (pending.length >= maxRows) {
        // A bound that drops the rest of the page must say so, or the scheduler would think the
        // form was finished and leave those answers behind for good.
        capped = true;
        break;
      }
      present.add(response.responseId);
      pending.push(response);
    }
    pageToken = batch.nextPageToken ?? undefined;
    if (capped) {
      more = true;
      break;
    }
    if (!pageToken) break;
    if (pending.length >= maxRows) {
      more = true;
      break;
    }
  }

  // 5. Append, in chunks. An append is never retried: if it fails we stop with the cursor where it
  //    was, and the next run reconciles against the sheet instead of writing blind.
  let written = 0;
  let syncedCount = sync.syncedCount;
  for (let index = 0; index < pending.length; index += rowsPerAppend) {
    const chunk = pending.slice(index, index + rowsPerAppend);
    const rows = chunk.map(response => responseCells(questions, response));
    try {
      await deps.sheets.appendRows(token, sync.spreadsheetId, sheetTitle, rows);
    } catch (error) {
      return stop(classifyFailure(error));
    }
    try {
      await deps.syncs.recordRows(sync.id, runId, chunk.map(response => response.responseId));
    } catch (error) {
      if (error instanceof StaleSyncRunError) throw error;
      // The rows are in the sheet; only the local note is missing. Safe to stop here: the next run
      // reads the sheet, sees them, and skips them.
      deps.onError?.('Sheet sync bookkeeping deferred');
      return stop({ code: 'internal_error', permanent: false });
    }
    written += chunk.length;
    for (const response of chunk) considered = laterOf(considered, submittedAt(response));
    syncedCount += chunk.length;
  }

  // Rows that were already in the sheet were written by an earlier run — possibly one that died
  // before its bookkeeping. Recording them here is what keeps the visible count equal to what the
  // spreadsheet actually holds, and it is idempotent by construction.
  if (reconciled.length) {
    try {
      const added = await deps.syncs.recordRows(sync.id, runId, reconciled);
      syncedCount += added.length;
    } catch (error) {
      if (error instanceof StaleSyncRunError) throw error;
      deps.onError?.('Sheet sync reconciliation deferred');
    }
  }

  // 6. Only now does the cursor move. Everything up to it is in the sheet and recorded here.
  const advanced = considered && (!sync.cursorLastSubmitted || considered.getTime() >= sync.cursorLastSubmitted.getTime())
    ? considered
    : null;
  const dueAt = new Date(now().getTime() + (more ? 0 : written > 0 ? ACTIVE_INTERVAL_MS : IDLE_INTERVAL_MS));

  try {
    await deps.syncs.finish(sync.id, runId, {
      status: more ? 'pending' : 'up_to_date',
      cursorLastSubmitted: advanced,
      nextSyncAt: dueAt,
      lastSyncedAt: now(),
      lastErrorCode: null,
      headerSignature: wroteHeader ? signature : undefined,
    });
  } catch (error) {
    if (error instanceof StaleSyncRunError) throw error;
    deps.onError?.('Sheet sync completion could not be recorded');
    return { outcome: 'deferred', written, syncedCount, errorCode: 'internal_error' };
  }

  return { outcome: more ? 'more' : 'up_to_date', written, syncedCount, errorCode: null };
}

/**
 * Run whatever is due, a few at a time.
 *
 * Bounded on purpose: a schedule that starts every sync at once is a schedule that discovers the
 * quota in production. The lease in `claimDue` is what keeps two instances apart.
 */
export async function runDueSyncs(
  deps: SheetsSyncDeps & { claim: (runId: string) => Promise<SheetSyncRecord[]> },
  runId: string,
  options: { concurrency?: number } = {},
): Promise<{ claimed: number; written: number }> {
  const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 2));
  const due = await deps.claim(runId);
  let written = 0;
  for (let index = 0; index < due.length; index += concurrency) {
    const slice = due.slice(index, index + concurrency);
    const results = await Promise.all(slice.map(async sync => {
      try {
        return await runSync(sync, runId, deps);
      } catch (error) {
        if (!(error instanceof StaleSyncRunError)) deps.onError?.('Sheet sync run failed');
        return null;
      }
    }));
    for (const result of results) written += result?.written ?? 0;
  }
  return { claimed: due.length, written };
}
