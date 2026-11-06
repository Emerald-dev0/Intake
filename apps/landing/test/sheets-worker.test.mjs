/**
 * The thing that makes syncing automatic.
 *
 * There is no queue and no cron in this deployment, so the scheduler is a timer — and a timer is
 * only safe because everything it needs is in the database. These tests are about the seams: a
 * task that is not due is left alone, two ticks cannot run the same form twice, one form failing
 * does not stop the others, and shutting down waits for work that is already running.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createSheetsWorker } from '../server/forms/sheets/worker.ts';
import { createWorld, makeSync, response } from './helpers/sheets-harness.mjs';

const T = minutes => new Date(Date.UTC(2026, 10, 6, 10, minutes, 0)).toISOString();
const NOW = () => new Date('2026-11-06T12:00:00.000Z');

function dueRecord(overrides = {}) {
  return makeSync({
    status: 'pending',
    runId: null,
    attempt: 0,
    lockedUntil: null,
    nextSyncAt: new Date('2026-11-06T11:59:00.000Z'),
    syncedCount: 0,
    ...overrides,
  });
}

test('a tick syncs the forms that are due', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {}), response('r2', T(2), {})] });
  Object.assign(world.store.records.get(world.sync.id), dueRecord());

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  const result = await worker.runOnce();

  assert.equal(result.claimed, 1);
  assert.equal(result.written, 2);
  assert.equal(world.sheets.state.spreadsheets.get(world.sync.spreadsheetId).rows.length, 2);
  assert.equal(world.store.get(world.sync.id).status, 'up_to_date');
});

test('a form that is not due yet is left alone', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  Object.assign(world.store.records.get(world.sync.id), dueRecord({
    status: 'up_to_date',
    nextSyncAt: new Date('2026-11-06T12:04:00.000Z'),
  }));

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  const result = await worker.runOnce();

  assert.equal(result.claimed, 0);
  assert.equal(world.google.state.lists, 0, 'no Google call is made for a form that is not due');
});

test('a sync that was switched off is never picked up', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  Object.assign(world.store.records.get(world.sync.id), dueRecord({ enabled: false, status: 'disabled' }));

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  assert.equal((await worker.runOnce()).claimed, 0);
  assert.equal(world.sheets.state.appends, 0);
});

test('two ticks at once do not run the same form twice', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  Object.assign(world.store.records.get(world.sync.id), dueRecord());

  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const list = world.deps.google.listResponses;
  world.deps.google.listResponses = async (...args) => {
    await gate;
    return list(...args);
  };

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  const first = worker.flush();
  const second = worker.flush();
  release();
  await Promise.all([first, second]);

  assert.equal(world.google.state.lists, 1, 'the second tick joined the first instead of starting another');
  assert.equal(world.sheets.state.spreadsheets.get(world.sync.spreadsheetId).rows.length, 1);
});

test('one form failing does not stop the others in the same tick', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  const broken = dueRecord({ id: 'fss_2', formId: 'form-2', spreadsheetId: 'SHEET_BROKEN_000000000000' });
  Object.assign(world.store.records.get(world.sync.id), dueRecord());
  world.store.records.set('fss_2', broken);

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  const result = await worker.runOnce();

  assert.equal(result.claimed, 2);
  assert.equal(world.store.get(world.sync.id).status, 'up_to_date', 'the healthy form still synced');
  assert.equal(world.store.get('fss_2').status, 'failed', 'and the broken one is recorded as failed');
});

test('a tick that throws does not take the worker down', async () => {
  const world = createWorld({ responses: [] });
  const store = { ...world.store, claimDue: async () => { throw new Error('database is down'); } };
  const errors = [];

  const worker = createSheetsWorker({ store, deps: world.deps, onError: label => errors.push(label) });
  await worker.flush();

  assert.deepEqual(errors, ['Sheet sync tick failed']);
});

test('stopping waits for the run that is already in flight', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  Object.assign(world.store.records.get(world.sync.id), dueRecord());

  let finished = false;
  const append = world.deps.sheets.appendRows;
  world.deps.sheets.appendRows = async (...args) => {
    await new Promise(resolve => setTimeout(resolve, 20));
    const result = await append(...args);
    finished = true;
    return result;
  };

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  worker.start();
  await worker.stop();

  assert.equal(finished, true, 'a half-written run is not abandoned on shutdown');
  assert.equal(world.store.get(world.sync.id).status, 'up_to_date');
});

test('nothing runs after stopping', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  Object.assign(world.store.records.get(world.sync.id), dueRecord());

  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  await worker.stop();
  await worker.flush();

  assert.equal(world.google.state.lists, 0);
});

test('starting twice does not create two timers', async () => {
  const world = createWorld({ responses: [] });
  let ticks = 0;
  const store = {
    ...world.store,
    async claimDue(...args) {
      ticks += 1;
      return world.store.claimDue(...args);
    },
  };
  const worker = createSheetsWorker({ store, deps: world.deps });
  worker.start();
  worker.start();
  await worker.stop();
  assert.equal(ticks, 1, 'one immediate tick, not two');
});

test('the worker never touches a form it was not given a lease for', async () => {
  const world = createWorld({ responses: [response('r1', T(1), {})] });
  const worker = createSheetsWorker({ store: world.store, deps: world.deps });
  // Nothing is due: the record still carries its seeded state.
  assert.equal((await worker.runOnce()).claimed, 0);
  assert.equal(world.google.state.lists, 0);
});
