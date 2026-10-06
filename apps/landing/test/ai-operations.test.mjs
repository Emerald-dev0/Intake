import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createAiOperationRunner } from '../server/ai/operations.ts';
import { createMemoryCreditStore } from '../server/credits/ledger.ts';
import { createCreditService } from '../server/credits/service.ts';
import { runWithModelCallCollector, newModelCallCollector } from '../server/ai/usage-scope.ts';
import { createFormInterpreter } from '../server/forms/interpretation/provider-interpreter.ts';
import { createGroqProvider } from '../server/ai/groq.ts';
import { assessInterpretation } from '../server/forms/interpretation/interpreter.ts';
import { costForFormCreation, creationComplexity } from '../server/credits/pricing.ts';

const NOW = new Date('2026-10-03T09:00:00Z');
const question = (id, type = 'short_text') => ({ id, title: id, description: null, type, required: true, options: [], visibility: null });
const spec = count => ({ title: 'Registration', description: null, questions: Array.from({ length: count }, (_, index) => question(`q${index}`)) });
const ready = count => ({ status: 'ready', specification: spec(count), assumptions: [], question: null, explanation: null });
const clarify = question => ({ status: 'needs_clarification', specification: null, assumptions: [], question, explanation: null });

function boot(options = {}) {
  const store = createMemoryCreditStore();
  const credits = createCreditService({ store, now: () => NOW, newId: () => `usage-${Math.random().toString(16).slice(2, 10)}` });
  const logs = [];
  let sequence = 0;
  const operations = createAiOperationRunner({
    credits, now: () => NOW, newId: () => `op-${String(++sequence).padStart(8, '0')}`, log: (event, fields) => logs.push({ event, ...fields }),
  });
  return { store, credits, operations, logs, ...(options.extra ?? {}) };
}

/** A metered creation operation, exactly as the drafts route builds it. */
function creationRun(operations, overrides = {}) {
  return {
    userId: 'user-a',
    operationType: 'form_create',
    operationKey: overrides.key ?? 'operation-key-0001',
    execute: async () => {
      const result = assessInterpretation(overrides.raw ?? ready(6));
      return result.status === 'ready'
        ? { kind: 'usable', value: result, cost: costForFormCreation(creationComplexity(result.specification)) }
        : { kind: 'no_result', value: result };
    },
  };
}

test('a usable result is charged exactly once, even when the operation makes several model calls', async () => {
  const { operations, credits, store } = boot();
  const provider = createGroqProvider({
    env: { GROQ_API_KEY: 'k' },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(ready(6)) } }],
      usage: { prompt_tokens: 100, completion_tokens: 200, total_tokens: 300 },
    }), { status: 200 }),
  });
  const interpreter = createFormInterpreter({ provider });
  const outcome = await operations.run({
    userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-0002',
    execute: async () => {
      // Two internal model calls, one logical operation.
      await interpreter.interpret({ mode: 'new', provider: 'google', request: 'first attempt' });
      const result = assessInterpretation(await interpreter.interpret({ mode: 'new', provider: 'google', request: 'retry of the same operation' }));
      return { kind: 'usable', value: result, cost: costForFormCreation(creationComplexity(result.specification)) };
    },
  });
  assert.equal(outcome.ok, true);
  assert.equal(outcome.charge.cost, 2);
  assert.equal(outcome.charge.status, 'charged');
  assert.equal((await credits.balance('user-a')).dailyRemaining, 8, 'two model calls, one charge');
  const usage = await store.ledger('user-a');
  assert.equal(usage.filter(entry => entry.entryType === 'ai_consumption').length, 1);
});

test('a replayed operation key is never charged twice and reports the original price', async () => {
  const { operations, credits } = boot();
  const first = await operations.run(creationRun(operations));
  const second = await operations.run(creationRun(operations));
  assert.equal(first.charge.status, 'charged');
  assert.equal(second.charge.status, 'already_charged');
  assert.equal(second.charge.cost, 2);
  assert.equal((await credits.balance('user-a')).dailyRemaining, 8);
});

test('provider failures, invalid output and no-result outcomes cost nothing', async () => {
  const { operations, credits, store } = boot();
  const failing = await operations.run({
    ...creationRun(operations, { key: 'operation-key-fail' }),
    execute: async () => { throw Object.assign(new Error('groq is down'), { code: 'model_unavailable' }); },
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.error.code, 'model_unavailable');
  assert.equal((await credits.balance('user-a')).dailyRemaining, 10, 'a failed operation is never charged');

  const clarification = await operations.run({
    userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-clarify',
    execute: async () => ({ kind: 'no_result', value: assessInterpretation(clarify('Which options?')) }),
  });
  assert.equal(clarification.ok, true);
  assert.equal(clarification.charge.status, 'not_charged');
  assert.equal((await credits.balance('user-a')).dailyRemaining, 10, 'a clarification is not a chargeable result');

  // Both attempts are recorded, with the failure category preserved for operators.
  const usage = await store.ledger('user-a');
  assert.equal(usage.filter(entry => entry.entryType === 'ai_consumption').length, 0);
  const rows = await store.usage('user-a');
  assert.deepEqual(rows.map(row => [row.operationKey, row.outcome, row.errorCategory, row.creditCost]).sort(),
    [['operation-key-clarify', 'no_result', null, 0], ['operation-key-fail', 'failed', 'model_unavailable', 0]]);
});

test('a user who cannot afford the cheapest operation is told before any model call is made', async () => {
  const { operations, credits } = boot();
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-drain', cost: 10 });
  let calls = 0;
  const outcome = await operations.run({
    userId: 'user-a', operationType: 'form_edit', operationKey: 'operation-key-broke',
    execute: async () => { calls += 1; return { kind: 'usable', value: {}, cost: 1 }; },
  });
  assert.equal(calls, 0, 'the model is not called for an operation the user cannot afford');
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'insufficient_credits');
});

test('a charge that cannot be applied withholds the result instead of giving it away', async () => {
  // Simulates the rare race in which another request spent the balance after this one started.
  const store = createMemoryCreditStore();
  const credits = createCreditService({ store, now: () => NOW });
  const operations = createAiOperationRunner({ credits, now: () => NOW });
  let calls = 0;
  const outcome = await operations.run({
    userId: 'user-race', operationType: 'form_create', operationKey: 'operation-key-race',
    execute: async () => {
      calls += 1;
      // Drain the bucket behind the runner's back, then report a usable result.
      await credits.charge({ userId: 'user-race', operationType: 'form_create', operationKey: 'operation-key-other', cost: 10 });
      return { kind: 'usable', value: { spec: true }, cost: 2 };
    },
  });
  assert.equal(calls, 1);
  assert.equal(outcome.ok, false);
  assert.equal(outcome.error.code, 'insufficient_credits');
  assert.equal((await credits.balance('user-race')).dailyRemaining, 0);
});

test('usage rows carry tokens and latency internally while the public balance exposes neither', async () => {
  const { operations, credits, store } = boot();
  const provider = createGroqProvider({
    env: { GROQ_API_KEY: 'k' },
    fetchImpl: async () => new Response(JSON.stringify({
      choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(ready(6)) } }],
      usage: { prompt_tokens: 40, completion_tokens: 60, total_tokens: 100 },
    }), { status: 200 }),
  });
  const interpreter = createFormInterpreter({ provider });
  await operations.run({
    userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-usage',
    execute: async () => {
      const result = assessInterpretation(await interpreter.interpret({ mode: 'new', provider: 'google', request: 'x' }));
      return { kind: 'usable', value: result, cost: 2 };
    },
  });
  const balance = await credits.balance('user-a');
  assert.equal(JSON.stringify(balance).includes('token'), false);
  assert.equal(JSON.stringify(balance).includes('100'), false);
  assert.deepEqual(Object.keys(balance).sort(), ['availableCredits', 'dailyLimit', 'dailyRemaining', 'monthlyLimit', 'monthlyRemaining', 'nextDailyReset', 'nextMonthlyReset', 'plan', 'subscriptionStatus']);
  const rows = await store.usage('user-a');
  assert.equal(rows.length, 1);
  assert.equal(rows[0].operationType, 'form_create');
  assert.equal(rows[0].creditCost, 2);
  assert.ok(rows[0].latencyMs >= 0);
});

test('each logical operation has its own model-call scope, and scopes do not leak', async () => {
  const { operations, store } = boot();
  const provider = createGroqProvider({
    env: { GROQ_API_KEY: 'k' },
    fetchImpl: async () => new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(ready(3)) } }], usage: { prompt_tokens: 5, completion_tokens: 5, total_tokens: 10 } }), { status: 200 }),
  });
  const interpreter = createFormInterpreter({ provider });
  const outer = newModelCallCollector();
  await runWithModelCallCollector(outer, async () => {
    await interpreter.interpret({ mode: 'new', provider: 'google', request: 'outside before' });
    await operations.run({
      userId: 'user-a', operationType: 'form_create', operationKey: 'operation-key-scope',
      execute: async () => {
        const result = assessInterpretation(await interpreter.interpret({ mode: 'new', provider: 'google', request: 'inside the operation' }));
        return { kind: 'usable', value: result, cost: 2 };
      },
    });
    // The operation's own scope must not swallow or duplicate later calls in the surrounding scope.
    await interpreter.interpret({ mode: 'new', provider: 'google', request: 'outside after' });
  });
  assert.equal(outer.calls.length, 2, 'the surrounding scope sees exactly its own two calls');
  const usage = await store.usage('user-a');
  assert.deepEqual(usage.map(row => [row.operationType, row.totalTokens, row.creditCost]), [['form_create', 10, 2]], 'the operation records only its own call');
});

