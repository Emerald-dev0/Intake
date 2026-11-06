import { randomUUID } from 'node:crypto';
import type { Pool } from 'pg';

/**
 * The coordination state for a form's sheet sync.
 *
 * Nothing in here is a response. The row holds a destination, a cursor, a schedule and the last
 * outcome; `form_sheet_row` holds response ids and nothing else. The answers themselves only ever
 * exist in Google's form and in the spreadsheet it writes to.
 */
export const SHEET_SYNC_STATUSES = ['pending', 'syncing', 'up_to_date', 'delayed', 'failed', 'disabled'] as const;
export type SheetSyncStatus = (typeof SHEET_SYNC_STATUSES)[number];

export const SHEET_SYNC_ERROR_CODES = [
  'permission_revoked',
  'destination_unavailable',
  'questions_changed',
  'form_unavailable',
  'rate_limited',
  'sheets_unavailable',
  'forms_unavailable',
  'internal_error',
] as const;
export type SheetSyncErrorCode = (typeof SHEET_SYNC_ERROR_CODES)[number];

export interface SheetSyncRecord {
  id: string;
  formId: string;
  userId: string;
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  sheetId: number;
  sheetTitle: string;
  headerSignature: string;
  status: SheetSyncStatus;
  enabled: boolean;
  cursorLastSubmitted: Date | null;
  syncedCount: number;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorAt: Date | null;
  attempt: number;
  nextSyncAt: Date;
  lockedUntil: Date | null;
  runId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface NewSheetSync {
  /** Supplied by the store when omitted; callers do not need to know the id format. */
  id?: string;
  formId: string;
  userId: string;
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  sheetId: number;
  sheetTitle: string;
  headerSignature: string;
}

export interface SyncFinish {
  status: SheetSyncStatus;
  /** Inclusive lower bound for the next read. Left alone when absent. */
  cursorLastSubmitted?: Date | null;
  nextSyncAt: Date;
  lastSyncedAt?: Date | null;
  lastErrorCode?: string | null;
  /** Replaces the recorded header description after the header row was rewritten. */
  headerSignature?: string;
}

/** A run whose lease has been taken over may not write anything. */
export class StaleSyncRunError extends Error {
  constructor() {
    super('sheet_sync_run_superseded');
    this.name = 'StaleSyncRunError';
  }
}

export interface SheetsSyncStore {
  findByForm(userId: string, formId: string): Promise<SheetSyncRecord | null>;
  findById(id: string): Promise<SheetSyncRecord | null>;
  create(input: NewSheetSync): Promise<SheetSyncRecord>;
  /** Points an existing sync at a new spreadsheet, resetting the cursor and the counters. */
  restart(syncId: string, input: Omit<NewSheetSync, 'id' | 'formId' | 'userId'>): Promise<SheetSyncRecord | null>;
  disable(userId: string, formId: string): Promise<SheetSyncRecord | null>;
  enable(userId: string, formId: string): Promise<SheetSyncRecord | null>;
  /** Takes up to `limit` due syncs, each with a lease. Two workers cannot claim the same one. */
  claimDue(runId: string, limit: number, leaseMs: number): Promise<SheetSyncRecord[]>;
  /** Records written response ids. Returns them, so the caller knows what is now durable. */
  recordRows(syncId: string, runId: string, responseIds: string[]): Promise<string[]>;
  finish(syncId: string, runId: string, finish: SyncFinish): Promise<SheetSyncRecord>;
  fail(syncId: string, runId: string, input: { status: 'delayed' | 'failed'; code: SheetSyncErrorCode; retryAt: Date | null }): Promise<SheetSyncRecord>;
  /** Pauses every sync a user has, after their Google grant stops working. */
  pauseForUser(userId: string, code: SheetSyncErrorCode): Promise<number>;
  countRows(syncId: string): Promise<number>;
}

interface Row {
  id: string;
  form_id: string;
  user_id: string;
  spreadsheet_id: string;
  spreadsheet_url: string | null;
  sheet_id: number;
  sheet_title: string;
  header_signature: string;
  status: SheetSyncStatus;
  enabled: boolean;
  cursor_last_submitted: Date | null;
  synced_count: number;
  last_synced_at: Date | null;
  last_error_code: string | null;
  last_error_at: Date | null;
  attempt: number;
  next_sync_at: Date;
  locked_until: Date | null;
  run_id: string | null;
  created_at: Date;
  updated_at: Date;
}

function record(row: Row): SheetSyncRecord {
  return {
    id: row.id,
    formId: row.form_id,
    userId: row.user_id,
    spreadsheetId: row.spreadsheet_id,
    spreadsheetUrl: row.spreadsheet_url,
    sheetId: row.sheet_id,
    sheetTitle: row.sheet_title,
    headerSignature: row.header_signature,
    status: row.status,
    enabled: row.enabled,
    cursorLastSubmitted: row.cursor_last_submitted,
    syncedCount: row.synced_count,
    lastSyncedAt: row.last_synced_at,
    lastErrorCode: row.last_error_code,
    lastErrorAt: row.last_error_at,
    attempt: row.attempt,
    nextSyncAt: row.next_sync_at,
    lockedUntil: row.locked_until,
    runId: row.run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** The lease has to outlast the slowest bounded run, or a live run would be reclaimed underneath. */
export const DEFAULT_LEASE_MS = 5 * 60 * 1000;

function newSheetSyncId(): string {
  return `fss_${randomUUID().replace(/-/g, '')}`;
}

export function createPostgresSheetsSyncStore(pool: Pool): SheetsSyncStore {
  return {
    async findByForm(userId, formId) {
      const result = await pool.query<Row>(
        'SELECT * FROM form_sheet_sync WHERE user_id = $1 AND form_id = $2',
        [userId, formId],
      );
      return result.rows[0] ? record(result.rows[0]) : null;
    },

    async findById(id) {
      const result = await pool.query<Row>('SELECT * FROM form_sheet_sync WHERE id = $1', [id]);
      return result.rows[0] ? record(result.rows[0]) : null;
    },

    async create(input) {
      const result = await pool.query<Row>(
        `INSERT INTO form_sheet_sync
           (id, form_id, user_id, spreadsheet_id, spreadsheet_url, sheet_id, sheet_title,
            header_signature, status, enabled, next_sync_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, 'pending', true, now())
         RETURNING *`,
        [input.id ?? newSheetSyncId(), input.formId, input.userId, input.spreadsheetId, input.spreadsheetUrl, input.sheetId, input.sheetTitle, input.headerSignature],
      );
      if (!result.rows[0]) throw new Error('sheet_sync_store_unavailable');
      return record(result.rows[0]);
    },

    async restart(syncId, input) {
      const result = await pool.query<Row>(
        `UPDATE form_sheet_sync SET
           spreadsheet_id = $2, spreadsheet_url = $3, sheet_id = $4, sheet_title = $5,
           header_signature = $6, status = 'pending', enabled = true,
           cursor_last_submitted = NULL, synced_count = 0, last_synced_at = NULL,
           last_error_code = NULL, last_error_at = NULL, attempt = 0,
           next_sync_at = now(), locked_until = NULL, run_id = NULL, updated_at = now()
         WHERE id = $1
         RETURNING *`,
        [syncId, input.spreadsheetId, input.spreadsheetUrl, input.sheetId, input.sheetTitle, input.headerSignature],
      );
      if (result.rows[0]) {
        // The old ids described the old spreadsheet; keeping them would suppress writes to the new one.
        await pool.query('DELETE FROM form_sheet_row WHERE sync_id = $1', [syncId]);
      }
      return result.rows[0] ? record(result.rows[0]) : null;
    },

    async disable(userId, formId) {
      const result = await pool.query<Row>(
        `UPDATE form_sheet_sync SET enabled = false, status = 'disabled',
           locked_until = NULL, run_id = NULL, updated_at = now()
         WHERE user_id = $1 AND form_id = $2
         RETURNING *`,
        [userId, formId],
      );
      return result.rows[0] ? record(result.rows[0]) : null;
    },

    async enable(userId, formId) {
      const result = await pool.query<Row>(
        `UPDATE form_sheet_sync SET enabled = true, status = 'pending', next_sync_at = now(),
           last_error_code = NULL, attempt = 0, updated_at = now()
         WHERE user_id = $1 AND form_id = $2
         RETURNING *`,
        [userId, formId],
      );
      return result.rows[0] ? record(result.rows[0]) : null;
    },

    async claimDue(runId, limit, leaseMs) {
      // A single statement, so the claim is atomic: `FOR UPDATE SKIP LOCKED` inside the subquery is
      // what stops two instances from taking the same form, and the eligibility clause is what
      // stops a live lease from being taken at all.
      const result = await pool.query<Row>(
        `UPDATE form_sheet_sync
            SET status = 'syncing', run_id = $1, locked_until = now() + ($2::int * interval '1 millisecond'),
                attempt = attempt + 1, updated_at = now()
          WHERE id IN (
            SELECT id FROM form_sheet_sync
             WHERE enabled
               AND status <> 'disabled'
               AND next_sync_at <= now()
               AND (locked_until IS NULL OR locked_until < now())
             ORDER BY next_sync_at
             LIMIT $3
             FOR UPDATE SKIP LOCKED
          )
          RETURNING *`,
        [runId, Math.max(1000, Math.min(30 * 60 * 1000, leaseMs)), Math.max(1, Math.min(20, limit))],
      );
      return result.rows.map(record);
    },

    async recordRows(syncId, runId, responseIds) {
      if (!responseIds.length) return [];
      // Inserted only if this run still holds the lease, and counted in the same statement. A run
      // whose lease was taken over writes nothing and reports nothing.
      const result = await pool.query<{ response_id: string }>(
        `WITH fenced AS (
           SELECT id FROM form_sheet_sync WHERE id = $1 AND run_id = $2
         ), inserted AS (
           INSERT INTO form_sheet_row (sync_id, response_id)
           SELECT $1, ids.response_id FROM fenced, unnest($3::text[]) AS ids(response_id)
           ON CONFLICT (sync_id, response_id) DO NOTHING
           RETURNING response_id
         ), bumped AS (
           UPDATE form_sheet_sync
              SET synced_count = synced_count + (SELECT count(*) FROM inserted), updated_at = now()
            WHERE id = $1 AND run_id = $2
         )
         SELECT response_id FROM inserted`,
        [syncId, runId, responseIds],
      );
      if (!result.rows.length && (await isStale(pool, syncId, runId))) throw new StaleSyncRunError();
      return result.rows.map(row => row.response_id);
    },

    async finish(syncId, runId, finish) {
      const result = await pool.query<Row>(
        `UPDATE form_sheet_sync SET
           status = $3,
           cursor_last_submitted = COALESCE($4, cursor_last_submitted),
           next_sync_at = $5,
           last_synced_at = COALESCE($6, last_synced_at),
           last_error_code = $7,
           header_signature = COALESCE($8, header_signature),
           attempt = CASE WHEN $3 IN ('up_to_date', 'pending') THEN 0 ELSE attempt END,
           locked_until = NULL,
           updated_at = now()
         WHERE id = $1 AND run_id = $2
         RETURNING *`,
        [syncId, runId, finish.status, finish.cursorLastSubmitted ?? null, finish.nextSyncAt, finish.lastSyncedAt ?? null, finish.lastErrorCode ?? null, finish.headerSignature ?? null],
      );
      if (!result.rows[0]) throw new StaleSyncRunError();
      return record(result.rows[0]);
    },

    async fail(syncId, runId, input) {
      const result = await pool.query<Row>(
        `UPDATE form_sheet_sync SET
           status = $3, last_error_code = $4, last_error_at = now(), next_sync_at = $5,
           locked_until = NULL, updated_at = now()
         WHERE id = $1 AND run_id = $2
         RETURNING *`,
        [syncId, runId, input.status, input.code, input.retryAt ?? new Date(Date.now() + 24 * 60 * 60 * 1000)],
      );
      if (!result.rows[0]) throw new StaleSyncRunError();
      return record(result.rows[0]);
    },

    async pauseForUser(userId, code) {
      const result = await pool.query(
        `UPDATE form_sheet_sync SET status = 'failed', last_error_code = $2, last_error_at = now(),
           next_sync_at = now() + interval '1 day', locked_until = NULL, run_id = NULL, updated_at = now()
         WHERE user_id = $1 AND enabled
         RETURNING id`,
        [userId, code],
      );
      return result.rowCount ?? 0;
    },

    async countRows(syncId) {
      const result = await pool.query<{ count: string }>(
        'SELECT count(*)::text AS count FROM form_sheet_row WHERE sync_id = $1',
        [syncId],
      );
      return Number(result.rows[0]?.count ?? 0);
    },
  };
}

async function isStale(pool: Pool, syncId: string, runId: string): Promise<boolean> {
  const result = await pool.query('SELECT 1 FROM form_sheet_sync WHERE id = $1 AND run_id = $2', [syncId, runId]);
  return result.rows.length === 0;
}
