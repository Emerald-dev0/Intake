import { test } from 'node:test';
import assert from 'node:assert/strict';
import { FORM_ERROR_STATUS, statusFor, toFailureBody } from '../server/forms/errors.ts';
import { createFormLogger, newRequestId, sanitizeLogFields } from '../server/forms/logging.ts';
import { planGoogleForm } from '../server/forms/providers/google/plan.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';
import { EXAMPLE_SPECIFICATION, FORM_ERROR_CODES } from '../src/lib/forms.ts';
import { createWorld, form, shortText } from './helpers/forms-harness.mjs';

// ---------------------------------------------------------------- logging

test('log fields are shaped and cleaned: secret-looking keys are masked, strings are bounded and redacted', () => {
  const safe = sanitizeLogFields({
    requestId: 'req_1',
    count: 3,
    ratio: Number.NaN,
    ok: true,
    nothing: null,
    skipped: undefined,
    accessToken: 'ACCESS_TOKEN_SHOULD_NOT_LEAK',
    refresh_token: 'REFRESH_TOKEN_SHOULD_NOT_LEAK',
    clientSecret: 'secret',
    Authorization: 'Bearer abc',
    cookie: 'session=abc',
    codeVerifier: 'verifier',
    ciphertext: 'v1.abc',
    apiKey: 'key',
    message: 'line one\nline two\u0000 access_token=abc123 postgresql://user:pass@host/db',
    long: 'x'.repeat(1000),
    codes: Array.from({ length: 40 }, (_, index) => `code_${index}`),
  });
  for (const key of ['accessToken', 'refresh_token', 'clientSecret', 'Authorization', 'cookie', 'codeVerifier', 'ciphertext', 'apiKey']) assert.equal(safe[key], '[redacted]', key);
  assert.equal('skipped' in safe, false);
  assert.equal(safe.ratio, null);
  assert.equal(safe.count, 3);
  assert.equal(safe.ok, true);
  assert.equal(safe.nothing, null);
  assert.equal(safe.long.length, 300);
  assert.equal(safe.codes.length, 20);
  assert.equal(/[\u0000-\u001f]/.test(safe.message), false, 'no control characters, so a log line cannot be forged');
  assert.equal(safe.message.includes('abc123'), false);
  assert.equal(safe.message.includes('pass@host'), false);
  assert.match(safe.message, /\[redacted/);
});

test('values that are not plain scalars or string lists are dropped rather than serialized', () => {
  const safe = sanitizeLogFields({ nested: { token: 'x' }, fn: () => 1, sym: Symbol('s') });
  assert.deepEqual(safe, {});
});

test('the logger writes one JSON object per event with a level that matches its severity', () => {
  const lines = [];
  const log = createFormLogger((line, level) => lines.push({ line, level }));
  log('form.create.started', { requestId: 'req_1', userId: 'user-a' });
  log('form.create.provider_request', { requestId: 'req_1' });
  log('form.create.completed', { requestId: 'req_1' });
  log('form.create.validation_failed', { requestId: 'req_1' });
  log('form.create.rejected', { requestId: 'req_1' });
  log('form.create.provider_failed', { requestId: 'req_1' });
  log('form.create.persist_failed', { requestId: 'req_1' });
  assert.deepEqual(lines.map(item => item.level), ['info', 'info', 'info', 'warn', 'warn', 'error', 'error']);
  for (const { line } of lines) {
    const parsed = JSON.parse(line);
    assert.equal(parsed.requestId, 'req_1');
    assert.match(parsed.event, /^form\.create\./);
    assert.ok(!Number.isNaN(Date.parse(parsed.time)));
    assert.equal(line.includes('\n'), false);
  }
});

test('the five events the workspace and operators rely on exist by name', () => {
  const lines = [];
  const log = createFormLogger(line => lines.push(JSON.parse(line).event));
  for (const event of ['form.create.started', 'form.create.validation_failed', 'form.create.provider_request', 'form.create.provider_failed', 'form.create.completed']) log(event, {});
  assert.equal(lines.length, 5);
});

test('request ids are opaque, url-safe and unique', () => {
  const ids = new Set(Array.from({ length: 2000 }, () => newRequestId()));
  assert.equal(ids.size, 2000);
  for (const id of ids) assert.match(id, /^req_[A-Za-z0-9_-]{12}$/);
});

// ---------------------------------------------------------------- the error contract

test('every error code the browser knows has exactly one HTTP status on the server, and vice versa', () => {
  assert.deepEqual([...FORM_ERROR_CODES].sort(), Object.keys(FORM_ERROR_STATUS).sort());
  for (const code of FORM_ERROR_CODES) {
    const status = statusFor(code);
    assert.ok(status >= 400 && status < 600, `${code} -> ${status}`);
  }
});

test('only a missing Intake session is a 401, so a provider problem never looks like being signed out', () => {
  const unauthorized = FORM_ERROR_CODES.filter(code => statusFor(code) === 401);
  assert.deepEqual(unauthorized, ['not_authenticated']);
  for (const code of ['provider_not_connected', 'provider_reauthorization_required']) assert.equal(statusFor(code), 409);
  assert.equal(statusFor('validation_failed'), 422);
  assert.equal(statusFor('provider_not_supported'), 501);
});

test('a failure body carries only what was set, and never the server-only account id', () => {
  const minimal = toFailureBody({ code: 'forbidden', message: 'No.' }, 'req_1');
  assert.deepEqual(minimal, { error: 'No.', code: 'forbidden', requestId: 'req_1' });
  const full = toFailureBody({
    code: 'provider_rejected',
    message: 'Rejected.',
    issues: [{ code: 'x', path: 'p', message: 'm' }],
    provider: 'google',
    stage: 'add_questions',
    outcome: 'partial',
    retryable: false,
    detail: 'Invalid value',
    partialForm: { providerFormId: 'abc12345', editUrl: null, state: 'unpublished' },
  }, 'req_2');
  assert.deepEqual(Object.keys(full).sort(), ['code', 'error', 'issues', 'outcome', 'partialForm', 'provider', 'requestId', 'retryable', 'stage']);
  assert.equal(full.detail, undefined, 'even unexpected detail fields are not serialized to clients');
  assert.equal(toFailureBody({ code: 'forbidden', message: 'x', issues: [] }, 'r').issues, undefined, 'empty issue lists are omitted');
});

// ---------------------------------------------------------------- how storage failures are described

test('a missing table is reported as storage_unavailable, any other write failure as storage_failed', async () => {
  for (const [error, reason] of [[Object.assign(new Error('relation "form" does not exist'), { code: '42P01' }), 'storage_unavailable'], [new Error('connection reset'), 'storage_failed']]) {
    const world = createWorld();
    await world.connect('user-a');
    const { engine } = world.engine({ store: { save: async () => { throw error; }, listForUser: async () => [] } });
    const outcome = await engine.createForm({ userId: 'user-a', provider: 'google', specification: form([shortText('q', { title: 'Q' })]) });
    assert.equal(outcome.ok, true, 'the form exists, so the request succeeded');
    assert.equal(outcome.form.id, null);
    assert.equal(world.logs.find(entry => entry.event === 'form.create.persist_failed').reason, reason);
  }
});

test('the engine turns an unexpected exception into a safe internal_error and frees the user\'s slot', async () => {
  const world = createWorld();
  await world.connect('user-a');
  const providers = world.providers();
  providers.google = { ...providers.google, createForm: async () => { throw new RangeError('boom postgresql://u:p@h/d'); } };
  const { engine } = world.engine({ providers });
  const specification = form([shortText('q', { title: 'Q' })]);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await engine.createForm({ userId: 'user-a', provider: 'google', specification });
    assert.equal(outcome.ok, false);
    assert.equal(outcome.error.code, 'internal_error', 'the second attempt reaches the adapter again, so the slot was released');
    assert.equal(JSON.stringify(outcome).includes('postgresql'), false);
    assert.equal(outcome.error.retryable, false);
  }
  assert.equal(JSON.stringify(world.logs).includes('postgresql'), false);
});

// ---------------------------------------------------------------- the provider service addition

test('reporting a rejected token flags only that user\'s own connection', async () => {
  const world = createWorld();
  await world.connect('user-a');
  await world.connect('user-b');
  await world.service.reportAuthorizationRejected('user-a', 'google');
  assert.equal((await world.store.getConnection('user-a', 'google')).status, 'reauthorization_required');
  assert.equal((await world.store.getConnection('user-b', 'google')).status, 'connected');
  const refused = await world.service.getAuthorizedConnection('user-a', 'google');
  assert.deepEqual([refused.ok, refused.reason], [false, 'reauthorization_required']);
  assert.equal((await world.service.getAuthorizedConnection('user-b', 'google')).ok, true);
});

test('reporting for a user with no connection, or for an unknown provider, does nothing and does not throw', async () => {
  const world = createWorld();
  await assert.doesNotReject(world.service.reportAuthorizationRejected('nobody', 'google'));
  await assert.doesNotReject(world.service.reportAuthorizationRejected('nobody', 'dropbox'));
  assert.equal(await world.store.getConnection('nobody', 'google'), null);
});

// ---------------------------------------------------------------- the shipped example

test('the example in the workspace validates and Google can express it', () => {
  const parsed = parseFormSpecification(EXAMPLE_SPECIFICATION);
  assert.equal(parsed.ok, true);
  const planned = planGoogleForm(parsed.specification);
  assert.equal(planned.ok, true);
  assert.deepEqual(planned.plan.warnings.map(warning => warning.questionId), ['email']);
});
