/**
 * The sync engine: what it writes, when it stops, and why it never writes the same answer twice.
 *
 * The tests that matter most here are the ones about the gap between "Google accepted the append"
 * and "Intake recorded it". Google gives no transaction that spans the two, so the design leans on
 * the spreadsheet itself as the record of what has been written. Every test in the "failure window"
 * section below removes one half of the bookkeeping and asserts that a second run still produces
 * exactly one correct copy of the answers.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runSync, headerFor, headerSignature, classifyFailure, retryDelayMs, MAX_ROWS_PER_RUN } from '../server/forms/sheets/sync.ts';
import { GoogleSheetsApiError } from '../server/forms/sheets/client.ts';
import { StaleSyncRunError } from '../server/forms/sheets/store.ts';
import { FORM, createWorld, connection, formsError, makeSync, networkError, question, response, sheetsError } from './helpers/sheets-harness.mjs';

const T = (minutes) => new Date(Date.UTC(2026, 10, 6, 10, minutes, 0)).toISOString();

function sheetOf(world) {
  return world.sheets.state.spreadsheets.get(world.sync.spreadsheetId);
}

// ------------------------------------------------------------------ initial sync

test('the first run writes the header and every historical response, in order', async () => {
  const world = createWorld({
    responses: [
      response('r1', T(1), { q1: ['Ada'] }),
      response('r2', T(2), { q1: ['Bola'], q2: ['Nothing to add'] }),
    ],
  });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  assert.equal(result.outcome, 'up_to_date');
  assert.equal(result.written, 2);
  const sheet = sheetOf(world);
  assert.deepEqual(sheet.rows.map(row => row[0]), ['r1', 'r2']);
  assert.equal(sheet.rows[0][1], T(1), 'the submission time is written as Google recorded it');
  assert.equal(sheet.rows[1][3], 'Bola');
  assert.equal(sheet.rows[1][4], 'Nothing to add');
  assert.equal(sheet.rows[0][4], '', 'a skipped question leaves an empty cell in its own column');

  const saved = world.store.get(world.sync.id);
  assert.equal(saved.status, 'up_to_date');
  assert.equal(saved.syncedCount, 2);
  assert.equal(saved.cursorLastSubmitted.toISOString(), T(2));
  assert.equal(saved.lastErrorCode, null);
});

test('a sheet that already has the right header is not given a second one', async () => {
  const world = createWorld({
    seedHeader: headerFor([{ id: 'q1', title: 'What is your name?' }, { id: 'q2', title: 'Anything else?' }]),
    responses: [response('r1', T(1), {})],
  });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(world.sheets.state.headerWrites, 0);
  assert.equal(sheetOf(world).rows.length, 1);
});

test('a sheet with no rows gets the header written before anything is appended', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(world.sheets.state.headerWrites, 1);
  assert.deepEqual(sheetOf(world).header, ['Response ID', 'Submitted at', 'Respondent email', 'What is your name?', 'Anything else?']);
});

test('a form with no responses finishes cleanly and writes nothing', async () => {
  const world = createWorld({ seedHeader: headerFor([{ id: 'q1', title: 'What is your name?' }, { id: 'q2', title: 'Anything else?' }]) });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  assert.equal(result.outcome, 'up_to_date');
  assert.equal(result.written, 0);
  assert.equal(world.sheets.state.appends, 0);
  const saved = world.store.get(world.sync.id);
  assert.equal(saved.status, 'up_to_date');
  assert.equal(saved.cursorLastSubmitted, null, 'an empty form does not invent a cursor');
});

// ----------------------------------------------------------------- incremental sync

test('a second run writes only the responses that arrived since the first one', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  world.google.state.responses.push(response('r2', T(6), {}));
  const again = world.store.get(world.sync.id);
  again.runId = 'run_2';
  const result = await runSync(again, 'run_2', world.deps);

  assert.equal(result.written, 1);
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1', 'r2']);
  assert.equal(world.store.get(world.sync.id).cursorLastSubmitted.toISOString(), T(6));
});

test('a run that finds nothing new writes nothing and does not move the cursor', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  const before = world.store.get(world.sync.id).cursorLastSubmitted;

  const again = world.store.get(world.sync.id);
  again.runId = 'run_2';
  const result = await runSync(again, 'run_2', world.deps);

  assert.equal(result.written, 0);
  assert.equal(world.store.get(world.sync.id).cursorLastSubmitted.toISOString(), before.toISOString());
  assert.equal(sheetOf(world).rows.length, 1);
});

test('responses that share a timestamp are never lost to the cursor', async () => {
  // Two answers at the same instant. A run may only take one of them (the row cap), so the next
  // run must start *at* that instant rather than after it.
  const world = createWorld({
    responses: [response('r1', T(1), {}), response('r2', T(1), {})],
    maxRowsPerRun: 1,
  });
  const first = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(first.outcome, 'more', 'the cap hands the rest back to the scheduler');
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1']);

  const second = world.store.get(world.sync.id);
  second.runId = 'run_2';
  await runSync(second, 'run_2', world.deps);

  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1', 'r2'], 'both answers, once each');
});

test('pages are followed to the end, not just the first one', async () => {
  const responses = Array.from({ length: 7 }, (_, index) => response(`r${index + 1}`, T(index + 1), { q1: [`name ${index + 1}`] }));
  const world = createWorld({ responses, pageSize: 2 });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  assert.equal(result.outcome, 'up_to_date');
  assert.equal(result.written, 7);
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1', 'r2', 'r3', 'r4', 'r5', 'r6', 'r7']);
  assert.ok(world.google.state.lists >= 4, 'every page was asked for');
});

test('a long history is written in chunks and completed over several runs', async () => {
  const responses = Array.from({ length: 5 }, (_, index) => response(`r${index + 1}`, T(index + 1), {}));
  const world = createWorld({ responses, maxRowsPerRun: 2, rowsPerAppend: 1 });

  let runs = 0;
  for (;;) {
    const current = world.store.get(world.sync.id);
    current.runId = `run_${runs + 1}`;
    const result = await runSync(current, `run_${runs + 1}`, world.deps);
    runs += 1;
    if (result.outcome === 'up_to_date') break;
    assert.ok(runs < 10, 'the run makes progress instead of looping');
  }

  assert.equal(runs, 3, 'five rows, two at a time');
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1', 'r2', 'r3', 'r4', 'r5']);
  assert.equal(world.store.get(world.sync.id).syncedCount, 5);
});

// ------------------------------------------------------------------ idempotency

test('running the same sync twice writes nothing the second time', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  const again = world.store.get(world.sync.id);
  again.runId = 'run_2';
  // Even with the cursor forced back to the start, the sheet is the source of truth.
  again.cursorLastSubmitted = null;
  await runSync(again, 'run_2', world.deps);

  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1'], 'exactly one row');
  assert.equal(world.store.get(world.sync.id).syncedCount, 1);
});

test('a row somebody deleted from the sheet is written again rather than silently skipped', async () => {
  // The database remembers writing r1, but the sheet no longer holds it. The sheet wins.
  const world = createWorld({ responses: [response('r1', T(1), {}), response('r2', T(2), {})] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  sheetOf(world).rows.shift();

  const again = world.store.get(world.sync.id);
  again.runId = 'run_2';
  again.cursorLastSubmitted = null;
  again.syncedCount = 1;
  await runSync(again, 'run_2', world.deps);

  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r2', 'r1'], 'the missing row is written again');
  // The count is what the database has recorded, and it never goes backwards. The sheet, not the
  // counter, is what decides whether a row is written.
  assert.ok(world.store.get(world.sync.id).syncedCount >= 1);
});

// --------------------------------------------------------------- failure window

test('an append that lands but then throws does not produce a duplicate on the next run', async () => {
  // This is the exact window: Google accepted the rows, Intake never heard back.
  const world = createWorld({ responses: [response('r1', T(1), {}), response('r2', T(2), {})] });
  world.sheets.state.applyThenThrow = networkError();

  const first = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(first.outcome, 'deferred', 'the run stops instead of pretending it succeeded');
  assert.equal(sheetOf(world).rows.length, 2, 'the rows are in the sheet');
  const afterFailure = world.store.get(world.sync.id);
  assert.equal(afterFailure.status, 'delayed');
  assert.equal(afterFailure.cursorLastSubmitted, null, 'the cursor did not move past unwritten work');
  assert.equal(afterFailure.syncedCount, 0, 'and nothing was recorded as written');

  const retry = world.store.get(world.sync.id);
  retry.runId = 'run_2';
  const second = await runSync(retry, 'run_2', world.deps);

  assert.equal(second.written, 0, 'the retry found the rows already there');
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1', 'r2'], 'one copy of each answer');
  const settled = world.store.get(world.sync.id);
  assert.equal(settled.status, 'up_to_date');
  assert.equal(settled.cursorLastSubmitted.toISOString(), T(2), 'and now the cursor is correct');
  assert.equal(settled.syncedCount, 2);
});

test('an append that never landed is retried safely', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  world.sheets.state.failAppend = sheetsError(429, { retryAfterSeconds: 5 });

  const first = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(first.outcome, 'deferred');
  assert.equal(first.errorCode, 'rate_limited');
  assert.equal(sheetOf(world).rows.length, 0);

  const retry = world.store.get(world.sync.id);
  retry.runId = 'run_2';
  const second = await runSync(retry, 'run_2', world.deps);
  assert.equal(second.written, 1);
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1']);
});

test('rows written but never recorded locally are still not written twice', async () => {
  // The second half of the window: the append worked, and the local record failed.
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  const original = world.deps.syncs.recordRows;
  let failures = 1;
  world.deps.syncs.recordRows = async (...args) => {
    if (failures > 0) {
      failures -= 1;
      throw new Error('database went away');
    }
    return original(...args);
  };

  const first = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(first.outcome, 'deferred');
  assert.equal(first.errorCode, 'internal_error');
  assert.equal(sheetOf(world).rows.length, 1, 'the row is in the sheet');

  const retry = world.store.get(world.sync.id);
  retry.runId = 'run_2';
  const second = await runSync(retry, 'run_2', world.deps);
  assert.equal(second.written, 0);
  assert.equal(sheetOf(world).rows.length, 1, 'still exactly one row');
  assert.equal(world.store.get(world.sync.id).syncedCount, 1, 'and the count catches up to reality');
});

test('a partial append batch does not duplicate the part that landed', async () => {
  const responses = [response('r1', T(1), {}), response('r2', T(2), {}), response('r3', T(3), {})];
  const world = createWorld({ responses, rowsPerAppend: 1 });

  // Let the first chunk land, then fail the second.
  const append = world.sheets.client.appendRows;
  let calls = 0;
  world.deps.sheets.appendRows = async (...args) => {
    calls += 1;
    if (calls === 2) throw sheetsError(503);
    return append(...args);
  };

  const first = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(first.outcome, 'deferred');
  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1']);

  const retry = world.store.get(world.sync.id);
  retry.runId = 'run_2';
  world.deps.sheets.appendRows = append;
  await runSync(retry, 'run_2', world.deps);

  assert.deepEqual(sheetOf(world).rows.map(row => row[0]), ['r1', 'r2', 'r3']);
});

// ------------------------------------------------------------------- concurrency

test('a run whose lease was taken over cannot finish or record anything', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  // Another worker claims the same form while this one still believes it holds it.
  world.store.get(world.sync.id).runId = 'run_someone_else';

  await assert.rejects(
    () => runSync(world.store.get(world.sync.id), 'run_1', world.deps),
    error => error instanceof StaleSyncRunError,
  );
});

test('two runs cannot both record the same response', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  const again = world.store.get(world.sync.id);
  again.runId = 'run_2';
  again.cursorLastSubmitted = null;
  await runSync(again, 'run_2', world.deps);

  assert.equal(world.store.rows.get(world.sync.id).size, 1);
});

// ---------------------------------------------------------------- what is stored

test('the sheet gets the answer text exactly as it was written, formula characters included', async () => {
  const world = createWorld({
    responses: [response('r1', T(1), { q1: ['=IMPORTXML("http://x","//a")'], q2: ['line one\nline two, with a comma'] })],
  });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  const row = sheetOf(world).rows[0];
  // RAW input, so Google stores the text and runs nothing. No apostrophe is added to the answer.
  assert.equal(row[3], '=IMPORTXML("http://x","//a")');
  assert.equal(row[4], 'line one\nline two, with a comma');
});

test('a checkbox answer keeps every value in one cell, exactly as the CSV does', async () => {
  const world = createWorld({ responses: [response('r1', T(1), { q2: ['One', 'Two', 'Three'] })] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(sheetOf(world).rows[0][4], 'One, Two, Three');
});

test('non-Latin text arrives unchanged', async () => {
  const world = createWorld({ responses: [response('r1', T(1), { q1: ['アダ', 'أدا', 'Ada 🎉'] })] });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(sheetOf(world).rows[0][3], 'アダ, أدا, Ada 🎉');
});

// -------------------------------------------------------------- destination drift

test('a spreadsheet that is gone stops the sync and says so, instead of retrying forever', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  world.sheets.state.deleted = true;
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'destination_unavailable');
  const saved = world.store.get(world.sync.id);
  assert.equal(saved.status, 'failed');
  assert.ok(saved.nextSyncAt.getTime() > Date.now(), 'it is not due again immediately');
});

test('a tab that was renamed keeps working, because the id is what identifies it', async () => {
  const world = createWorld({
    seedHeader: headerFor([{ id: 'q1', title: 'What is your name?' }, { id: 'q2', title: 'Anything else?' }]),
    responses: [response('r1', T(1), {})],
  });
  sheetOf(world).sheetTitle = 'Answers 2026';
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'up_to_date');
  assert.equal(sheetOf(world).rows.length, 1);
});

test('questions that changed after rows were written stop the sync rather than mislabel them', async () => {
  const world = createWorld({
    seedHeader: ['Response ID', 'Submitted at', 'Respondent email', 'What is your name?', 'Anything else?'],
    seedRows: [['r0', T(1), '', 'Ada', '']],
  });
  world.google.state.questions = [question('q1', 'What is your name?'), question('q2', 'Anything else?'), question('q3', 'Your email?')];

  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'questions_changed');
  assert.equal(sheetOf(world).rows.length, 1, 'nothing was appended into columns that mean something else');
});

test('questions that changed on an empty sheet rewrite the header and carry on', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  world.google.state.questions = [question('q1', 'Your name, please')];
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  assert.equal(result.outcome, 'up_to_date');
  assert.deepEqual(sheetOf(world).header, ['Response ID', 'Submitted at', 'Respondent email', 'Your name, please']);
  assert.equal(world.store.get(world.sync.id).headerSignature, headerSignature([{ id: 'q1', title: 'Your name, please' }]));
  assert.equal(sheetOf(world).rows.length, 1);
});

// ----------------------------------------------------------------------- grants

test('a grant without the spreadsheet permission stops before reading anything', async () => {
  const world = createWorld({
    responses: [response('r1', T(1), {})],
    connection: connection({ scopes: ['openid', 'email', 'https://www.googleapis.com/auth/forms.body'] }),
  });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);

  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'permission_revoked');
  assert.equal(world.google.state.lists, 0, 'no response data is read without the permission');
  assert.equal(sheetOf(world).rows.length, 0);
});

test('a connection that has to be remade stops the run and waits a day', async () => {
  const world = createWorld({ connection: { ok: false, provider: 'google', reason: 'expired' } });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'permission_revoked');
});

test('a form that is no longer yours is not synced', async () => {
  const world = createWorld({ deps: { getForm: async () => ({ ok: false }) } });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'failed');
  assert.equal(result.errorCode, 'form_unavailable');
  assert.equal(world.google.state.lists, 0);
});

// -------------------------------------------------------------------- transient

test('a temporary Forms failure delays the sync instead of failing it', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  world.google.state.failList = formsError(503);
  // Reads are retried; the first call fails, the retry succeeds.
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'up_to_date');
  assert.equal(world.google.state.lists, 2, 'the read was attempted twice');
});

test('a failure that outlasts the retries delays the sync and does not advance the cursor', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  const failure = formsError(503);
  world.deps.google.listResponses = async () => { throw failure; };

  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'deferred');
  assert.equal(result.errorCode, 'forms_unavailable');
  const saved = world.store.get(world.sync.id);
  assert.equal(saved.status, 'delayed');
  assert.equal(saved.cursorLastSubmitted, null);
  assert.ok(saved.nextSyncAt.getTime() > new Date('2026-11-06T12:00:00.000Z').getTime());
});

test('a permanent authorization failure is classified as permanent and not retried in a loop', () => {
  const forbidden = new GoogleSheetsApiError({ operation: 'values.append', kind: 'http', httpStatus: 403 });
  assert.deepEqual(classifyFailure(forbidden), { code: 'permission_revoked', permanent: true });
  const missing = new GoogleSheetsApiError({ operation: 'spreadsheets.get', kind: 'http', httpStatus: 404 });
  assert.deepEqual(classifyFailure(missing), { code: 'destination_unavailable', permanent: true });
  const busy = new GoogleSheetsApiError({ operation: 'values.append', kind: 'http', httpStatus: 429 });
  assert.equal(classifyFailure(busy).permanent, false);
  const timeout = new GoogleSheetsApiError({ operation: 'values.append', kind: 'timeout' });
  assert.equal(classifyFailure(timeout).permanent, false);
});

test('the retry delay grows and is capped', () => {
  assert.ok(retryDelayMs(1) >= 30_000);
  assert.ok(retryDelayMs(2) > retryDelayMs(1) - 5_000);
  assert.ok(retryDelayMs(20) <= 30 * 60 * 1000 + 5_000);
});

// ------------------------------------------------------------------- scheduling

test('a form that just wrote rows is checked again sooner than an idle one', async () => {
  const busy = createWorld({ responses: [response('r1', T(1), {})] });
  await runSync(busy.store.get(busy.sync.id), 'run_1', busy.deps);
  const quiet = createWorld({ responses: [] });
  await runSync(quiet.store.get(quiet.sync.id), 'run_1', quiet.deps);

  const busyDue = busy.store.get(busy.sync.id).nextSyncAt.getTime();
  const quietDue = quiet.store.get(quiet.sync.id).nextSyncAt.getTime();
  assert.ok(busyDue < quietDue, 'a form producing answers is polled more often than an empty one');
});

test('the row cap is a real bound, and the run says there is more', async () => {
  const responses = Array.from({ length: MAX_ROWS_PER_RUN + 5 }, (_, index) => response(`r${index + 1}`, T(index + 1), {}));
  const world = createWorld({ responses });
  const result = await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(result.outcome, 'more');
  assert.equal(result.written, MAX_ROWS_PER_RUN);
  assert.equal(world.store.get(world.sync.id).status, 'pending');
});

test('the sheet is never asked to sync a form the caller does not own', async () => {
  const world = createWorld({
    deps: { getForm: async () => ({ ok: false }) },
    sync: makeSync({ formId: FORM.id }),
  });
  await runSync(world.store.get(world.sync.id), 'run_1', world.deps);
  assert.equal(world.google.state.lists, 0);
});
