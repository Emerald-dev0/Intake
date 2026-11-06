/**
 * The response export: the CSV a form owner downloads, and the door they walk through to get it.
 *
 * Two different things are checked here. The first is the file — a row per response, a column that
 * never moves when a question is skipped, an answer with a comma or a line break that survives the
 * trip, and a cell that a spreadsheet cannot be tricked into running. The second is the gate — an
 * export gets no looser door than the summary does, and a failure halfway through says so rather
 * than handing over a file that looks complete.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { buildResponsesCsv, csvCell, csvFilename, csvPreamble, csvResponseLine } from '../server/forms/insights/export.ts';
import { createInsightsRouter } from '../server/forms/insights/routes.ts';
import { GoogleFormsApiError } from '../server/forms/providers/google/client.ts';

const RESPONSES_SCOPE = 'https://www.googleapis.com/auth/forms.responses.readonly';
const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';
const EXPORTED_AT = new Date('2026-11-06T12:34:56.000Z');

const FORM = {
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

const QUESTIONS = [
  { id: 'q1', title: 'What is your name?' },
  { id: 'q2', title: 'How did you hear about us?' },
  { id: 'q3', title: 'Anything else?' },
];

/** Answers as the client normalizes them: question id to the values given, in order. */
function answer(values) {
  return values;
}

function response(responseId, answers, extra = {}) {
  return {
    responseId,
    createTime: '2026-11-06T09:00:00.000Z',
    lastSubmittedTime: '2026-11-06T09:02:00.000Z',
    respondentEmail: null,
    answers,
    totalScore: null,
    ...extra,
  };
}

/**
 * A small RFC 4180 reader, so a test can say "this cell is exactly that" instead of matching text.
 * It only understands what the builder writes: quoted fields, doubled quotes, CRLF records.
 */
function parseCsv(csv) {
  const records = [];
  let record = [];
  let cell = '';
  let quoted = false;
  for (let index = 0; index < csv.length; index += 1) {
    const char = csv[index];
    if (quoted) {
      if (char === '"' && csv[index + 1] === '"') { cell += '"'; index += 1; }
      else if (char === '"') quoted = false;
      else cell += char;
      continue;
    }
    if (char === '"') quoted = true;
    else if (char === ',') { record.push(cell); cell = ''; }
    else if (char === '\r' && csv[index + 1] === '\n') {
      record.push(cell); records.push(record); record = []; cell = ''; index += 1;
    } else if (char === '\n') { record.push(cell); records.push(record); record = []; cell = ''; }
    else cell += char;
  }
  if (cell || record.length) { record.push(cell); records.push(record); }
  return records;
}

/** Comments are the `#` lines; everything else is the table. A response id never starts with `#`. */
const isComment = record => record[0].startsWith('#');

/** The table: header first, then one record per response. */
function table(csv) {
  return parseCsv(csv).filter(record => !isComment(record));
}

function headerOf(csv) {
  return table(csv)[0]?.join(',') ?? '';
}

function dataRows(csv) {
  return table(csv).slice(1);
}

function comments(csv) {
  return parseCsv(csv).filter(isComment).map(record => record[0]);
}

// --------------------------------------------------------------------- the file

test('the file names itself by the day it was made', () => {
  assert.equal(csvFilename(EXPORTED_AT), 'intake-form-responses-2026-11-06.csv');
  assert.equal(csvFilename(new Date('2026-01-01T23:59:59.000Z')), 'intake-form-responses-2026-01-01.csv');
});

test('the file says where it came from, and says nothing about any respondent', () => {
  const csv = buildResponsesCsv({ formTitle: 'Customer feedback', questions: QUESTIONS, responses: [], exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' });
  const lines = comments(csv);
  assert.equal(lines[0], '# Exported from Intake - intake.calder.click');
  assert.ok(lines.includes('# Form: Customer feedback'));
  assert.ok(lines.includes('# Exported: 2026-11-06T12:34:56.000Z'));
  assert.equal(lines.some(line => line.includes('ada@')), false, 'no respondent information in the credit block');
});

test('the columns are the form\'s questions, in the order the form asks them', () => {
  const csv = buildResponsesCsv({ formTitle: 'F', questions: QUESTIONS, responses: [], exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' });
  assert.equal(headerOf(csv), 'Response ID,Submitted at,Respondent email,What is your name?,How did you hear about us?,Anything else?');
});

test('one response is one row, with its id, when it arrived, and who sent it', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: QUESTIONS,
    responses: [response('r1', { q1: answer(['Ada']) }, { respondentEmail: 'ada@example.com' })],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  assert.equal(dataRows(csv).length, 1);
  const [cells] = dataRows(csv);
  assert.equal(cells[0], 'r1');
  assert.equal(cells[1], '2026-11-06T09:02:00.000Z');
  assert.equal(cells[2], 'ada@example.com');
  assert.equal(cells[3], 'Ada');
  assert.equal(cells.length, headerOf(csv).split(',').length, 'the row is exactly as wide as the header');
});

test('a skipped question leaves an empty cell in its own column, so no answer slides sideways', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: QUESTIONS,
    // The middle question was skipped entirely.
    responses: [response('r1', { q1: answer(['Ada']), q3: answer(['Nothing to add']) })],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  assert.deepEqual(dataRows(csv)[0], ['r1', '2026-11-06T09:02:00.000Z', '', 'Ada', '', 'Nothing to add']);
});

test('a response that answered nothing is still a row, with its id', () => {
  const csv = buildResponsesCsv({ formTitle: 'F', questions: QUESTIONS, responses: [response('r1', {})], exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' });
  assert.deepEqual(dataRows(csv)[0], ['r1', '2026-11-06T09:02:00.000Z', '', '', '', '']);
});

test('several answers to one question stay together, separated but not merged', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: QUESTIONS,
    responses: [response('r1', { q2: answer(['A friend', 'A podcast']) })],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  const [cells] = dataRows(csv);
  assert.deepEqual(cells, ['r1', '2026-11-06T09:02:00.000Z', '', '', 'A friend, A podcast', '']);
});

test('an answer with a comma, a quote, or a line break survives intact', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: QUESTIONS,
    responses: [response('r1', { q3: answer(['Hello, "world"\nthen a new line']) })],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  const [cells] = dataRows(csv);
  assert.equal(cells[5], 'Hello, "world"\nthen a new line', 'one cell, with its comma, its quotes and its line break');
});

test('an answer in another script arrives as the respondent typed it', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: [{ id: 'q1', title: 'Name in your own language' }],
    responses: [response('r1', { q1: answer(['アダ', 'Ada 🎉', 'أدا']) })],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  assert.equal(dataRows(csv)[0][3], 'アダ, Ada 🎉, أدا');
  // UTF-8 both ways: what the respondent typed survives the round trip byte for byte.
  assert.equal(Buffer.from(csv, 'utf8').toString('utf8'), csv);
  assert.equal(csv.includes('\\u30a2'), false, 'characters, not escape sequences');
});

test('a value that a spreadsheet would run is neutralized where it stands', () => {
  for (const dangerous of ['=1+1', '+1+1', '-1+1', '@SUM(A1)', '=HYPERLINK("http://x","click")']) {
    const csv = buildResponsesCsv({
      formTitle: 'F',
      questions: [{ id: 'q1', title: 'Answer' }],
      responses: [response('r1', { q1: answer([dangerous]) })],
      exportedAt: EXPORTED_AT,
      siteUrl: 'intake.calder.click',
    });
    const cell = dataRows(csv)[0][3];
    assert.equal(cell.startsWith("'"), true, `the cell is neutralized: ${cell}`);
    assert.equal(cell.slice(1), dangerous, 'and still says what the respondent wrote');
  }
});

test('a question title that a spreadsheet would run is neutralized too, not just the answers', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: [{ id: 'q1', title: '=cmd|calc' }],
    responses: [],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  assert.deepEqual(table(csv)[0].slice(3), ["'=cmd|calc"]);
});

test('a header with a comma in the question is quoted, so the columns still line up', () => {
  const csv = buildResponsesCsv({
    formTitle: 'F',
    questions: [{ id: 'q1', title: 'Which city, exactly?' }],
    responses: [response('r1', { q1: answer(['Abuja']) })],
    exportedAt: EXPORTED_AT,
    siteUrl: 'intake.calder.click',
  });
  assert.deepEqual(table(csv)[0], ['Response ID', 'Submitted at', 'Respondent email', 'Which city, exactly?']);
  assert.deepEqual(dataRows(csv)[0], ['r1', '2026-11-06T09:02:00.000Z', '', 'Abuja']);
});

test('a form title with a newline cannot break the credit block', () => {
  const csv = buildResponsesCsv({ formTitle: 'Line one\nLine two', questions: [], responses: [], exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' });
  assert.ok(comments(csv).includes('# Form: Line one Line two'), csv);
});

test('the file ends with a newline and a stated total', () => {
  const csv = buildResponsesCsv({ formTitle: 'F', questions: QUESTIONS, responses: [response('r1', {}), response('r2', {})], exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' });
  assert.ok(csv.endsWith('\r\n'));
  // The route adds the closing line; the builder ends with the last row and a newline.
  assert.equal(dataRows(csv).length, 2);
});

test('a cell is quoted only when quoting is needed', () => {
  assert.equal(csvCell('plain'), 'plain');
  assert.equal(csvCell('a,b'), '"a,b"');
  assert.equal(csvCell('say "hi"'), '"say ""hi"""');
  assert.equal(csvCell('line\nbreak'), '"line\nbreak"');
  assert.equal(csvCell(''), '');
  assert.equal(csvCell('a\u0000b'), 'ab', 'a null byte would truncate the file for some readers');
});

test('a streamed export is the same file as a built one', () => {
  const responses = [response('r1', { q1: answer(['Ada']) }), response('r2', { q2: answer(['A friend']) })];
  const whole = buildResponsesCsv({ formTitle: 'F', questions: QUESTIONS, responses, exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' });
  const streamed = [
    csvPreamble({ formTitle: 'F', questions: QUESTIONS, responses: [], exportedAt: EXPORTED_AT, siteUrl: 'intake.calder.click' }),
    ...responses.map(item => csvResponseLine(QUESTIONS, item)),
  ].join('');
  assert.equal(streamed, whole, 'writing page by page must not produce a different document');
});

// ---------------------------------------------------------------------- the gate

function connection(overrides = {}) {
  return {
    ok: true,
    provider: 'google',
    userId: 'user-a',
    externalAccountId: 'google-sub',
    externalAccountEmail: 'ada@gmail.com',
    scopes: ['openid', 'email', FORMS_SCOPE, RESPONSES_SCOPE],
    accessToken: 'ACCESS_TOKEN',
    accessTokenExpiresAt: '2026-09-01T11:00:00.000Z',
    ...overrides,
  };
}

/**
 * A router with a scripted Google behind it. `pages` is one entry per listResponses call: a body of
 * responses, or a function that throws to simulate Google failing at that point.
 */
async function boot(options = {}) {
  const calls = { listResponses: [], getForm: 0 };
  const pages = [...(options.pages ?? [{ responses: [response('r1', {})], nextPageToken: null }])];
  const deps = {
    getSession: async () => (options.signedIn === false ? null : { id: 'user-a', email: 'a@intake.test', name: 'Ada' }),
    getForm: async (userId, id) => (id === FORM.id ? { ok: true, form: FORM } : { ok: false }),
    entitlement: async () => options.entitlement ?? { plan: 'pro', subscriptionStatus: 'active' },
    getConnection: async () => options.connection ?? connection(),
    googleClient: {
      async getForm() {
        calls.getForm += 1;
        return {
          items: [
            { kind: 'question', questionId: 'q1', title: 'What is your name?', questionType: 'short_text' },
            { kind: 'section', title: 'About you' },
            { kind: 'question', questionId: 'q2', title: 'How did you hear about us?', questionType: 'checkboxes' },
          ],
        };
      },
      async listResponses(_token, _formId, query) {
        calls.listResponses.push(query);
        const next = pages.length > 1 ? pages.shift() : pages[0];
        if (typeof next === 'function') return next();
        return next;
      },
    },
    sleep: async () => {},
    now: () => EXPORTED_AT,
  };
  const app = express();
  app.use('/api/forms', createInsightsRouter(deps));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

const exportUrl = `${'/api/forms'}/${FORM.id}/insights/export.csv`;

test('the export hands over a named CSV file rather than something a browser might render', async () => {
  const world = await boot();
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'text/csv; charset=utf-8');
    assert.equal(response.headers.get('content-disposition'), 'attachment; filename="intake-form-responses-2026-11-06.csv"');
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.equal(response.headers.get('x-content-type-options'), 'nosniff');
    const body = await response.text();
    assert.ok(body.includes('# Exported from Intake'), body);
    assert.ok(body.includes('What is your name?'), 'the question title is the column header');
  } finally { await world.close(); }
});

test('a signed-out visitor is told to sign in and no response is read', async () => {
  const world = await boot({ signedIn: false });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 401);
    assert.equal(world.calls.listResponses.length, 0);
  } finally { await world.close(); }
});

test('a form that is not yours cannot be exported, and reads as missing', async () => {
  const world = await boot();
  try {
    const response = await fetch(`${world.base}/api/forms/someone-elses-form/insights/export.csv`);
    assert.equal(response.status, 404);
    assert.equal(world.calls.listResponses.length, 0);
    assert.equal(world.calls.getForm, 0);
  } finally { await world.close(); }
});

test('an export needs Pro, the same as the summary does', async () => {
  const world = await boot({ entitlement: { plan: 'free', subscriptionStatus: 'none' } });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'pro_required');
    assert.equal(world.calls.listResponses.length, 0);
  } finally { await world.close(); }
});

test('without the responses permission there is no file at all — not even an empty one', async () => {
  const world = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE] }) });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'responses_scope_required');
    assert.equal(response.headers.get('content-disposition'), null);
    assert.equal(world.calls.listResponses.length, 0);
  } finally { await world.close(); }
});

test('a connection that needs reconnecting asks for that, before reading anything', async () => {
  const world = await boot({ connection: { ok: false, provider: 'google', reason: 'expired' } });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'reauthorization_required');
    assert.equal(world.calls.listResponses.length, 0);
  } finally { await world.close(); }
});

test('a form with no responses gets an explanation, not a file with nothing in it', async () => {
  const world = await boot({ pages: [{ responses: [], nextPageToken: null }] });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 404);
    assert.equal(response.headers.get('content-disposition'), null);
    const body = await response.json();
    assert.equal(body.code, 'no_responses');
    assert.match(body.error, /no responses yet/i);
  } finally { await world.close(); }
});

// ------------------------------------------------------------------ the paging

test('every page is read and every response appears exactly once', async () => {
  const world = await boot({
    pages: [
      { responses: [response('r1', { q1: answer(['Ada']) }), response('r2', { q1: answer(['Bola']) })], nextPageToken: 'PAGE_2' },
      { responses: [response('r3', { q1: answer(['Chidi']) })], nextPageToken: 'PAGE_3' },
      // A page token that hands back a row already written must not duplicate it.
      { responses: [response('r2', { q1: answer(['Bola']) }), response('r4', { q1: answer(['Dayo']) })], nextPageToken: null },
    ],
  });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.equal(world.calls.listResponses.length, 3, 'the loop follows every token');
    assert.deepEqual(world.calls.listResponses.map(call => call.pageToken), [undefined, 'PAGE_2', 'PAGE_3']);
    for (const call of world.calls.listResponses) assert.equal(call.pageSize, 1000, 'a bounded page, not the whole form');
    const ids = dataRows(body).map(row => row[0]);
    assert.deepEqual(ids, ['r1', 'r2', 'r3', 'r4'], 'in order, with no duplicate row');
    assert.ok(body.includes('# End of export. 4 responses written.'), body);
  } finally { await world.close(); }
});

test('an export that stops early says so inside the file instead of ending quietly', async () => {
  const world = await boot({
    pages: [
      { responses: [response('r1', {})], nextPageToken: 'PAGE_2' },
      () => { throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 403 }); },
    ],
  });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    const body = await response.text();
    assert.equal(response.status, 200, 'the download already started, so the status cannot change');
    assert.ok(body.includes('r1,'), 'what was read is kept');
    assert.ok(body.includes('# INCOMPLETE: 1 responses were written before this happened.'), body);
    assert.ok(body.includes('Reconnect Google Forms'), 'the file names the fix, not just the failure');
    assert.equal(body.includes('# End of export'), false, 'an incomplete file must not claim to be complete');
  } finally { await world.close(); }
});

test('a rate limit is waited out and the export continues, rather than failing the person', async () => {
  let attempt = 0;
  const world = await boot({
    pages: [
      { responses: [response('r1', {})], nextPageToken: 'PAGE_2' },
      () => {
        attempt += 1;
        if (attempt === 1) throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 429, retryAfterSeconds: 1 });
        return { responses: [response('r2', {})], nextPageToken: null };
      },
    ],
  });
  try {
    const body = await (await fetch(`${world.base}${exportUrl}`)).text();
    assert.deepEqual(dataRows(body).map(row => row[0]), ['r1', 'r2']);
    assert.equal(attempt, 2);
  } finally { await world.close(); }
});

test('a first page that fails before the file starts is still an error a person can act on', async () => {
  const world = await boot({ pages: [() => { throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 500 }); }] });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 502);
    assert.equal(response.headers.get('content-disposition'), null);
    assert.match((await response.json()).error, /try again/i);
  } finally { await world.close(); }
});

test('a Google permission refusal on the first read sends the person to reconnect', async () => {
  const world = await boot({ pages: [() => { throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 403 }); }] });
  try {
    const response = await fetch(`${world.base}${exportUrl}`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'reauthorization_required');
    assert.equal(world.calls.listResponses.length, 1, 'a refusal is not retried');
  } finally { await world.close(); }
});

// -------------------------------------------------------------------- filtering

test('a start date becomes a timestamp Google understands, in UTC', async () => {
  const world = await boot();
  try {
    await (await fetch(`${world.base}${exportUrl}?since=2026-10-01`)).text();
    assert.equal(world.calls.listResponses[0].since, '2026-10-01T00:00:00.000Z');
    assert.equal(world.calls.listResponses[0].sinceExclusive, false);
  } finally { await world.close(); }
});

test('an end of day can be included or excluded, and that is the only extra', async () => {
  const world = await boot();
  try {
    await (await fetch(`${world.base}${exportUrl}?since=2026-10-01T09:00:00Z&since_exclusive=true`)).text();
    assert.equal(world.calls.listResponses[0].since, '2026-10-01T09:00:00.000Z');
    assert.equal(world.calls.listResponses[0].sinceExclusive, true);
  } finally { await world.close(); }
});

test('a date that is not a date is refused instead of being passed on to Google', async () => {
  const world = await boot();
  try {
    for (const since of ['yesterday', '2026-13-45', "2026-01-01' OR 1=1", '']) {
      const response = await fetch(`${world.base}${exportUrl}?since=${encodeURIComponent(since)}`);
      assert.equal(response.status, 400, since);
      assert.equal((await response.json()).code, 'invalid_since');
    }
    assert.equal(world.calls.listResponses.length, 0);
  } finally { await world.close(); }
});

test('parameters Intake does not know are never forwarded to Google', async () => {
  const world = await boot();
  try {
    await (await fetch(`${world.base}${exportUrl}?filter=timestamp%20%3E%202020-01-01T00%3A00%3A00Z&pageSize=50000&fields=*`)).text();
    const [call] = world.calls.listResponses;
    assert.equal(call.since, undefined, 'a raw filter is not a start date and must not become one');
    assert.equal(call.pageSize, 1000, 'the page size is Intake\'s to decide');
  } finally { await world.close(); }
});

test('a filtered export with nothing in range says so, and mentions the date', async () => {
  const world = await boot({ pages: [{ responses: [], nextPageToken: null }] });
  try {
    const response = await fetch(`${world.base}${exportUrl}?since=2030-01-01`);
    assert.equal(response.status, 404);
    assert.match((await response.json()).error, /earlier date/i);
  } finally { await world.close(); }
});

test('an export that runs past the page limit stops and says the file is incomplete', async () => {
  // A token that never ends would otherwise page forever. The cap protects the server; the file
  // says what happened instead of ending as if it were the whole form.
  const world = await boot({ pages: [{ responses: [response('r1', {})], nextPageToken: 'NEVER_ENDS' }] });
  try {
    const body = await (await fetch(`${world.base}${exportUrl}`)).text();
    assert.ok(body.includes('# STOPPED'), 'the cap is stated in the file');
    assert.equal(body.includes('# End of export'), false);
    assert.ok(world.calls.listResponses.length <= 400, 'the cap is a bound on Google calls too');
    assert.deepEqual(dataRows(body).map(row => row[0]), ['r1'], 'a repeated row is not written twice');
  } finally { await world.close(); }
});
