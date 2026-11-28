/**
 * The sync store against a real PostgreSQL engine.
 *
 * The guarantees this feature makes to the user rest on four statements here: only one worker can
 * hold a form at a time, a lease that expires can be taken over, a superseded run cannot record or
 * finish, and recording an id twice changes nothing. If any of those were merely hopeful, the
 * engine above them would write duplicate rows.
 */

import { before, after, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresSheetsSyncStore, StaleSyncRunError, DEFAULT_LEASE_MS } from '../server/forms/sheets/store.ts';

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;
let store;

/** PGlite speaks SQL but not the `pg` pool interface, so it is given the shape the store expects. */
function poolFor(database) {
  return {
    async query(text, params) {
      const result = await database.query(text, params);
      return { rows: result.rows, rowCount: result.rows.length };
    },
    async connect() {
      return {
        query: (text, params) => poolFor(database).query(text, params),
        release() {},
      };
    },
  };
}

before(async () => {
  db = new PGlite();
  // The two tables 045 points at, reduced to the columns the foreign keys need.
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY);');
  await db.exec('CREATE TABLE form (id text PRIMARY KEY, user_id text NOT NULL REFERENCES "user"(id) ON DELETE CASCADE);');
  await db.exec(await migration('045_form_sheet_sync.sql'));
  await db.exec(await migration('047_sheet_sync_destination.sql'));
  store = createPostgresSheetsSyncStore(poolFor(db));
  await db.exec(`INSERT INTO "user" (id) VALUES ('user-a'), ('user-b');`);
  await db.exec(`INSERT INTO form (id, user_id) VALUES ('form-1', 'user-a'), ('form-2', 'user-a');`);
});

after(async () => {
  await db?.close();
});

beforeEach(async () => {
  await db.exec('DELETE FROM form_sheet_row; DELETE FROM form_sheet_sync;');
  await db.exec(`INSERT INTO form (id, user_id) VALUES ('form-1', 'user-a'), ('form-2', 'user-a') ON CONFLICT (id) DO NOTHING;`);
});

const base = (overrides = {}) => ({
  formId: 'form-1',
  userId: 'user-a',
  spreadsheetId: 'SHEET_ID_1234567890abcdef',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_1234567890abcdef/edit',
  sheetId: 0,
  sheetTitle: 'Responses',
  headerSignature: '[["q1","Name"]]',
  ...overrides,
});

test('a new sync starts pending, enabled and due immediately', async () => {
  const created = await store.create(base());
  assert.equal(created.status, 'pending');
  assert.equal(created.enabled, true);
  assert.equal(created.cursorLastSubmitted, null);
  assert.equal(created.attempt, 0);

  const due = await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  assert.equal(due.length, 1);
  assert.equal(due[0].id, created.id);
  assert.equal(due[0].runId, 'run_1');
});

test('a form can only have one destination', async () => {
  await store.create(base());
  await assert.rejects(() => store.create(base({ spreadsheetId: 'SHEET_ID_other_0987654321' })));
});

test('only one worker can hold a form at a time', async () => {
  await store.create(base());
  const first = await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  assert.equal(first.length, 1);

  const second = await store.claimDue('run_2', 10, DEFAULT_LEASE_MS);
  assert.equal(second.length, 0, 'the held lease keeps the second worker out');
});

test('a lease that expires can be taken over, and the old run is fenced off', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);

  // What a process that died mid-run leaves behind: a claimed row whose lease has run out.
  await db.query(`UPDATE form_sheet_sync SET locked_until = now() - interval '1 minute' WHERE id = $1`, [created.id]);
  const second = await store.claimDue('run_2', 10, DEFAULT_LEASE_MS);
  assert.equal(second.length, 1, 'the expired lease does not lock the form forever');
  assert.equal(second[0].runId, 'run_2');

  await assert.rejects(() => store.recordRows(created.id, 'run_1', ['r1']), error => error instanceof StaleSyncRunError);
  await assert.rejects(() => store.finish(created.id, 'run_1', {
    status: 'up_to_date', cursorLastSubmitted: '2026-11-06T10:00:00.000Z', headerSignature: 'x', nextSyncAt: new Date(),
  }), error => error instanceof StaleSyncRunError);
  await assert.rejects(() => store.fail(created.id, 'run_1', { status: 'failed', code: 'internal_error' }), error => error instanceof StaleSyncRunError);

  const rows = await store.countRows(created.id);
  assert.equal(rows, 0, 'the superseded run recorded nothing');
});

test('recording the same id twice changes nothing', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);

  const first = await store.recordRows(created.id, 'run_1', ['r1', 'r2']);
  const again = await store.recordRows(created.id, 'run_1', ['r1', 'r2', 'r3']);
  assert.deepEqual(first, ['r1', 'r2']);
  assert.deepEqual(again, ['r3'], 'only the new id is reported');
  assert.equal(await store.countRows(created.id), 3);
});

test('a form that is not due is left alone', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  await store.finish(created.id, 'run_1', {
    status: 'up_to_date',
    cursorLastSubmitted: '2026-11-06T10:00:00.000Z',
    headerSignature: '[["q1","Name"]]',
    nextSyncAt: new Date(Date.now() + 60 * 60 * 1000),
    lastSyncedAt: new Date(),
  });

  const due = await store.claimDue('run_2', 10, DEFAULT_LEASE_MS);
  assert.equal(due.length, 0);
});

test('disabling stops the schedule without touching the destination', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);

  const disabled = await store.disable('user-a', 'form-1');
  assert.equal(disabled.status, 'disabled');
  assert.equal(disabled.enabled, false);
  assert.equal((await store.claimDue('run_2', 10, DEFAULT_LEASE_MS)).length, 0);
  assert.equal(disabled.spreadsheetUrl, created.spreadsheetUrl, 'the spreadsheet is still known, not deleted');
});

test('enabling again makes the form due immediately and clears the failure', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  await store.fail(created.id, 'run_1', { status: 'failed', code: 'permission_revoked', retryAt: new Date(Date.now() + 86_400_000) });
  await store.disable('user-a', 'form-1');

  const enabled = await store.enable('user-a', 'form-1');
  assert.equal(enabled.enabled, true);
  assert.equal(enabled.status, 'pending');
  assert.equal(enabled.lastErrorCode, null);
  assert.equal((await store.claimDue('run_3', 10, DEFAULT_LEASE_MS)).length, 1);
});

test('one person cannot reach another person’s sync', async () => {
  await store.create(base());
  assert.equal(await store.findByForm('user-b', 'form-1'), null);
  assert.equal(await store.disable('user-b', 'form-1'), null);
  assert.equal(await store.enable('user-b', 'form-1'), null);
});

test('the cursor and header signature are read back exactly as written', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  await store.finish(created.id, 'run_1', {
    status: 'up_to_date',
    cursorLastSubmitted: '2026-11-06T10:04:00.000Z',
    headerSignature: '[["q1","姓名"]]',
    nextSyncAt: new Date(Date.now() + 5 * 60 * 1000),
    lastSyncedAt: new Date('2026-11-06T10:05:00.000Z'),
  });

  const read = await store.findById(created.id);
  assert.equal(read.cursorLastSubmitted.toISOString(), '2026-11-06T10:04:00.000Z');
  assert.equal(read.headerSignature, '[["q1","姓名"]]');
  assert.equal(read.status, 'up_to_date');
});

test('a failure records a code and a time, and the next attempt is scheduled', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  const retryAt = new Date(Date.now() + 120_000);
  const failed = await store.fail(created.id, 'run_1', { status: 'delayed', code: 'rate_limited', retryAt });

  assert.equal(failed.status, 'delayed');
  assert.equal(failed.lastErrorCode, 'rate_limited');
  assert.ok(failed.lastErrorAt instanceof Date);
  assert.equal((await store.claimDue('run_2', 10, DEFAULT_LEASE_MS)).length, 0, 'it waits rather than hammering Google');
});

test('deleting the form removes the sync and every id it recorded', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  await store.recordRows(created.id, 'run_1', ['r1', 'r2']);

  await db.exec(`DELETE FROM form WHERE id = 'form-1';`);

  assert.equal(await store.findById(created.id), null);
  const rows = await db.query('SELECT count(*)::int AS count FROM form_sheet_row;');
  assert.equal(rows.rows[0].count, 0, 'no orphaned ids are left behind');
});

test('restarting a sync forgets the cursor and the ids, and re-reads the sheet', async () => {
  const created = await store.create(base());
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  await store.recordRows(created.id, 'run_1', ['r1']);
  await store.finish(created.id, 'run_1', {
    status: 'up_to_date', cursorLastSubmitted: '2026-11-06T10:00:00.000Z', headerSignature: 'x', nextSyncAt: new Date(),
  });

  const restarted = await store.restart(created.id, {
    spreadsheetId: 'SHEET_ID_second_destination_0001',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_second_destination_0001/edit',
    sheetId: 0,
    sheetTitle: 'Responses',
    headerSignature: '[["q1","Name"]]',
  });

  assert.equal(restarted.spreadsheetId, 'SHEET_ID_second_destination_0001');
  assert.equal(restarted.cursorLastSubmitted, null);
  assert.equal(restarted.syncedCount, 0);
  assert.equal(await store.countRows(created.id), 0);
  assert.equal(restarted.status, 'pending');
});

// ------------------------------------------------- Phase D: which kind of destination

test('a sync Intake created is recorded as created, with the title it made', async () => {
  const created = await store.create(base({ spreadsheetTitle: 'Customer feedback — Intake Responses' }));
  assert.equal(created.destination, 'created', 'the default matches Phase C rows and the column default');
  assert.equal(created.spreadsheetTitle, 'Customer feedback — Intake Responses');
});

test('a spreadsheet somebody chose is recorded as selected, with its title for display', async () => {
  const created = await store.create(base({ destination: 'selected', spreadsheetTitle: 'Team tracker', sheetTitle: 'Sheet 2' }));
  assert.equal(created.destination, 'selected');
  assert.equal(created.spreadsheetTitle, 'Team tracker');
  assert.equal(created.sheetTitle, 'Sheet 2');

  const found = await store.findByForm('user-a', 'form-1');
  assert.equal(found.destination, 'selected', 'the kind survives a read, so the panel can label it');
});

test('a destination has to be one of the two kinds the schema knows', async () => {
  await assert.rejects(() => store.create(base({ destination: 'guessed' })), /destination/);
});

test('a title longer than a reasonable name is refused by the column, not stored truncated', async () => {
  await assert.rejects(() => store.create(base({ spreadsheetTitle: 'x'.repeat(201) })), /spreadsheet_title/);
});

test('restarting a sync at a new destination keeps one row and resets the journey', async () => {
  const first = await store.create(base({ spreadsheetTitle: 'First', destination: 'created' }));
  // A real run holds the lease before it may record anything.
  await store.claimDue('run_1', 10, DEFAULT_LEASE_MS);
  await store.recordRows(first.id, 'run_1', ['r1', 'r2']);

  const moved = await store.restart(first.id, {
    spreadsheetId: 'OTHER_SHEET_ID_0123456789ab',
    spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/OTHER_SHEET_ID_0123456789ab/edit',
    spreadsheetTitle: 'Somebody’s own file',
    destination: 'selected',
    sheetId: 7,
    sheetTitle: 'Sheet 2',
    headerSignature: '[["q1","Name"]]',
  });

  assert.equal(moved.id, first.id, 'the form still has exactly one destination');
  assert.equal(moved.destination, 'selected');
  assert.equal(moved.spreadsheetTitle, 'Somebody’s own file');
  assert.equal(moved.sheetId, 7);
  assert.equal(moved.syncedCount, 0, 'the new destination starts from the beginning');
  assert.equal(moved.cursorLastSubmitted, null);
  assert.equal(moved.enabled, true);
  assert.equal(moved.status, 'pending');

  const rows = await store.countRows(first.id);
  assert.equal(rows, 0, 'and the old ledger of written ids goes with the old destination');
});

test('renaming a tab or a file updates the names without disturbing the sync', async () => {
  const created = await store.create(base({ destination: 'selected', spreadsheetTitle: 'Tracker' }));
  await store.retitle(created.id, { sheetTitle: 'Answers 2026', spreadsheetTitle: 'Tracker (final)' });

  const found = await store.findById(created.id);
  assert.equal(found.sheetTitle, 'Answers 2026');
  assert.equal(found.spreadsheetTitle, 'Tracker (final)');
  assert.equal(found.destination, 'selected', 'and nothing else changes');
  assert.equal(found.enabled, true);
});

test('a retitle with nothing to say changes nothing', async () => {
  const created = await store.create(base({ spreadsheetTitle: 'Tracker' }));
  await store.retitle(created.id, {});
  const found = await store.findById(created.id);
  assert.equal(found.sheetTitle, 'Responses');
  assert.equal(found.spreadsheetTitle, 'Tracker');
});
