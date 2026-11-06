/**
 * Fakes for the Google Sheets sync: a form that pages, a spreadsheet that remembers rows, and a
 * store that fences runs the way the real one does.
 *
 * The spreadsheet fake is deliberately stateful. Deduplication is the whole point of this feature,
 * and a fake that forgets what it was told cannot fail the test that matters.
 */

import { GoogleSheetsApiError } from '../../server/forms/sheets/client.ts';
import { GoogleFormsApiError } from '../../server/forms/providers/google/client.ts';
import { StaleSyncRunError } from '../../server/forms/sheets/store.ts';

export const SHEETS_SCOPE = 'https://www.googleapis.com/auth/drive.file';
export const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';

export const FORM = {
  id: 'form-1',
  provider: 'google',
  providerFormId: '1FAIpQLSfakeFormId123',
  title: 'Customer feedback',
  status: 'created',
  failureStage: null,
  editUrl: null,
  responderUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  description: null,
  source: 'created',
  lastSyncedAt: null,
  archivedAt: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

export function connection(overrides = {}) {
  return {
    ok: true,
    provider: 'google',
    userId: 'user-a',
    externalAccountId: 'google-sub',
    externalAccountEmail: 'ada@gmail.com',
    scopes: ['openid', 'email', FORMS_SCOPE, SHEETS_SCOPE],
    accessToken: 'ACCESS_TOKEN',
    accessTokenExpiresAt: '2026-09-01T11:00:00.000Z',
    ...overrides,
  };
}

export function question(id, title) {
  return { kind: 'question', questionId: id, title, questionType: 'short_text' };
}

/** One response as the Forms client normalizes it. */
export function response(id, lastSubmittedTime, answers = {}) {
  return {
    responseId: id,
    createTime: lastSubmittedTime,
    lastSubmittedTime,
    respondentEmail: null,
    answers,
    totalScore: null,
  };
}

/**
 * The Forms API as this code uses it: newest-last, `timestamp >= since`, and a page token that
 * continues where the last page stopped.
 */
export function createFakeGoogle(options = {}) {
  const state = {
    questions: options.questions ?? [question('q1', 'What is your name?'), question('q2', 'Anything else?')],
    responses: [...(options.responses ?? [])],
    pageSize: options.pageSize ?? 500,
    lists: 0,
    failList: null,
  };

  return {
    state,
    client: {
      async getForm() {
        if (options.failGetForm) throw options.failGetForm;
        return { items: state.questions };
      },
      async listResponses(_token, _formId, query = {}) {
        state.lists += 1;
        if (state.failList) {
          const error = state.failList;
          state.failList = null;
          throw error;
        }
        const since = query.since ? Date.parse(query.since) : null;
        const eligible = state.responses
          .filter(item => !since || Date.parse(item.lastSubmittedTime) >= since)
          .sort((a, b) => Date.parse(a.lastSubmittedTime) - Date.parse(b.lastSubmittedTime));
        const size = Math.max(1, Math.min(query.pageSize ?? state.pageSize, state.pageSize));
        const offset = query.pageToken ? Number(query.pageToken) : 0;
        const slice = eligible.slice(offset, offset + size);
        const next = offset + size < eligible.length ? String(offset + size) : null;
        return { responses: slice, nextPageToken: next };
      },
      async getResponse() {
        throw new Error('not used in these tests');
      },
    },
  };
}

/**
 * A spreadsheet that behaves like the real one for the calls Intake makes.
 *
 * `failAppend` throws *before* the rows land; `applyThenThrow` writes them and then throws, which
 * is the failure window the sync has to survive.
 */
export function createFakeSheets(options = {}) {
  const state = {
    created: [],
    spreadsheets: new Map(),
    appends: 0,
    failAppend: null,
    applyThenThrow: null,
    deleted: false,
    headerWrites: 0,
  };

  function seed(spreadsheetId = 'SHEET_ID_1234567890abcdef', overrides = {}) {
    const sheet = {
      spreadsheetId,
      title: overrides.title ?? 'Customer feedback — Intake Responses',
      sheetId: overrides.sheetId ?? 0,
      sheetTitle: overrides.sheetTitle ?? 'Responses',
      header: [...(overrides.header ?? [])],
      rows: [...(overrides.rows ?? [])],
    };
    state.spreadsheets.set(spreadsheetId, sheet);
    return sheet;
  }

  function current(spreadsheetId) {
    const sheet = state.deleted ? null : state.spreadsheets.get(spreadsheetId);
    if (!sheet) throw new GoogleSheetsApiError({ operation: 'spreadsheets.get', kind: 'http', httpStatus: 404, googleStatus: 'NOT_FOUND' });
    return sheet;
  }

  return {
    state,
    seed,
    client: {
      async createSpreadsheet(_token, input) {
        const id = `SHEET_${String(state.created.length).padStart(4, '0')}_created_by_intake`;
        const sheet = seed(id, { title: input.title, sheetTitle: input.sheetTitle, sheetId: 0 });
        state.created.push({ id, ...input });
        return { spreadsheetId: id, spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${id}/edit`, sheetId: sheet.sheetId, sheetTitle: sheet.sheetTitle };
      },
      async getSpreadsheet(_token, spreadsheetId) {
        const sheet = current(spreadsheetId);
        return {
          spreadsheetId,
          title: sheet.title,
          spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${spreadsheetId}/edit`,
          sheets: [{ sheetId: sheet.sheetId, title: sheet.sheetTitle, rowCount: 1000 }],
        };
      },
      async readSheetState(_token, spreadsheetId) {
        const sheet = current(spreadsheetId);
        return { header: [...sheet.header], responseIds: sheet.rows.map(row => row[0]) };
      },
      async appendRows(_token, spreadsheetId, _sheetTitle, rows) {
        const sheet = current(spreadsheetId);
        if (state.failAppend) {
          const error = state.failAppend;
          state.failAppend = null;
          throw error;
        }
        sheet.rows.push(...rows.map(row => row.map(cell => String(cell))));
        state.appends += 1;
        if (state.applyThenThrow) {
          const error = state.applyThenThrow;
          state.applyThenThrow = null;
          throw error;
        }
        return { updatedRows: rows.length };
      },
      async writeHeader(_token, spreadsheetId, _sheetTitle, header) {
        const sheet = current(spreadsheetId);
        sheet.header = [...header];
        state.headerWrites += 1;
      },
    },
  };
}

/**
 * The store, in memory, with the same fences as the SQL: a claim takes a lease, and a run that has
 * been superseded cannot record, finish or fail.
 */
export function createMemorySyncStore(seedRecords = []) {
  const records = new Map(seedRecords.map(record => [record.id, { ...record }]));
  const rows = new Map();
  let clock = () => new Date('2026-11-06T12:00:00.000Z');

  const clone = record => ({ ...record });

  function staleError() {
    return new StaleSyncRunError();
  }

  const store = {
    records,
    rows,
    setClock(fn) { clock = fn; },
    get(id) { return records.get(id) ?? null; },
    async findByForm(userId, formId) {
      for (const record of records.values()) if (record.userId === userId && record.formId === formId) return clone(record);
      return null;
    },
    async findById(id) {
      const record = records.get(id);
      return record ? clone(record) : null;
    },
    async create(input) {
      const record = {
        ...input,
        status: 'pending',
        enabled: true,
        cursorLastSubmitted: null,
        syncedCount: 0,
        lastSyncedAt: null,
        lastErrorCode: null,
        lastErrorAt: null,
        attempt: 0,
        nextSyncAt: clock(),
        lockedUntil: null,
        runId: null,
        createdAt: clock(),
        updatedAt: clock(),
      };
      records.set(record.id, record);
      return clone(record);
    },
    async restart(id, input) {
      const record = records.get(id);
      if (!record) return null;
      Object.assign(record, input, {
        status: 'pending', enabled: true, cursorLastSubmitted: null, syncedCount: 0,
        lastSyncedAt: null, lastErrorCode: null, attempt: 0, runId: null, lockedUntil: null,
      });
      rows.delete(id);
      return clone(record);
    },
    async disable(userId, formId) {
      for (const record of records.values()) {
        if (record.userId === userId && record.formId === formId) {
          record.enabled = false;
          record.status = 'disabled';
          record.runId = null;
          record.lockedUntil = null;
          return clone(record);
        }
      }
      return null;
    },
    async enable(userId, formId) {
      for (const record of records.values()) {
        if (record.userId === userId && record.formId === formId) {
          record.enabled = true;
          record.status = 'pending';
          record.nextSyncAt = clock();
          record.lastErrorCode = null;
          record.attempt = 0;
          return clone(record);
        }
      }
      return null;
    },
    async claimDue(runId, limit, _leaseMs) {
      const now = clock().getTime();
      const due = [...records.values()]
        .filter(record => record.enabled && record.status !== 'disabled'
          && record.nextSyncAt.getTime() <= now
          && (!record.lockedUntil || record.lockedUntil.getTime() < now))
        .slice(0, limit);
      for (const record of due) {
        record.status = 'syncing';
        record.runId = runId;
        record.attempt += 1;
        record.lockedUntil = new Date(now + 5 * 60 * 1000);
      }
      return due.map(clone);
    },
    async recordRows(syncId, runId, responseIds) {
      const record = records.get(syncId);
      if (!record || record.runId !== runId) throw staleError();
      const set = rows.get(syncId) ?? new Set();
      const added = [];
      for (const id of responseIds) {
        if (set.has(id)) continue;
        set.add(id);
        added.push(id);
      }
      rows.set(syncId, set);
      record.syncedCount += added.length;
      return added;
    },
    async finish(syncId, runId, finish) {
      const record = records.get(syncId);
      if (!record || record.runId !== runId) throw staleError();
      record.status = finish.status;
      if (finish.cursorLastSubmitted) record.cursorLastSubmitted = finish.cursorLastSubmitted;
      if (finish.headerSignature) record.headerSignature = finish.headerSignature;
      record.nextSyncAt = finish.nextSyncAt;
      if (finish.lastSyncedAt) record.lastSyncedAt = finish.lastSyncedAt;
      record.lastErrorCode = finish.lastErrorCode ?? null;
      record.lockedUntil = null;
      if (finish.status === 'up_to_date' || finish.status === 'pending') record.attempt = 0;
      return clone(record);
    },
    async fail(syncId, runId, input) {
      const record = records.get(syncId);
      if (!record || record.runId !== runId) throw staleError();
      record.status = input.status;
      record.lastErrorCode = input.code;
      record.lastErrorAt = clock();
      record.nextSyncAt = input.retryAt ?? new Date(clock().getTime() + 24 * 60 * 60 * 1000);
      record.lockedUntil = null;
      return clone(record);
    },
    async pauseForUser(userId, code) {
      let count = 0;
      for (const record of records.values()) {
        if (record.userId !== userId || !record.enabled) continue;
        record.status = 'failed';
        record.lastErrorCode = code;
        record.nextSyncAt = new Date(clock().getTime() + 24 * 60 * 60 * 1000);
        record.runId = null;
        record.lockedUntil = null;
        count += 1;
      }
      return count;
    },
    async countRows(syncId) {
      return rows.get(syncId)?.size ?? 0;
    },
  };
  return store;
}

/** A sync record in the shape the engine receives from a claim. */
export function makeSync(overrides = {}) {
  return {
    id: 'fss_1',
    formId: FORM.id,
    userId: 'user-a',
    spreadsheetId: 'SHEET_ID_1234567890abcdef',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_1234567890abcdef/edit',
    sheetId: 0,
    sheetTitle: 'Responses',
    headerSignature: JSON.stringify([['q1', 'What is your name?'], ['q2', 'Anything else?']]),
    status: 'syncing',
    enabled: true,
    cursorLastSubmitted: null,
    syncedCount: 0,
    lastSyncedAt: null,
    lastErrorCode: null,
    lastErrorAt: null,
    attempt: 1,
    nextSyncAt: new Date('2026-11-06T12:00:00.000Z'),
    lockedUntil: new Date('2026-11-06T12:05:00.000Z'),
    runId: 'run_1',
    createdAt: new Date('2026-11-06T11:00:00.000Z'),
    updatedAt: new Date('2026-11-06T11:00:00.000Z'),
    ...overrides,
  };
}

/** Everything the engine needs, wired to the fakes. */
/** The two classes the engine classifies on, for tests that need to simulate a specific failure. */
export function sheetsError(httpStatus, extra = {}) {
  return new GoogleSheetsApiError({ operation: 'values.append', kind: 'http', httpStatus, ...extra });
}

export function formsError(httpStatus) {
  return new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus });
}

export function networkError() {
  return new GoogleSheetsApiError({ operation: 'values.append', kind: 'network' });
}

export function createWorld(options = {}) {
  const google = createFakeGoogle({ responses: options.responses ?? [], pageSize: options.pageSize });
  const sheets = createFakeSheets();
  const store = createMemorySyncStore();
  const sync = makeSync(options.sync);
  store.records.set(sync.id, { ...sync });
  sheets.seed(sync.spreadsheetId, {
    header: options.seedHeader ?? [],
    rows: options.seedRows ?? [],
  });
  const now = options.now ?? (() => new Date('2026-11-06T12:00:00.000Z'));
  store.setClock(now);

  const deps = {
    syncs: store,
    google: google.client,
    sheets: sheets.client,
    getConnection: async () => options.connection ?? connection(),
    getForm: async (userId, formId) => (formId === FORM.id ? { ok: true, form: FORM } : { ok: false }),
    now,
    sleep: async () => {},
    maxRowsPerRun: options.maxRowsPerRun,
    pageSize: options.pageSize,
    rowsPerAppend: options.rowsPerAppend,
    onError: () => {},
    ...(options.deps ?? {}),
  };

  return { google, sheets, store, sync, deps, now };
}
