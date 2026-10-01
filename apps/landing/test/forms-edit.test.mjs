import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createMemoryFormEditDraftStore } from '../server/forms/edit-memory-store.ts';
import { createFormEditRouter } from '../server/forms/edit-routes.ts';
import { createInterpretationLimiter } from '../server/forms/interpretation/routes.ts';
import { InterpretationError } from '../server/forms/interpretation/interpreter.ts';
import { SPEC_VERSION } from '../server/forms/specification.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';
import { createGoogleForm, createWorld, form, ORIGIN, shortText } from './helpers/forms-harness.mjs';

const RECORD_ID = 'existing-form-01';
const USER_A = { id: 'user-a', email: 'ada@example.test', name: 'Ada' };
const ready = (summary, operations) => ({ status: 'ready', summary, operations, question: null, explanation: null });
const clarification = question => ({ status: 'needs_clarification', summary: null, operations: null, question, explanation: null });
const unsupported = explanation => ({ status: 'unsupported', summary: null, operations: null, question: null, explanation });
const confirmInput = draft => ({ draftId: draft.id, version: draft.version, confirm: true });
const count = (world, op) => world.fake.callsTo(op).length;
const defaultSpec = () => form([
  shortText('name', { title: 'Full name', required: true, description: 'Use your legal name.' }),
  { id: 'role', type: 'multiple_choice', title: 'Role', required: true, options: ['Student', 'Staff'] },
  shortText('notes', { title: 'Additional notes', required: false }),
], { title: 'Project registration', description: 'Register for the project showcase.' });

async function boot(options = {}) {
  const world = createWorld();
  await world.connect('user-a');
  const { formStore } = world.engine();
  const parsed = parseFormSpecification(options.specification ?? defaultSpec());
  assert.equal(parsed.ok, true);
  const source = await createGoogleForm(world, parsed.specification, 'user-a');
  const status = options.recordStatus ?? 'created';
  await formStore.save({ id: RECORD_ID, userId: 'user-a', provider: 'google', externalAccountId: source.externalAccountId,
    providerFormId: source.providerFormId, title: source.title, status, editUrl: source.editUrl ?? null,
    responderUrl: status === 'created' ? source.responderUrl ?? null : null, failureStage: status === 'created' ? null : 'publish',
    requestId: 'req_form_create', specification: parsed.specification, specificationVersion: SPEC_VERSION }, world.now());

  const drafts = createMemoryFormEditDraftStore();
  const inputs = [];
  let interpretationCount = 0;
  let draftSequence = 0;
  const interpreter = { async interpret(input) {
    inputs.push(structuredClone(input));
    interpretationCount += 1;
    if (options.interpret) return options.interpret(input, interpretationCount);
    return ready('Rename the form', [{ type: 'update_title', title: 'Project registration 2027' }]);
  } };
  const people = { current: USER_A };
  const app = express();
  app.use('/api/forms', createFormEditRouter({
    providers: world.providers(), forms: formStore, drafts, interpreter, env: world.env, log: world.log, now: world.now,
    ...(options.limiter ? { limiter: options.limiter } : {}), getSession: async () => people.current,
    newId: () => `00000000-0000-4000-8000-${String(++draftSequence).padStart(12, '0')}`,
  }));
  const server = createServer(app);
  await new Promise((resolve, reject) => server.listen(0, '127.0.0.1', error => error ? reject(error) : resolve()));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;
  async function call(method, path, data, opts = {}) {
    const headers = {};
    if (method !== 'GET' && opts.origin !== null) headers.origin = opts.origin ?? ORIGIN;
    if (data !== undefined) headers['content-type'] = 'application/json';
    const response = await fetch(base + path, { method, headers, ...(data === undefined ? {} : { body: opts.raw ? data : JSON.stringify(data) }) });
    const text = await response.text();
    let json = null;
    try { json = JSON.parse(text); } catch { /* e.g. 204 */ }
    return { status: response.status, json, text, headers: response.headers };
  }
  return {
    world, source, formStore, drafts, inputs, people, call,
    inspect(target = { formRecordId: RECORD_ID }, opts) { return call('POST', '/edit/inspect', { target }, opts); },
    interpret(data, opts) { return call('POST', '/edit/interpret', data, opts); },
    revise(data, opts) { return call('POST', '/edit/revise', data, opts); },
    confirm(data, opts) { return call('POST', '/edit/confirm', data, opts); },
    getDraft(id) { return call('GET', `/edit/draft/${id}`); },
    discard(id, opts) { return call('DELETE', `/edit/draft/${id}`, undefined, opts); },
    async close() { server.closeAllConnections?.(); await new Promise(resolve => server.close(() => resolve())); },
  };
}
async function withApi(options, run) { const api = await boot(options); try { return await run(api); } finally { await api.close(); } }
async function makeProposal(api, target = { formRecordId: RECORD_ID }, request = 'Rename the form.') {
  const response = await api.interpret({ target, request });
  assert.equal(response.status, 201, response.text);
  assert.equal(response.json.status, 'ready');
  return response.json.draft;
}
function assertNoSecrets(api, ...values) {
  const publicText = JSON.stringify({ values, logs: api.world.logs });
  for (const secret of ['ACCESS_TOKEN_OF_USER-A', 'REFRESH_TOKEN_OF_USER-A', 'REFRESHED_ACCESS_TOKEN_FOR_TESTS', 'google-account-of-user-a', 'test-google-client-secret']) {
    assert.equal(publicText.includes(secret), false, `leaked ${secret}`);
  }
  assert.doesNotMatch(publicText, /"(?:accessToken|refreshToken|externalAccountId|revisionId)"\s*:/);
}

// Current-state retrieval and target selection

test('inspect returns fresh sanitized Google state and real question IDs without a mutation', () => withApi({}, async api => {
  const before = { gets: count(api.world, 'forms.get'), creates: count(api.world, 'forms.create'), batches: count(api.world, 'forms.batchUpdate') };
  const response = await api.inspect();
  assert.equal(response.status, 200, response.text);
  assert.equal(response.json.form.providerFormId, api.source.providerFormId);
  assert.equal(response.json.form.title, 'Project registration');
  assert.deepEqual(response.json.form.items.map(item => item.title), ['Full name', 'Role', 'Additional notes']);
  const questions = response.json.form.items.filter(item => item.kind === 'question');
  assert.equal(questions.length, 3);
  assert.ok(questions.every(item => item.itemId && item.questionId));
  assert.equal(new Set(questions.map(item => item.questionId)).size, 3);
  assert.equal('revisionId' in response.json.form, false);
  assert.equal('externalAccountId' in response.json.form, false);
  assert.equal(count(api.world, 'forms.get'), before.gets + 1);
  assert.equal(count(api.world, 'forms.create'), before.creates);
  assert.equal(count(api.world, 'forms.batchUpdate'), before.batches);
  assertNoSecrets(api, response.json);
}));

test('URL parsing accepts exact Google Forms edit/view URLs and rejects untrusted URL shapes before any fetch', async () => {
  const { extractGoogleFormId } = await import('../server/forms/edit-engine.ts');
  const id = '1FAfakeForm0001abcdefghijklmnop';
  assert.equal(extractGoogleFormId(`https://docs.google.com/forms/d/${id}/edit`), id);
  assert.equal(extractGoogleFormId(`https://docs.google.com/forms/d/${id}/viewform`), id);
  assert.equal(extractGoogleFormId(`https://docs.google.com/forms/u/2/d/${id}/edit?usp=sharing`), id);
  for (const url of [`http://docs.google.com/forms/d/${id}/edit`, `https://evil.example/forms/d/${id}/edit`,
    `https://docs.google.com.evil.example/forms/d/${id}/edit`, 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform',
    `https://docs.google.com/forms/d/${id}/edit/extra`, `https://docs.google.com/forms/d/${id}/edit#fragment`,
    `https://user:pass@docs.google.com/forms/d/${id}/edit`]) assert.equal(extractGoogleFormId(url), null, url);
  await withApi({}, async api => {
    const gets = count(api.world, 'forms.get');
    const bad = await api.inspect({ formUrl: 'https://attacker.example/fetch-this' });
    assert.equal(bad.status, 400);
    assert.equal(bad.json.code, 'invalid_form_url');
    assert.equal(count(api.world, 'forms.get'), gets, 'malformed URL is never fetched');
    const valid = await api.inspect({ formUrl: api.source.editUrl });
    assert.equal(valid.status, 200, valid.text);
    assert.equal(valid.json.form.providerFormId, api.source.providerFormId);
    assert.equal(count(api.world, 'forms.get'), gets + 1);
    const missing = await api.inspect({ formUrl: 'https://docs.google.com/forms/d/1FAunknownForm000000000000000/edit' });
    assert.equal(missing.status, 404);
    assert.equal(missing.json.code, 'form_not_found');
    assert.ok(api.world.fake.calls.every(call => call.operation.startsWith('forms.')), 'no Drive-wide/arbitrary URL discovery request is made');
  });
});

test('a pre-existing form selected by known URL edits in place without importing it or creating a replacement', () => withApi({}, async api => {
  const parsed = parseFormSpecification(defaultSpec());
  const external = await createGoogleForm(api.world, parsed.specification, 'user-a');
  assert.deepEqual((await api.formStore.listForUser('user-a', 20)).map(item => item.providerFormId), [api.source.providerFormId]);
  const creates = count(api.world, 'forms.create');
  const proposal = await makeProposal(api, { formUrl: external.editUrl });
  assert.equal(proposal.current.providerFormId, external.providerFormId);
  assert.equal(proposal.plan.formId, external.providerFormId);
  const result = await api.confirm(confirmInput(proposal));
  assert.equal(result.status, 200, result.text);
  assert.equal(result.json.result.providerFormId, external.providerFormId);
  assert.equal(result.json.result.responderUrl, external.responderUrl);
  assert.equal(api.world.fake.forms.get(external.providerFormId).formId, external.providerFormId);
  assert.equal(count(api.world, 'forms.create'), creates, 'the edit path never calls forms.create');
  assert.deepEqual((await api.formStore.listForUser('user-a', 20)).map(item => item.providerFormId), [api.source.providerFormId]);
}));

// Plan validation, preview and confirmation

test('interpretation builds a validated, human-readable proposal targeting real question IDs only', () => withApi({
  interpret: input => ready('Update the name question', [{ type: 'update_question',
    questionId: input.current.items.find(item => item.title === 'Full name').questionId,
    changes: { title: 'Name for badge', required: false } }]),
}, async api => {
  const batches = count(api.world, 'forms.batchUpdate');
  const response = await api.interpret({ target: { formRecordId: RECORD_ID }, request: 'Rename Full name and make it optional.' });
  assert.equal(response.status, 201, response.text);
  const draft = response.json.draft;
  assert.equal(draft.status, 'ready');
  assert.equal(draft.version, 1);
  assert.equal(draft.current.providerFormId, api.source.providerFormId);
  assert.equal(draft.plan.formId, api.source.providerFormId);
  assert.equal(draft.plan.operations[0].questionId, api.inputs[0].current.items.find(item => item.title === 'Full name').questionId);
  assert.match(draft.changes[0].detail, /Full name.*Name for badge/);
  assert.match(draft.changes[0].detail, /Required: Yes → No/);
  assert.equal(count(api.world, 'forms.batchUpdate'), batches, 'interpretation is read-only');
  const untrustedPlan = await api.interpret({ target: { formRecordId: RECORD_ID }, request: 'Change it.', plan: { operations: [] } });
  assert.equal(untrustedPlan.status, 400, 'the client cannot send an executable plan');
  assertNoSecrets(api, response.json);
}));

test('unknown question targets ask for clarification, while invalid options/conflicts are rejected before writes', () => withApi({
  interpret: (input, count) => count === 1
    ? ready('Change a question', [{ type: 'update_question', questionId: 'model-invented-id', changes: { required: false } }])
    : count === 2
      ? ready('Clear role options', [{ type: 'update_question', questionId: input.current.items.find(item => item.title === 'Role').questionId, changes: { options: [] } }])
      : ready('Two titles', [{ type: 'update_title', title: 'First' }, { type: 'update_title', title: 'Second' }]),
}, async api => {
  const target = { formRecordId: RECORD_ID };
  const unknown = await api.interpret({ target, request: 'Change that question.' });
  assert.equal(unknown.json.status, 'needs_clarification');
  assert.match(unknown.json.question, /exact question title/i);
  const invalid = await api.interpret({ target, request: 'Clear all role options.' });
  assert.equal(invalid.status, 502);
  assert.equal(invalid.json.code, 'model_invalid_output');
  const conflict = await api.interpret({ target, request: 'Use two different titles.' });
  assert.equal(conflict.status, 502);
  assert.equal(conflict.json.code, 'model_invalid_output');
  assert.equal(api.drafts.all().length, 0);
  assert.equal(count(api.world, 'forms.batchUpdate'), 1);
}));

test('confirm requires explicit acknowledgement, updates the original ID, preserves responder URL and persists verification', () => withApi({}, async api => {
  const before = structuredClone(api.world.fake.forms.get(api.source.providerFormId));
  const reads = count(api.world, 'forms.get');
  const batches = count(api.world, 'forms.batchUpdate');
  const creates = count(api.world, 'forms.create');
  const proposal = await makeProposal(api);
  assert.equal(proposal.changes[0].detail, '“Project registration” → “Project registration 2027”');
  const denied = await api.confirm({ draftId: proposal.id, version: proposal.version, confirm: false });
  assert.equal(denied.status, 400);
  assert.equal(count(api.world, 'forms.batchUpdate'), batches);
  const applied = await api.confirm(confirmInput(proposal));
  assert.equal(applied.status, 200, applied.text);
  assert.equal(applied.json.result.ok, true);
  assert.equal(applied.json.draft.status, 'applied');
  assert.equal(applied.json.result.providerFormId, api.source.providerFormId);
  assert.equal(applied.json.result.title, 'Project registration 2027');
  assert.equal(applied.json.result.responderUrl, before.responderUri);
  assert.equal(applied.json.result.recordUpdated, true);
  assert.equal(count(api.world, 'forms.create'), creates);
  assert.equal(count(api.world, 'forms.batchUpdate'), batches + 1);
  assert.equal(count(api.world, 'forms.get'), reads + 3, 'one interpretation read, one pre-write read and one verification read');
  const after = api.world.fake.forms.get(api.source.providerFormId);
  assert.equal(after.formId, before.formId);
  assert.equal(after.info.title, 'Project registration 2027');
  assert.equal(after.responderUri, before.responderUri);
  assert.deepEqual(after.items, before.items);
  const record = await api.formStore.getForUser('user-a', RECORD_ID);
  assert.equal(record.providerFormId, api.source.providerFormId);
  assert.equal(record.title, 'Project registration 2027');
  assert.equal(record.responderUrl, api.source.responderUrl);
  assert.equal(applied.json.draft.current.title, 'Project registration 2027');
  const calls = api.world.fake.calls.length;
  const replay = await api.confirm(confirmInput(proposal));
  assert.equal(replay.status, 200);
  assert.equal(api.world.fake.calls.length, calls, 'a replay uses the stored success result');
  assertNoSecrets(api, applied.json);
}));

test('question updates preserve IDs and use documented masks for descriptions, choice options/types and text type', () => withApi({
  interpret: input => {
    const choice = input.current.items.find(item => item.title === 'Role');
    const text = input.current.items.find(item => item.title === 'Full name');
    return ready('Update the purpose, role choices and name answer style', [
      { type: 'update_description', description: 'Collects project showcase registration details.' },
      { type: 'update_question', questionId: choice.questionId, changes: { type: 'dropdown', options: ['Student', 'Staff', 'Guest'] } },
      { type: 'update_question', questionId: text.questionId, changes: { type: 'long_text' } },
    ]);
  },
}, async api => {
  const before = api.world.fake.forms.get(api.source.providerFormId);
  const oldChoice = before.items.find(item => item.title === 'Role');
  const oldText = before.items.find(item => item.title === 'Full name');
  const proposal = await makeProposal(api);
  const result = await api.confirm(confirmInput(proposal));
  assert.equal(result.status, 200, result.text);
  const after = api.world.fake.forms.get(api.source.providerFormId);
  assert.equal(after.info.description, 'Collects project showcase registration details.');
  const choice = after.items.find(item => item.title === 'Role');
  assert.equal(choice.itemId, oldChoice.itemId);
  assert.equal(choice.questionItem.question.questionId, oldChoice.questionItem.question.questionId);
  assert.equal(choice.questionItem.question.choiceQuestion.type, 'DROP_DOWN');
  assert.deepEqual(choice.questionItem.question.choiceQuestion.options.map(item => item.value), ['Student', 'Staff', 'Guest']);
  const text = after.items.find(item => item.title === 'Full name');
  assert.equal(text.itemId, oldText.itemId);
  assert.equal(text.questionItem.question.questionId, oldText.questionItem.question.questionId);
  assert.equal(text.questionItem.question.textQuestion.paragraph, true);
  const requests = api.world.fake.callsTo('forms.batchUpdate').at(-1).body.requests;
  assert.equal(requests[0].updateFormInfo.updateMask, 'description');
  assert.match(requests[1].updateItem.updateMask, /questionItem\.question\.choiceQuestion\.type/);
  assert.match(requests[1].updateItem.updateMask, /questionItem\.question\.choiceQuestion\.options/);
  assert.match(requests[2].updateItem.updateMask, /questionItem\.question\.textQuestion\.paragraph/);
}));

test('supported add/move/delete edits use existing question IDs and clearly flag a destructive preview', () => withApi({
  interpret: input => {
    const questions = input.current.items.filter(item => item.kind === 'question');
    return ready('Add a question, move Additional notes, remove Role', [
      { type: 'add_question', question: { title: 'Preferred name', type: 'short_text', required: false } },
      { type: 'move_question', questionId: questions[2].questionId, position: 1 },
      { type: 'delete_question', questionId: questions[1].questionId },
    ]);
  },
}, async api => {
  const oldItems = api.world.fake.forms.get(api.source.providerFormId).items;
  const oldIds = oldItems.map(item => item.questionItem.question.questionId);
  const proposal = await makeProposal(api);
  assert.equal(proposal.changes.find(change => change.type === 'delete_question').destructive, true);
  const result = await api.confirm(confirmInput(proposal));
  assert.equal(result.status, 200, result.text);
  const updated = api.world.fake.forms.get(api.source.providerFormId);
  assert.equal(updated.formId, api.source.providerFormId);
  assert.deepEqual(updated.items.map(item => item.title), ['Full name', 'Additional notes', 'Preferred name']);
  const ids = updated.items.map(item => item.questionItem.question.questionId);
  assert.ok(ids.includes(oldIds[0]));
  assert.ok(ids.includes(oldIds[2]));
  assert.ok(!ids.includes(oldIds[1]));
}));

test('conversational revision replaces the old plan without applying it and rejects its old version', () => withApi({
  interpret: input => !input.existingPlan
    ? ready('Rename the form', [{ type: 'update_title', title: 'Renamed' }])
    : ready('Make Full name optional instead', [{ type: 'update_question', questionId: input.current.items.find(item => item.title === 'Full name').questionId, changes: { required: false } }]),
}, async api => {
  const batches = count(api.world, 'forms.batchUpdate');
  const original = await makeProposal(api);
  const revised = await api.revise({ draftId: original.id, version: original.version, request: 'Do not rename it; make Full name optional.' });
  assert.equal(revised.status, 200, revised.text);
  assert.equal(revised.json.draft.version, 2);
  assert.equal(revised.json.draft.plan.operations[0].type, 'update_question');
  assert.equal(api.inputs[1].existingPlan.operations[0].type, 'update_title');
  assert.equal(count(api.world, 'forms.batchUpdate'), batches);
  assert.equal((await api.confirm(confirmInput(original))).status, 409);
  assert.equal(count(api.world, 'forms.batchUpdate'), batches);
}));

// Stale state, account changes, and provider outcomes

test('a changed Google revision blocks a proposal before write and permanently stales it', () => withApi({}, async api => {
  const proposal = await makeProposal(api);
  api.world.fake.mutateForm(api.source.providerFormId, form => { form.info.title = 'Edited directly in Google'; });
  const batches = count(api.world, 'forms.batchUpdate');
  const stale = await api.confirm(confirmInput(proposal));
  assert.equal(stale.status, 409);
  assert.equal(stale.json.failure.code, 'edit_stale');
  assert.equal(stale.json.failure.outcome, 'stale');
  assert.equal(stale.json.draft.status, 'stale');
  assert.equal(count(api.world, 'forms.batchUpdate'), batches);
  assert.equal((await api.confirm(confirmInput(proposal))).status, 409);
  assert.equal(count(api.world, 'forms.batchUpdate'), batches);
}));

test('confirmation re-checks that the same connected Google account is still authorized', () => withApi({}, async api => {
  const proposal = await makeProposal(api);
  await api.world.store.deleteConnection('user-a', 'google');
  await api.world.connect('user-a', { externalAccountId: 'different-google-account' });
  const batches = count(api.world, 'forms.batchUpdate');
  const result = await api.confirm(confirmInput(proposal));
  assert.equal(result.status, 403);
  assert.equal(result.json.failure.code, 'form_not_editable');
  assert.equal(result.json.failure.outcome, 'not_applied');
  assert.equal(count(api.world, 'forms.batchUpdate'), batches);
  assert.equal(api.world.fake.forms.get(api.source.providerFormId).info.title, 'Project registration');
}));

test('failed requests are reconciled; partial, lost and transient-read outcomes are handled without blind writes', () => withApi({
  interpret: () => ready('Rename the form and add Department', [
    { type: 'update_title', title: 'Registration 2027' },
    { type: 'add_question', question: { title: 'Department', type: 'short_text', required: false } },
  ]),
}, async api => {
  const partialDraft = await makeProposal(api);
  const batches = count(api.world, 'forms.batchUpdate');
  api.world.fake.failOn('forms.batchUpdate', { status: 500, googleStatus: 'INTERNAL', partialAfter: 1 });
  const partial = await api.confirm(confirmInput(partialDraft));
  assert.equal(partial.status, 502);
  assert.equal(partial.json.failure.outcome, 'partial');
  assert.equal(partial.json.draft.status, 'blocked');
  assert.equal(partial.json.draft.current.title, 'Registration 2027', 'the re-fetched partial snapshot is persisted');
  const calls = api.world.fake.calls.length;
  assert.equal((await api.confirm(confirmInput(partialDraft))).status, 502);
  assert.equal(api.world.fake.calls.length, calls);
  assert.equal(count(api.world, 'forms.batchUpdate'), batches + 1);
}));

test('a lost successful batch response is reconciled and a transient verification read is safely retried', async () => {
  await withApi({}, async api => {
    const lost = await makeProposal(api);
    api.world.fake.failOn('forms.batchUpdate', { applyThenDrop: true });
    const response = await api.confirm(confirmInput(lost));
    assert.equal(response.status, 200, response.text);
    assert.equal(response.json.draft.status, 'applied');
    const callsAfterLost = api.world.fake.calls.length;
    assert.equal((await api.confirm(confirmInput(lost))).status, 200);
    assert.equal(api.world.fake.calls.length, callsAfterLost);
  });
  await withApi({}, async api => {
    const proposal = await makeProposal(api);
    const batches = count(api.world, 'forms.batchUpdate');
    const reads = count(api.world, 'forms.get');
    api.world.fake.failOn('forms.get', { network: true }, 1); // pre-write read works; first verify read fails
    const result = await api.confirm(confirmInput(proposal));
    assert.equal(result.status, 200, result.text);
    assert.equal(result.json.draft.status, 'applied');
    assert.equal(count(api.world, 'forms.batchUpdate'), batches + 1);
    assert.equal(count(api.world, 'forms.get'), reads + 3);
  });
});

test('a known rejected update needs a new version and simultaneous confirms cause no duplicate batch', async () => {
  await withApi({}, async api => {
    const proposal = await makeProposal(api);
    const batches = count(api.world, 'forms.batchUpdate');
    api.world.fake.failOn('forms.batchUpdate', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'rejected' });
    const rejected = await api.confirm(confirmInput(proposal));
    assert.equal(rejected.status, 502);
    assert.equal(rejected.json.failure.outcome, 'not_applied');
    assert.equal(rejected.json.draft.status, 'ready');
    assert.equal(rejected.json.draft.version, 2);
    assert.equal((await api.confirm(confirmInput(proposal))).status, 409);
    assert.equal(count(api.world, 'forms.batchUpdate'), batches + 1);
  });
  await withApi({}, async api => {
    const proposal = await makeProposal(api);
    const batches = count(api.world, 'forms.batchUpdate');
    const results = await Promise.all([api.confirm(confirmInput(proposal)), api.confirm(confirmInput(proposal))]);
    assert.ok(results.every(result => result.status === 200 || result.status === 409));
    assert.equal(count(api.world, 'forms.batchUpdate'), batches + 1);
  });
});

// Ownership, capabilities and UI-facing errors

test('Intake records and edit drafts are scoped to the authenticated session user', () => withApi({}, async api => {
  const reads = count(api.world, 'forms.get');
  api.people.current = { id: 'user-b', email: 'bob@example.test', name: 'Bob' };
  const hidden = await api.inspect();
  assert.equal(hidden.status, 404);
  assert.equal(hidden.json.code, 'form_not_found');
  assert.equal(count(api.world, 'forms.get'), reads);
  api.people.current = USER_A;
  const proposal = await makeProposal(api);
  api.people.current = { id: 'user-b', email: 'bob@example.test', name: 'Bob' };
  assert.equal((await api.getDraft(proposal.id)).status, 404);
  assert.equal((await api.confirm(confirmInput(proposal))).status, 404);
  api.people.current = USER_A;
  assert.ok(await api.drafts.get('user-a', proposal.id));
  assert.equal(await api.drafts.get('user-b', proposal.id), null);
}));

test('auth, CSRF, malformed JSON and client-supplied identity are rejected before Google reads', () => withApi({}, async api => {
  const reads = count(api.world, 'forms.get');
  api.people.current = null;
  assert.equal((await api.inspect()).status, 401);
  api.people.current = USER_A;
  assert.equal((await api.inspect(undefined, { origin: 'https://attacker.example' })).status, 403);
  assert.equal((await api.call('POST', '/edit/inspect', { target: { formRecordId: RECORD_ID }, userId: 'user-b' })).status, 400);
  assert.equal((await api.call('POST', '/edit/interpret', '{broken', { raw: true })).status, 400);
  assert.equal(count(api.world, 'forms.get'), reads);
}));

test('a current Google connection must be bound to the account owning a saved Intake form', () => withApi({}, async api => {
  await api.world.store.deleteConnection('user-a', 'google');
  await api.world.connect('user-a', { externalAccountId: 'other-account' });
  const result = await api.inspect();
  assert.equal(result.status, 403);
  assert.equal(result.json.code, 'form_not_editable');
  assert.equal(count(api.world, 'forms.batchUpdate'), 1);
}));

test('clarification, unsupported requests, and model timeout do not save or mutate', () => withApi({
  interpret: (_input, n) => n === 1 ? clarification('Which question title should I change?') : n === 2
    ? unsupported('Quiz grading is not supported by the verified edit operations.')
    : Promise.reject(new InterpretationError('model_timeout', 'timeout')),
}, async api => {
  const target = { formRecordId: RECORD_ID };
  assert.equal((await api.interpret({ target, request: 'Change that.' })).json.status, 'needs_clarification');
  assert.equal((await api.interpret({ target, request: 'Change grading.' })).json.status, 'unsupported');
  const failed = await api.interpret({ target, request: 'Try again.' });
  assert.equal(failed.status, 504);
  assert.equal(failed.json.code, 'model_timeout');
  assert.equal(api.drafts.all().length, 0);
  assert.equal(count(api.world, 'forms.batchUpdate'), 1);
}));

test('quiz structure and section-routing controller changes are explicitly unsupported', async () => {
  await withApi({ interpret: input => ready('Remove a question', [{ type: 'delete_question', questionId: input.current.items.find(item => item.kind === 'question').questionId }]) }, async api => {
    api.world.fake.mutateForm(api.source.providerFormId, form => { form.isQuiz = true; });
    const response = await api.interpret({ target: { formRecordId: RECORD_ID }, request: 'Remove the first question.' });
    assert.equal(response.json.status, 'unsupported');
    assert.equal(api.drafts.all().length, 0);
  });
  const branching = form([
    { id: 'need', type: 'multiple_choice', title: 'Need accommodation?', required: true, options: ['Yes', 'No'] },
    { id: 'details', type: 'short_text', title: 'Accommodation details', required: true, visibility: { when: { question: 'need', equals: 'Yes' } } },
  ], { title: 'Branching form' });
  await withApi({ specification: branching, interpret: input => ready('Make the controller optional', [{
    type: 'update_question', questionId: input.current.items.find(item => item.title === 'Need accommodation?').questionId, changes: { required: false },
  }]) }, async api => {
    const response = await api.interpret({ target: { formRecordId: RECORD_ID }, request: 'Make the controller optional.' });
    assert.equal(response.json.status, 'unsupported');
    assert.match(response.json.explanation, /cannot be made optional/i);
    assert.equal(api.drafts.all().length, 0);
  });
});

test('one shared per-user interpretation limiter applies to edit requests', () => withApi({ limiter: createInterpretationLimiter({ limit: 1 }) }, async api => {
  const target = { formRecordId: RECORD_ID };
  assert.equal((await api.interpret({ target, request: 'Rename it.' })).status, 201);
  const blocked = await api.interpret({ target, request: 'Add something.' });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.json.code, 'rate_limited');
  assert.equal(api.inputs.length, 1);
}));

test('Microsoft editing refuses without an undocumented endpoint and draft discard never mutates Google', async () => {
  await withApi({}, async api => {
    const parsed = parseFormSpecification(defaultSpec());
    await api.formStore.save({ id: 'microsoft-record-01', userId: 'user-a', provider: 'microsoft', externalAccountId: 'ms-account',
      providerFormId: 'microsoft-form-01', title: 'Microsoft survey', status: 'created', editUrl: null, responderUrl: null,
      failureStage: null, requestId: 'req_ms', specification: parsed.specification, specificationVersion: SPEC_VERSION }, api.world.now());
    const response = await api.inspect({ formRecordId: 'microsoft-record-01' });
    assert.equal(response.status, 422);
    assert.equal(response.json.code, 'edit_unsupported');
    assert.equal(api.world.providers().microsoft.capabilities.editForm, false);
    assert.match(api.world.providers().microsoft.capabilities.editNote, /does not publish a supported Forms update API/);
  });
  await withApi({}, async api => {
    const proposal = await makeProposal(api);
    const original = structuredClone(api.world.fake.forms.get(api.source.providerFormId));
    assert.equal((await api.discard(proposal.id)).status, 204);
    assert.equal(await api.drafts.get('user-a', proposal.id), null);
    assert.deepEqual(api.world.fake.forms.get(api.source.providerFormId), original);
    assert.equal(count(api.world, 'forms.batchUpdate'), 1);
  });
});
