import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createMemoryDraftStore } from '../server/forms/draft-memory-store.ts';
import { createFormDraftRouter, createInterpretationLimiter } from '../server/forms/interpretation/routes.ts';
import { createAiOperationRunner } from '../server/ai/operations.ts';
import { createCreditRouter } from '../server/credits/routes.ts';
import { createMemoryCreditStore } from '../server/credits/ledger.ts';
import { createMemoryFormEditDraftStore } from '../server/forms/edit-memory-store.ts';
import { createFormEditRouter } from '../server/forms/edit-routes.ts';
import { createGoogleForm } from './helpers/forms-harness.mjs';
import { parseFormSpecification } from '../server/forms/validation.ts';
import { createCreditService } from '../server/credits/service.ts';
import { createWorld, ORIGIN } from './helpers/forms-harness.mjs';

const NOW = new Date('2026-10-03T09:00:00Z');
const question = (id, extra = {}) => ({ id, title: id, description: null, type: 'short_text', required: true, options: [], visibility: null, ...extra });
const spec = count => ({ title: 'Registration', description: 'Register.', questions: Array.from({ length: count }, (_, index) => question(`q${index}`)) });
const ready = value => ({ status: 'ready', specification: value, assumptions: [], question: null, explanation: null });
const secrets = ['ACCESS_TOKEN_OF_USER-A', 'REFRESH_TOKEN_OF_USER-A', 'Bearer ', 'test-google-client-secret'];

async function boot(options = {}) {
  const world = createWorld();
  const { engine } = world.engine();
  const store = options.store ?? createMemoryDraftStore();
  const creditStore = createMemoryCreditStore();
  const credits = createCreditService({ store: creditStore, now: () => NOW, newId: () => `usage-${Math.random().toString(16).slice(2, 10)}` });
  const operations = createAiOperationRunner({ credits, now: () => NOW, newId: () => `operation-key-${Math.random().toString(16).slice(2, 10)}` });
  const seen = { calls: 0 };
  const interpreter = {
    async interpret(input) {
      seen.calls += 1;
      if (options.interpret) return options.interpret(input, seen.calls);
      return ready(options.specification ?? spec(options.questions ?? 6));
    },
  };
  const people = { current: { id: 'user-a', email: 'ada@example.test', name: 'Ada' } };
  const app = express();
  app.use('/api/forms', createFormDraftRouter({
    store, engine, interpreter, env: world.env, log: world.log, now: () => NOW,
    newId: () => `aaaaaaaa-aaaa-4aaa-8aaa-${String(store.all().length + 1).padStart(12, '0')}`,
    limiter: options.limiter ?? createInterpretationLimiter(),
    getSession: async () => people.current,
    operations: options.unmetered ? undefined : operations,
  }));
  app.use('/api/credits', createCreditRouter({ credits, getSession: async () => people.current }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  async function call(method, path, data, { origin = ORIGIN } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: { ...(method !== 'GET' ? { origin, 'content-type': 'application/json' } : {}) },
      ...(data === undefined ? {} : { body: JSON.stringify(data) }),
    });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* 204 */ }
    return { status: response.status, json, text, headers: response.headers };
  }
  return {
    world, store, creditStore, credits, operations, seen, people, call,
    interpret: (data = { provider: 'google', request: 'Register people' }) => call('POST', '/api/forms/interpret', data),
    revise: data => call('POST', '/api/forms/revise', data),
    balance: () => call('GET', '/api/credits'),
    async close() { await new Promise(resolve => server.close(resolve)); },
  };
}
const withApi = async (options, run) => { const api = await boot(options); try { return await run(api); } finally { await api.close(); } };
const noSecrets = (api, ...bodies) => {
  const data = JSON.stringify([api.world.logs, ...bodies]);
  for (const secret of secrets) assert.equal(data.includes(secret), false, `secret leaked: ${secret}`);
};

test('the balance endpoint reports plan, remaining credits and reset instants, and requires a session', () => withApi({}, async app => {
  const anonymous = await app.balance();
  assert.equal(anonymous.status, 200);
  const balance = anonymous.json.credits;
  assert.deepEqual(Object.keys(balance).sort(), ['availableCredits', 'dailyLimit', 'dailyRemaining', 'monthlyLimit', 'monthlyRemaining', 'nextDailyReset', 'nextMonthlyReset', 'plan', 'subscriptionStatus']);
  assert.deepEqual({ plan: balance.plan, daily: balance.dailyRemaining, dailyLimit: balance.dailyLimit, monthly: balance.monthlyRemaining, monthlyLimit: balance.monthlyLimit, available: balance.availableCredits }, { plan: 'free', daily: 10, dailyLimit: 10, monthly: 0, monthlyLimit: 0, available: 10 });
  assert.equal(balance.subscriptionStatus, 'none');
  assert.deepEqual(anonymous.json.costGuide, {
    formCreate: { min: 2, max: 5, standard: 2, complexMin: 3 },
    formEdit: { min: 1, max: 5, singleChange: 1, majorMin: 3 },
  });
  assert.equal(balance.nextDailyReset, '2026-10-04T00:00:00.000Z');
  assert.equal(anonymous.headers.get('cache-control'), 'no-store');
  assert.equal(/token|cost|model|provider/i.test(JSON.stringify(balance)), false);
  noSecrets(app, anonymous.json);

  app.people.current = null;
  const signedOut = await app.balance();
  assert.equal(signedOut.status, 401);
  assert.equal(signedOut.json.code, 'not_authenticated');
}));

test('a normal form creation costs 2 credits once, and the response carries the new balance', () => withApi({}, async app => {
  const first = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-aaaa1111' });
  assert.equal(first.status, 201, first.text);
  assert.equal(first.json.credits.dailyRemaining, 18);
  assert.equal(first.json.credits.plan, 'free');
  assert.deepEqual(first.json.operationCost, { credits: 2, status: 'charged' });
  assert.equal(app.store.all().length, 1);

  const usage = await app.creditStore.usage('user-a');
  assert.equal(usage.length, 1);
  assert.deepEqual({ type: usage[0].operationType, cost: usage[0].creditCost, outcome: usage[0].outcome }, { type: 'form_create', cost: 2, outcome: 'succeeded' });

  // The same operation key cannot be charged twice, even though the model runs again.
  const replay = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-aaaa1111' });
  assert.equal(replay.status, 201, replay.text);
  assert.equal(replay.json.credits.dailyRemaining, 18, 'a replayed operation is not charged again');
  assert.deepEqual(replay.json.operationCost, { credits: 2, status: 'already_charged' });
  assert.equal(app.seen.calls, 2, 'the model did run; only the billing is deduplicated');
  const consumption = (await app.creditStore.ledger('user-a')).filter(entry => entry.entryType === 'ai_consumption');
  assert.equal(consumption.length, 1);
  noSecrets(app, first.json, replay.json);
}));

test('a complex creation costs more, and the price is decided by the server', () => withApi({ questions: 26 }, async app => {
  const response = await app.interpret({ provider: 'google', request: 'A long registration form', operationId: 'operation-key-bbbb2222' });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.credits.dailyRemaining, 15, '26 questions cost 5 credits');
  assert.deepEqual(response.json.operationCost, { credits: 5, status: 'charged' });
  const usage = await app.creditStore.usage('user-a');
  assert.equal(usage[0].creditCost, 5);
  // A client-supplied price is not part of the accepted body at all.
  const withPrice = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-cccc3333', creditCost: 0, plan: 'pro', userId: 'someone-else' });
  assert.equal(withPrice.status, 400);
  assert.equal(withPrice.json.code, 'invalid_request');
  assert.equal(app.seen.calls, 1, 'a rejected body never reaches the model');
}));

test('a failed or non-result AI operation never charges', () => withApi({ interpret: () => { throw Object.assign(new Error('provider down'), { code: 'model_unavailable', name: 'InterpretationError' }); } }, async app => {
  const failed = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-dddd4444' });
  assert.equal(failed.status, 503);
  assert.equal(failed.json.code, 'model_unavailable');
  const balance = (await app.balance()).json.credits;
  assert.equal(balance.dailyRemaining, 10, 'a provider failure is never charged');
  const usage = await app.creditStore.usage('user-a');
  assert.deepEqual(usage.map(row => [row.outcome, row.errorCategory, row.creditCost]), [['failed', 'model_unavailable', 0]]);
  assert.equal(app.store.all().length, 0);
  noSecrets(app, failed.json);
}));

test('clarification and unsupported results are recorded but not charged', () => withApi({
  interpret: input => input.clarification
    ? { status: 'unsupported', specification: null, assumptions: [], question: null, explanation: 'File uploads are not supported.' }
    : { status: 'needs_clarification', specification: null, assumptions: [], question: 'Which options?', explanation: null },
}, async app => {
  const clarification = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-eeee5555' });
  assert.equal(clarification.status, 200, clarification.text);
  assert.equal(clarification.json.status, 'needs_clarification');
  assert.equal(clarification.json.credits, undefined, 'no balance change is reported when nothing was charged');
  assert.deepEqual(clarification.json.operationCost, { credits: 0, status: 'not_charged' });
  const unsupported = await app.interpret({ provider: 'google', request: 'Register people', clarification: 'Please add file upload', operationId: 'operation-key-ffff6666' });
  assert.equal(unsupported.status, 200);
  assert.equal(unsupported.json.status, 'unsupported');
  assert.deepEqual(unsupported.json.operationCost, { credits: 0, status: 'not_charged' });
  assert.equal((await app.balance()).json.credits.dailyRemaining, 20);
  const usage = await app.creditStore.usage('user-a');
  assert.deepEqual(usage.map(row => [row.outcome, row.creditCost]), [['no_result', 0], ['no_result', 0]]);
}));

test('an unaffordable operation is refused before the model is called, and creates nothing', () => withApi({}, async app => {
  await app.credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-drain-1', cost: 10, now: NOW });
  assert.equal((await app.balance()).json.credits.dailyRemaining, 0);
  const refused = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-gggg7777' });
  assert.equal(refused.status, 402);
  assert.equal(refused.json.code, 'insufficient_credits');
  assert.match(refused.json.error, /not have enough credits/i);
  assert.equal(app.seen.calls, 0, 'no model call is paid for when the user cannot afford the cheapest operation');
  assert.equal(app.store.all().length, 0);
  assert.equal((await app.creditStore.usage('user-a')).length, 0);
  noSecrets(app, refused.json);
}));

test('revising a draft is a separate logical operation with its own charge', () => withApi({}, async app => {
  const created = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-hhhh8888' });
  const draft = created.json.draft;
  assert.equal(created.json.credits.dailyRemaining, 18);
  assert.deepEqual(created.json.operationCost, { credits: 2, status: 'charged' });
  const revised = await app.revise({ draftId: draft.id, version: draft.version, request: 'Make email optional', operationId: 'operation-key-iiii9999' });
  assert.equal(revised.status, 200, revised.text);
  assert.equal(revised.json.credits.dailyRemaining, 16);
  assert.deepEqual(revised.json.operationCost, { credits: 2, status: 'charged' });
  const usage = await app.creditStore.usage('user-a');
  assert.deepEqual(usage.map(row => [row.operationType, row.creditCost]), [['form_create', 2], ['form_revise', 2]]);

  // Retrying a revision with the version the first attempt already advanced is a conflict, not a
  // second charge: the client re-reads the draft and retries as a new operation.
  const replay = await app.revise({ draftId: draft.id, version: draft.version, request: 'Make email optional', operationId: 'operation-key-iiii9999' });
  assert.equal(replay.status, 409, replay.text);
  assert.equal(replay.json.code, 'draft_conflict');
  assert.equal((await app.balance()).json.credits.dailyRemaining, 16, 'a conflicting revise never charges');
  assert.equal((await app.creditStore.ledger('user-a')).filter(entry => entry.entryType === 'ai_consumption').length, 2);
}));

test('a pro plan spends daily credits first, then the monthly reserve, and the browser only sees the totals', () => withApi({}, async app => {
  await app.credits.setPlan('user-a', { plan: 'pro', subscriptionStatus: 'active' });
  const start = (await app.balance()).json.credits;
  assert.deepEqual({ plan: start.plan, daily: start.dailyRemaining, monthly: start.monthlyRemaining }, { plan: 'pro', daily: 10, monthly: 1000 });
  // Drain the daily allowance with a single complex creation, then spend from the reserve.
  await app.credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-drain-2', cost: 10, now: NOW });
  const created = await app.interpret({ provider: 'google', request: 'Register people', operationId: 'operation-key-jjjj1010' });
  assert.equal(created.status, 201, created.text);
  assert.deepEqual({ daily: created.json.credits.dailyRemaining, monthly: created.json.credits.monthlyRemaining }, { daily: 0, monthly: 498 });
}));

test('metering can be absent without breaking interpretation (isolated or database-less deployments)', () => withApi({ unmetered: true }, async app => {
  const response = await app.interpret({ provider: 'google', request: 'Register people' });
  assert.equal(response.status, 201, response.text);
  assert.equal(app.store.all().length, 1);
  assert.equal((await app.balance()).json.credits.dailyRemaining, 20);
}));

test('an edit interpretation is a metered logical operation, and applying the plan is not', async () => {
  const world = createWorld();
  await world.connect('user-a');
  const { formStore } = world.engine();
  const parsed = parseFormSpecification({ title: 'Project registration', questions: [
    { id: 'name', title: 'Full name', type: 'short_text', required: true },
    { id: 'role', title: 'Role', type: 'multiple_choice', required: true, options: ['Student', 'Staff'] },
  ] });
  assert.equal(parsed.ok, true);
  const source = await createGoogleForm(world, parsed.specification, 'user-a');
  await formStore.save({ id: 'existing-form-01', userId: 'user-a', provider: 'google', externalAccountId: source.externalAccountId,
    providerFormId: source.providerFormId, title: source.title, status: 'created', editUrl: source.editUrl ?? null,
    responderUrl: source.responderUrl ?? null, failureStage: null, requestId: 'req_form_create',
    specification: parsed.specification, specificationVersion: 1 }, world.now());

  const creditStore = createMemoryCreditStore();
  const credits = createCreditService({ store: creditStore, now: () => NOW });
  const operations = createAiOperationRunner({ credits, now: () => NOW });
  const drafts = createMemoryFormEditDraftStore();
  let interpretations = 0;
  const interpreter = { async interpret() {
    interpretations += 1;
    return { status: 'ready', summary: 'Rename the form', operations: [{ type: 'update_title', title: 'Project registration 2027' }], question: null, explanation: null };
  } };
  const app = express();
  app.use('/api/forms', createFormEditRouter({
    providers: world.providers(), forms: formStore, drafts, interpreter, env: world.env, log: world.log, now: world.now,
    newId: () => `00000000-0000-4000-8000-${String(drafts.all?.().length ?? 0 + 1).padStart(12, '0')}`,
    operations, credits, getSession: async () => ({ id: 'user-a', email: 'ada@example.test', name: 'Ada' }),
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;
  const post = async (path, data) => {
    const response = await fetch(base + path, { method: 'POST', headers: { origin: ORIGIN, 'content-type': 'application/json' }, body: JSON.stringify(data) });
    const text = await response.text();
    return { status: response.status, json: (() => { try { return JSON.parse(text); } catch { return null; } })(), text };
  };
  try {
    const first = await post('/edit/interpret', { target: { kind: 'record', formRecordId: 'existing-form-01' }, request: 'Rename the form.', operationId: 'operation-key-edit1' });
    assert.equal(first.status, 201, first.text);
    assert.equal(first.json.credits.dailyRemaining, 19, 'a single-change edit costs 1 credit');
    assert.deepEqual(first.json.operationCost, { credits: 1, status: 'charged' });
    const draft = first.json.draft;

    // Replaying the identical interpretation is not charged again, even though the model runs.
    const replay = await post('/edit/interpret', { target: { kind: 'record', formRecordId: 'existing-form-01' }, request: 'Rename the form.', operationId: 'operation-key-edit1' });
    assert.equal(replay.status, 201, replay.text);
    assert.equal(replay.json.credits.dailyRemaining, 19);
    assert.deepEqual(replay.json.operationCost, { credits: 1, status: 'already_charged' });
    assert.equal(interpretations, 2);

    // Applying the reviewed plan is a provider write, not an AI operation: no extra credits.
    const applied = await post('/edit/confirm', { draftId: draft.id, version: draft.version, confirm: true });
    assert.equal(applied.status, 200, applied.text);
    assert.equal(applied.json.credits, undefined, 'a provider write never reports a credit change');
    assert.equal((await credits.balance('user-a')).dailyRemaining, 19);

    const usage = await creditStore.usage('user-a');
    assert.deepEqual(usage.map(row => [row.operationType, row.creditCost]), [['form_edit', 1]]);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
