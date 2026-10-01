import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createCreationLimiter } from '../server/forms/engine.ts';
import { createFormsRouter } from '../server/forms/routes.ts';
import { createFormsProviders } from '../server/forms/providers/index.ts';
import { createMemoryFormStore } from '../server/forms/memory-store.ts';
import { EXAMPLE_SPECIFICATION } from '../src/lib/forms.ts';
import { CLIENT_SECRET, ORIGIN, REFRESHED_TOKEN, createWorld, form, shortText, when, yesNo } from './helpers/forms-harness.mjs';

const SIMPLE = form([shortText('name', { title: 'Full name', required: true })], { title: 'Route test form' });
const SECRETS = ['ACCESS_TOKEN_OF_USER-A', 'REFRESH_TOKEN_OF_USER-A', 'ACCESS_TOKEN_OF_USER-B', 'REFRESH_TOKEN_OF_USER-B', REFRESHED_TOKEN, CLIENT_SECRET, 'google-account-of-user-a', 'google-account-of-user-b', 'Bearer '];

async function boot(options = {}) {
  const world = createWorld(options.world);
  const parts = world.engine(typeof options.engine === 'function' ? options.engine(world) : (options.engine ?? {}));
  const users = { current: { id: 'user-a', email: 'a@intake.test', name: 'Ada' }, failing: false };
  const app = express();
  app.use('/api/forms', createFormsRouter({
    engine: parts.engine,
    getSession: async () => {
      if (users.failing) throw new Error('database unreachable password=hunter2');
      return users.current;
    },
    env: world.env,
    log: world.log,
    allowDirectCreation: options.allowDirectCreation,
    abuseLimiter: options.abuseLimiter,
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;

  async function call(method, body, { headers = {}, raw = false, path = '', origin = ORIGIN } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(method === 'POST' ? { 'content-type': 'application/json', ...(origin === null ? {} : { origin }) } : {}), ...headers },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  return {
    world,
    users,
    ...parts,
    post: (body, options) => call('POST', body, options),
    get: options => call('GET', undefined, options),
    call,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function withServer(options, run) {
  const app = await boot(options);
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

function assertNoSecrets(app, ...values) {
  const haystack = JSON.stringify([app.world.logs, ...values]);
  for (const secret of SECRETS) assert.equal(haystack.includes(secret), false, `a secret appeared where it must not: ${secret}`);
}

function assertFailureShape(response, status, code) {
  assert.equal(response.status, status, response.text);
  assert.equal(response.json?.code, code, response.text);
  assert.equal(typeof response.json.error, 'string');
  assert.equal(response.json.requestId, response.headers.get('x-request-id'), 'the id in the body is the id in the header');
  assert.match(response.json.requestId, /^req_[A-Za-z0-9_-]+$/);
  assert.equal(response.text.includes('    at '), false, 'no stack trace');
}

// ---------------------------------------------------------------- authentication

test('an unauthenticated request is refused before anything else happens', () =>
  withServer({}, async app => {
    app.users.current = null;
    await app.world.connect('user-a');
    const post = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(post, 401, 'not_authenticated');
    const list = await app.get();
    assertFailureShape(list, 401, 'not_authenticated');
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0);
    assert.equal(app.formStore.all().length, 0);
    assert.equal(post.headers.get('cache-control'), 'no-store');
    assert.equal(post.headers.get('referrer-policy'), 'no-referrer');
  }));

test('an unauthenticated caller with an unreadable body still gets 401, not a parse error', () =>
  withServer({}, async app => {
    app.users.current = null;
    const response = await app.post('{ not json', { raw: true });
    assertFailureShape(response, 401, 'not_authenticated');
  }));

test('a session lookup failure is a 503 that leaks nothing', () =>
  withServer({}, async app => {
    app.users.failing = true;
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 503, 'storage_unavailable');
    assert.equal(response.text.includes('hunter2'), false);
    assert.equal(response.json.retryable, true);
  }));

test('production composition can disable the direct structured creation route', () =>
  withServer({ allowDirectCreation: false }, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 405, 'invalid_request');
    assert.equal(response.json.retryable, false);
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.formStore.all().length, 0);
  }));

test('library filters and import URLs are rejected strictly before provider access', () =>
  withServer({}, async app => {
    const invalidLimit = await app.get({ path: '?mode=library&limit=0' });
    assertFailureShape(invalidLimit, 400, 'invalid_request');
    const repeated = await app.get({ path: '?mode=library&sort=newest&sort=oldest' });
    assertFailureShape(repeated, 400, 'invalid_request');
    const unknown = await app.get({ path: '?mode=library&owner=user-b' });
    assertFailureShape(unknown, 400, 'invalid_request');
    const importResponse = await app.post({ url: 'https://evil.example/forms/not-google' }, { path: '/library/import' });
    assertFailureShape(importResponse, 400, 'invalid_request');
    assert.equal(app.world.fake.calls.length, 0);
  }));

// ---------------------------------------------------------------- cross-site requests and body handling

test('a cross-site POST is refused before the body is read', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    for (const origin of ['https://evil.example', 'null', 'http://localhost:5173.evil.example', 'http://localhost:5174']) {
      // An unreadable body proves the check happens first: a 400 here would mean the body was parsed.
      const response = await app.post('{ not json', { raw: true, origin });
      assertFailureShape(response, 403, 'forbidden');
      assert.match(response.json.error, /Nothing was created/);
    }
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0);
    assert.equal(app.formStore.all().length, 0);
  }));

test('a POST with neither Origin nor Referer is refused, and a Referer from the app itself is accepted', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const body = { provider: 'google', specification: SIMPLE };
    assertFailureShape(await app.post(body, { origin: null }), 403, 'forbidden');
    assertFailureShape(await app.post(body, { origin: null, headers: { referer: 'https://evil.example/app/forms' } }), 403, 'forbidden');
    assertFailureShape(await app.post(body, { origin: null, headers: { referer: 'not a url' } }), 403, 'forbidden');
    assert.equal(app.world.fake.calls.length, 0);
    const accepted = await app.post(body, { origin: null, headers: { referer: `${ORIGIN}/app/forms` } });
    assert.equal(accepted.status, 201, accepted.text);
  }));

test('malformed, oversized and mis-shaped bodies are refused as JSON, with nothing created', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    assertFailureShape(await app.post('{ "provider": ', { raw: true }), 400, 'invalid_request');
    assertFailureShape(await app.post('"just a string"', { raw: true }), 400, 'invalid_request');
    assertFailureShape(await app.post([], {}), 400, 'invalid_request');
    assertFailureShape(await app.post('hello', { raw: true, headers: { 'content-type': 'text/plain' } }), 400, 'invalid_request');
    const huge = await app.post({ provider: 'google', specification: { title: 'x'.repeat(200_000), questions: [] } });
    assertFailureShape(huge, 413, 'invalid_request');
    assert.equal(app.world.fake.calls.length, 0);
  }));

test('no request can name a token, a provider account, a connection or a user', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    for (const key of ['accessToken', 'refreshToken', 'access_token', 'userId', 'user_id', 'connectionId', 'providerAccountId', 'externalAccountId', 'accountId', 'authorization', 'extra']) {
      const response = await app.post({ provider: 'google', specification: SIMPLE, [key]: 'SMUGGLED_VALUE_12345' });
      assertFailureShape(response, 400, 'invalid_request');
      assert.ok(response.json.issues.some(issue => issue.code === 'unknown_property' && issue.path === key), key);
      assert.equal(response.text.includes('SMUGGLED_VALUE_12345'), false, 'the value is never echoed');
      assert.equal(response.json.outcome, 'not_created');
    }
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0);
    assert.equal(JSON.stringify(app.world.logs).includes('SMUGGLED_VALUE_12345'), false);
  }));

test('hostile property names are neutralized before they appear in a response or a log', () =>
  withServer({}, async app => {
    const response = await app.post({ provider: 'google', specification: SIMPLE, '<script>alert(1)</script>\nX': 1 });
    assertFailureShape(response, 400, 'invalid_request');
    assert.equal(response.text.includes('<script>'), false);
    assert.equal(JSON.stringify(app.world.logs).includes('<script>'), false);
  }));

test('a missing provider or specification is reported for each field', () =>
  withServer({}, async app => {
    const both = await app.post({});
    assertFailureShape(both, 400, 'invalid_request');
    assert.deepEqual(both.json.issues.map(issue => issue.path).sort(), ['provider', 'specification']);
    const noSpec = await app.post({ provider: 'google' });
    assert.deepEqual(noSpec.json.issues.map(issue => issue.path), ['specification']);
  }));

test('an unknown provider is rejected without reaching any adapter', () =>
  withServer({}, async app => {
    for (const provider of ['dropbox', 'Google', '', 7, null, { id: 'google' }, ['google']]) {
      const response = await app.post({ provider, specification: SIMPLE });
      assertFailureShape(response, 400, 'unsupported_provider');
    }
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0);
  }));

test('unknown paths and methods answer in the same JSON shape', () =>
  withServer({}, async app => {
    const put = await app.call('PUT', {}, { headers: { 'content-type': 'application/json' } });
    assert.equal(put.status, 404);
    assert.equal(put.json.code, 'invalid_request');
    const nested = await app.get({ path: '/anything' });
    assert.equal(nested.status, 404);
  }));

// ---------------------------------------------------------------- validation and provider state

test('an invalid specification returns exactly what is wrong and makes zero provider requests', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const cases = [
      ['title_required', { questions: [shortText('a')] }],
      ['options_required', { title: 'T', questions: [{ id: 'q', type: 'multiple_choice', title: 'Pick' }] }],
      ['options_required', { title: 'T', questions: [{ id: 'q', type: 'dropdown', title: 'Pick', options: [] }] }],
      ['unsupported_question_type', { title: 'T', questions: [{ id: 'q', type: 'signature', title: 'Sign' }] }],
      ['duplicate_question_id', { title: 'T', questions: [shortText('a'), shortText('a')] }],
      ['unknown_question_reference', { title: 'T', questions: [shortText('a', when('ghost', 'Yes'))] }],
    ];
    for (const [code, specification] of cases) {
      const response = await app.post({ provider: 'google', specification });
      assertFailureShape(response, 422, 'validation_failed');
      assert.equal(response.json.outcome, 'not_created');
      assert.equal(response.json.retryable, false);
      assert.ok(response.json.issues.some(issue => issue.code === code), `${code}: ${response.text}`);
      for (const issue of response.json.issues) assert.ok(issue.path !== undefined && issue.message);
    }
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0, 'the connection is not even read');
    assert.equal(app.formStore.all().length, 0);
  }));

test('a form Google cannot express is a 422 with the reason, and nothing is sent', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'google', specification: form([yesNo(), shortText('a', when('need', 'Yes')), shortText('b', when('need', 'No'))]) });
    assertFailureShape(response, 422, 'unsupported_by_provider');
    assert.ok(response.json.issues.some(issue => issue.code === 'google_condition_placement'));
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0);
  }));

test('Microsoft is reported as not available and nothing is called', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'microsoft', specification: SIMPLE });
    assertFailureShape(response, 501, 'provider_not_supported');
    assert.equal(response.json.provider, 'microsoft');
    assert.equal(response.json.outcome, 'not_created');
    assert.match(response.json.error, /Microsoft Forms creation is not available yet/);
    assert.equal(app.world.fake.calls.length, 0);
    assert.equal(app.world.lookups.length, 0);
  }));

test('a user with no Google connection is told to connect, with a 409 that is never a sign-in redirect', () =>
  withServer({}, async app => {
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 409, 'provider_not_connected');
    assert.equal(response.json.stage, 'connection');
    assert.equal(response.json.outcome, 'not_created');
    assert.match(response.json.error, /Connect Google Forms/);
    assert.equal(app.world.fake.calls.length, 0);
  }));

test('an expired connection returns a 409 asking to reconnect', () =>
  withServer({}, async app => {
    await app.world.connect('user-a', { status: 'reauthorization_required' });
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 409, 'provider_reauthorization_required');
    assert.match(response.json.error, /Reconnect Google/);
    assert.equal(app.world.fake.calls.length, 0);
  }));

// ---------------------------------------------------------------- the whole path

test('a signed-in user with Google connected creates a form: authenticated, validated, their connection, real links', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'google', specification: EXAMPLE_SPECIFICATION });
    assert.equal(response.status, 201, response.text);
    assert.deepEqual(Object.keys(response.json).sort(), ['form', 'requestId', 'warnings']);
    assert.equal(response.json.requestId, response.headers.get('x-request-id'));

    const google = app.world.fake.lastForm();
    assert.deepEqual(Object.keys(response.json.form).sort(), ['createdAt', 'editUrl', 'id', 'provider', 'providerFormId', 'published', 'responderUrl', 'title']);
    assert.deepEqual(response.json.form, {
      id: 'form-record-1',
      provider: 'google',
      providerFormId: google.formId,
      title: 'Final Year Project Registration',
      editUrl: `https://docs.google.com/forms/d/${google.formId}/edit`,
      responderUrl: google.responderUri,
      published: true,
      createdAt: '2026-09-29T09:00:00.000Z',
    });
    assert.deepEqual(response.json.warnings.map(warning => warning.code), ['email_validation_unavailable']);

    // Google holds a real, published form with every question, routed by section.
    assert.deepEqual(google.publishState, { isPublished: true, isAcceptingResponses: true });
    assert.equal(google.info.title, 'Final Year Project Registration');
    assert.equal(google.info.description, 'Register for the final-year project showcase.');
    assert.equal(google.items.filter(item => item.questionItem).length, EXAMPLE_SPECIFICATION.questions.length);
    assert.equal(google.items.filter(item => item.pageBreakItem).length, 1);

    // The ownership chain is stored, and the provider account never leaves the server.
    const [record] = app.formStore.all();
    assert.equal(record.userId, 'user-a');
    assert.equal(record.provider, 'google');
    assert.equal(record.externalAccountId, 'google-account-of-user-a');
    assert.equal(record.providerFormId, google.formId);
    assert.equal(record.status, 'created');
    assert.equal(record.requestId, response.json.requestId);
    assert.equal(record.specification.title, 'Final Year Project Registration');

    assertNoSecrets(app, response.json, response.text);
  }));

test('the Google calls carry the signed-in user\'s token and nothing from the request', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    await app.post({ provider: 'google', specification: SIMPLE });
    assert.ok(app.world.fake.calls.length >= 3);
    assert.ok(app.world.fake.calls.every(call => call.authorization === 'Bearer ACCESS_TOKEN_OF_USER-A'));
    assert.deepEqual(app.world.lookups, [['user-a', 'google']]);
  }));

test('one user cannot use, see or affect another user\'s connection or forms', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');

    // user-b has no connection of their own: user-a's does not help them.
    app.users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };
    const denied = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(denied, 409, 'provider_not_connected');
    assert.equal(app.world.fake.calls.length, 0, 'user-a\'s token was not used for user-b');

    // user-b cannot name user-a's connection, account or user.
    for (const smuggle of [{ userId: 'user-a' }, { connectionId: 'connection-user-a' }, { providerAccountId: 'google-account-of-user-a' }]) {
      assertFailureShape(await app.post({ provider: 'google', specification: SIMPLE, ...smuggle }), 400, 'invalid_request');
    }
    assert.equal(app.world.fake.calls.length, 0);

    // Once user-b connects their own account, forms go to their account with their token.
    await app.world.connect('user-b');
    const created = await app.post({ provider: 'google', specification: SIMPLE });
    assert.equal(created.status, 201, created.text);
    assert.ok(app.world.fake.calls.every(call => call.authorization === 'Bearer ACCESS_TOKEN_OF_USER-B'));

    // user-a's own form.
    app.users.current = { id: 'user-a', email: 'a@intake.test', name: 'Ada' };
    const own = await app.post({ provider: 'google', specification: form([shortText('q', { title: 'Q' })], { title: 'Ada form' }) });
    assert.equal(own.status, 201, own.text);

    const aList = await app.get();
    const bId = created.json.form.providerFormId;
    assert.deepEqual(aList.json.forms.map(item => item.title), ['Ada form']);
    assert.equal(aList.text.includes(bId), false, 'user-a never sees user-b\'s form');

    app.users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };
    const bList = await app.get();
    assert.deepEqual(bList.json.forms.map(item => item.title), ['Route test form']);
    assert.equal(bList.text.includes(own.json.form.providerFormId), false, 'user-b never sees user-a\'s form');

    assert.deepEqual(app.formStore.all().map(record => [record.userId, record.externalAccountId]), [
      ['user-b', 'google-account-of-user-b'],
      ['user-a', 'google-account-of-user-a'],
    ]);
    assertNoSecrets(app, aList.text, bList.text, created.text, own.text);
  }));

test('the list returns only what the workspace needs, newest first', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    for (const title of ['First', 'Second', 'Third']) {
      app.world.clock.time = new Date(app.world.clock.time.getTime() + 60_000);
      const created = await app.post({ provider: 'google', specification: form([shortText('q', { title: 'Q' })], { title }) });
      assert.equal(created.status, 201, created.text);
    }
    const list = await app.get();
    assert.equal(list.status, 200);
    assert.deepEqual(Object.keys(list.json).sort(), ['forms', 'requestId']);
    assert.deepEqual(list.json.forms.map(item => item.title), ['Third', 'Second', 'First']);
    assert.deepEqual(Object.keys(list.json.forms[0]).sort(), ['createdAt', 'editUrl', 'failureStage', 'id', 'provider', 'providerFormId', 'responderUrl', 'status', 'title']);
    assert.equal(JSON.stringify(list.json).includes('specification'), false);
    assert.equal(JSON.stringify(list.json).includes('externalAccountId'), false);
    assertNoSecrets(app, list.text);
  }));

// ---------------------------------------------------------------- failures that leave something behind

test('a partly built form is reported with its link, recorded as incomplete, and never listed as live', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.failOn('forms.batchUpdate', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'Invalid requests[1]' });
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 502, 'provider_rejected');
    const google = app.world.fake.lastForm();
    assert.equal(response.json.outcome, 'partial');
    assert.equal(response.json.stage, 'add_questions');
    assert.equal(response.json.retryable, false);
    assert.deepEqual(response.json.partialForm, { providerFormId: google.formId, editUrl: `https://docs.google.com/forms/d/${google.formId}/edit`, state: 'unpublished' });
    assert.equal(response.json.form, undefined, 'a failure never carries a success payload');
    assert.equal(response.text.includes('google-account-of-user-a'), false);

    const [record] = app.formStore.all();
    assert.equal(record.status, 'incomplete');
    assert.equal(record.failureStage, 'add_questions');
    assert.equal(record.responderUrl, null);
    assert.equal(record.externalAccountId, 'google-account-of-user-a');

    const list = await app.get();
    assert.deepEqual(list.json.forms.map(item => [item.status, item.failureStage, item.responderUrl]), [['incomplete', 'add_questions', null]]);
    assert.ok(list.json.forms[0].editUrl.startsWith('https://docs.google.com/forms/d/'));
    assert.deepEqual(google.publishState, { isPublished: false, isAcceptingResponses: false });
    assertNoSecrets(app, response.text, list.text);
  }));

test('trying again after a partial failure creates a separate form and does not pretend otherwise', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.failOn('forms.batchUpdate', { status: 500, googleStatus: 'INTERNAL', message: 'Internal error' });
    assertFailureShape(await app.post({ provider: 'google', specification: SIMPLE }), 502, 'provider_error');
    const again = await app.post({ provider: 'google', specification: SIMPLE });
    assert.equal(again.status, 201, again.text);
    assert.equal(app.world.fake.forms.size, 2, 'the earlier partly built form was not touched or reused');
    assert.deepEqual(app.formStore.all().map(record => record.status), ['incomplete', 'created']);
  }));

test('when Google does not answer forms.create, the outcome is unknown and nothing is recorded', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.failOn('forms.create', { timeout: true });
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 503, 'provider_unavailable');
    assert.equal(response.json.outcome, 'unknown');
    assert.equal(response.json.retryable, false);
    assert.equal(response.json.partialForm, undefined);
    assert.equal(app.formStore.all().length, 0, 'there is no form id to record');
  }));

test('a Google rate limit before anything exists is a retryable 429', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.failOn('forms.create', { status: 429, googleStatus: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', headers: { 'retry-after': '30' } });
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 429, 'provider_rate_limited');
    assert.equal(response.json.outcome, 'not_created');
    assert.equal(response.json.retryable, true);
    assert.equal(response.json.retryAfterSeconds, 30);
    assert.equal(response.headers.get('retry-after'), '30');
  }));

test('a rejected Google token returns a 409 reconnect prompt and flags the connection', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.revokeToken('ACCESS_TOKEN_OF_USER-A');
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(response, 409, 'provider_reauthorization_required');
    assert.notEqual(response.status, 401, 'the workspace must not treat this as being signed out of Intake');
    assert.equal((await app.world.store.getConnection('user-a', 'google')).status, 'reauthorization_required');
  }));

// ---------------------------------------------------------------- persistence

test('failing to record the form does not turn a created form into an error', () =>
  withServer({ engine: { store: { save: async () => { throw new Error('db down postgresql://u:p@h/d'); }, listForUser: async () => [] } } }, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assert.equal(response.status, 201, response.text);
    assert.equal(response.json.form.id, null);
    assert.equal(response.json.form.createdAt, null);
    assert.ok(response.json.form.editUrl && response.json.form.responderUrl, 'the links are still returned');
    const persistFailure = app.world.logs.find(entry => entry.event === 'form.create.persist_failed');
    assert.equal(persistFailure.formId, response.json.form.providerFormId, 'the id is logged where an operator can recover it');
    assert.equal(JSON.stringify(app.world.logs).includes('postgresql://'), false);
    assert.equal(app.world.logs.find(entry => entry.event === 'form.create.completed').recorded, false);
  }));

test('a storage failure while listing is a retryable 503', () =>
  withServer({ engine: { store: { save: async () => { throw new Error('unused'); }, listForUser: async () => { throw new Error('relation "form" does not exist'); } } } }, async app => {
    const response = await app.get();
    assertFailureShape(response, 503, 'storage_unavailable');
    assert.equal(response.json.retryable, true);
    assert.equal(response.text.includes('relation'), false);
  }));

// ---------------------------------------------------------------- one at a time, and a ceiling

test('a second creation while one is running is refused, the first still completes, and other users are not blocked', { timeout: 20_000 }, async () => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  let entered;
  const inside = new Promise(resolve => { entered = resolve; });
  const gatedProviders = world => {
    const client = {
      ...world.google.client,
      createForm: async (...args) => {
        if (args[0] === 'ACCESS_TOKEN_OF_USER-A') {
          entered();
          await gate;
        }
        return world.google.client.createForm(...args);
      },
    };
    return { providers: createFormsProviders({ env: world.env, google: { ...world.google, client } }) };
  };
  await withServer({ engine: gatedProviders }, async app => {
    await app.world.connect('user-a');
    await app.world.connect('user-b');

    const first = app.post({ provider: 'google', specification: SIMPLE });
    await inside; // the first request is now inside the provider, holding user-a's slot

    const second = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(second, 409, 'creation_in_progress');
    assert.equal(second.json.retryable, true);
    assert.equal(second.json.outcome, 'not_created');
    assert.equal(app.world.fake.forms.size, 0, 'the refused request created nothing');

    app.users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };
    const other = await app.post({ provider: 'google', specification: SIMPLE });
    assert.equal(other.status, 201, 'the slot is per user');
    app.users.current = { id: 'user-a', email: 'a@intake.test', name: 'Ada' };

    release();
    const done = await first;
    assert.equal(done.status, 201, done.text);
    assert.equal(app.world.fake.forms.size, 2, 'exactly one form each');

    const third = await app.post({ provider: 'google', specification: SIMPLE });
    assert.equal(third.status, 201, 'the slot was released');
  });
});

test('the engine allows one creation at a time per user and a ceiling per window', async () => {
  const limiter = createCreationLimiter({ limit: 3, windowMs: 1000 });
  const a = limiter.acquire('user-a', 0);
  assert.equal(a.ok, true);
  assert.deepEqual(limiter.acquire('user-a', 1), { ok: false, reason: 'in_progress' });
  const b = limiter.acquire('user-b', 1);
  assert.equal(b.ok, true, 'another user is independent');
  a.release();
  b.release();
  for (const at of [10, 20]) {
    const slot = limiter.acquire('user-a', at);
    assert.equal(slot.ok, true);
    slot.release();
  }
  assert.deepEqual(limiter.acquire('user-a', 30), { ok: false, reason: 'rate_limited' });
  const later = limiter.acquire('user-a', 1100);
  assert.equal(later.ok, true, 'the window slides');
  later.release();
});

test('the ceiling is enforced through the route', () =>
  withServer({ engine: { limiter: createCreationLimiter({ limit: 2 }) } }, async app => {
    await app.world.connect('user-a');
    for (let attempt = 0; attempt < 2; attempt += 1) assert.equal((await app.post({ provider: 'google', specification: SIMPLE })).status, 201);
    const third = await app.post({ provider: 'google', specification: SIMPLE });
    assertFailureShape(third, 429, 'rate_limited');
    assert.equal(third.json.retryable, true);
    assert.equal(app.world.fake.forms.size, 2);
  }));

test('a failed slot is always released, so one error never locks a user out', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.failOn('forms.create', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'nope' });
    assert.equal((await app.post({ provider: 'google', specification: SIMPLE })).status, 502);
    assert.equal((await app.post({ provider: 'google', specification: SIMPLE })).status, 201);
  }));

// ---------------------------------------------------------------- logs

test('a creation logs started, each provider request, and completed, tied together by the request id', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'google', specification: EXAMPLE_SPECIFICATION });
    assert.equal(response.status, 201);
    assert.deepEqual(app.world.eventNames(), [
      'form.create.started',
      'form.create.provider_request',
      'form.create.provider_request',
      'form.create.provider_request',
      'form.create.completed',
    ]);
    assert.ok(app.world.logs.every(entry => entry.requestId === response.json.requestId));
    const completed = app.world.logs.at(-1);
    assert.equal(completed.formId, response.json.form.providerFormId);
    assert.equal(completed.questionCount, EXAMPLE_SPECIFICATION.questions.length);
    assert.equal(completed.published, true);
    assert.equal(completed.userId, 'user-a');
    assert.equal(typeof completed.durationMs, 'number');
    assertNoSecrets(app);
  }));

test('logs describe the operation without copying what the user wrote into the form', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    await app.post({ provider: 'google', specification: EXAMPLE_SPECIFICATION });
    await app.post({ provider: 'google', specification: { title: '', questions: [] } });
    const logged = JSON.stringify(app.world.logs);
    for (const text of ['Final Year Project Registration', 'Register for the final-year project showcase', 'Full name', 'Email address', 'Department', 'On campus', 'a@intake.test', 'Ada']) {
      assert.equal(logged.includes(text), false, `${text} must not be logged`);
    }
  }));

test('an invalid specification logs started and validation_failed, and no provider request', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    const response = await app.post({ provider: 'google', specification: { title: '', questions: [{ id: 'q', type: 'dropdown', title: 'Pick' }] } });
    assert.equal(response.status, 422);
    assert.deepEqual(app.world.eventNames(), ['form.create.started', 'form.create.validation_failed']);
    const failed = app.world.logs[1];
    assert.equal(failed.requestId, response.json.requestId);
    assert.ok(failed.issueCount >= 2);
    assert.ok(failed.codes.includes('title_required') && failed.codes.includes('options_required'));
  }));

test('a provider failure logs provider_failed with the stage and outcome', () =>
  withServer({}, async app => {
    await app.world.connect('user-a');
    app.world.fake.failOn('forms.batchUpdate', { status: 403, googleStatus: 'PERMISSION_DENIED', reason: 'SERVICE_DISABLED', message: 'API disabled' });
    const response = await app.post({ provider: 'google', specification: SIMPLE });
    assert.equal(response.status, 502);
    const events = app.world.eventNames();
    assert.deepEqual(events, ['form.create.started', 'form.create.provider_request', 'form.create.provider_request', 'form.create.provider_failed']);
    const failed = app.world.logs.at(-1);
    assert.deepEqual([failed.stage, failed.operation, failed.httpStatus, failed.reason, failed.outcome, failed.code], ['add_questions', 'forms.batchUpdate', 403, 'SERVICE_DISABLED', 'partial', 'provider_permission_denied']);
    assert.equal(failed.requestId, response.json.requestId);
    assertNoSecrets(app, response.text);
  }));

test('rejected requests are logged without the values that were sent', () =>
  withServer({}, async app => {
    await app.post({ provider: 'google', specification: SIMPLE, accessToken: 'LEAKY_VALUE_9876' });
    app.users.current = null;
    await app.post({ provider: 'google', specification: SIMPLE });
    const logged = JSON.stringify(app.world.logs);
    assert.equal(logged.includes('LEAKY_VALUE_9876'), false);
    const rejected = app.world.logs.find(entry => entry.event === 'form.create.rejected');
    assert.equal(rejected.reason, 'invalid_request');
    assert.deepEqual(rejected.properties, ['accessToken']);
  }));

test('a store that is queried through the route only ever sees the session user', async () => {
  const seen = [];
  const inner = createMemoryFormStore();
  const store = { save: (...args) => inner.save(...args), listForUser: (userId, limit) => { seen.push(userId); return inner.listForUser(userId, limit); }, all: () => inner.all() };
  await withServer({ engine: { store } }, async app => {
    await app.get();
    app.users.current = { id: 'user-z', email: 'z@intake.test', name: 'Zed' };
    await app.get({ headers: { 'x-user-id': 'user-a' } });
    assert.deepEqual(seen, ['user-a', 'user-z'], 'headers cannot change whose forms are read');
  });
});
