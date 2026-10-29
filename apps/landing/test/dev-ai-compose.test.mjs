import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDevRouter } from '../server/dev/routes.ts';
import { DevService } from '../server/dev/service.ts';
import { createMemoryDevStore } from '../server/dev/memory-store.ts';
import { createAiOperationRunner } from '../server/ai/operations.ts';
import { createCreditService } from '../server/credits/service.ts';
import { createMemoryCreditStore } from '../server/credits/ledger.ts';
import { costForFormCreation } from '../server/credits/pricing.ts';
import { proposalToFields, readProposal } from '../server/dev/compose.ts';
import { DEV_FORM_TEMPLATES } from '../src/lib/dev-templates.ts';

/**
 * Writing the questions of a hosted form from one sentence.
 *
 * The rules under test are the ones that cost money and the ones that keep the developer in
 * control: it goes through the one credit service, the price list decides the cost, a model
 * failure or a clarifying question costs nothing, a retried proposal lands on the same form,
 * and the form that comes out is a draft the developer reads before anything is published.
 */

let server;
let baseUrl;
let store;
let service;
let creditStore;
let credits;
let projectId;
let modelCalls;

const READY_PROPOSAL = {
  status: 'ready',
  title: 'Beta application',
  description: 'Tell us about your product.',
  fields: [
    { label: 'Your name', description: '', type: 'short_text', required: true, options: [] },
    { label: 'Email address', description: '', type: 'email', required: true, options: [] },
    { label: 'Team size', description: 'Roughly how many people?', type: 'single_choice', required: false, options: ['Just me', '2-10', 'More'] },
  ],
  reply: 'Here are the three questions your form asks.',
};

/** A model that answers with something fixed, and records what it was asked. */
const workingModel = {
  async propose(input) {
    modelCalls.push(input);
    return READY_PROPOSAL;
  },
};

const clarifyingModel = {
  async propose(input) {
    modelCalls.push(input);
    if (!input.clarification) return { status: 'needs_clarification', question: 'Which team sizes should the list have?' };
    return READY_PROPOSAL;
  },
};

const unsupportedModel = {
  async propose() {
    return { status: 'unsupported', explanation: 'A hosted form cannot take a file upload.' };
  },
};

const failingModel = {
  async propose() {
    throw Object.assign(new Error('the model did not answer'), { code: 'model_unavailable' });
  },
};

async function call(path, { method = 'POST', body, userId = 'user_owner' } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { 'Content-Type': 'application/json', 'x-test-user': userId },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, body: json };
}

/** A server whose composer answers with the given model. */
async function serverWith(model, creditService = credits) {
  const app = express();
  app.use('/api/dev', createDevRouter({
    service,
    store,
    getSession: async req => {
      const id = req.headers['x-test-user'];
      return id ? { id: String(id), email: `${String(id)}@example.com`, name: 'Test' } : null;
    },
    compose: { runner: createAiOperationRunner({ credits: creditService }), model },
  }));
  const listener = await new Promise(resolve => { const server = app.listen(0, '127.0.0.1', () => resolve(server)); });
  return { listener, url: `http://127.0.0.1:${listener.address().port}/api/dev` };
}

before(async () => {
  store = createMemoryDevStore();
  service = new DevService({ store, now: () => new Date('2026-10-29T00:00:00.000Z') });
  creditStore = createMemoryCreditStore();
  credits = createCreditService({ store: creditStore, now: () => new Date('2026-10-29T00:00:00.000Z') });

  const project = await service.createProject('user_owner', { name: 'Checkout app' });
  projectId = project.id;

  const app = express();
  app.use('/api/dev', createDevRouter({
    service,
    store,
    getSession: async req => {
      const id = req.headers['x-test-user'];
      return id ? { id: String(id), email: `${String(id)}@example.com`, name: 'Test' } : null;
    },
    compose: { runner: createAiOperationRunner({ credits }), model: workingModel },
  }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dev`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('one sentence becomes a draft form with the questions the model wrote', async () => {
  modelCalls = [];
  const response = await call(`/projects/${projectId}/forms/propose`, {
    body: { request: 'a sign-up form for our design partners' },
  });

  assert.equal(response.status, 201);
  assert.equal(response.body.status, 'ready');
  assert.equal(response.body.form.form.name, 'Beta application');
  assert.equal(response.body.form.form.status, 'draft', 'the form is a draft until the developer publishes it');
  assert.equal(response.body.reply, 'Here are the three questions your form asks.');

  const fields = response.body.form.draftVersion.definition.fields;
  assert.deepEqual(fields.map(field => field.label), ['Your name', 'Email address', 'Team size']);
  assert.deepEqual(fields.map(field => field.type), ['short_text', 'email', 'single_choice']);
  assert.deepEqual(fields[2].options, ['Just me', '2-10', 'More']);
  assert.equal(fields[0].required, true);
  assert.equal(fields[2].required, false);
  // The identifiers are the server's, not the model's.
  assert.deepEqual(fields.map(field => field.id), ['your-name', 'email-address', 'team-size']);
});

test('it costs the price list, and says what it cost', async () => {
  const response = await call(`/projects/${projectId}/forms/propose`, {
    body: { request: 'another form for the same product' },
  });
  assert.equal(response.body.cost.credits, costForFormCreation({ questionCount: 3, conditionalCount: 0 }));
  assert.equal(response.body.cost.status, 'charged');
});

test('the model is given the sentence and nothing else', async () => {
  modelCalls = [];
  await call(`/projects/${projectId}/forms/propose`, { body: { request: 'ask about our uptime' } });
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].request, 'ask about our uptime');
  assert.equal(modelCalls[0].clarification, undefined);
});

test('a clarifying question costs nothing, and the answer finishes the job', async () => {
  const { listener, url } = await serverWith(clarifyingModel);
  try {
    const first = await fetch(`${url}/projects/${projectId}/forms/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user_owner' },
      body: JSON.stringify({ request: 'ask how big our teams are' }),
    });
    const firstBody = await first.json();
    assert.equal(first.status, 200);
    assert.equal(firstBody.status, 'needs_clarification');
    assert.match(firstBody.question, /team sizes/i);
    assert.equal(firstBody.cost.credits, 0);
    assert.equal(firstBody.cost.status, 'not_charged');

    const second = await fetch(`${url}/projects/${projectId}/forms/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user_owner' },
      body: JSON.stringify({ request: 'ask how big our teams are', clarification: 'Just me, 2-10, more' }),
    });
    const secondBody = await second.json();
    assert.equal(second.status, 201);
    assert.equal(secondBody.status, 'ready');
    assert.equal(secondBody.cost.status, 'charged');
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});

test('a request the hosted form cannot do costs nothing and says why', async () => {
  const { listener, url } = await serverWith(unsupportedModel);
  try {
    const response = await fetch(`${url}/projects/${projectId}/forms/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user_owner' },
      body: JSON.stringify({ request: 'a form that takes a logo upload' }),
    });
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.equal(body.status, 'unsupported');
    assert.match(body.explanation, /file upload/i);
    assert.equal(body.cost.credits, 0);
    assert.equal(body.cost.status, 'not_charged');
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
});

test('a model failure costs nothing and writes no form', async () => {
  const before = (await service.listForms('user_owner', projectId)).length;
  const { listener, url } = await serverWith(failingModel);
  try {
    const response = await fetch(`${url}/projects/${projectId}/forms/propose`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-test-user': 'user_owner' },
      body: JSON.stringify({ request: 'a form that will never be written' }),
    });
    const body = await response.json();
    assert.equal(response.status, 502);
    assert.match(body.message, /No credits were spent/);
  } finally {
    await new Promise(resolve => listener.close(resolve));
  }
  const after = (await service.listForms('user_owner', projectId)).length;
  assert.equal(after, before, 'no form was written');
});

test('the same proposal twice is one form and one charge', async () => {
  const body = { request: 'a form that gets retried', operationId: 'retry_test_operation_key' };
  const first = await call(`/projects/${projectId}/forms/propose`, { body });
  assert.equal(first.status, 201);
  const second = await call(`/projects/${projectId}/forms/propose`, { body });
  assert.equal(second.status, 200);
  assert.equal(second.body.form.form.id, first.body.form.form.id, 'the retry lands on the same form');
  assert.equal(second.body.cost.status, 'already_charged');
  assert.equal(second.body.cost.credits, costForFormCreation({ questionCount: 3, conditionalCount: 0 }));

  const matching = (await service.listForms('user_owner', projectId)).filter(form => form.sourceOperationKey === 'retry_test_operation_key');
  assert.equal(matching.length, 1, 'there is one form, not two');
});

test('somebody else\'s project is not found, and no model is called', async () => {
  modelCalls = [];
  const other = await service.createProject('user_other', { name: 'Not yours' });
  const response = await call(`/projects/${other.id}/forms/propose`, {
    body: { request: 'a form in somebody else\'s project' },
    userId: 'user_owner',
  });
  assert.equal(response.status, 404);
  assert.equal(modelCalls.length, 0, 'the model was not called');
});

test('an empty sentence is refused before anything happens', async () => {
  const response = await call(`/projects/${projectId}/forms/propose`, { body: { request: '   ' } });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'invalid_request');
});

test('the proposal is recorded as an operation, with what it cost', async () => {
  const usage = await creditStore.usage('user_owner');
  const operations = usage.filter(entry => entry.operationType === 'form_create');
  assert.ok(operations.length > 0, 'the ledger has the operation');
  assert.ok(operations.some(entry => entry.outcome === 'succeeded' && entry.creditCost > 0));
});

test('the words the model wrote are read strictly', () => {
  assert.throws(() => readProposal({ status: 'ready' }), /model_invalid_output|could not read/);
  assert.throws(() => readProposal({ status: 'unknown' }), /model_invalid_output|could not read/);
  assert.throws(() => readProposal({ status: 'ready', title: 'x', fields: [] }), /model_invalid_output|could not read/);
  const parsed = readProposal(READY_PROPOSAL);
  assert.equal(parsed.status, 'ready');
  assert.equal(parsed.title, 'Beta application');
});

test('two questions with the same label do not share an identifier', () => {
  const fields = proposalToFields([
    { label: 'Your name', description: '', type: 'short_text', required: true, options: [] },
    { label: 'Your name', description: '', type: 'short_text', required: false, options: [] },
  ]);
  assert.notEqual(fields[0].id, fields[1].id);
  assert.match(fields[1].id, /^your-name_2$/);
});

test('the starter templates are sentences, and none of them asks for a password', () => {
  assert.ok(DEV_FORM_TEMPLATES.length >= 8, 'there are enough starters to be useful');
  const labels = DEV_FORM_TEMPLATES.map(template => template.label);
  for (const expected of ['Waitlist', 'Feedback', 'Contact', 'Sign-in']) {
    assert.ok(labels.includes(expected), `${expected} is one of the starters`);
  }
  const ids = DEV_FORM_TEMPLATES.map(template => template.id);
  assert.equal(new Set(ids).size, ids.length, 'no two starters share an identifier');
  for (const template of DEV_FORM_TEMPLATES) {
    assert.ok(template.prompt.trim().length > 10, `${template.id} has a real sentence`);
    assert.ok(template.prompt.length <= 300, `${template.id} is a sentence, not a paragraph`);
    assert.doesNotMatch(template.prompt, /password/i, `${template.id} does not ask for a password`);
  }
});
