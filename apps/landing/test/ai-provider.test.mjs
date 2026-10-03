import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroqProvider, DEFAULT_GROQ_MODEL, GROQ_ENDPOINT, readGroqModel } from '../server/ai/groq.ts';
import { createOpenAiProvider, OPENAI_ENDPOINT } from '../server/ai/openai.ts';
import { aiProviderLabel, readMaxCompletionTokens, resolveAiProvider } from '../server/ai/registry.ts';
import { newModelCallCollector, runWithModelCallCollector, summarizeModelCalls } from '../server/ai/usage-scope.ts';
import { createFormInterpreter, createFormEditInterpreter } from '../server/forms/interpretation/provider-interpreter.ts';
import { INTERPRETATION_SCHEMA } from '../server/forms/interpretation/prompts.ts';

const ready = { status: 'ready', specification: { title: 'T', description: null, questions: [{ id: 'a', title: 'A', description: null, type: 'short_text', required: true, options: [], visibility: null }] }, assumptions: [], question: null, explanation: null };

function completion(output, { finish_reason = 'stop', usage, refusal } = {}) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason, message: refusal ? { refusal, content: null } : { content: typeof output === 'string' ? output : JSON.stringify(output) } }],
    ...(usage ? { usage } : {}),
  }), { status: 200 });
}

const GROQ_ENV = { GROQ_API_KEY: 'groq-server-key', GROQ_MODEL: 'openai/gpt-oss-120b' };
const input = { mode: 'new', request: 'A registration form', provider: 'google' };

test('Groq is the primary provider and is addressed through the strict structured-output contract', async () => {
  const calls = [];
  const provider = createGroqProvider({ env: GROQ_ENV, fetchImpl: async (url, init) => { calls.push({ url, init }); return completion(ready); } });
  assert.equal(provider.id, 'groq');
  assert.equal(provider.model, 'openai/gpt-oss-120b');
  const interpreter = createFormInterpreter({ provider });
  assert.deepEqual(await interpreter.interpret(input), ready);

  const [{ url, init }] = calls;
  assert.equal(url, GROQ_ENDPOINT);
  assert.equal(init.method, 'POST');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.authorization, 'Bearer groq-server-key');
  const body = JSON.parse(init.body);
  assert.equal(body.model, 'openai/gpt-oss-120b');
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.equal(body.response_format.json_schema.name, 'intake_form_interpretation');
  assert.deepEqual(body.response_format.json_schema.schema, INTERPRETATION_SCHEMA);
  assert.equal(body.stream, undefined, 'structured output is never combined with streaming');
  assert.deepEqual(body.tools, undefined, 'the model never gets tools');
  assert.equal(init.body.includes('groq-server-key'), false, 'the key is never part of the model input');
  assert.equal(JSON.parse(body.messages[1].content).request, input.request);
  assert.equal(body.reasoning_effort, undefined, 'reasoning effort is only sent when explicitly configured');
});

test('the Groq model and optional reasoning effort are configuration, not code', async () => {
  assert.equal(readGroqModel({}), DEFAULT_GROQ_MODEL);
  assert.equal(readGroqModel({ GROQ_MODEL: '  openai/gpt-oss-20b  ' }), 'openai/gpt-oss-20b');
  assert.equal(resolveAiProvider({ env: GROQ_ENV }).model, 'openai/gpt-oss-120b');
  assert.equal(aiProviderLabel({}), 'not configured (no GROQ_API_KEY or OPENAI_API_KEY)');
  assert.equal(aiProviderLabel(GROQ_ENV), 'groq/openai/gpt-oss-120b');
  assert.equal(aiProviderLabel({ OPENAI_API_KEY: 'k' }), 'openai/gpt-4o-mini');
  const calls = [];
  const provider = createGroqProvider({ env: { ...GROQ_ENV, GROQ_REASONING_EFFORT: 'low' }, fetchImpl: async (url, init) => { calls.push(init); return completion(ready); } });
  await provider.generate({ schemaName: 's', schema: {}, system: 'x', input: {} });
  assert.equal(JSON.parse(calls[0].body).reasoning_effort, 'low');
  assert.throws(() => createGroqProvider({ env: { ...GROQ_ENV, GROQ_REASONING_EFFORT: 'maximum' } }), /GROQ_REASONING_EFFORT/);
});

test('provider selection prefers Groq, honours an explicit choice, and never falls back at request time', async () => {
  assert.equal(resolveAiProvider({ env: GROQ_ENV }).id, 'groq');
  assert.equal(resolveAiProvider({ env: { OPENAI_API_KEY: 'k' } }).id, 'openai', 'an existing OpenAI deployment keeps working');
  assert.equal(resolveAiProvider({ env: { ...GROQ_ENV, OPENAI_API_KEY: 'k' } }).id, 'groq');
  assert.equal(resolveAiProvider({ env: { AI_PROVIDER: 'openai', ...GROQ_ENV, OPENAI_API_KEY: 'k' } }).id, 'openai');
  assert.equal(resolveAiProvider({ env: {} }).id, 'none');
  assert.throws(() => resolveAiProvider({ env: { AI_PROVIDER: 'gemini' } }), /AI_PROVIDER must be groq or openai/);
  assert.throws(() => resolveAiProvider({ env: { AI_PROVIDER: 'groq' } }), /requires GROQ_API_KEY/);
  // An unconfigured server fails closed with the stable application code and makes no network call.
  let calls = 0;
  const missing = createFormInterpreter({ provider: resolveAiProvider({ env: {}, fetchImpl: async () => { calls++; return completion(ready); } }) });
  await assert.rejects(missing.interpret(input), error => error.code === 'model_not_configured' && /GROQ_API_KEY/.test(error.message));
  assert.equal(calls, 0);
  // A failed call is reported, never silently re-sent to a second vendor.
  let attempts = 0;
  const onlyGroq = createFormInterpreter({ provider: resolveAiProvider({ env: { ...GROQ_ENV, OPENAI_API_KEY: 'k' }, fetchImpl: async () => { attempts++; return new Response('down', { status: 503 }); } }) });
  await assert.rejects(onlyGroq.interpret(input), error => error.code === 'model_unavailable');
  assert.equal(attempts, 1, 'exactly one attempt: no automatic retry, no cross-provider fallback');
});

test('Groq failures map to stable application codes without leaking provider payloads', async () => {
  const cases = [
    [new Response('{"error":{"message":"Invalid API Key leaked-detail"}}', { status: 401 }), 'model_not_configured'],
    [new Response('{"error":{"message":"model not found leaked-detail"}}', { status: 404 }), 'model_not_configured'],
    [new Response('{"error":{"message":"rate limit reached for org leaked-detail"}}', { status: 429 }), 'model_rate_limited'],
    [new Response('{"error":{"message":"internal failure leaked-detail"}}', { status: 500 }), 'model_unavailable'],
    [new Response('{"error":{"message":"bad request leaked-detail"}}', { status: 418 }), 'model_provider_error'],
    [completion('{not-json'), 'model_invalid_output'],
    [completion(ready, { finish_reason: 'length' }), 'model_invalid_output'],
    [completion(null, { refusal: 'I will not do that.' }), 'model_invalid_output'],
  ];
  for (const [response, expected] of cases) {
    let calls = 0;
    const provider = createGroqProvider({ env: GROQ_ENV, fetchImpl: async () => { calls++; return response; } });
    const interpreter = createFormInterpreter({ provider });
    await assert.rejects(interpreter.interpret(input), error => {
      assert.equal(error.code, expected);
      assert.equal(error.message.includes('leaked-detail'), false, 'raw provider payload must never surface');
      assert.equal(/[{}\"\[]/.test(error.message), false, 'no raw provider JSON fragment may surface');
      assert.equal(error.message.includes('groq-server-key'), false);
      return true;
    });
    assert.equal(calls, 1, 'no automatic retry');
  }
});

test('timeouts, aborts and malformed responses are explicit and bounded', async () => {
  const timeout = createFormInterpreter({ provider: createGroqProvider({ env: GROQ_ENV, fetchImpl: async () => { throw Object.assign(new Error('timeout with secret'), { name: 'TimeoutError' }); } }) });
  await assert.rejects(timeout.interpret(input), error => error.code === 'model_timeout' && !error.message.includes('secret'));
  const offline = createFormInterpreter({ provider: createGroqProvider({ env: GROQ_ENV, fetchImpl: async () => { throw new Error('socket blew up'); } }) });
  await assert.rejects(offline.interpret(input), error => error.code === 'model_unavailable' && !error.message.includes('socket blew up'));
  // A declared timeout is enforced by the provider, not by the route.
  let signalAborted = false;
  const hanging = createFormInterpreter({ provider: createGroqProvider({ env: GROQ_ENV, timeoutMs: 25, fetchImpl: async (_url, init) => {
    await new Promise(resolve => setTimeout(resolve, 60));
    signalAborted = init.signal.aborted;
    throw Object.assign(new Error('aborted'), { name: 'AbortError' });
  } }) });
  await assert.rejects(hanging.interpret(input), error => error.code === 'model_timeout');
  assert.equal(signalAborted, true, 'an AI request cannot hang indefinitely');
});

test('usage collection records tokens, latency and outcome for every call in a logical operation', async () => {
  const collector = newModelCallCollector();
  const provider = createGroqProvider({ env: GROQ_ENV, fetchImpl: async () => completion(ready, { usage: { prompt_tokens: 120, completion_tokens: 340, total_tokens: 460 } }) });
  const interpreter = createFormInterpreter({ provider, collector });
  await runWithModelCallCollector(collector, () => interpreter.interpret(input));
  assert.equal(collector.calls.length, 1);
  assert.deepEqual(
    { provider: collector.calls[0].provider, model: collector.calls[0].model, ok: collector.calls[0].ok, errorCategory: collector.calls[0].errorCategory },
    { provider: 'groq', model: 'openai/gpt-oss-120b', ok: true, errorCategory: null },
  );
  const summary = summarizeModelCalls(collector.calls);
  assert.deepEqual({ inputTokens: summary.inputTokens, outputTokens: summary.outputTokens, totalTokens: summary.totalTokens, failed: summary.failed }, { inputTokens: 120, outputTokens: 340, totalTokens: 460, failed: false });
  assert.ok(summary.latencyMs >= 0);

  const failed = newModelCallCollector();
  const failing = createFormInterpreter({ provider: createGroqProvider({ env: GROQ_ENV, fetchImpl: async () => new Response('busy', { status: 429 }) }), collector: failed });
  await runWithModelCallCollector(failed, () => failing.interpret(input)).catch(() => undefined);
  assert.equal(failed.calls[0].ok, false);
  assert.equal(failed.calls[0].errorCategory, 'model_rate_limited');
  assert.equal(summarizeModelCalls(failed.calls).failed, true);
});

test('a single logical operation may make several model calls but stays one provider boundary', async () => {
  // Editing revisions are a second call inside the same operation; the collector sees both.
  const collector = newModelCallCollector();
  let calls = 0;
  const provider = createGroqProvider({ env: GROQ_ENV, fetchImpl: async () => { calls++; return completion(ready, { usage: { prompt_tokens: 10, completion_tokens: 20, total_tokens: 30 } }); } });
  const editInterpreter = createFormEditInterpreter({ provider, collector });
  const current = { providerFormId: 'form-1', title: 'T', description: null, hasSections: false, hasBranching: false, items: [] };
  await runWithModelCallCollector(collector, async () => {
    await editInterpreter.interpret({ request: 'Rename it', current });
    await editInterpreter.interpret({ request: 'Actually keep the name', current, existingPlan: { summary: 'rename', operations: [] } });
  });
  assert.equal(calls, 2);
  assert.equal(collector.calls.length, 2);
  assert.equal(summarizeModelCalls(collector.calls).totalTokens, 60, 'internal calls are summed for one logical operation');
});

test('completion-token ceilings are validated configuration', () => {
  assert.equal(readMaxCompletionTokens({}), undefined);
  assert.equal(readMaxCompletionTokens({ AI_MAX_COMPLETION_TOKENS: '12000' }), 12_000);
  for (const value of ['abc', '0', '12.5', '999999']) assert.throws(() => readMaxCompletionTokens({ AI_MAX_COMPLETION_TOKENS: value }), /AI_MAX_COMPLETION_TOKENS/);
  const provider = createOpenAiProvider({ env: { OPENAI_API_KEY: 'k' }, maxCompletionTokens: 4321, fetchImpl: async () => completion(ready) });
  assert.equal(provider.id, 'openai');
});
