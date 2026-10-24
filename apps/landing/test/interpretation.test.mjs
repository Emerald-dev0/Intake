import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessInterpretation, InterpretationError, isRepairablePlacement, placementIssues } from '../server/forms/interpretation/interpreter.ts';
import { createFormInterpreter } from '../server/forms/interpretation/provider-interpreter.ts';
import { createOpenAiProvider } from '../server/ai/openai.ts';
import { createGroqProvider } from '../server/ai/groq.ts';
import { INTERPRETATION_SCHEMA } from '../server/forms/interpretation/prompts.ts';

/** The interpretation layer is provider-agnostic; these boundary tests exercise both providers. */
const openAiInterpreter = options => createFormInterpreter({ provider: createOpenAiProvider(options) });
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

test('the assistant sentence is carried through, cleaned, and rejected when it is not a sentence', () => {
  // reply is what the person reads in the chat; it travels with the structured result.
  assert.deepEqual(
    assessInterpretation({ ...clarification('Which departments should be listed?'), reply: '  Need one detail\n before I build this.  ' }),
    { status: 'needs_clarification', question: 'Which departments should be listed?', reply: 'Need one detail before I build this.' },
  );
  assert.deepEqual(
    assessInterpretation({ ...unsupported('Google Forms cannot do file uploads.'), reply: 'I can do everything else, just not file uploads.' }),
    { status: 'unsupported', explanation: 'Google Forms cannot do file uploads.', reply: 'I can do everything else, just not file uploads.' },
  );
  const withReply = assessInterpretation({ ...ready(), reply: 'Five questions, with accommodation behind a yes/no gate.' });
  assert.equal(withReply.status, 'ready');
  assert.equal(withReply.reply, 'Five questions, with accommodation behind a yes/no gate.');

  // Absent or empty is allowed (older outputs degrade to silence); the wrong type or an essay is not.
  assert.equal('reply' in assessInterpretation(ready()), false);
  assert.equal('reply' in assessInterpretation({ ...ready(), reply: null }), false);
  assert.equal('reply' in assessInterpretation({ ...ready(), reply: '   ' }), false);
  invalid({ ...ready(), reply: 42 });
  invalid({ ...ready(), reply: 'x'.repeat(401) });
  invalid({ ...ready(), reply: { text: 'hello' } });
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

test('back-to-back conditional groups are repaired with planner feedback, not shown as engineer text', async () => {
  const branched = registration();
  branched.questions.push(q('no_proof', 'Upload proof of otherwise', 'short_text', { visibility: { when: { question: 'need_accommodation', equals: 'No' } } }));
  const rawBad = ready(branched);
  const issues = placementIssues(rawBad);
  assert.ok(issues.some(issue => issue.code === 'google_condition_placement'), 'the planner flags the layout');
  assert.equal(isRepairablePlacement(issues), true);
  assert.deepEqual(placementIssues(ready()), [], 'clean plans need no repair');
  assert.deepEqual(placementIssues(clarification('Which?')), [], 'non-ready results need no repair');

  // A residual failure the repair loop could not fix speaks plainly, without question ids.
  const residual = assessInterpretation(rawBad);
  assert.equal(residual.status, 'unsupported');
  assert.match(residual.explanation, /back to back/);
  assert.ok(!residual.explanation.includes('q10b') && !residual.explanation.includes('questions['), 'no engineer pointers leak');

  // The interpreter itself retries once with adaptation-first guidance and returns the fixed draft.
  const fixed = registration();
  const script = [rawBad, ready(fixed)];
  let calls = 0;
  const bodies = [];
  const interpreter = createFormInterpreter({
    provider: createGroqProvider({
      env: { GROQ_API_KEY: 'server-test-key' },
      sleepImpl: async () => undefined,
      fetchImpl: async (_url, init) => { bodies.push(JSON.parse(init.body)); return modelResponse(script[Math.min(calls++, script.length - 1)]); },
    }),
  });
  const repaired = await interpreter.interpret({ mode: 'new', request: 'Registration with two follow-ups.', provider: 'google' });
  assert.equal(calls, 2, 'one guided reshuffle retry');
  const retryRequest = JSON.parse(bodies[1].messages[1].content).request;
  assert.match(retryRequest, /Produce a working arrangement/, 'repair demands output, not apology');
  assert.match(retryRequest, /bridging Yes\/No/, 'repair teaches the bridging pattern');
  assert.match(retryRequest, /last resort/, 'refusal stays the final fallback');
  const assessed = assessInterpretation(repaired);
  assert.equal(assessed.status, 'ready');
  assert.equal(assessed.specification.questions.length, fixed.questions.length);
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

test('the OpenAI boundary requests strict structured output, never exposes its key in the model input, and uses the current spec for revisions', async () => {
  const calls = [];
  const fetchImpl = async (url, init) => { calls.push({ url, init }); return modelResponse(ready()); };
  const interpreter = openAiInterpreter({ env: { OPENAI_API_KEY: 'server-test-key', OPENAI_MODEL: 'gpt-4o-mini' }, fetchImpl });
  const result = await interpreter.interpret({ mode: 'revise', request: 'Make email optional.', specification: assessInterpretation(ready()).specification, provider: 'google' });
  assert.equal(result.status, 'ready');
  const [{ url, init }] = calls;
  assert.equal(url, 'https://api.openai.com/v1/chat/completions');
  assert.equal(init.redirect, 'error');
  assert.equal(init.headers.authorization, 'Bearer server-test-key');
  const body = JSON.parse(init.body);
  assert.equal(body.response_format.type, 'json_schema');
  assert.equal(body.response_format.json_schema.strict, true);
  assert.deepEqual(INTERPRETATION_SCHEMA.required, ['status', 'reply', 'specification', 'assumptions', 'question', 'explanation']);
  assert.equal(INTERPRETATION_SCHEMA.additionalProperties, false);
  assert.equal(body.messages[1].role, 'user');
  assert.match(body.messages[1].content, /currentSpecification/);
  assert.match(body.messages[0].content, /preserve all unaffected questions/i);
  assert.match(body.messages[0].content, /section routing/);
  assert.equal(init.body.includes('server-test-key'), false);
  assert.equal(init.body.includes('ACCESS_TOKEN'), false);
  assert.equal(JSON.parse(body.messages[1].content).request, 'Make email optional.');
});

test('the Groq provider defaults to the configured strict-JSON model', async () => {
  let request;
  const interpreter = createFormInterpreter({
    provider: createGroqProvider({
      env: { GROQ_API_KEY: 'server-test-key' },
      fetchImpl: async (url, init) => {
        request = { url, body: JSON.parse(init.body) };
        return modelResponse(ready());
      },
    }),
  });
  await interpreter.interpret({ mode: 'new', request: 'Make a registration form.', provider: 'google' });
  assert.equal(request.url, 'https://api.groq.com/openai/v1/chat/completions');
  assert.equal(request.body.model, 'openai/gpt-oss-120b');
  assert.equal(request.body.response_format.json_schema.strict, true);
});

test('transient provider wobbles retry with backoff; 4xx never retries', async () => {
  const noSleep = async () => undefined;
  const error = status => new Response(JSON.stringify({ error: { message: `provider says ${status}`, code: status } }), { status });

  // 429 then success: one retry, honest result, no user charge for the wobble.
  let attempts = 0;
  const flaky = createFormInterpreter({
    provider: createGroqProvider({
      env: { GROQ_API_KEY: 'server-test-key' },
      sleepImpl: noSleep,
      fetchImpl: async () => (++attempts === 1 ? error(429) : modelResponse(ready())),
    }),
  });
  const recovered = await flaky.interpret({ mode: 'new', request: 'Make a registration form.', provider: 'google' });
  assert.equal(recovered.status, 'ready');
  assert.equal(attempts, 2);

  // Persistent 500s exhaust the bound and surface as unavailable, not credentials.
  let down = 0;
  const outage = createFormInterpreter({
    provider: createGroqProvider({
      env: { GROQ_API_KEY: 'server-test-key' },
      sleepImpl: noSleep,
      fetchImpl: async () => { down += 1; return error(500); },
    }),
  });
  await assert.rejects(
    outage.interpret({ mode: 'new', request: 'Make a registration form.', provider: 'google' }),
    error => error instanceof InterpretationError && error.code === 'model_unavailable',
  );
  assert.equal(down, 3, 'retries are bounded');

  // 400 is decisive: retrying the identical request cannot help.
  let bad = 0;
  const broken = createFormInterpreter({
    provider: createGroqProvider({
      env: { GROQ_API_KEY: 'server-test-key' },
      sleepImpl: noSleep,
      fetchImpl: async () => { bad += 1; return error(400); },
    }),
  });
  await assert.rejects(
    broken.interpret({ mode: 'new', request: 'Make a registration form.', provider: 'google' }),
    error => error instanceof InterpretationError && error.code === 'model_not_configured',
  );
  assert.equal(bad, 1, 'client errors fail fast without retry');
});

test('missing credentials fail clearly without fake inference or network access', async () => {
  let calls = 0;
  const interpreter = openAiInterpreter({ env: {}, fetchImpl: async () => { calls++; return modelResponse(ready()); } });
  await assert.rejects(interpreter.interpret({ mode: 'new', request: 'Register', provider: 'google' }), error => error.code === 'model_not_configured' && /OPENAI_API_KEY/.test(error.message));
  assert.equal(calls, 0);
});

test('the model boundary maps provider errors distinctly; only fast transients retry', async () => {
  const input = { mode: 'new', request: 'Registration', provider: 'google' };
  // Decisive failures: classified, surfaced, single attempt.
  for (const [response, expected] of [
    [new Response('unauthorized', { status: 401 }), 'model_not_configured'],
    [new Response('invalid schema', { status: 400 }), 'model_not_configured'],
    [new Response('teapot', { status: 418 }), 'model_provider_error'],
    [modelResponse('{not-json'), 'model_invalid_output'],
    [modelResponse(ready(), { finish_reason: 'length' }), 'model_invalid_output'],
    [new Response(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { refusal: 'No', content: null } }] }), { status: 200 }), 'model_invalid_output'],
  ]) {
    let calls = 0;
    const interpreter = openAiInterpreter({ env: { OPENAI_API_KEY: 'test-key' }, sleepImpl: async () => undefined, fetchImpl: async () => { calls++; return response; } });
    await assert.rejects(interpreter.interpret(input), error => error.code === expected);
    assert.equal(calls, 1, 'decisive failures never retry');
  }
  // Fast transients: bounded retries, then the honest code. Each attempt gets a fresh
  // Response: a body can only be read once, so reusing one across retries is unfaithful.
  for (const [makeResponse, expected] of [
    [() => new Response('busy', { status: 429 }), 'model_rate_limited'],
    [() => new Response('down', { status: 503 }), 'model_unavailable'],
  ]) {
    let calls = 0;
    const interpreter = openAiInterpreter({ env: { OPENAI_API_KEY: 'test-key' }, sleepImpl: async () => undefined, fetchImpl: async () => { calls++; return makeResponse(); } });
    await assert.rejects(interpreter.interpret(input), error => error.code === expected);
    assert.equal(calls, 3, 'transients retry to the bound, then surface truthfully');
  }
  const timeout = openAiInterpreter({ env: { OPENAI_API_KEY: 'test-key' }, fetchImpl: async () => { throw Object.assign(new Error('timeout secret'), { name: 'TimeoutError' }); } });
  await assert.rejects(timeout.interpret(input), error => error.code === 'model_timeout' && !error.message.includes('secret'));
});
