/**
 * Who may set up a spreadsheet sync, what they are told when they may not, and what turning it off
 * does.
 *
 * Creating a spreadsheet is a write into somebody's own Drive, so the gate matters twice over: the
 * form has to be theirs, the plan has to allow it, and the Google grant has to include the
 * spreadsheet permission they were asked for. Switching it off must work in every one of those
 * states — including the state where Google access has lapsed, because that is exactly when
 * somebody wants it to stop.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createSheetsRouter } from '../server/forms/sheets/routes.ts';
import { connection, createFakeSheets, createMemorySyncStore, FORM, sheetsError, FORMS_SCOPE, SHEETS_SCOPE } from './helpers/sheets-harness.mjs';

async function boot(options = {}) {
  const sheets = options.sheets ?? createFakeSheets();
  const store = options.store ?? createMemorySyncStore();
  const calls = { getForm: 0, create: 0, header: 0 };
  const deps = {
    getSession: async () => (options.signedIn === false ? null : { id: 'user-a', email: 'a@intake.test', name: 'Ada' }),
    getForm: async (_userId, id) => {
      if (options.foreignForm) return { ok: false };
      if (options.otherProvider) return { ok: true, form: { ...FORM, provider: 'typeform' } };
      return id === FORM.id ? { ok: true, form: FORM } : { ok: false };
    },
    entitlement: async () => options.entitlement ?? { plan: 'pro', subscriptionStatus: 'active' },
    getConnection: async () => options.connection ?? connection(),
    syncs: store,
    google: {
      async getForm() {
        calls.getForm += 1;
        if (options.failQuestions) throw sheetsError(500);
        return { items: [
          { kind: 'question', questionId: 'q1', title: 'What is your name?' },
          { kind: 'question', questionId: 'q2', title: 'Anything else?' },
          { kind: 'section', title: 'Thanks' },
        ] };
      },
    },
    sheets: {
      ...sheets.client,
      async createSpreadsheet(token, input) {
        calls.create += 1;
        if (options.failCreate) throw sheetsError(403);
        return sheets.client.createSpreadsheet(token, input);
      },
      async writeHeader(...args) {
        calls.header += 1;
        if (options.failHeader) throw sheetsError(503);
        return sheets.client.writeHeader(...args);
      },
    },
    abuseLimiter: options.abuseLimiter,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/forms', createSheetsRouter(deps));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    store,
    sheets,
    calls,
    close: () => new Promise(resolve => server.close(resolve)),
    get: path => fetch(`${base}${path}`, { method: 'GET', headers: { accept: 'application/json' } }),
    post: path => fetch(`${base}${path}`, { method: 'POST', headers: { accept: 'application/json' } }),
    del: path => fetch(`${base}${path}`, { method: 'DELETE', headers: { accept: 'application/json' } }),
  };
}

// The helpers above need `base`; wrap them so each test can call `world.get(...)` directly.
function client(world) {
  return {
    get: path => fetch(`${world.base}${path}`),
    post: path => fetch(`${world.base}${path}`, { method: 'POST' }),
    del: path => fetch(`${world.base}${path}`, { method: 'DELETE' }),
  };
}

const SHEETS_PATH = `/api/forms/${FORM.id}/sheets`;

// -------------------------------------------------------------------------- gate

test('a signed-out visitor is refused', async () => {
  const world = await boot({ signedIn: false });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 401);
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

test('a form that is not the caller’s own is refused without admitting it exists', async () => {
  const world = await boot({ foreignForm: true });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 404);
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

test('a form that is not a Google Form has no spreadsheet to sync', async () => {
  const world = await boot({ otherProvider: true });
  try {
    assert.equal((await client(world).post(SHEETS_PATH)).status, 404);
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

test('someone not on Pro is told to upgrade before anything is created', async () => {
  const world = await boot({ entitlement: { plan: 'free', subscriptionStatus: 'none' } });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'pro_required');
    assert.equal(world.calls.create, 0, 'no spreadsheet is created for an account that cannot use it');
  } finally { await world.close(); }
});

test('a lapsed Google connection is told to reconnect', async () => {
  const world = await boot({ connection: { ok: false, provider: 'google', reason: 'expired' } });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'reauthorization_required');
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

test('without the spreadsheet permission nothing is created, and the screen says why', async () => {
  const world = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE] }) });
  try {
    const post = await client(world).post(SHEETS_PATH);
    assert.equal(post.status, 403);
    assert.equal((await post.json()).code, 'sheets_scope_required');
    assert.equal(world.calls.create, 0, 'no spreadsheet is created without the permission it needs');

    const status = await client(world).get(SHEETS_PATH);
    assert.equal(status.status, 200);
    const body = await status.json();
    assert.equal(body.state, 'awaiting_authorization');
    assert.equal(body.canSync, false);
    assert.equal(body.sync, null);
  } finally { await world.close(); }
});

// ----------------------------------------------------------------------- create

test('setting up syncing creates one spreadsheet with a header and reports a first sync', async () => {
  const world = await boot();
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 201);
    const body = await response.json();

    assert.equal(world.calls.create, 1);
    assert.equal(world.sheets.state.created.length, 1);
    const created = world.sheets.state.created[0];
    assert.equal(created.title, 'Customer feedback — Intake Responses');
    assert.equal(created.sheetTitle, 'Responses');

    assert.deepEqual(world.sheets.state.spreadsheets.get(body.sync.spreadsheetId).header, [
      'Response ID', 'Submitted at', 'Respondent email', 'What is your name?', 'Anything else?',
    ], 'one column per question, in the order the form asks them, and no column for a non-question');

    assert.equal(body.state, 'initial');
    assert.equal(body.canSync, true);
    assert.equal(body.sync.enabled, true);
    assert.equal(body.sync.syncedCount, 0);
    assert.equal(body.sync.lastSyncedAt, null);
    assert.match(body.sync.spreadsheetUrl, /^https:\/\/docs\.google\.com\/spreadsheets\/d\//);
  } finally { await world.close(); }
});

test('pressing it twice does not build a second spreadsheet', async () => {
  const world = await boot();
  try {
    assert.equal((await client(world).post(SHEETS_PATH)).status, 201);
    const second = await client(world).post(SHEETS_PATH);
    assert.equal(second.status, 409);
    assert.equal((await second.json()).code, 'already_enabled');
    assert.equal(world.calls.create, 1);
    assert.equal(world.sheets.state.created.length, 1);
  } finally { await world.close(); }
});

test('a header that fails to write does not throw away the spreadsheet that was created', async () => {
  const world = await boot({ failHeader: true });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 201);
    const body = await response.json();
    assert.equal(body.state, 'initial');
    assert.deepEqual(world.sheets.state.spreadsheets.get(body.sync.spreadsheetId).header, []);
    // The first scheduled run writes the header before it writes any rows.
    const saved = await world.store.findByForm('user-a', FORM.id);
    assert.equal(saved.spreadsheetId, body.sync.spreadsheetId);
    assert.equal(saved.headerSignature.length > 2, true);
  } finally { await world.close(); }
});

test('a spreadsheet Google refuses to create is reported as a connection problem, not a crash', async () => {
  const world = await boot({ failCreate: true });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'reauthorization_required');
    assert.equal(world.store.records.size, 0, 'nothing is remembered about a spreadsheet that does not exist');
  } finally { await world.close(); }
});

test('a failure reading the questions stops before creating anything', async () => {
  const world = await boot({ failQuestions: true });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 502);
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

// ---------------------------------------------------------------------- status

const states = [
  ['up_to_date', { status: 'up_to_date', syncedCount: 12 }, 'up_to_date'],
  ['initial', { status: 'pending', syncedCount: 0 }, 'initial'],
  ['syncing', { status: 'syncing', syncedCount: 3 }, 'syncing'],
  ['delayed', { status: 'delayed', lastErrorCode: 'rate_limited' }, 'delayed'],
  ['revoked', { status: 'failed', lastErrorCode: 'permission_revoked' }, 'permission_revoked'],
  ['destination', { status: 'failed', lastErrorCode: 'destination_unavailable' }, 'destination_unavailable'],
  ['questions', { status: 'failed', lastErrorCode: 'questions_changed' }, 'questions_changed'],
  ['other', { status: 'failed', lastErrorCode: 'internal_error' }, 'failed'],
  ['disabled', { status: 'disabled', enabled: false }, 'disabled'],
];

for (const [label, overrides, expected] of states) {
  test(`the screen is told "${expected}" for a ${label} sync`, async () => {
    const store = createMemorySyncStore();
    const record = {
      id: 'fss_1',
      formId: FORM.id,
      userId: 'user-a',
      spreadsheetId: 'SHEET_ID_1234567890abcdef',
      spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_1234567890abcdef/edit',
      sheetTitle: 'Responses',
      headerSignature: '[]',
      enabled: true,
      cursorLastSubmitted: null,
      syncedCount: 0,
      lastSyncedAt: new Date('2026-11-06T10:00:00.000Z'),
      lastErrorCode: null,
      lastErrorAt: null,
      attempt: 0,
      nextSyncAt: new Date('2026-11-06T12:05:00.000Z'),
      lockedUntil: null,
      runId: null,
      createdAt: new Date('2026-11-06T09:00:00.000Z'),
      updatedAt: new Date('2026-11-06T09:00:00.000Z'),
      ...overrides,
    };
    store.records.set(record.id, record);

    const world = await boot({ store });
    try {
      const body = await (await client(world).get(SHEETS_PATH)).json();
      assert.equal(body.state, expected);
      assert.equal(body.sync.lastSyncedAt, '2026-11-06T10:00:00.000Z');
      assert.equal(body.sync.syncedCount, overrides.syncedCount ?? 0);
    } finally { await world.close(); }
  });
}

test('the status call is never cached by a browser or a proxy', async () => {
  const world = await boot();
  try {
    const response = await client(world).get(SHEETS_PATH);
    assert.equal(response.headers.get('cache-control'), 'no-store');
  } finally { await world.close(); }
});

test('the status call does not need the spreadsheet permission', async () => {
  const store = createMemorySyncStore();
  const world = await boot({ store, connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE] }) });
  try {
    const response = await client(world).get(SHEETS_PATH);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).state, 'awaiting_authorization');
  } finally { await world.close(); }
});

test('a revoked grant is reported as such even when the last sync succeeded', async () => {
  const store = createMemorySyncStore();
  store.records.set('fss_1', {
    id: 'fss_1', formId: FORM.id, userId: 'user-a',
    spreadsheetId: 'SHEET_ID_1234567890abcdef', spreadsheetUrl: null, sheetTitle: 'Responses', headerSignature: '[]',
    status: 'up_to_date', enabled: true, cursorLastSubmitted: null, syncedCount: 4, lastSyncedAt: null,
    lastErrorCode: null, lastErrorAt: null, attempt: 0, nextSyncAt: new Date(), lockedUntil: null, runId: null,
  });
  const world = await boot({ store, connection: { ok: false, provider: 'google', reason: 'revoked' } });
  try {
    const body = await (await client(world).get(SHEETS_PATH)).json();
    assert.equal(body.state, 'reconnect_required');
    assert.equal(body.canSync, false);
    assert.equal(body.sync.syncedCount, 4, 'what was already written is still reported');
  } finally { await world.close(); }
});

// -------------------------------------------------------------------- switching

test('switching syncing off keeps the spreadsheet and stops the schedule', async () => {
  const world = await boot();
  try {
    const created = await (await client(world).post(SHEETS_PATH)).json();
    const response = await client(world).del(SHEETS_PATH);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'disabled');
    assert.equal(body.sync.enabled, false);
    assert.ok(world.sheets.state.spreadsheets.get(created.sync.spreadsheetId), 'the file is still there');

    const status = await (await client(world).get(SHEETS_PATH)).json();
    assert.equal(status.state, 'disabled');
  } finally { await world.close(); }
});

test('syncing can be switched off even when Google access has lapsed', async () => {
  const store = createMemorySyncStore();
  store.records.set('fss_1', {
    id: 'fss_1', formId: FORM.id, userId: 'user-a',
    spreadsheetId: 'SHEET_ID_1234567890abcdef', spreadsheetUrl: null, sheetTitle: 'Responses', headerSignature: '[]',
    status: 'failed', enabled: true, cursorLastSubmitted: null, syncedCount: 0, lastSyncedAt: null,
    lastErrorCode: 'permission_revoked', lastErrorAt: null, attempt: 3, nextSyncAt: new Date(), lockedUntil: null, runId: null,
  });
  const world = await boot({ store, connection: { ok: false, provider: 'google', reason: 'revoked' } });
  try {
    const response = await client(world).del(SHEETS_PATH);
    assert.equal(response.status, 200, 'a person can always stop it');
    assert.equal((await response.json()).state, 'disabled');
  } finally { await world.close(); }
});

test('switching a disabled sync back on resumes the same spreadsheet', async () => {
  const world = await boot();
  try {
    const created = await (await client(world).post(SHEETS_PATH)).json();
    await client(world).del(SHEETS_PATH);

    const response = await client(world).post(`${SHEETS_PATH}/enable`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'initial');
    assert.equal(body.sync.spreadsheetId, created.sync.spreadsheetId, 'the same file, not a new one');
    assert.equal(world.calls.create, 1);
  } finally { await world.close(); }
});

test('starting over after switching off builds a new spreadsheet and forgets the old cursor', async () => {
  const world = await boot();
  try {
    const first = await (await client(world).post(SHEETS_PATH)).json();
    await client(world).del(SHEETS_PATH);

    const second = await client(world).post(SHEETS_PATH);
    assert.equal(second.status, 201);
    const body = await second.json();
    assert.notEqual(body.sync.spreadsheetId, first.sync.spreadsheetId);
    assert.equal(body.sync.syncedCount, 0);
    assert.equal(world.sheets.state.created.length, 2);
    assert.ok(world.sheets.state.spreadsheets.get(first.sync.spreadsheetId), 'the old file is left alone, not deleted');
  } finally { await world.close(); }
});

test('asking for a sync now queues it instead of holding the request open', async () => {
  const world = await boot();
  try {
    await client(world).post(SHEETS_PATH);
    const response = await client(world).post(`${SHEETS_PATH}/sync`);
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.state, 'initial');
    assert.ok(body.sync.nextSyncAt, 'the worker is told it is due');
    assert.equal(world.calls.create, 1, 'and no second spreadsheet is created');
  } finally { await world.close(); }
});

test('a sync that is switched off cannot be nudged into running', async () => {
  const world = await boot();
  try {
    await client(world).post(SHEETS_PATH);
    await client(world).del(SHEETS_PATH);
    const response = await client(world).post(`${SHEETS_PATH}/sync`);
    assert.equal(response.status, 409);
    assert.equal((await response.json()).code, 'disabled');
  } finally { await world.close(); }
});

test('a form with no spreadsheet yet has nothing to resume, nudge or switch off', async () => {
  const world = await boot();
  try {
    for (const path of [`${SHEETS_PATH}/enable`, `${SHEETS_PATH}/sync`]) {
      const response = await client(world).post(path);
      assert.equal(response.status, 404);
      assert.equal((await response.json()).code, 'not_enabled');
    }
    assert.equal((await client(world).del(SHEETS_PATH)).status, 404);
  } finally { await world.close(); }
});

test('the router answers a rate limit rather than calling Google', async () => {
  const world = await boot({
    abuseLimiter: {
      async consume() {
        return { ok: false, reason: 'rate_limited', retryAfterSeconds: 60 };
      },
    },
  });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 429);
    assert.equal(response.headers.get('retry-after'), '60');
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

test('a rate limiter that is down refuses the request instead of letting it through', async () => {
  const world = await boot({
    abuseLimiter: {
      async consume() { throw new Error('redis is gone'); },
    },
  });
  try {
    const response = await client(world).post(SHEETS_PATH);
    assert.equal(response.status, 503);
    assert.equal(world.calls.create, 0);
  } finally { await world.close(); }
});

test('no response ever carries a token', async () => {
  const world = await boot();
  try {
    const created = await (await client(world).post(SHEETS_PATH)).text();
    const status = await (await client(world).get(SHEETS_PATH)).text();
    for (const body of [created, status]) {
      assert.ok(!body.includes('ACCESS_TOKEN'));
      assert.ok(!body.includes('accessToken'));
      assert.ok(!body.includes('refresh'));
    }
  } finally { await world.close(); }
});
