/**
 * Connecting a spreadsheet to a form, and reading what the sync is doing.
 *
 * The shape of this router mirrors the response-insights router deliberately: the same ownership
 * check, the same subscription check, the same "one plain code the UI turns into the one next
 * step". A sync is a way of reading responses continuously, so it gets no easier a door than
 * reading them once.
 *
 * Nothing here blocks on a large initial sync. Creating the spreadsheet is one Google call; the
 * historical responses are written by the scheduled worker, and the screen watches the count.
 */

import { randomUUID } from 'node:crypto';
import { Router, type Request, type Response } from 'express';
import type { PublicLibraryForm } from '../../../src/lib/forms';
import type { Entitlement } from '../../credits/entitlements';
import { isProActive } from '../../credits/entitlements';
import { hasScope } from '../../providers/oauth';
import { SHEETS_SCOPE, type AuthorizedConnection } from '../../providers/service';
import { createGoogleSheetsClient, isSpreadsheetId, type GoogleSheetsClient } from './client';
import { assessWorksheet, type WorksheetAssessment } from './destination';
import { publicPickerConfig, readPickerConfig, type PickerConfig } from './picker';
import { headerFor, headerSignature } from './sync';
import type { SheetSyncRecord, SheetsSyncStore } from './store';
import { consumeRequestLimit, setRateLimitHeaders, type AbuseScope, type RateLimitStore } from '../../security/rate-limit';
import type { SessionUser } from '../../providers/service';

export interface SheetsRouterDeps {
  getSession: (req: Request) => Promise<SessionUser | null>;
  getForm: (userId: string, id: string) => Promise<{ ok: true; form: PublicLibraryForm } | { ok: false }>;
  entitlement: (userId: string) => Promise<Pick<Entitlement, 'plan' | 'subscriptionStatus'>>;
  getConnection: (userId: string, provider: string) => Promise<AuthorizedConnection>;
  syncs: SheetsSyncStore;
  /** Reads the form's questions so the header matches the form at the moment it is created. */
  google: {
    getForm: (accessToken: string, formId: string) => Promise<{ items?: unknown[] }>;
  };
  sheets?: GoogleSheetsClient;
  abuseLimiter?: RateLimitStore;
  /**
   * Google Picker configuration. Defaults to the environment; a deployment without the API key
   * simply cannot offer "connect an existing spreadsheet", and everything else keeps working.
   */
  picker?: PickerConfig;
}

/** The one vocabulary the screen switches on. Machine state stays in the database; this is for people. */
export type SheetsUiState =
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

export interface SheetsStatusBody {
  state: SheetsUiState;
  canSync: boolean;
  /** Whether this deployment can offer Google Picker at all. */
  canPick: boolean;
  /** Why not, when it cannot. */
  pickerProblem: string | null;
  sync: {
    spreadsheetId: string;
    spreadsheetUrl: string | null;
    spreadsheetTitle: string | null;
    /** `created` for a file Intake made, `selected` for one chosen through Picker. */
    destination: 'created' | 'selected';
    sheetId: number;
    sheetTitle: string;
    enabled: boolean;
    syncedCount: number;
    lastSyncedAt: string | null;
    lastErrorCode: string | null;
    nextSyncAt: string | null;
  } | null;
}

/** Where the person is sent once they have allowed the spreadsheet permission. */
const SHEET_TAB_TITLE = 'Responses';
const MAX_TITLE = 180;

function spreadsheetTitle(formTitle: string): string {
  const base = formTitle.trim().slice(0, MAX_TITLE - 20) || 'Intake form';
  return `${base} — Intake Responses`;
}

function publicSync(record: SheetSyncRecord): SheetsStatusBody['sync'] {
  return {
    spreadsheetId: record.spreadsheetId,
    spreadsheetUrl: record.spreadsheetUrl,
    spreadsheetTitle: record.spreadsheetTitle,
    destination: record.destination,
    sheetId: record.sheetId,
    sheetTitle: record.sheetTitle,
    enabled: record.enabled,
    syncedCount: record.syncedCount,
    lastSyncedAt: record.lastSyncedAt ? record.lastSyncedAt.toISOString() : null,
    lastErrorCode: record.lastErrorCode,
    nextSyncAt: record.status === 'up_to_date' || record.status === 'pending' ? record.nextSyncAt.toISOString() : null,
  };
}

/** The screen's state, from the persisted sync plus the live grant. */
/** One place that assembles a status body, so `canPick` cannot drift between routes. */
export function sheetsStatusBody(
  record: SheetSyncRecord | null,
  grant: 'ok' | 'missing_scope' | 'reconnect',
  picker: PickerConfig,
): SheetsStatusBody {
  return {
    state: sheetsUiState(record, grant),
    canSync: grant === 'ok',
    canPick: picker.available && grant === 'ok',
    pickerProblem: picker.problem,
    sync: record ? publicSync(record) : null,
  };
}

export function sheetsUiState(record: SheetSyncRecord | null, grant: 'ok' | 'missing_scope' | 'reconnect'): SheetsUiState {
  if (grant === 'reconnect') return 'reconnect_required';
  if (grant === 'missing_scope') return 'awaiting_authorization';
  if (!record) return 'not_enabled';
  if (!record.enabled || record.status === 'disabled') return 'disabled';
  if (record.status === 'up_to_date') return 'up_to_date';
  if (record.status === 'delayed') return 'delayed';
  if (record.status === 'failed') {
    if (record.lastErrorCode === 'permission_revoked') return 'permission_revoked';
    if (record.lastErrorCode === 'destination_unavailable') return 'destination_unavailable';
    if (record.lastErrorCode === 'worksheet_missing') return 'worksheet_missing';
    if (record.lastErrorCode === 'worksheet_unsuitable') return 'worksheet_unsuitable';
    if (record.lastErrorCode === 'questions_changed') return 'questions_changed';
    return 'failed';
  }
  // pending or syncing
  return record.syncedCount > 0 ? 'syncing' : 'initial';
}

export function createSheetsRouter(deps: SheetsRouterDeps): Router {
  const router = Router();
  const sheetsClient = deps.sheets ?? createGoogleSheetsClient();
  const pickerConfig = deps.picker ?? readPickerConfig();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    next();
  });

  type LiveConnection = Extract<AuthorizedConnection, { ok: true }>;

  interface OwnedForm {
    userId: string;
    form: PublicLibraryForm & { providerFormId: string };
  }

  interface Access extends OwnedForm {
    connection: LiveConnection;
  }

  /**
   * Ownership, plan, connection and grant, in that order — the same sequence the insights router
   * uses, so a person who cannot read responses cannot schedule them either.
   */
  async function authorizeOwnership(req: Request, res: Response, scope: AbuseScope): Promise<OwnedForm | null> {
    const user = await deps.getSession(req).catch(() => null);
    if (!user) {
      res.status(401).json({ error: 'You are not signed in. Sign in, then try again.' });
      return null;
    }

    if (deps.abuseLimiter) {
      try {
        const decision = await consumeRequestLimit(deps.abuseLimiter, scope, user.id, req);
        if (!decision.ok) {
          if (decision.reason === 'rate_limited') setRateLimitHeaders(res, decision.retryAfterSeconds);
          res.status(decision.reason === 'rate_limited' ? 429 : 503).json({ error: 'Too many requests. Wait briefly and try again.' });
          return null;
        }
      } catch {
        res.status(503).json({ error: 'Spreadsheet syncing is temporarily unavailable.' });
        return null;
      }
    }

    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const found = await deps.getForm(user.id, id).catch(() => null);
    if (!found || !found.ok || found.form.provider !== 'google' || found.form.status !== 'created' || !found.form.providerFormId) {
      res.status(404).json({ error: 'Form not found.' });
      return null;
    }
    const form = found.form as PublicLibraryForm & { providerFormId: string };

    const entitlement = await deps.entitlement(user.id).catch(() => null);
    if (!entitlement || !isProActive(entitlement)) {
      res.status(403).json({ error: 'Spreadsheet syncing needs Pro.', code: 'pro_required' });
      return null;
    }

    return { userId: user.id, form };
  }

  /**
   * Ownership plus a usable, sufficient Google grant. This is what creating, resuming and
   * triggering a sync require: without the spreadsheet permission there is nothing to do.
   */
  async function authorize(req: Request, res: Response, scope: AbuseScope): Promise<Access | null> {
    const owned = await authorizeOwnership(req, res, scope);
    if (!owned) return null;

    const connection = await deps.getConnection(owned.userId, 'google').catch(() => null);
    if (!connection || connection.ok !== true) {
      res.status(403).json({ error: 'Reconnect Google Forms first.', code: 'reauthorization_required' });
      return null;
    }
    // Writing rows into a spreadsheet is the same data as reading responses once. No permission,
    // no sync — and no partially working version of it.
    if (!hasScope(connection.scopes, SHEETS_SCOPE)) {
      res.status(403).json({ error: 'Allow Intake to manage its own spreadsheets first.', code: 'sheets_scope_required' });
      return null;
    }

    return { ...owned, connection };
  }

  /** The grant a read-only status call should report, without refusing the call outright. */
  async function grantState(userId: string): Promise<'ok' | 'missing_scope' | 'reconnect'> {
    const connection = await deps.getConnection(userId, 'google').catch(() => null);
    if (!connection || connection.ok !== true) return 'reconnect';
    return hasScope(connection.scopes, SHEETS_SCOPE) ? 'ok' : 'missing_scope';
  }

  function googleFailure(res: Response, error: unknown): void {
    const info = error && typeof error === 'object' && 'info' in error ? (error as { info: { httpStatus?: number } }).info : null;
    if (info && (info.httpStatus === 401 || info.httpStatus === 403)) {
      res.status(403).json({ error: 'Google refused the request. Reconnect Google Forms.', code: 'reauthorization_required' });
      return;
    }
    res.status(502).json({ error: 'Google did not answer. Try again shortly.' });
  }

  router.get('/:id/sheets', async (req, res) => {
    const user = await deps.getSession(req).catch(() => null);
    if (!user) return res.status(401).json({ error: 'You are not signed in. Sign in, then try again.' });

    const id = typeof req.params.id === 'string' ? req.params.id : '';
    const found = await deps.getForm(user.id, id).catch(() => null);
    if (!found || !found.ok || found.form.provider !== 'google' || found.form.status !== 'created') {
      return res.status(404).json({ error: 'Form not found.' });
    }

    const grant = await grantState(user.id);
    const record = await deps.syncs.findByForm(user.id, found.form.id).catch(() => null);
    return res.json(sheetsStatusBody(record, grant, pickerConfig));
  });

  /**
   * Create a spreadsheet and start syncing into it.
   *
   * The spreadsheet is created inside the person's own Drive, by an app that can only reach files
   * it created itself. Intake keeps the id and nothing else: the sheet belongs to them, and
   * turning syncing off never touches it.
   */
  router.post('/:id/sheets', async (req, res) => {
    const access = await authorize(req, res, 'forms.sheets');
    if (!access) return;
    const { userId, form, connection } = access;

    // One destination per form. A second press must not build a second spreadsheet.
    const existing = await deps.syncs.findByForm(userId, form.id).catch(() => null);
    if (existing && existing.enabled) {
      return res.status(409).json({ error: 'This form is already syncing to a spreadsheet.', code: 'already_enabled' });
    }

    let questions: Array<{ id: string; title: string }>;
    try {
      const resource = await deps.google.getForm(connection.accessToken, form.providerFormId);
      questions = (Array.isArray(resource.items) ? resource.items : [])
        .filter((item): item is { kind: string; questionId: string; title: string } =>
          !!item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'question'
          && typeof (item as { questionId?: unknown }).questionId === 'string'
          && typeof (item as { title?: unknown }).title === 'string')
        .map(item => ({ id: item.questionId, title: item.title }));
    } catch (error) {
      return googleFailure(res, error);
    }

    let created: Awaited<ReturnType<GoogleSheetsClient['createSpreadsheet']>>;
    const title = spreadsheetTitle(form.title);
    try {
      created = await sheetsClient.createSpreadsheet(connection.accessToken, {
        title,
        sheetTitle: SHEET_TAB_TITLE,
      });
    } catch (error) {
      // Nothing was created, so there is nothing to track and nothing was left in anyone's Drive.
      return googleFailure(res, error);
    }

    // The header is written now so the sheet is legible from the moment it exists. If that one
    // call fails the spreadsheet is still tracked, and the first sync writes the header instead —
    // which is better than refusing to remember a file that has already been created.
    try {
      await sheetsClient.writeHeader(connection.accessToken, created.spreadsheetId, created.sheetTitle, headerFor(questions));
    } catch {
      // Deliberately swallowed: the sync below owns the header from here.
    }

    const record = existing
      ? await deps.syncs.restart(existing.id, {
        spreadsheetId: created.spreadsheetId,
        spreadsheetUrl: created.spreadsheetUrl,
        spreadsheetTitle: title,
        destination: 'created',
        sheetId: created.sheetId,
        sheetTitle: created.sheetTitle,
        headerSignature: headerSignature(questions),
      })
      : await deps.syncs.create({
        id: `fss_${randomUUID().replace(/-/g, '')}`,
        formId: form.id,
        userId,
        spreadsheetId: created.spreadsheetId,
        spreadsheetUrl: created.spreadsheetUrl,
        spreadsheetTitle: title,
        destination: 'created',
        sheetId: created.sheetId,
        sheetTitle: created.sheetTitle,
        headerSignature: headerSignature(questions),
      });
    if (!record) return res.status(503).json({ error: 'The spreadsheet was created, but Intake could not save the connection to it. Try again.' });

    return res.status(201).json(sheetsStatusBody(record, 'ok', pickerConfig));
  });

  /** Resume a sync that was switched off, without building another spreadsheet. */
  router.post('/:id/sheets/enable', async (req, res) => {
    const access = await authorize(req, res, 'forms.sheets');
    if (!access) return;
    const record = await deps.syncs.findByForm(access.userId, access.form.id).catch(() => null);
    if (!record) return res.status(404).json({ error: 'There is no spreadsheet set up for this form.', code: 'not_enabled' });
    const enabled = await deps.syncs.enable(access.userId, access.form.id);
    if (!enabled) return res.status(503).json({ error: 'Intake could not restart this sync. Try again.' });
    return res.json(sheetsStatusBody(enabled, 'ok', pickerConfig));
  });

  /**
   * Ask for a sync now.
   *
   * It posts a due time rather than doing the work in the request: a form with years of responses
   * would otherwise hold a browser connection open for minutes. The scheduled worker picks it up
   * on its next tick, and the screen watches the count.
   */
  router.post('/:id/sheets/sync', async (req, res) => {
    const access = await authorize(req, res, 'forms.sheets');
    if (!access) return;
    const record = await deps.syncs.findByForm(access.userId, access.form.id).catch(() => null);
    if (!record) return res.status(404).json({ error: 'There is no spreadsheet set up for this form.', code: 'not_enabled' });
    if (!record.enabled) return res.status(409).json({ error: 'This sync is switched off. Turn it back on first.', code: 'disabled' });
    const updated = await deps.syncs.enable(access.userId, access.form.id);
    if (!updated) return res.status(503).json({ error: 'Intake could not queue this sync. Try again.' });
    return res.json(sheetsStatusBody(updated, 'ok', pickerConfig));
  });

  /**
   * Switch syncing off. The spreadsheet stays exactly as it is: it is the person's file, and Intake
   * does not delete files it did not ask to delete.
   */
  router.delete('/:id/sheets', async (req, res) => {
    // Deliberately no Google call and no spreadsheet permission: switching syncing off is always
    // possible, whatever state the authorization is in.
    const access = await authorizeOwnership(req, res, 'forms.sheets');
    if (!access) return;
    const record = await deps.syncs.disable(access.userId, access.form.id).catch(() => null);
    if (!record) return res.status(404).json({ error: 'There is no spreadsheet set up for this form.', code: 'not_enabled' });
    return res.json(sheetsStatusBody(record, 'ok', pickerConfig));
  });

  // ---------------------------------------------------------------------------------------------
  // Phase D: choosing an existing spreadsheet.
  // ---------------------------------------------------------------------------------------------

  /** The questions of a Google form, or a response already sent to the caller. */
  async function loadQuestions(access: Access, res: Response): Promise<Array<{ id: string; title: string }> | null> {
    try {
      const resource = await deps.google.getForm(access.connection.accessToken, access.form.providerFormId);
      return (Array.isArray(resource.items) ? resource.items : [])
        .filter((item): item is { kind: string; questionId: string; title: string } =>
          !!item && typeof item === 'object' && (item as { kind?: unknown }).kind === 'question'
          && typeof (item as { questionId?: unknown }).questionId === 'string'
          && typeof (item as { title?: unknown }).title === 'string')
        .map(item => ({ id: item.questionId, title: item.title }));
    } catch (error) {
      googleFailure(res, error);
      return null;
    }
  }

  /**
   * The backend is the authority on a destination.
   *
   * An id that arrives from the browser is treated as a claim, not a fact: it is checked against
   * the shape Google uses, then read with *this user's* connection. A spreadsheet they cannot open
   * fails here, whatever the Picker appeared to show, and one belonging to somebody else is simply
   * not found — there is no path from an id in a request body to another person's file.
   */
  async function resolveSpreadsheet(
    access: Access,
    spreadsheetId: unknown,
    res: Response,
  ): Promise<{ metadata: Awaited<ReturnType<GoogleSheetsClient['getSpreadsheet']>> } | null> {
    if (!isSpreadsheetId(spreadsheetId)) {
      res.status(400).json({ error: 'That is not a Google spreadsheet ID.', code: 'invalid_spreadsheet_id' });
      return null;
    }
    try {
      const metadata = await sheetsClient.getSpreadsheet(access.connection.accessToken, spreadsheetId);
      if (!metadata.sheets.length) {
        res.status(422).json({ error: 'That file is not a spreadsheet Intake can write to.', code: 'not_a_spreadsheet' });
        return null;
      }
      return { metadata };
    } catch (error) {
      const info = error && typeof error === 'object' && 'info' in error
        ? (error as { info: { httpStatus?: number; kind?: string } }).info
        : null;
      if (info?.httpStatus === 404) {
        res.status(404).json({
          error: 'Google could not find that spreadsheet, or Intake cannot open it. Choose it again from your Drive.',
          code: 'spreadsheet_not_found',
        });
        return null;
      }
      if (info?.httpStatus === 403) {
        res.status(403).json({
          error: 'Intake does not have access to that spreadsheet. Choose it again through Google Picker, which is what grants access to the file.',
          code: 'spreadsheet_forbidden',
        });
        return null;
      }
      if (info?.httpStatus === 429) {
        res.status(429).json({ error: 'Google is limiting requests just now. Try again in a minute.', code: 'rate_limited' });
        return null;
      }
      res.status(502).json({ error: 'Google did not answer. Try again shortly.', code: 'sheets_unavailable' });
      return null;
    }
  }

  /** The sample of a worksheet plus the same verdict the sync engine will reach later. */
  async function inspectWorksheet(
    access: Access,
    spreadsheetId: string,
    sheetTitle: string,
    expectedHeader: string[],
    res: Response,
  ): Promise<WorksheetAssessment | null> {
    try {
      const sample = await sheetsClient.readWorksheetSample(access.connection.accessToken, spreadsheetId, sheetTitle, 25);
      return assessWorksheet({ sample, expectedHeader });
    } catch {
      res.status(502).json({ error: 'Google did not answer while Intake was reading that worksheet. Try again shortly.', code: 'sheets_unavailable' });
      return null;
    }
  }

  /**
   * Where the Picker gets its token.
   *
   * The Picker runs in the browser, so the page needs an access token. It gets the one Intake
   * already holds — short-lived, `drive.file`, and the same grant the server uses — and nothing
   * else. The refresh token stays encrypted in the database and never crosses this boundary.
   */
  router.get('/:id/sheets/picker', async (req, res) => {
    const access = await authorize(req, res, 'forms.sheets');
    if (!access) return;
    if (!pickerConfig.available) {
      return res.status(503).json({
        error: pickerConfig.problem ?? 'Choosing an existing spreadsheet is not set up on this server.',
        code: 'picker_unavailable',
      });
    }
    const expiresAt = access.connection.accessTokenExpiresAt;
    if (expiresAt && new Date(expiresAt).getTime() <= Date.now()) {
      return res.status(409).json({
        error: 'Intake’s Google access has just expired. Reconnect Google Forms, then try again.',
        code: 'token_expired',
      });
    }
    return res.json(publicPickerConfig(pickerConfig, {
      accessToken: access.connection.accessToken,
      expiresAt: expiresAt ?? new Date(Date.now() + 5 * 60 * 1000).toISOString(),
    }));
  });

  /**
   * Look at a spreadsheet somebody picked, before anything is written to it.
   *
   * Without a worksheet id it answers the list of worksheets. With one it answers the verdict for
   * that worksheet — empty, already this form's table, or holding somebody else's data — so the
   * screen can say what will happen before the person agrees to it.
   */
  router.post('/:id/sheets/inspect', async (req, res) => {
    const access = await authorize(req, res, 'forms.sheets');
    if (!access) return;
    const body = (req.body ?? {}) as { spreadsheetId?: unknown; sheetId?: unknown };
    const resolved = await resolveSpreadsheet(access, body.spreadsheetId, res);
    if (!resolved) return;
    const { metadata } = resolved;

    const questions = await loadQuestions(access, res);
    if (!questions) return;
    const expectedHeader = headerFor(questions);

    const base = {
      spreadsheetId: metadata.spreadsheetId,
      title: metadata.title,
      spreadsheetUrl: metadata.spreadsheetUrl,
      worksheets: metadata.sheets.map(sheet => ({
        sheetId: sheet.sheetId,
        title: sheet.title,
        rowCount: sheet.rowCount,
        columnCount: sheet.columnCount,
      })),
    };

    if (body.sheetId === undefined || body.sheetId === null) {
      return res.json({ ...base, worksheet: null, assessment: null, header: expectedHeader });
    }

    const sheetId = typeof body.sheetId === 'number' && Number.isSafeInteger(body.sheetId) ? body.sheetId : null;
    const sheet = sheetId === null ? null : metadata.sheets.find(candidate => candidate.sheetId === sheetId);
    if (!sheet) {
      return res.status(404).json({ error: 'That worksheet is not in this spreadsheet any more. Pick another one.', code: 'worksheet_not_found' });
    }

    const assessment = await inspectWorksheet(access, metadata.spreadsheetId, sheet.title, expectedHeader, res);
    if (!assessment) return;

    return res.json({
      ...base,
      worksheet: { sheetId: sheet.sheetId, title: sheet.title, rowCount: sheet.rowCount, columnCount: sheet.columnCount },
      assessment,
      header: expectedHeader,
    });
  });

  /**
   * Connect an existing spreadsheet as this form's destination.
   *
   * The worksheet is inspected again here, in the request that writes: a screen can be open for
   * minutes, and what it showed then is not evidence about what is in the sheet now. An empty
   * worksheet gets the header row. One that already holds this form's table is left exactly as it
   * is — its existing rows are read like any others, and the sync engine skips them by response id.
   * Anything else is refused, with the reason.
   */
  router.post('/:id/sheets/connect', async (req, res) => {
    const access = await authorize(req, res, 'forms.sheets');
    if (!access) return;
    const body = (req.body ?? {}) as { spreadsheetId?: unknown; sheetId?: unknown; replace?: unknown };
    const resolved = await resolveSpreadsheet(access, body.spreadsheetId, res);
    if (!resolved) return;
    const { metadata } = resolved;

    const sheetId = typeof body.sheetId === 'number' && Number.isSafeInteger(body.sheetId) ? body.sheetId : null;
    const sheet = sheetId === null ? null : metadata.sheets.find(candidate => candidate.sheetId === sheetId);
    if (!sheet) {
      return res.status(404).json({ error: 'That worksheet is not in this spreadsheet any more. Pick another one.', code: 'worksheet_not_found' });
    }

    const questions = await loadQuestions(access, res);
    if (!questions) return;
    const expectedHeader = headerFor(questions);
    const assessment = await inspectWorksheet(access, metadata.spreadsheetId, sheet.title, expectedHeader, res);
    if (!assessment) return;

    if (assessment.verdict === 'unsuitable') {
      return res.status(409).json({
        error: assessment.reason ?? 'That worksheet already contains other data. Choose an empty one.',
        code: 'worksheet_unsuitable',
      });
    }

    const existing = await deps.syncs.findByForm(access.userId, access.form.id).catch(() => null);
    if (existing && existing.enabled) {
      const same = existing.spreadsheetId === metadata.spreadsheetId && existing.sheetId === sheet.sheetId;
      if (same) {
        return res.status(409).json({ error: 'This form is already syncing to that worksheet.', code: 'already_enabled' });
      }
      // Moving a live sync to another file is allowed, but not by accident: the screen has to say
      // what happens to the old destination and send `replace` with the answer.
      if (body.replace !== true) {
        return res.status(409).json({
          error: 'This form is already syncing to another spreadsheet. Confirm the change before switching.',
          code: 'destination_change_unconfirmed',
        });
      }
    }

    // Only an empty worksheet is initialised. A worksheet that already holds this form's table is
    // left untouched, and one with other data never reaches this line.
    if (assessment.verdict === 'empty') {
      try {
        await sheetsClient.writeHeader(access.connection.accessToken, metadata.spreadsheetId, sheet.title, expectedHeader);
      } catch (error) {
        return googleFailure(res, error);
      }
    }

    const destination = {
      spreadsheetId: metadata.spreadsheetId,
      spreadsheetUrl: metadata.spreadsheetUrl,
      spreadsheetTitle: metadata.title,
      destination: 'selected' as const,
      sheetId: sheet.sheetId,
      sheetTitle: sheet.title,
      headerSignature: headerSignature(questions),
    };

    // A destination change reuses the one sync row: one destination per form, whichever kind it is.
    const record = existing
      ? await deps.syncs.restart(existing.id, destination)
      : await deps.syncs.create({
        formId: access.form.id,
        userId: access.userId,
        ...destination,
      });
    if (!record) return res.status(503).json({ error: 'Intake could not save the connection to that spreadsheet. Try again.' });

    return res.status(201).json(sheetsStatusBody(record, 'ok', pickerConfig));
  });

  return router;
}
