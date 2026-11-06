/**
 * The Google Forms client's response reading: paging, filtering, and what one response contains.
 *
 * Every assertion here is about a promise Intake makes to a form owner: every response is reachable,
 * nothing is invented when Google is silent, and nothing a caller says can become a raw Google query
 * string. The fake fetch records what would have gone over the wire, so the tests check the request
 * as much as the parse.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGoogleFormsClient, GoogleFormsApiError, MAX_RESPONSE_PAGE_SIZE } from '../server/forms/providers/google/client.ts';
import { isRetryable, retryDelayMs, withRetry } from '../server/forms/providers/google/retry.ts';

const FORM_ID = '1FAIpQLSfakeFormId123';

/** A client whose every answer is scripted, plus the requests it would have sent. */
function harness(responses) {
  const sent = [];
  const queue = [...responses];
  const client = createGoogleFormsClient({
    fetchImpl: async (url, init) => {
      sent.push({ url: String(url), init });
      const next = queue.length > 1 ? queue.shift() : queue[0];
      const { status = 200, body = {} } = typeof next === 'function' ? next() : next;
      return new Response(typeof body === 'string' ? body : JSON.stringify(body), {
        status,
        headers: { 'content-type': 'application/json' },
      });
    },
  });
  return { client, sent, query: index => new URL(sent[index].url).searchParams };
}

function responseBody(responseId, answers, extra = {}) {
  return {
    responseId,
    createTime: '2026-11-06T09:00:00.000Z',
    lastSubmittedTime: '2026-11-06T09:02:00.000Z',
    answers,
    ...extra,
  };
}

// ------------------------------------------------------------------------ paging

test('a page of responses is read with the page size the caller asked for', async () => {
  const { client, query } = harness([{ body: { responses: [responseBody('r1', { q1: { textAnswers: { answers: [{ value: 'Yes' }] } } })] } }]);
  const page = await client.listResponses('token', FORM_ID, { pageSize: 250 });

  assert.equal(query(0).get('pageSize'), '250');
  assert.equal(query(0).get('pageToken'), null);
  assert.equal(query(0).get('filter'), null, 'no filter means the request looks exactly as it always did');
  assert.equal(page.responses.length, 1);
  assert.equal(page.nextPageToken, null);
});

test('a page size larger than Google allows is clamped, never sent as-is', async () => {
  const { client, query } = harness([{ body: { responses: [] } }]);
  await client.listResponses('token', FORM_ID, { pageSize: 99_999 });
  assert.equal(query(0).get('pageSize'), String(MAX_RESPONSE_PAGE_SIZE));
  assert.equal(MAX_RESPONSE_PAGE_SIZE, 5000, 'the documented maximum');
});

test('no page size is the documented default, not zero', async () => {
  const { client, query } = harness([{ body: { responses: [] } }]);
  await client.listResponses('token', FORM_ID);
  assert.equal(query(0).get('pageSize'), null, 'Google decides the page size when none is given');
});

test('a nonsense page size is refused before anything is sent', async () => {
  const { client, sent } = harness([{ body: { responses: [] } }]);
  for (const pageSize of [0, -1, 1.5, '100', Number.NaN]) {
    await assert.rejects(
      client.listResponses('token', FORM_ID, { pageSize }),
      error => error instanceof GoogleFormsApiError && error.info.kind === 'malformed_response',
      String(pageSize),
    );
  }
  assert.equal(sent.length, 0);
});

test('the page token is carried forward, so a second page is the next page and not the first', async () => {
  const { client, query } = harness([
    { body: { responses: [responseBody('r1', {})], nextPageToken: 'TOKEN_2' } },
    { body: { responses: [responseBody('r2', {})] } },
  ]);
  const first = await client.listResponses('token', FORM_ID, { pageSize: 2 });
  assert.equal(first.nextPageToken, 'TOKEN_2');
  const second = await client.listResponses('token', FORM_ID, { pageSize: 2, pageToken: first.nextPageToken });
  assert.equal(query(1).get('pageToken'), 'TOKEN_2');
  assert.equal(query(1).get('pageSize'), '2', 'the same page size, so the pages stay comparable');
  assert.equal(second.nextPageToken, null, 'the last page says so instead of leaving it to be guessed');
});

test('a page token that is not a token is refused rather than sent to Google', async () => {
  const { client, sent } = harness([{ body: { responses: [] } }]);
  for (const pageToken of ['', 'x'.repeat(5000), 42, {}]) {
    await assert.rejects(client.listResponses('token', FORM_ID, { pageToken }), GoogleFormsApiError, String(pageToken));
  }
  assert.equal(sent.length, 0);
});

// ---------------------------------------------------------------------- filtering

test('a start time becomes the one filter Google documents, as UTC', async () => {
  const { client, query } = harness([{ body: { responses: [] } }]);
  await client.listResponses('token', FORM_ID, { since: '2026-10-01T00:00:00.000Z' });
  assert.equal(query(0).get('filter'), 'timestamp >= 2026-10-01T00:00:00.000Z');
});

test('an exclusive start time uses the strict comparison', async () => {
  const { client, query } = harness([{ body: { responses: [] } }]);
  await client.listResponses('token', FORM_ID, { since: '2026-10-01T00:00:00Z', sinceExclusive: true });
  assert.equal(query(0).get('filter'), 'timestamp > 2026-10-01T00:00:00Z');
});

test('a caller cannot smuggle a query string in where a timestamp belongs', async () => {
  const { client, sent } = harness([{ body: { responses: [] } }]);
  const attempts = [
    'timestamp > 2026-01-01T00:00:00Z',
    '2026-01-01',
    '2026-01-01T00:00:00+01:00',
    'yesterday',
    "2026-01-01T00:00:00Z' OR 'x",
    '',
  ];
  for (const since of attempts) {
    await assert.rejects(
      client.listResponses('token', FORM_ID, { since }),
      error => error instanceof GoogleFormsApiError && error.info.kind === 'malformed_response',
      since,
    );
  }
  assert.equal(sent.length, 0, 'a rejected filter never becomes a request');
});

test('options nobody documented are ignored rather than forwarded', async () => {
  const { client, query } = harness([{ body: { responses: [] } }]);
  await client.listResponses('token', FORM_ID, { pageSize: 10, filter: 'timestamp > 2020-01-01T00:00:00Z', orderBy: 'x', fields: '*' });
  assert.deepEqual([...query(0).keys()].sort(), ['pageSize']);
});

// ----------------------------------------------------------------------- metadata

test('one response carries its id, its times, its email when there is one, and its answers', async () => {
  const { client } = harness([{
    body: {
      responses: [responseBody('r1', {
        q1: { textAnswers: { answers: [{ value: 'Ada' }] } },
        q2: { textAnswers: { answers: [{ value: 'One' }, { value: 'Two' }] } },
      }, { respondentEmail: 'ada@example.com', totalScore: 7 })],
    },
  }]);
  const [response] = (await client.listResponses('token', FORM_ID)).responses;

  assert.equal(response.responseId, 'r1');
  assert.equal(response.lastSubmittedTime, '2026-11-06T09:02:00.000Z');
  assert.equal(response.createTime, '2026-11-06T09:00:00.000Z');
  assert.equal(response.respondentEmail, 'ada@example.com');
  assert.equal(response.totalScore, 7);
  assert.deepEqual(response.answers, { q1: ['Ada'], q2: ['One', 'Two'] }, 'every value, in the order it was given');
});

test('a response without an email says null instead of an empty string or a guess', async () => {
  const { client } = harness([{ body: { responses: [responseBody('r1', {}, { respondentEmail: undefined })] } }]);
  const [response] = (await client.listResponses('token', FORM_ID)).responses;
  assert.equal(response.respondentEmail, null);
});

test('a response without times says null instead of inventing a submission date', async () => {
  const { client } = harness([{ body: { responses: [{ responseId: 'r1', answers: {} }] } }]);
  const [response] = (await client.listResponses('token', FORM_ID)).responses;
  assert.equal(response.createTime, null);
  assert.equal(response.lastSubmittedTime, null);
  assert.equal(response.totalScore, null);
});

test('a non-UTC timestamp is normalized, so two readings of the same answer agree', async () => {
  const { client } = harness([{ body: { responses: [{ responseId: 'r1', lastSubmittedTime: '2026-11-06T10:02:00+01:00', answers: {} }] } }]);
  const [response] = (await client.listResponses('token', FORM_ID)).responses;
  assert.equal(response.lastSubmittedTime, '2026-11-06T09:02:00.000Z');
});

test('a response without an id is dropped, because a row nobody can name is not a row', async () => {
  const { client } = harness([{ body: { responses: [{ answers: { q1: { textAnswers: { answers: [{ value: 'x' }] } } } }, responseBody('r2', {})] } }]);
  const page = await client.listResponses('token', FORM_ID);
  assert.deepEqual(page.responses.map(response => response.responseId), ['r2']);
});

test('an answer value that is empty or not a string is left out instead of becoming a blank answer', async () => {
  const { client } = harness([{
    body: {
      responses: [responseBody('r1', {
        q1: { textAnswers: { answers: [{ value: '   ' }, { value: 42 }, { value: 'kept' }] } },
        q2: { textAnswers: { answers: [] } },
        'bad id with spaces': { textAnswers: { answers: [{ value: 'ignored' }] } },
      })],
    },
  }]);
  const [response] = (await client.listResponses('token', FORM_ID)).responses;
  assert.deepEqual(response.answers, { q1: ['kept'] });
});

test('answers from a form that changed still arrive, keyed by question id', async () => {
  const { client } = harness([{ body: { responses: [responseBody('r1', { deletedQuestion: { textAnswers: { answers: [{ value: 'still here' }] } } })] } }]);
  const [response] = (await client.listResponses('token', FORM_ID)).responses;
  assert.deepEqual(response.answers, { deletedQuestion: ['still here'] }, 'an answer to a removed question is still the respondent\'s answer');
});

// --------------------------------------------------------------------- get by id

test('one response can be read on its own, from the form it belongs to', async () => {
  const { client, sent } = harness([{ body: responseBody('r1', { q1: { textAnswers: { answers: [{ value: 'Yes' }] } } }) }]);
  const response = await client.getResponse('token', FORM_ID, 'r1');

  assert.equal(response.responseId, 'r1');
  assert.equal(new URL(sent[0].url).pathname, `/v1/forms/${FORM_ID}/responses/r1`);
  assert.equal(new URL(sent[0].url).search, '');
  assert.equal(sent[0].init.method, 'GET');
  assert.equal(sent[0].init.headers.authorization, 'Bearer token');
});

test('a response id that is not an id is refused without a request', async () => {
  const { client, sent } = harness([{ body: responseBody('r1', {}) }]);
  for (const responseId of ['', '../x', 'a/b', 'has space', 'x'.repeat(300), null, 42]) {
    await assert.rejects(client.getResponse('token', FORM_ID, responseId), GoogleFormsApiError, String(responseId));
  }
  assert.equal(sent.length, 0);
});

test('a response Google does not have surfaces as a plain 404 error, not an empty response', async () => {
  const { client } = harness([{ status: 404, body: { error: { code: 404, status: 'NOT_FOUND', message: 'Requested entity was not found.' } } }]);
  await assert.rejects(client.getResponse('token', FORM_ID, 'gone'), error => {
    assert.ok(error instanceof GoogleFormsApiError);
    assert.equal(error.info.kind, 'http');
    assert.equal(error.info.httpStatus, 404);
    return true;
  });
});

// ------------------------------------------------------------------------ retries

test('only the failures that can improve are retried', () => {
  const http = httpStatus => new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus });
  assert.equal(isRetryable(http(429)), true, 'rate limited: waiting is the fix');
  assert.equal(isRetryable(http(500)), true);
  assert.equal(isRetryable(http(503)), true);
  assert.equal(isRetryable(new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'network' })), true);
  assert.equal(isRetryable(new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'timeout' })), true);
  assert.equal(isRetryable(http(400)), false, 'a malformed request stays malformed');
  assert.equal(isRetryable(http(401)), false, 'a bad token does not become good by retrying');
  assert.equal(isRetryable(http(403)), false, 'a missing permission is an answer');
  assert.equal(isRetryable(http(404)), false);
  assert.equal(isRetryable(new Error('something else')), false);
});

test('a retry waits longer each time, within a bound, and honours what Google asked for', () => {
  const options = { baseDelayMs: 400, maxDelayMs: 4000, random: () => 0 };
  assert.equal(retryDelayMs(1, undefined, options), 400);
  assert.equal(retryDelayMs(2, undefined, options), 800);
  assert.equal(retryDelayMs(3, undefined, options), 1600);
  assert.equal(retryDelayMs(20, undefined, options), 4000, 'never unbounded');
  assert.equal(retryDelayMs(1, 2, options), 2000, 'Retry-After wins');
  assert.equal(retryDelayMs(1, 600, options), 4000, 'but is itself capped');
  assert.ok(retryDelayMs(1, undefined, { ...options, random: () => 0.999 }) > 400, 'jitter, so a crowd does not return at once');
});

test('a transient failure is retried and the caller sees the successful answer', async () => {
  let attempts = 0;
  const waits = [];
  const result = await withRetry(async () => {
    attempts += 1;
    if (attempts < 3) throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 429, retryAfterSeconds: 1 });
    return 'page';
  }, { sleep: async ms => { waits.push(ms); }, random: () => 0 });

  assert.equal(result, 'page');
  assert.equal(attempts, 3);
  assert.deepEqual(waits, [1000, 1000], 'each retry waits as long as Google asked');
});

test('a permanent failure is not retried at all', async () => {
  let attempts = 0;
  await assert.rejects(withRetry(async () => {
    attempts += 1;
    throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 403 });
  }, { sleep: async () => {} }), GoogleFormsApiError);
  assert.equal(attempts, 1, 'no quota spent being told the same thing twice');
});

test('retrying stops after the attempts allowed and throws the last real error', async () => {
  let attempts = 0;
  await assert.rejects(withRetry(async () => {
    attempts += 1;
    throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'http', httpStatus: 503 });
  }, { attempts: 3, sleep: async () => {}, random: () => 0 }), error => {
    assert.equal(error.info.httpStatus, 503);
    return true;
  });
  assert.equal(attempts, 3);
});
