import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessInterpretation, InterpretationError } from '../server/forms/interpretation/interpreter.ts';
import { createGroqFormInterpreter, INTERPRETATION_SCHEMA } from '../server/forms/interpretation/groq.ts';
import { planGoogleForm } from '../server/forms/providers/google/plan.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';

const q = (id, title, type = 'short_text', extra = {}) => ({ id, title, description: null, type, required: true, options: [], visibility: null, ...extra });
const registration = () => ({
  title: 'Final-year project registration', description: 'Register for the project showcase.',
  questions: [
    q('full_name', 'Full name'), q('email', 'Email address', 'email'),
    q('phone', 'Phone number', 'short_text', { required: false }),
    q('department', 'Department'),
    q('need_accommodation', 'Do you need accommodation?', 'multiple_choice', { options: ['Yes', 'No'] }),
    q('accommodation_type', 'What type of accommodation do you need?', 'short_text', { visibility: { when: { question: 'need_accommodation', equals: 'Yes' } } }),
  ],
});
const ready = (specification = registration(), assumptions = []) => ({ status: 'ready', specification, assumptions, question: null, explanation: null });
const clarification = question => ({ status: 'needs_clarification', specification: null, assumptions: [], question, explanation: null });
const unsupported = explanation => ({ status: 'unsupported', specification: null, assumptions: [], question: null, explanation });

function invalid(value) {
  assert.throws(() => assessInterpretation(value), error => error instanceof InterpretationError && error.code === 'model_invalid_output');
}

test('a representative registration result maps text, email, optional, choices and supported conditional routing to the real engine', () => {
  const result = assessInterpretation(ready(registration(), ['Department is open text because no list of departments was provided.']));
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.specification.questions.map(item => [item.id, item.type, item.required]), [
    ['full_name', 'short_text', true], ['email', 'email', true], ['phone', 'short_text', false],
    ['department', 'short_text', true], ['need_accommodation', 'multiple_choice', true], ['accommodation_type', 'short_text', true],
  ]);
  assert.deepEqual(result.specification.questions[4].options, ['Yes', 'No']);
  assert.deepEqual(result.specification.questions[5].visibility, { when: { question: 'need_accommodation', equals: 'Yes' } });
  assert.equal(result.specification.description, 'Register for the project showcase.');
  assert.ok(Object.isFrozen(result.specification));
  assert.equal(parseFormSpecification(result.specification).ok, true);
  assert.equal(planGoogleForm(result.specification).ok, true);
  assert.deepEqual(result.warnings.map(warning => warning.code), ['email_validation_unavailable']);
  assert.match(result.assumptions[0], /Department is open text/);
});

test('dropdown, checkboxes, paragraph and multiple choice preserve their actual choices', () => {
  const spec = registration();
  spec.questions.splice(3, 1,
    q('department', 'Department', 'dropdown', { options: ['Computer Science', 'Economics', 'Statistics'] }),
    q('interests', 'Interests', 'checkboxes', { options: ['Research', 'Design'] }),
    q('notes', 'Tell us more', 'long_text', { required: false }));
  const result = assessInterpretation(ready(spec));
  assert.equal(result.status, 'ready');
  assert.deepEqual(result.specification.questions[3].options, ['Computer Science', 'Economics', 'Statistics']);
  assert.deepEqual(result.specification.questions[4].options, ['Research', 'Design']);
  assert.equal(result.specification.questions[5].type, 'long_text');
});

test('uncertainty and unsupported capabilities are distinct from complete specifications', () => {
  assert.deepEqual(assessInterpretation(clarification('Which options should respondents choose from for department?')), { status: 'needs_clarification', question: 'Which options should respondents choose from for department?' });
  assert.deepEqual(assessInterpretation(unsupported('Google Forms cannot create a file-upload question through the supported Intake adapter.')), { status: 'unsupported', explanation: 'Google Forms cannot create a file-upload question through the supported Intake adapter.' });
  invalid({ ...clarification('Which options?'), specification: registration() });
  invalid({ ...unsupported('File uploads are unavailable.'), assumptions: ['I ignored it'] });
  invalid({ ...ready(), question: 'Which?' });
});

test('the provider planner refuses unsupported branching instead of creating a draft that lies', () => {
  const spec = registration();
  spec.questions[4].required = false;
  const result = assessInterpretation(ready(spec));
  assert.equal(result.status, 'unsupported');
  assert.match(result.explanation, /must be required/);
  const nested = registration();
  nested.questions.push(q('followup2', 'Explain it', 'long_text', { visibility: { when: { question: 'accommodation_type', equals: 'Other' } } }));
  invalid(ready(nested)); // the strict spec validator rejects text as a controller
});

test('malformed model output, invalid types and extra properties never bypass validation', () => {
  for (const value of [null, 'JSON in markdown', [], {}, { ...ready(), userId: 'someone-else' },
    { ...ready(), assumptions: ['x'.repeat(241)] }, { ...ready(), assumptions: Array(7).fill('ok') }]) invalid(value);
  const badType = registration(); badType.questions[0].type = 'date'; invalid(ready(badType));
  const withToken = registration(); withToken.questions[0].accessToken = 'secret'; invalid(ready(withToken));
  const badOptions = registration(); badOptions.questions[4].options = ['Yes', 'yes']; invalid(ready(badOptions));
  const badRule = registration(); badRule.questions[5].visibility = { when: { question: 'missing', equals: 'Yes' } }; invalid(ready(badRule));
  const stray = registration(); stray.user_id = 'another-person'; invalid(ready(stray));
});

test('revision returns a new validated full specification with stable ids and only requested changes', () => {
  const original = assessInterpretation(ready());
  const revised = structuredClone(registration());
  revised.questions[1].required = false;
  revised.questions.splice(3, 0, q('student_id', 'Student ID'));
  revised.questions[4] = q('department', 'Department', 'dropdown', { options: ['Computer Science', 'Economics', 'Statistics'] });
  const next = assessInterpretation(ready(revised));
  assert.equal(next.status, 'ready');
  assert.deepEqual(next.specification.questions.slice(0, 3).map(item => item.id), ['full_name', 'email', 'phone']);
  assert.equal(next.specification.questions[1].required, false);
  assert.deepEqual(next.specification.questions[4].options, ['Computer Science', 'Economics', 'Statistics']);
  assert.deepEqual(original.specification.questions.map(item => item.id), registration().questions.map(item => item.id), 'the previous draft did not mutate');
  const removed = structuredClone(revised);
  removed.questions.splice(3, 1);
  const afterRemoval = assessInterpretation(ready(removed));
  assert.equal(afterRemoval.status, 'ready');
  assert.equal(afterRemoval.specification.questions.some(item => item.id === 'student_id'), false);
  const invalidRevision = structuredClone(revised); invalidRevision.questions[4].options = [];
  invalid(ready(invalidRevision));
});

function modelResponse(output, { finish_reason = 'stop' } = {}) {
  return new Response(JSON.stringify({ choices: [{ finish_reason, message: { content: typeof output === 'string' ? output : JSON.stringify(output) } }] }), { status: 200 });
}

test('the Groq boundary requests strict structured output, never exposes its key in the model input, and uses the current spec for revisions', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return modelResponse(ready()); };
  const interpreter = createGroqFormInterpreter({ env: { GROQ_API_KEY: 'server-test-key', GROQ_MODEL: 'openai/gpt-oss-20b' }, fetchImpl });
  const result = await interpreter.interpret({ mode: 'revise', request: 'Make email optional.', specification: assessInterpretation(ready()).specification, provider: 'google' });
  assert.equal(result.status, 'ready');
  const [{ url, init }] = calls;
  assert.equal(url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.authorization, 'Bearer server-test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(INTERPRETATION_SCHEMA.required, ['status', 'specification', 'assumptions', 'question', 'explanation']);
  assert.equal(INTERPRETATION_SCHEMA.additionalProperties, false);
  assert.equal(body.messages[1].role, 'user');
  assert.match(body.messages[1].content, /currentSpecification/);
  assert.match(body.messages[0].content, /preserve all unaffected questions/);
  assert.match(body.messages[0].content, /section routing/);
  assert.equal(init.body.includes('server-test-key'), false);
  assert.equal(init.body.includes('ACCESS_TOKEN'), false);
  assert.equal(JSON.parse(body.messages[1].content).request, 'Make email optional.');
});

test('the Groq interpreter defaults to the configured strict-JSON model', async () => {
  let request;
  const interpreter = createGroqFormInterpreter({
    env: { GROQ_API_KEY: 'server-test-key' },
    fetchImpl: async (url, init) => {
      request = { url, body: JSON.parse(init.body) };
      return modelResponse(ready());
    },
  });
  await interpreter.interpret({ mode: 'new', request: 'Make a registration form.', provider: 'google' });
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(request.body.model, 'openai/gpt-oss-20b');
  assert.equal(request.body.response_format.json_schema.strict, true);
});

test('missing credentials fail clearly without fake inference or network access', async () => {
  let calls = 0;
  const interpreter = createGroqFormInterpreter({ env: {}, fetchImpl: async () => { calls++; return modelResponse(ready()); } });
  await assert.rejects(interpreter.interpret({ mode: 'new', request: 'Register', provider: 'google' }), error => error.code === 'model_not_configured' && /GROQ_API_KEY/.test(error.message));
  assert.equal(calls, 0);
});

test('the model boundary handles provider errors, refusal, truncation, invalid JSON and timeouts without retrying', async () => {
  const input = { mode: 'new', request: 'Registration', provider: 'google' };
  for (const [response, expected] of [
    [new Response('unauthorized', { status: 401 }), 'model_not_configured'],
    [new Response('invalid schema', { status: 400 }), 'model_not_configured'],
    [new Response('busy', { status: 429 }), 'model_unavailable'],
    [modelResponse('{not-json'), 'model_invalid_output'],
    [modelResponse(ready(), { finish_reason: 'length' }), 'model_invalid_output'],
    [new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'No', content: null } }] }), { status: 200 }), 'model_invalid_output'],
  ]) {
    let calls = 0;
    const interpreter = createGroqFormInterpreter({ env: { GROQ_API_KEY: 'test-key' }, fetchImpl: async () => { calls++; return response; } });
    await assert.rejects(interpreter.interpret(input), error => error.code === expected);
    assert.equal(calls, 1, 'no automatic model retry');
  }
  const timeout = createGroqFormInterpreter({ env: { GROQ_API_KEY: 'test-key' }, fetchImpl: async () => { throw Object.assign(new Error('timeout secret'), { name: 'TimeoutError' }); } });
  await assert.rejects(timeout.interpret(input), error => error.code === 'model_timeout' && !error.message.includes('secret'));
});
