import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createMemoryDraftStore } from '../server/forms/draft-memory-store.ts';
import { createFormDraftRouter, createInterpretationLimiter } from '../server/forms/interpretation/routes.ts';
import { createFormInterpreter } from '../server/forms/interpretation/provider-interpreter.ts';
import { createUnconfiguredProvider } from '../server/ai/provider.ts';
import { createFormsRouter } from '../server/forms/routes.ts';
import { createWorld, ORIGIN } from './helpers/forms-harness.mjs';

const Q = (id, title, type = 'short_text', extra = {}) => ({ id, title, description: null, type, required: true, options: [], visibility: null, ...extra });
const SPEC = () => ({ title: 'Project registration', description: 'Please register.', questions: [
  Q('full_name', 'Full name'), Q('email', 'Email address', 'email'),
  Q('needs', 'Need accommodation?', 'multiple_choice', { options: ['Yes', 'No'] }),
  Q('type', 'What type of accommodation?', 'short_text', { visibility: { when: { question: 'needs', equals: 'Yes' } } }),
] });
const ready = (spec = SPEC()) => ({ status: 'ready', specification: spec, assumptions: ['Name and email are required.'], question: null, explanation: null });
const clarify = question => ({ status: 'needs_clarification', specification: null, assumptions: [], question, explanation: null });
const unsupported = explanation => ({ status: 'unsupported', specification: null, assumptions: [], question: null, explanation });
const secrets = ['ACCESS_TOKEN_OF_USER-A', 'REFRESH_TOKEN_OF_USER-A', 'google-account-of-user-a', 'Bearer ', 'test-google-client-secret'];

async function boot(options = {}) {
  const world = createWorld();
  const { engine, formStore } = world.engine();
  const store = options.store ?? createMemoryDraftStore();
  const inputs = [];
  const interpreter = {
    async interpret(input) {
      inputs.push(structuredClone(input));
      if (options.interpret) return options.interpret(input, inputs.length);
      return ready();
    },
  };
  const people = { current: { id: 'user-a', email: 'ada@example.test', name: 'Ada' }, failing: false };
  const app = express();
  app.use('/api/forms', createFormDraftRouter({
    store, engine, interpreter: options.interpreter ?? interpreter, env: world.env, log: world.log, now: world.now,
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(store.all().length + 1).padStart(12, '0')}`,
    limiter: options.limiter,
    abuseLimiter: options.abuseLimiter,
    getSession: async () => { if (people.failing) throw new Error('session password=hunter2'); return people.current; },
  }));
  app.use('/api/forms', createFormsRouter({ engine, env: world.env, log: world.log, getSession: async () => people.current }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;
  async function call(method, path, data, { origin = ORIGIN, raw = false } = {}) {
    const response = await fetch(base + path, { method, headers: {
      ...(method !== 'GET' ? { origin, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}) } : {}),
    }, body: data === undefined ? undefined : raw ? data : JSON.stringify(data) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 204 */ }
    return { status: response.status, json, text, headers: response.headers };
  }
  const api = {
    world, engine, formStore, store, people, inputs, call,
    interpret: (data = { provider: 'google', request: 'Register people' }, opts) => call('POST', '/interpret', data, opts),
    revise: (data, opts) => call('POST', '/revise', data, opts),
    confirm: (data, opts) => call('POST', '/confirm', data, opts),
    get: id => call('GET', `/draft/${id}`),
    discard: id => call('DELETE', `/draft/${id}`),
    async close() { await new Promise(resolve => server.close(resolve)); },
  };
  return api;
}
async function withApi(options, run) {
  const app = await boot(options);
  try { return await run(app); } finally { await app.close(); }
}
async function makeDraft(app) {
  const response = await app.interpret();
  assert.equal(response.status, 201, response.text);
  return response.json.draft;
}
const confirm = draft => ({ draftId: draft.id, version: draft.version, confirm: true });

function noSecrets(app, ...bodies) {
  const data = JSON.stringify([app.world.logs, ...bodies]);
  for (const secret of secrets) assert.equal(data.includes(secret), false, `secret leaked: ${secret}`);
}

test('the complete mocked workflow does not reach Google until a user confirms a validated draft', () => withApi({}, async app => {
  await app.world.connect('user-a');
  const draft = await makeDraft(app);
  assert.equal(draft.version, 1);
  assert.equal(draft.status, 'ready');
  assert.equal(draft.provider, 'google');
  assert.deepEqual(draft.specification.questions.map(q => q.type), ['short_text', 'email', 'multiple_choice', 'short_text']);
  assert.equal(draft.warnings[0].code, 'email_validation_unavailable');
  assert.equal(app.world.fake.calls.length, 0);
  assert.equal(app.formStore.all().length, 0);
  assert.equal((await app.get(draft.id)).json.draft.specification.title, draft.specification.title);
  const response = await app.confirm(confirm(draft));
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.draft.status, 'created');
  assert.equal(response.json.form.published, true);
  assert.equal(response.json.form.editUrl, `https://docs.google.com/forms/d/${response.json.form.providerFormId}/edit`);
  assert.ok(response.json.form.responderUrl.startsWith('https://docs.google.com/forms/'));
  assert.deepEqual(app.world.fake.lastForm().publishState, { isPublished: true, isAcceptingResponses: true });
  assert.equal(app.formStore.all()[0].specification.title, draft.specification.title);
  assert.deepEqual(app.world.lookups, [['user-a', 'google']]);
  assert.equal(app.world.logs.some(entry => entry.event === 'form.interpret.started'), true);
  assert.equal(app.world.logs.some(entry => entry.event === 'form.interpret.completed'), true);
  assert.equal(app.world.logs.some(entry => entry.event === 'form.draft.create_completed'), true);
  noSecrets(app, draft, response.json);
}));

test('clarification and unsupported requests do not create drafts or contact Google', () => withApi({ interpret: (_, number) => number === 1 ? clarify('Which options should department have?') : unsupported('File uploads are not supported.') }, async app => {
  const question = await app.interpret();
  assert.equal(question.status, 200);
  assert.equal(question.json.status, 'needs_clarification');
  assert.match(question.json.question, /Which options/);
  const notAvailable = await app.interpret({ provider: 'google', request: 'Upload files', clarification: 'I need files.' });
  assert.equal(notAvailable.json.status, 'unsupported');
  assert.equal(app.store.all().length, 0);
  assert.equal(app.world.fake.calls.length, 0);
  assert.equal(app.world.logs.some(entry => entry.event === 'form.interpret.clarification'), true);
  assert.equal(app.world.logs.some(entry => entry.event === 'form.interpret.unsupported'), true);
}));

test('revision changes the existing owned draft only, supports adding/removing/reordering/options/required status, never creates an external form', () => withApi({ interpret: (input, number) => {
  if (number === 1) return ready();
  assert.equal(input.mode, 'revise');
  const next = structuredClone(input.specification);
  if (number === 2) {
    next.questions[1].required = false;
    next.questions.splice(2, 0, { id: 'department', title: 'Department', type: 'dropdown', required: true, options: ['Computer Science', 'Economics', 'Statistics'] });
  } else {
    next.questions = next.questions.filter(q => q.id !== 'email' && q.id !== 'type');
    next.questions.push(next.questions.splice(next.questions.findIndex(q => q.id === 'department'), 1)[0]);
  }
  return ready(next);
} }, async app => {
  const draft = await makeDraft(app);
  const added = await app.revise({ draftId: draft.id, version: draft.version, request: 'Make email optional and add a department dropdown with Computer Science, Economics and Statistics.' });
  assert.equal(added.status, 200, added.text);
  assert.deepEqual(added.json.draft.specification.questions.map(q => q.id), ['full_name', 'email', 'department', 'needs', 'type']);
  assert.equal(added.json.draft.specification.questions[1].required, false);
  assert.deepEqual(added.json.draft.specification.questions[2].options, ['Computer Science', 'Economics', 'Statistics']);
  assert.equal(added.json.draft.version, 2);
  assert.equal(app.inputs[1].specification.questions.some(q => q.id === 'full_name'), true);
  const changed = await app.revise({ draftId: draft.id, version: 2, request: 'Remove email and the conditional question.' });
  assert.equal(changed.status, 200, changed.text);
  assert.deepEqual(changed.json.draft.specification.questions.map(q => q.id), ['full_name', 'needs', 'department']);
  assert.equal(app.world.fake.calls.length, 0);
  assert.equal(app.formStore.all().length, 0);
  assert.equal((await app.get(draft.id)).json.draft.version, 3);
}));

test('a failed or unclear revision preserves the previous specification and version', () => withApi({ interpret: (input, number) => {
  if (number === 1) return ready();
  if (number === 2) return clarify('Which choices should I use?');
  if (number === 3) return unsupported('Response validation cannot be configured through Intake.');
  const invalid = SPEC(); invalid.questions[2].options = [];
  return ready(invalid);
} }, async app => {
  const draft = await makeDraft(app);
  assert.equal((await app.revise({ draftId: draft.id, version: 1, request: 'Change the options.' })).json.status, 'needs_clarification');
  assert.equal((await app.revise({ draftId: draft.id, version: 1, request: 'Enforce email validation.' })).json.status, 'unsupported');
  const invalid = await app.revise({ draftId: draft.id, version: 1, request: 'Invalid choices' });
  assert.equal(invalid.status, 502);
  assert.equal(invalid.json.code, 'model_invalid_output');
  assert.equal((await app.get(draft.id)).json.draft.version, 1);
  assert.equal(app.world.fake.calls.length, 0);
}));

test('authorization and CSRF checks run before parsing or model work', () => withApi({}, async app => {
  app.people.current = null;
  for (const path of ['/interpret', '/revise', '/confirm']) {
    const response = await app.call('POST', path, '{bad json', { raw: true });
    assert.equal(response.status, 401, response.text);
    assert.equal(response.json.code, 'not_authenticated');
  }
  assert.equal((await app.get('aaaaaaaa-aaaa-4aaa-8aaa-000000000001')).status, 401);
  app.people.current = { id: 'user-a' };
  const csrf = await app.interpret(undefined, { origin: 'https://evil.example' });
  assert.equal(csrf.status, 403, csrf.text);
  const bad = await app.call('POST', '/interpret', '{bad json', { raw: true });
  assert.equal(bad.status, 400);
  assert.equal(app.inputs.length, 0);
  assert.equal(app.world.fake.calls.length, 0);
  app.people.failing = true;
  const unavailable = await app.interpret();
  assert.equal(unavailable.status, 503);
  assert.equal(unavailable.text.includes('hunter2'), false);
}));

test('ownership is checked for every read and mutation; another user cannot get or create the draft', () => withApi({}, async app => {
  await app.world.connect('user-a');
  const draft = await makeDraft(app);
  app.people.current = { id: 'user-b' };
  for (const response of [await app.get(draft.id), await app.revise({ draftId: draft.id, version: 1, request: 'Remove name' }), await app.confirm(confirm(draft)), await app.discard(draft.id)]) {
    assert.equal(response.status, 404, response.text);
    assert.equal(response.json.code, 'draft_not_found');
    assert.equal(response.text.includes('Project registration'), false);
  }
  assert.equal(app.world.fake.calls.length, 0);
  noSecrets(app);
}));

test('a connected Google account belongs to the session user, not to model output or a browser connection id', () => withApi({}, async app => {
  await app.world.connect('user-b');
  const draft = await makeDraft(app);
  const injection = await app.confirm({ ...confirm(draft), userId: 'user-b', connectionId: 'connection-user-b', accessToken: 'SHOULD_NOT_LOG' });
  assert.equal(injection.status, 400);
  assert.equal(app.world.lookups.length, 0);
  const refused = await app.confirm(confirm(draft));
  assert.equal(refused.status, 409, refused.text);
  assert.equal(refused.json.code, 'provider_not_connected');
  assert.equal(refused.json.outcome, 'not_created');
  assert.equal(refused.json.draft.status, 'ready');
  assert.deepEqual(app.world.lookups, [['user-a', 'google']]);
  assert.equal(app.world.fake.calls.length, 0);
  assert.equal(JSON.stringify(app.world.logs).includes('SHOULD_NOT_LOG'), false);
}));

test('confirmation requires exact version and explicit true, then duplicate submissions replay the stored result', () => withApi({}, async app => {
  await app.world.connect('user-a');
  const draft = await makeDraft(app);
  for (const body of [{ draftId: draft.id, version: 1 }, { draftId: draft.id, version: 1, confirm: false }, { draftId: draft.id, version: 1, confirm: 'true' }]) {
    const denied = await app.confirm(body);
    assert.equal(denied.status, 400);
  }
  assert.equal((await app.confirm({ draftId: draft.id, version: 2, confirm: true })).json.code, 'draft_conflict');
  assert.equal(app.world.fake.calls.length, 0);
  const results = await Promise.all([app.confirm(confirm(draft)), app.confirm(confirm(draft))]);
  assert.ok(results.some(response => response.status === 201));
  assert.equal(app.world.fake.callsTo('forms.create').length, 1);
  const replay = await app.confirm(confirm(draft));
  assert.equal(replay.status, 200);
  assert.equal(replay.json.form.providerFormId, results.find(response => response.status === 201).json.form.providerFormId);
  assert.equal(app.world.fake.callsTo('forms.create').length, 1);
  assert.equal(app.formStore.all().length, 1);
}));

test('provider failure before creation can be retried after connecting, without losing the draft', () => withApi({}, async app => {
  const draft = await makeDraft(app);
  const denied = await app.confirm(confirm(draft));
  assert.equal(denied.json.code, 'provider_not_connected');
  assert.equal((await app.get(draft.id)).json.draft.status, 'ready');
  await app.world.connect('user-a');
  const made = await app.confirm(confirm(draft));
  assert.equal(made.status, 201, made.text);
  assert.equal(app.world.fake.callsTo('forms.create').length, 1);
}));

test('partial provider failure is recorded and the same draft is permanently blocked from another create', () => withApi({}, async app => {
  await app.world.connect('user-a');
  const draft = await makeDraft(app);
  app.world.fake.failOn('forms.batchUpdate', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'Invalid layout' });
  const failed = await app.confirm(confirm(draft));
  assert.equal(failed.status, 502, failed.text);
  assert.equal(failed.json.outcome, 'partial');
  assert.equal(failed.json.draft.status, 'blocked');
  assert.ok(failed.json.partialForm.editUrl.startsWith('https://docs.google.com/forms/'));
  assert.equal((await app.get(draft.id)).json.draft.result.failure.outcome, 'partial');
  const replay = await app.confirm(confirm(draft));
  assert.equal(replay.json.partialForm.providerFormId, failed.json.partialForm.providerFormId);
  assert.equal(app.world.fake.callsTo('forms.create').length, 1);
  assert.equal(app.formStore.all()[0].status, 'incomplete');
  noSecrets(app, failed.json, replay.json);
}));

test('an ambiguous Google create timeout locks the draft and is never retried, even if the browser asks again', () => withApi({}, async app => {
  await app.world.connect('user-a');
  const draft = await makeDraft(app);
  app.world.fake.failOn('forms.create', { timeout: true });
  const failed = await app.confirm(confirm(draft));
  assert.equal(failed.json.outcome, 'unknown');
  assert.equal(failed.json.draft.status, 'blocked');
  const replay = await app.confirm(confirm(draft));
  assert.equal(replay.json.outcome, 'unknown');
  assert.equal(app.world.fake.callsTo('forms.create').length, 1);
}));

test('a crashed/unfinished claim cannot reach the provider again; the user can inspect its state', () => withApi({}, async app => {
  const draft = await makeDraft(app);
  await app.store.claim('user-a', draft.id, 1, app.world.now());
  const denied = await app.confirm(confirm(draft));
  assert.equal(denied.status, 409);
  assert.equal(denied.json.code, 'creation_in_progress');
  assert.equal(denied.json.outcome, 'unknown');
  assert.equal((await app.get(draft.id)).json.draft.status, 'creating');
  assert.equal(app.world.fake.callsTo('forms.create').length, 0);
}));

test('input sizes, unwanted fields, invalid model output and rate limits fail before storage or provider calls', () => withApi({ limiter: createInterpretationLimiter({ limit: 1 }) }, async app => {
  for (const data of [
    { provider: 'google', request: '' }, { provider: 'google', request: 'x'.repeat(3001) },
    { provider: 'google', request: 'Hello', userId: 'user-b' }, { provider: 'microsoft', request: 'Hello' },
  ]) {
    const rejected = await app.interpret(data);
    assert.ok(rejected.status === 400 || rejected.status === 501);
  }
  const large = await app.interpret({ provider: 'google', request: 'x'.repeat(70_000) });
  assert.equal(large.status, 413);
  await makeDraft(app);
  assert.equal((await app.interpret()).status, 429);
  assert.equal(app.inputs.length, 1);
  assert.equal(app.world.fake.calls.length, 0);
}));

test('distributed interpretation limits fail before model work and include a retry hint', () => withApi({
  abuseLimiter: {
    async consume(scope) {
      return scope.endsWith('.user')
        ? { allowed: false, retryAfterSeconds: 23, limit: 1, remaining: 0 }
        : { allowed: true, retryAfterSeconds: 23, limit: 100, remaining: 99 };
    },
  },
}, async app => {
  const response = await app.interpret();
  assert.equal(response.status, 429, response.text);
  assert.equal(response.json.code, 'rate_limited');
  assert.equal(response.headers.get('retry-after'), '23');
  assert.equal(app.inputs.length, 0);
  assert.equal(app.store.all().length, 0);
}));

test('a distributed limiter outage fails closed before expensive work', () => withApi({
  abuseLimiter: { async consume() { throw new Error('rate database unavailable'); } },
}, async app => {
  const response = await app.interpret();
  assert.equal(response.status, 503, response.text);
  assert.equal(response.json.code, 'storage_unavailable');
  assert.equal(app.inputs.length, 0);
}));

test('cancel discards only a ready draft and never deletes a provider form', () => withApi({}, async app => {
  const draft = await makeDraft(app);
  const response = await app.discard(draft.id);
  assert.equal(response.status, 204);
  assert.equal(await app.store.get('user-a', draft.id), null);
  assert.equal(app.world.fake.calls.length, 0);
}));

test('a missing live model key returns an explicit configuration error without inventing an inference result', () => {
  let calls = 0;
  const interpreter = createFormInterpreter({ provider: createUnconfiguredProvider('GROQ_API_KEY is not configured.') });
  return withApi({ interpreter }, async app => {
    const response = await app.interpret();
    assert.equal(response.status, 503);
    assert.equal(response.json.code, 'model_not_configured');
    assert.match(response.json.error, /GROQ_API_KEY/, 'the message names the credential an operator must set');
    assert.equal(calls, 0);
    assert.equal(app.store.all().length, 0);
    assert.equal(app.world.fake.calls.length, 0);
    noSecrets(app, response.json);
  });
});

test('invalid initial specifications and model-supplied connection fields are rejected before any draft or Google operation', () => withApi({ interpret: (_, number) => {
  if (number === 1) {
    const bad = SPEC(); bad.questions[2].options = [];
    return ready(bad);
  }
  const bad = SPEC(); bad.questions[0].connectionId = 'connection-user-b';
  return ready(bad);
} }, async app => {
  for (let i = 0; i < 2; i++) {
    const response = await app.interpret();
    assert.equal(response.status, 502, response.text);
    assert.equal(response.json.code, 'model_invalid_output');
    assert.equal(app.store.all().length, 0);
  }
  assert.equal(app.world.fake.calls.length, 0);
}));

test('a failure to save a completed provider outcome leaves the claimed draft locked, never causing a second Google form', () => {
  const store = createMemoryDraftStore();
  store.finish = async () => { throw new Error('database write failed password=secret'); };
  return withApi({ store }, async app => {
    await app.world.connect('user-a');
    const draft = await makeDraft(app);
    const response = await app.confirm(confirm(draft));
    assert.equal(response.status, 503, response.text);
    assert.equal(response.json.code, 'storage_unavailable');
    assert.equal(response.json.outcome, 'unknown');
    assert.equal(response.text.includes('password=secret'), false);
    assert.equal((await app.get(draft.id)).json.draft.status, 'creating');
    assert.equal(app.formStore.all().length, 1, 'the engine may have completed before the draft write failed');
    assert.equal((await app.confirm(confirm(draft))).json.code, 'creation_in_progress');
    assert.equal(app.world.fake.callsTo('forms.create').length, 1);
  });
});

test('only one interpretation at a time per user and a bounded number per window reach the model', () => {
  let finish;
  const waiting = new Promise(resolve => { finish = resolve; });
  let markStarted;
  const started = new Promise(resolve => { markStarted = resolve; });
  return withApi({ interpret: (_input, number) => { if (number === 1) { markStarted(); return waiting; } return ready(); } }, async app => {
    const first = app.interpret();
    await started;
    const refused = await app.interpret();
    assert.equal(refused.status, 429);
    assert.equal(refused.json.code, 'rate_limited');
    assert.equal(app.inputs.length, 1);
    finish(ready());
    assert.equal((await first).status, 201);
    assert.equal((await app.interpret()).status, 201, 'a completed call releases the in-flight slot');
    assert.equal(app.world.fake.calls.length, 0);
  });
});

test('interpretation logs never contain user prose, question text, options, passwords or tokens', () => withApi({ interpret: () => {
  const value = SPEC(); value.questions[0].title = 'Private student email one@example.test';
  value.questions[2].options = ['SensitiveOption_A', 'SensitiveOption_B'];
  value.questions[3].visibility.when.equals = 'SensitiveOption_A';
  return ready(value);
} }, async app => {
  const response = await app.interpret({ provider: 'google', request: 'Collect private details password=hunter2' });
  assert.equal(response.status, 201);
  const logs = JSON.stringify(app.world.logs);
  for (const privateValue of ['private details', 'one@example.test', 'hunter2', 'Full name', 'SensitiveOption_A', 'SensitiveOption_B']) assert.equal(logs.includes(privateValue), false, `logged ${privateValue}`);
  assert.equal(logs.includes('Private student email'), false);
  noSecrets(app, logs);
}));
