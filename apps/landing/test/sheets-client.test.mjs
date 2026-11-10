/**
 * The Sheets client, against a stubbed network.
 *
 * Two things are asserted over and over here, because they are the ones that would hurt: nothing
 * that reaches Google is interpreted (RAW, exact text), and no write is ever sent twice by this
 * layer. Everything else is parameter shape and error translation.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleSheetsClient, GoogleSheetsApiError, isSpreadsheetId, columnLetter } from '../server/forms/sheets/client.ts';

const ID = 'SHEET_ID_1234567890abcdef';
const TOKEN = 'ACCESS_TOKEN';

function stub(handler) {
  const calls = [];
  const fetchImpl = async (url, init = {}) => {
    calls.push({ url: new URL(url), init, body: init.body ? JSON.parse(String(init.body)) : null });
    return handler(calls[calls.length - 1], calls.length);
  };
  return { calls, fetchImpl, client: createGoogleSheetsClient({ fetchImpl }) };
}

const json = (body, init = {}) => new Response(JSON.stringify(body), {
  status: 200,
  headers: { 'content-type': 'application/json', ...(init.headers ?? {}) },
  ...init,
});

// ----------------------------------------------------------------------- create

test('creating a spreadsheet asks for a title and the first tab in one request', async () => {
  const { calls, client } = stub(() => json({
    spreadsheetId: ID,
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`,
    sheets: [{ properties: { sheetId: 0, title: 'Responses' } }],
  }));

  const created = await client.createSpreadsheet(TOKEN, { title: 'Customer feedback — Intake Responses', sheetTitle: 'Responses' });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url.origin, 'https://sheets.googleapis.com');
  assert.equal(calls[0].url.pathname, '/v4/spreadsheets');
  assert.deepEqual(calls[0].body, {
    properties: { title: 'Customer feedback — Intake Responses' },
    sheets: [{ properties: { title: 'Responses' } }],
  });
  assert.equal(created.spreadsheetId, ID);
  assert.equal(created.sheetId, 0);
  assert.equal(created.sheetTitle, 'Responses');
  assert.equal(calls[0].init.headers.authorization, `Bearer ${TOKEN}`, 'the token travels in the header only');
  assert.equal(calls[0].url.search, '', 'and never in the URL');
});

test('a create response without a usable tab id is refused rather than half-used', async () => {
  const { client } = stub(() => json({ spreadsheetId: ID, sheets: [{ properties: { title: 'Responses' } }] }));
  await assert.rejects(
    () => client.createSpreadsheet(TOKEN, { title: 'x', sheetTitle: 'Responses' }),
    error => error instanceof GoogleSheetsApiError && error.info.kind === 'malformed_response',
  );
});

test('an id that does not look like a spreadsheet id is never sent anywhere', async () => {
  const { calls, client } = stub(() => json({}));
  for (const bad of ['', '../../etc/passwd', 'abc', 'x'.repeat(400), 'has spaces in it']) {
    await assert.rejects(
      () => client.getSpreadsheet(TOKEN, bad),
      error => error instanceof GoogleSheetsApiError && error.info.kind === 'malformed_response',
    );
  }
  assert.equal(calls.length, 0);
  assert.equal(isSpreadsheetId(ID), true);
});

// --------------------------------------------------------------------- metadata

test('reading metadata asks only for what is needed and finds the tab by id', async () => {
  const { calls, client } = stub(() => json({
    spreadsheetId: ID,
    properties: { title: 'Customer feedback — Intake Responses' },
    spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${ID}/edit`,
    sheets: [
      { properties: { sheetId: 0, title: 'Responses', gridProperties: { rowCount: 1000, columnCount: 26 } } },
      { properties: { sheetId: 7, title: 'Notes', gridProperties: { rowCount: 20, columnCount: 12 } } },
    ],
  }));

  const metadata = await client.getSpreadsheet(TOKEN, ID);
  assert.equal(calls[0].url.pathname, `/v4/spreadsheets/${ID}`);
  assert.match(calls[0].url.searchParams.get('fields'), /sheets\.properties/);
  assert.equal(metadata.sheets.length, 2);
  assert.equal(metadata.sheets[1].sheetId, 7);
  assert.equal(metadata.sheets[0].rowCount, 1000, 'the grid size comes from gridProperties');
  assert.equal(metadata.sheets[0].columnCount, 26);
});

test('a spreadsheet that is gone reports that it is gone', async () => {
  const { client } = stub(() => new Response(JSON.stringify({ error: { status: 'NOT_FOUND', message: 'Requested entity was not found.' } }), {
    status: 404,
    headers: { 'content-type': 'application/json' },
  }));

  await assert.rejects(
    () => client.getSpreadsheet(TOKEN, ID),
    error => error instanceof GoogleSheetsApiError
      && error.info.kind === 'http'
      && error.info.httpStatus === 404
      && error.info.googleStatus === 'NOT_FOUND'
      && !/entity was not found/.test(error.message),
  );
});

// ------------------------------------------------------------------------ read

test('reading the sheet state fetches the id column and the header row in one call', async () => {
  const { calls, client } = stub(() => json({
    valueRanges: [
      { range: "'Responses'!A1:A3", values: [['Response ID'], ['r1'], ['r2']] },
      { range: "'Responses'!1:1", values: [['Response ID', 'Submitted at', 'Respondent email', 'Your name']] },
    ],
  }));

  const state = await client.readSheetState(TOKEN, ID, 'Responses');
  assert.equal(calls.length, 1, 'one round trip, not two');
  assert.equal(calls[0].url.pathname, `/v4/spreadsheets/${ID}/values:batchGet`);
  assert.deepEqual(calls[0].url.searchParams.getAll('ranges'), ["'Responses'!A1:A", "'Responses'!1:1"]);
  assert.deepEqual(state.responseIds, ['r1', 'r2'], 'the header cell is not mistaken for an id');
  assert.deepEqual(state.header, ['Response ID', 'Submitted at', 'Respondent email', 'Your name']);
});

test('a tab name with a quote or a space is quoted properly, not injected into the URL', async () => {
  const { calls, client } = stub(() => json({ valueRanges: [{ values: [] }, { values: [] }] }));
  await client.readSheetState(TOKEN, ID, "Ada's responses");
  assert.deepEqual(calls[0].url.searchParams.getAll('ranges')[0], "'Ada''s responses'!A1:A");
  assert.equal(calls[0].url.pathname.endsWith('/values:batchGet'), true);
});

test('an empty sheet reads as empty rather than as an error', async () => {
  const { client } = stub(() => json({ valueRanges: [] }));
  const state = await client.readSheetState(TOKEN, ID, 'Responses');
  assert.deepEqual(state, { header: [], responseIds: [] });
});

// ---------------------------------------------------------------------- append

test('appending writes raw text, never interprets it, and never overwrites', async () => {
  const rows = [
    ['r1', '2026-11-06T10:00:00.000Z', '', '=IMPORTXML("http://x","//a")', 'line one\nline two'],
    ['r2', '2026-11-06T10:01:00.000Z', 'ada@example.com', "'quoted", 'アダ'],
  ];
  const { calls, client } = stub(() => json({ updates: { updatedRows: 2, updatedRange: "'Responses'!A2:E3" } }));

  const result = await client.appendRows(TOKEN, ID, 'Responses', rows);

  assert.equal(result.updatedRows, 2);
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].url.searchParams.get('valueInputOption'), 'RAW', 'nothing is evaluated as a formula');
  assert.equal(calls[0].url.searchParams.get('insertDataOption'), 'INSERT_ROWS', 'existing rows are not overwritten');
  assert.deepEqual(calls[0].body.values, rows, 'the text arrives exactly as it was written');
  assert.equal(calls[0].body.majorDimension, 'ROWS');
  assert.match(calls[0].url.pathname, /:append$/);
});

test('an append of nothing is not a request at all', async () => {
  const { calls, client } = stub(() => json({}));
  const result = await client.appendRows(TOKEN, ID, 'Responses', []);
  assert.equal(result.updatedRows, 0);
  assert.equal(calls.length, 0);
});

test('a failed append throws once', async () => {
  let count = 0;
  const { client } = stub(() => {
    count += 1;
    return new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), { status: 429, headers: { 'content-type': 'application/json', 'retry-after': '30' } });
  });

  await assert.rejects(() => client.appendRows(TOKEN, ID, 'Responses', [['r1']]));
  assert.equal(count, 1, 'the client does not retry a write; that is what would duplicate rows');
});

test('a rate limit reports how long to wait', async () => {
  const { client } = stub(() => new Response(JSON.stringify({ error: { status: 'RESOURCE_EXHAUSTED' } }), {
    status: 429,
    headers: { 'content-type': 'application/json', 'retry-after': '42' },
  }));

  await assert.rejects(
    () => client.appendRows(TOKEN, ID, 'Responses', [['r1']]),
    error => error.info.httpStatus === 429 && error.info.retryAfterSeconds === 42 && error.info.googleStatus === 'RESOURCE_EXHAUSTED',
  );
});

test('a permission failure is reported as a permission failure', async () => {
  const { client } = stub(() => new Response(JSON.stringify({
    error: { status: 'PERMISSION_DENIED', details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },
  }), { status: 403, headers: { 'content-type': 'application/json' } }));

  await assert.rejects(
    () => client.appendRows(TOKEN, ID, 'Responses', [['r1']]),
    error => error.info.httpStatus === 403 && error.info.reason === 'ACCESS_TOKEN_SCOPE_INSUFFICIENT',
  );
});

// ----------------------------------------------------------------- unwritable

test('a network failure is reported as an unknown outcome, not as a rejection by Google', async () => {
  const client = createGoogleSheetsClient({
    fetchImpl: async () => { throw Object.assign(new Error('connect ECONNREFUSED'), { name: 'TypeError' }); },
  });
  await assert.rejects(
    () => client.appendRows(TOKEN, ID, 'Responses', [['r1']]),
    error => error.info.kind === 'network',
  );
});

test('a timeout is its own kind, because it leaves the same doubt as a network failure', async () => {
  const client = createGoogleSheetsClient({
    fetchImpl: async () => { throw Object.assign(new Error('timed out'), { name: 'TimeoutError' }); },
  });
  await assert.rejects(
    () => client.appendRows(TOKEN, ID, 'Responses', [['r1']]),
    error => error.info.kind === 'timeout',
  );
});

test('a body that is not JSON is refused rather than guessed at', async () => {
  const { client } = stub(() => new Response('<html>gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }));
  await assert.rejects(
    () => client.getSpreadsheet(TOKEN, ID),
    error => error.info.kind === 'malformed_response',
  );
});

test('redirects are refused, so a bearer token cannot be forwarded elsewhere', async () => {
  const { calls, client } = stub(() => json({}));
  await client.getSpreadsheet(TOKEN, ID).catch(() => {});
  assert.equal(calls[0].init.redirect, 'error');
});

// ---------------------------------------------------------------------- header

test('the header is written to row one of the columns it needs', async () => {
  const { calls, client } = stub(() => json({ updatedCells: 5 }));
  await client.writeHeader(TOKEN, ID, 'Responses', ['Response ID', 'Submitted at', 'Respondent email', 'Your name', 'Notes']);

  assert.equal(calls[0].init.method, 'PUT');
  assert.equal(calls[0].url.pathname, `/v4/spreadsheets/${ID}/values/${encodeURIComponent("'Responses'!A1:E1")}`);
  assert.equal(calls[0].url.searchParams.get('valueInputOption'), 'RAW');
  assert.deepEqual(calls[0].body, {
    range: "'Responses'!A1:E1",
    majorDimension: 'ROWS',
    values: [['Response ID', 'Submitted at', 'Respondent email', 'Your name', 'Notes']],
  });
});

test('column letters keep working past Z', () => {
  assert.equal(columnLetter(1), 'A');
  assert.equal(columnLetter(26), 'Z');
  assert.equal(columnLetter(27), 'AA');
  assert.equal(columnLetter(52), 'AZ');
  assert.equal(columnLetter(53), 'BA');
});
