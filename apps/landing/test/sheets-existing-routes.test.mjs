/**
 * Connecting a spreadsheet somebody already has.
 *
 * The Picker is a convenience, not a permission: every id in these requests is treated as a claim
 * from the browser and checked again on the server with the caller's own Google connection. The
 * tests below are mostly about the cases where that check fails — a made-up id, a file that is not
 * a spreadsheet, somebody else's file, a worksheet full of other people's data — because those are
 * the moments where a mistake would write into something Intake has no business touching.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createSheetsRouter } from '../server/forms/sheets/routes.ts';
import { readPickerConfig } from '../server/forms/sheets/picker.ts';
import { headerFor } from '../server/forms/sheets/sync.ts';
import {
  connection, createFakeSheets, createMemorySyncStore, FORM, makeSync, sheetsError, FORMS_SCOPE, SHEETS_SCOPE,
} from './helpers/sheets-harness.mjs';

const PICKER = readPickerConfig({ GOOGLE_PICKER_API_KEY: `AIza${'d'.repeat(35)}`, GOOGLE_PICKER_APP_ID: '123456789012' });

const QUESTIONS = [
  { kind: 'question', questionId: 'q1', title: 'What is your name?' },
  { kind: 'question', questionId: 'q2', title: 'Anything else?' },
];
const HEADER = headerFor(QUESTIONS.map(q => ({ id: q.questionId, title: q.title })));

/** An accessible spreadsheet owned by the caller, with whatever worksheets a test needs. */
function ownedSpreadsheet(options = {}) {
  const sheets = createFakeSheets();
  sheets.seed('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', {
    title: 'Support inbox',
    sheetId: 0,
    sheetTitle: 'Responses',
    header: options.header ?? [],
    rows: options.rows ?? [],
    extraSheets: options.extraSheets ?? [],
  });
  return sheets;
}

async function boot(options = {}) {
  const sheets = options.sheets ?? ownedSpreadsheet();
  const store = options.store ?? createMemorySyncStore();
  const calls = { header: 0, sample: 0, sheets: 0 };
  const deps = {
    getSession: async () => (options.signedIn === false ? null : { id: 'user-a', email: 'a@intake.test', name: 'Ada' }),
    getForm: async (_userId, id) => {
      if (options.foreignForm) return { ok: false };
      if (options.otherProvider) return { ok: true, form: { ...FORM, provider: 'typeform' } };
      return id === FORM.id ? { ok: true, form: FORM } : { ok: false };
    },
    entitlement: async () => options.entitlement ?? { plan: 'pro', subscriptionStatus: 'active' },
    getConnection: async () => options.connection ?? connection({ accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString() }),
    syncs: store,
    google: {
      async getForm() {
        return { items: QUESTIONS };
      },
    },
    sheets: {
      ...sheets.client,
      async getSpreadsheet(...args) {
        calls.sheets += 1;
        if (options.failMetadata) throw options.failMetadata;
        return sheets.client.getSpreadsheet(...args);
      },
      async readWorksheetSample(...args) {
        calls.sample += 1;
        if (options.failSample) throw sheetsError(503);
        return sheets.client.readWorksheetSample(...args);
      },
      async writeHeader(...args) {
        calls.header += 1;
        if (options.failHeader) throw sheetsError(503);
        return sheets.client.writeHeader(...args);
      },
    },
    picker: options.picker ?? PICKER,
    abuseLimiter: options.abuseLimiter,
  };

  const app = express();
  app.use(express.json());
  app.use('/api/forms', createSheetsRouter(deps));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  const send = (path, body) => fetch(`${base}${path}`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', accept: 'application/json' },
    body: JSON.stringify(body ?? {}),
  });
  return {
    base, store, sheets, calls, send,
    get: path => fetch(`${base}${path}`, { headers: { accept: 'application/json' } }),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

const INSPECT = `/api/forms/${FORM.id}/sheets/inspect`;
const CONNECT = `/api/forms/${FORM.id}/sheets/connect`;
const SPREADSHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';

// ------------------------------------------------------------------------ inspect

test('inspecting a spreadsheet lists its worksheets, with no verdict yet', async () => {
  const world = await boot({ sheets: ownedSpreadsheet({ extraSheets: [{ sheetId: 7, title: 'Notes' }] }) });
  try {
    const response = await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.title, 'Support inbox');
    assert.equal(body.worksheets.length, 2);
    assert.deepEqual(body.worksheets.map(sheet => sheet.sheetId), [0, 7], 'the numeric id is what a form stores');
    assert.deepEqual(body.worksheets.map(sheet => sheet.title), ['Responses', 'Notes']);
    assert.equal(body.worksheet, null);
    assert.equal(body.assessment, null);
    assert.deepEqual(body.header, HEADER, 'and the columns Intake would write');
    assert.equal(world.calls.header, 0, 'nothing is written while inspecting');
  } finally { await world.close(); }
});

test('inspecting one worksheet says whether it is empty, compatible or unusable', async () => {
  const world = await boot();
  try {
    const empty = await (await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).json();
    assert.equal(empty.worksheet.title, 'Responses');
    assert.equal(empty.assessment.verdict, 'empty');
  } finally { await world.close(); }

  const compatible = await boot({ sheets: ownedSpreadsheet({ header: HEADER, rows: [['r1', '2026-11-06T10:00:00.000Z', '', 'Ada', '']] }) });
  try {
    const body = await (await compatible.send(INSPECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).json();
    assert.equal(body.assessment.verdict, 'compatible');
    assert.equal(body.assessment.existingIds, 1);
  } finally { await compatible.close(); }

  const busy = await boot({ sheets: ownedSpreadsheet({ header: ['Name', 'Email'], rows: [['Ada', 'ada@example.com']] }) });
  try {
    const body = await (await busy.send(INSPECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).json();
    assert.equal(body.assessment.verdict, 'unsuitable');
    assert.match(body.assessment.reason, /content of its own/);
  } finally { await busy.close(); }
});

test('an id that is not shaped like a spreadsheet id is refused before Google is called', async () => {
  const world = await boot();
  try {
    for (const bad of ['', 'short', '../../etc/passwd', 'has spaces in it', `${'a'.repeat(200)}`, 42, null]) {
      const response = await world.send(INSPECT, { spreadsheetId: bad });
      assert.equal(response.status, 400, `${JSON.stringify(bad)} must not reach Google`);
      assert.equal((await response.json()).code, 'invalid_spreadsheet_id');
    }
    assert.equal(world.calls.sheets, 0);
  } finally { await world.close(); }
});

test('a spreadsheet this user cannot open is a plain "not found", with no hint that it exists', async () => {
  const world = await boot({ failMetadata: sheetsError(404) });
  try {
    const response = await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID });
    assert.equal(response.status, 404);
    const body = await response.json();
    assert.equal(body.code, 'spreadsheet_not_found');
    assert.equal(/other user|someone else|permission denied/i.test(body.error), false);
  } finally { await world.close(); }
});

test('a file reachable but without the picker grant is told to pick it again', async () => {
  const world = await boot({ failMetadata: sheetsError(403) });
  try {
    const response = await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'spreadsheet_forbidden');
    assert.match(body.error, /Picker/, 'and names the one action that fixes it');
  } finally { await world.close(); }
});

test('Google being unavailable or rate-limiting is not reported as a bad request', async () => {
  const limited = await boot({ failMetadata: sheetsError(429) });
  try {
    assert.equal((await limited.send(INSPECT, { spreadsheetId: SPREADSHEET_ID })).status, 429);
  } finally { await limited.close(); }

  const broken = await boot({ failMetadata: sheetsError(503) });
  try {
    const response = await broken.send(INSPECT, { spreadsheetId: SPREADSHEET_ID });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'sheets_unavailable');
  } finally { await broken.close(); }
});

test('a worksheet id that is not in the spreadsheet is refused', async () => {
  const world = await boot();
  try {
    for (const sheetId of [7, '0', 1.5]) {
      const response = await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID, sheetId });
      assert.equal(response.status, 404, `${JSON.stringify(sheetId)} is not a worksheet of this file`);
      assert.equal((await response.json()).code, 'worksheet_not_found');
    }
  } finally { await world.close(); }
});

test('a sheet with no tabs at all is not something Intake can write to', async () => {
  const sheets = createFakeSheets();
  sheets.seed(SPREADSHEET_ID, { title: 'Odd', header: [], rows: [] });
  sheets.client.getSpreadsheet = async (_token, spreadsheetId) => ({
    spreadsheetId, title: 'Odd', spreadsheetUrl: null, sheets: [],
  });
  const world = await boot({ sheets });
  try {
    const response = await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID });
    assert.equal(response.status, 422);
    assert.equal((await response.json()).code, 'not_a_spreadsheet');
  } finally { await world.close(); }
});

test('reading a worksheet fails as an upstream problem, not as a verdict', async () => {
  const world = await boot({ failSample: true });
  try {
    const response = await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 502);
    assert.equal((await response.json()).code, 'sheets_unavailable');
  } finally { await world.close(); }
});

test('inspecting is gated exactly like the rest of the panel', async () => {
  const signedOut = await boot({ signedIn: false });
  try { assert.equal((await signedOut.send(INSPECT, { spreadsheetId: SPREADSHEET_ID })).status, 401); } finally { await signedOut.close(); }

  const foreign = await boot({ foreignForm: true });
  try { assert.equal((await foreign.send(INSPECT, { spreadsheetId: SPREADSHEET_ID })).status, 404); } finally { await foreign.close(); }

  const free = await boot({ entitlement: { plan: 'free', subscriptionStatus: 'none' } });
  try { assert.equal((await free.send(INSPECT, { spreadsheetId: SPREADSHEET_ID })).status, 403); } finally { await free.close(); }

  const noScope = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE] }) });
  try {
    const response = await noScope.send(INSPECT, { spreadsheetId: SPREADSHEET_ID });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'sheets_scope_required');
  } finally { await noScope.close(); }
});

// ------------------------------------------------------------------------ connect

test('an empty worksheet gets Intake’s header and starts syncing from the beginning', async () => {
  const world = await boot();
  try {
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 201);
    const body = await response.json();

    assert.equal(body.state, 'initial');
    assert.equal(body.sync.destination, 'selected');
    assert.equal(body.sync.spreadsheetTitle, 'Support inbox');
    assert.equal(body.sync.sheetId, 0);
    assert.equal(body.sync.sheetTitle, 'Responses');
    assert.equal(body.sync.spreadsheetUrl, `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`);
    assert.equal(world.calls.header, 1);
    assert.deepEqual(world.sheets.state.spreadsheets.get(SPREADSHEET_ID).header, HEADER);
    assert.equal(body.sync.cursorLastSubmitted, undefined, 'the cursor is a server detail, not a UI one');
  } finally { await world.close(); }
});

test('a worksheet that already holds this form’s table is used as it is, header untouched', async () => {
  const world = await boot({
    sheets: ownedSpreadsheet({
      header: [...HEADER],
      rows: [
        ['r1', '2026-11-06T09:00:00.000Z', '', 'Ada', ''],
        ['r2', '2026-11-06T09:30:00.000Z', '', 'Bola', 'Yes'],
      ],
    }),
  });
  try {
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 201);
    assert.equal(world.calls.header, 0, 'no header is written over an existing one');
    const body = await response.json();
    assert.equal(body.sync.destination, 'selected');
  } finally { await world.close(); }
});

test('a worksheet with other data in it is refused, and nothing is written', async () => {
  const world = await boot({ sheets: ownedSpreadsheet({ header: ['Name', 'Score'], rows: [['Ada', 42]] }) });
  try {
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'worksheet_unsuitable');
    assert.match(body.error, /content of its own/);
    assert.equal(world.calls.header, 0);
    assert.equal(world.store.records.size, 0, 'and no sync is recorded');
  } finally { await world.close(); }
});

test('content beside the table is refused, because appending would shift it', async () => {
  const world = await boot({
    sheets: ownedSpreadsheet({
      header: [...HEADER],
      rows: [['r1', '2026-11-06T09:00:00.000Z', '', 'Ada', '', '', 'a note somebody typed']],
    }),
  });
  try {
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 409);
    assert.match((await response.json()).error, /columns beside it/);
  } finally { await world.close(); }
});

test('the destination is inspected again when connecting, not trusted from the earlier look', async () => {
  // The screen looked at an empty worksheet; by the time somebody presses the button it is not.
  const world = await boot({
    sheets: ownedSpreadsheet({ header: ['Name'], rows: [['Ada']] }),
  });
  try {
    const inspect = await (await world.send(INSPECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).json();
    assert.equal(inspect.assessment.verdict, 'unsuitable');
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 409, 'the connect request refuses on its own evidence');
    assert.equal(world.calls.header, 0);
  } finally { await world.close(); }
});

test('a form can only have one destination, and a second connect says it is already on', async () => {
  const world = await boot();
  try {
    assert.equal((await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).status, 201);
    const again = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(again.status, 409);
    assert.equal((await again.json()).code, 'already_enabled');
    assert.equal(world.store.records.size, 1, 'the one row is reused, not duplicated');
  } finally { await world.close(); }
});

test('switching a live sync to another spreadsheet needs an explicit confirmation', async () => {
  const store = createMemorySyncStore([makeSync({ spreadsheetId: 'OLD_SPREADSHEET_0123456789ab', sheetTitle: 'Responses' })]);
  const world = await boot({ store });
  try {
    const unconfirmed = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(unconfirmed.status, 409);
    assert.equal((await unconfirmed.json()).code, 'destination_change_unconfirmed');
    assert.equal(world.calls.header, 0, 'nothing is initialised until the answer is yes');

    const confirmed = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0, replace: true });
    assert.equal(confirmed.status, 201);
    const body = await confirmed.json();
    assert.equal(body.sync.spreadsheetId, SPREADSHEET_ID);
    assert.equal(body.sync.destination, 'selected');
    assert.equal(world.store.records.size, 1, 'the form still has exactly one destination');
  } finally { await world.close(); }
});

test('the previous spreadsheet is never touched when the destination changes', async () => {
  const store = createMemorySyncStore([makeSync({ spreadsheetId: 'OLD_SPREADSHEET_0123456789ab' })]);
  const sheets = ownedSpreadsheet();
  sheets.seed('OLD_SPREADSHEET_0123456789ab', { title: 'Old', header: [...HEADER], rows: [['r1', 'x', '', 'Ada', '']] });
  const world = await boot({ store, sheets });
  try {
    const before = structuredClone(sheets.state.spreadsheets.get('OLD_SPREADSHEET_0123456789ab'));
    assert.equal((await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0, replace: true })).status, 201);
    assert.deepEqual(sheets.state.spreadsheets.get('OLD_SPREADSHEET_0123456789ab'), before, 'not a cell changed');
    assert.equal(sheets.state.spreadsheets.get(SPREADSHEET_ID).header.length, HEADER.length);
  } finally { await world.close(); }
});

test('a paused sync can be pointed at another spreadsheet without the confirmation dance', async () => {
  const store = createMemorySyncStore([makeSync({ enabled: false, status: 'disabled' })]);
  const world = await boot({ store });
  try {
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.equal(response.status, 201);
    assert.equal((await response.json()).sync.enabled, true);
  } finally { await world.close(); }
});

test('connecting is gated like the rest of the panel, and never by the browser’s word alone', async () => {
  const signedOut = await boot({ signedIn: false });
  try { assert.equal((await signedOut.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).status, 401); } finally { await signedOut.close(); }

  const noScope = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE] }) });
  try {
    assert.equal((await noScope.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 })).status, 403);
    assert.equal(noScope.calls.header, 0);
  } finally { await noScope.close(); }

  const invalid = await boot();
  try {
    assert.equal((await invalid.send(CONNECT, { spreadsheetId: 'nope', sheetId: 0 })).status, 400);
    assert.equal(invalid.calls.header, 0);
  } finally { await invalid.close(); }
});

test('a header that cannot be written leaves no half-connected sync behind', async () => {
  const world = await boot({ failHeader: true });
  try {
    const response = await world.send(CONNECT, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 });
    assert.ok(response.status >= 500);
    assert.equal(world.store.records.size, 0);
  } finally { await world.close(); }
});
