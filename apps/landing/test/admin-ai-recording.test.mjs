import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createGroqFormInterpreter } from '../server/forms/interpretation/groq.ts';

const result = {
  status: 'needs_clarification', specification: null, assumptions: [],
  question: 'Which date?', explanation: null,
};
const telemetry = { userId: 'user-1', requestId: 'req_safe_01', route: '/api/forms/interpret' };

function groqResponse({ status = 200, usage, output = result } = {}) {
  return new Response(JSON.stringify({
    choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(output) } }],
    ...(usage ? { usage } : {}),
  }), { status });
}

test('Groq calls record real server-side token usage and safe operation metadata without storing prompts', async () => {
  const records = [];
  const interpreter = createGroqFormInterpreter({
    env: { GROQ_API_KEY: 'never-return-this', GROQ_MODEL: 'openai/gpt-oss-20b' },
    fetchImpl: async () => groqResponse({ usage: { prompt_tokens: 321, completion_tokens: 87 } }),
    recordOperation: async record => { records.push(record); },
  });
  await interpreter.interpret({ mode: 'new', provider: 'google', request: 'Sensitive free-form prompt with private details', telemetry });
  assert.equal(records.length, 1);
  assert.equal(records[0].userId, 'user-1');
  assert.equal(records[0].requestId, 'req_safe_01');
  assert.equal(records[0].route, '/api/forms/interpret');
  assert.equal(records[0].operation, 'form_interpretation');
  assert.equal(records[0].provider, 'groq');
  assert.equal(records[0].model, 'openai/gpt-oss-20b');
  assert.equal(records[0].status, 'succeeded');
  assert.equal(records[0].failureCode, null);
  assert.equal(records[0].inputTokens, 321);
  assert.equal(records[0].outputTokens, 87);
  assert.ok(records[0].latencyMs >= 0);
  assert.ok(records[0].startedAt instanceof Date);
  assert.ok(records[0].completedAt instanceof Date);
  assert.doesNotMatch(JSON.stringify(records[0]), /Sensitive free-form prompt|private details|never-return-this/);
});

test('AI failures retain only a normalized category and usage sink failures never replace the model result', async () => {
  const failureRecords = [];
  const failing = createGroqFormInterpreter({
    env: { GROQ_API_KEY: 'test-key' },
    fetchImpl: async () => new Response('provider body with prompt-like secret', { status: 429 }),
    recordOperation: async record => { failureRecords.push(record); },
  });
  await assert.rejects(failing.interpret({ mode: 'new', provider: 'google', request: 'Do not store this text', telemetry }), error => error.code === 'model_rate_limited');
  assert.equal(failureRecords.length, 1);
  assert.equal(failureRecords[0].status, 'failed');
  assert.equal(failureRecords[0].failureCode, 'model_rate_limited');
  assert.equal(failureRecords[0].inputTokens, null);
  assert.doesNotMatch(JSON.stringify(failureRecords), /Do not store|prompt-like secret/);

  const succeedsWithoutStorage = createGroqFormInterpreter({
    env: { GROQ_API_KEY: 'test-key' },
    fetchImpl: async () => groqResponse(),
    recordOperation: async () => { throw new Error('database has a token=secret'); },
  });
  const output = await succeedsWithoutStorage.interpret({ mode: 'new', provider: 'google', request: 'Registration', telemetry });
  assert.equal(output.status, 'needs_clarification');
});
