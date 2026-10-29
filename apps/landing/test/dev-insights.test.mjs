import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDevRouter } from '../server/dev/routes.ts';
import { DevService } from '../server/dev/service.ts';
import { createMemoryDevStore } from '../server/dev/memory-store.ts';
import { createAiOperationRunner } from '../server/ai/operations.ts';
import { createCreditService } from '../server/credits/service.ts';
import { createMemoryCreditStore } from '../server/credits/ledger.ts';
import { DEV_INSIGHTS_COST } from '../server/credits/pricing.ts';
import { emptyDefinition } from '../server/dev/validation.ts';

/**
 * The AI summary of a form's answers.
 *
 * The rules under test are the ones that cost money: it goes through the one credit service, it
 * charges the price list, a model failure costs nothing, and the same answers are never charged
 * twice. The counts beside the summary are counted from the rows, not taken from the model.
 */

let server;
let baseUrl;
let store;
let service;
let creditStore;
let credits;
let formId;
let modelCalls;
let lastPrompt;

const DEFINITION = {
  ...emptyDefinition(),
  fields: [
    { id: 'email', type: 'email', label: 'Email', description: null, required: true, options: [], placeholder: null },
    { id: 'why', type: 'long_text', label: 'Why did you sign up', description: null, required: false, options: [], placeholder: null },
    { id: 'size', type: 'single_choice', label: 'Team size', description: null, required: false, options: ['1-10', '11-50'], placeholder: null },
  ],
};

/** A model that answers with something fixed, and records what it was asked. */
const workingModel = {
  async summarize(input) {
    modelCalls.push(input);
    return {
      summary: 'People mostly talk about pricing.',
      highlights: ['Pricing comes up again and again.'],
      caveats: [`Read ${input.answers.length} of ${input.totalAnswers} answers.`],
    };
  },
};

const failingModel = {
  async summarize() {
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

before(async () => {
  store = createMemoryDevStore();
  service = new DevService({ store, now: () => new Date('2026-10-29T00:00:00.000Z') });
  creditStore = createMemoryCreditStore();
  credits = createCreditService({ store: creditStore, now: () => new Date('2026-10-29T00:00:00.000Z') });

  const project = await service.createProject('user_owner', { name: 'Checkout app' });
  const detail = await service.createForm('user_owner', project.id, { name: 'Waitlist' });
  formId = detail.form.id;
  await service.saveDefinition('user_owner', formId, DEFINITION);
  await service.publish('user_owner', formId);

  for (const [index, answers] of [
    { email: 'ada@example.com', why: 'we need pricing for checkout', size: '1-10' },
    { email: 'grace@example.com', why: 'pricing again, please', size: '11-50' },
  ].entries()) {
    await store.createSubmission({
      id: `sub_${index}`,
      formId,
      formVersionId: detail.draftVersion.id,
      projectId: project.id,
      answers,
      source: {},
      idempotencyKey: null,
      submittedAt: new Date(`2026-10-29T0${index + 1}:00:00.000Z`),
    });
  }

  const app = express();
  app.use('/api/dev', createDevRouter({
    service,
    getSession: async req => {
      const id = req.headers['x-test-user'];
      return id ? { id: String(id), email: `${String(id)}@example.com`, name: 'Test' } : null;
    },
    insights: { runner: createAiOperationRunner({ credits }), model: workingModel, cost: DEV_INSIGHTS_COST },
  }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dev`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('a summary costs the price list and says what it cost', async () => {
  modelCalls = [];
  const response = await call(`/forms/${formId}/insights`);
  assert.equal(response.status, 200);
  assert.equal(response.body.cost.credits, DEV_INSIGHTS_COST);
  assert.equal(response.body.cost.status, 'charged');
  assert.equal(response.body.answersTotal, 2);
  assert.equal(response.body.answersRead, 2);
});

test('the counts beside the summary are counted from the rows', async () => {
  modelCalls = [];
  const response = await call(`/forms/${formId}/insights`);
  assert.equal(response.body.statistics.totalResponses, 2);
  const size = response.body.statistics.questions.find(question => question.id === 'size');
  assert.deepEqual(size.choices.sort((a, b) => a.label.localeCompare(b.label)), [
    { label: '1-10', count: 1 },
    { label: '11-50', count: 1 },
  ]);
});

test('the model is given this form\'s answers and nothing else', async () => {
  modelCalls = [];
  await call(`/forms/${formId}/insights`);
  assert.equal(modelCalls.length, 1);
  const input = modelCalls[0];
  assert.equal(input.totalAnswers, 2);
  assert.deepEqual(input.questions.map(question => question.id), ['email', 'why', 'size']);
  // Nothing about the account, and no other form.
  assert.equal(JSON.stringify(input).includes('user_owner'), false);
  assert.equal(JSON.stringify(input).includes('Checkout app'), false);
});

test('a model failure costs nothing', async () => {
  const failingApp = express();
  failingApp.use('/api/dev', createDevRouter({
    service,
    getSession: async () => ({ id: 'user_owner', email: 'user_owner@example.com', name: 'Test' }),
    insights: { runner: createAiOperationRunner({ credits: createCreditService({ store: createMemoryCreditStore() }) }), model: failingModel, cost: DEV_INSIGHTS_COST },
  }));
  const local = await new Promise(resolve => { const listener = failingApp.listen(0, '127.0.0.1', () => resolve(listener)); });
  const response = await fetch(`http://127.0.0.1:${local.address().port}/api/dev/forms/${formId}/insights`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
  });
  const body = await response.json();
  await new Promise(resolve => local.close(resolve));

  assert.equal(response.status, 502);
  assert.match(body.message, /No credits were spent/);
});

test('the same answers are not charged twice', async () => {
  // A form of its own, so the first summary here has not been paid for yet.
  const project = await service.createProject('user_owner', { name: 'Fresh project' });
  const detail = await service.createForm('user_owner', project.id, { name: 'Fresh form' });
  await service.saveDefinition('user_owner', detail.form.id, DEFINITION);
  await service.publish('user_owner', detail.form.id);
  await store.createSubmission({
    id: 'sub_fresh',
    formId: detail.form.id,
    formVersionId: detail.draftVersion.id,
    projectId: project.id,
    answers: { email: 'fresh@example.com', why: 'pricing', size: '1-10' },
    source: {},
    idempotencyKey: null,
    submittedAt: new Date('2026-10-29T09:00:00.000Z'),
  });

  const first = await call(`/forms/${detail.form.id}/insights`);
  assert.equal(first.body.cost.status, 'charged');
  const second = await call(`/forms/${detail.form.id}/insights`);
  assert.equal(second.body.cost.status, 'already_charged', 'the same answers cost nothing the second time');
  assert.equal(second.body.cost.credits, DEV_INSIGHTS_COST);
});

test('somebody else cannot summarise your answers', async () => {
  const response = await call(`/forms/${formId}/insights`, { userId: 'user_stranger' });
  assert.equal(response.status, 404);
});

test('a form with no answers has nothing to summarise', async () => {
  const project = await service.createProject('user_owner', { name: 'Quiet project' });
  const detail = await service.createForm('user_owner', project.id, { name: 'Quiet form' });
  await service.saveDefinition('user_owner', detail.form.id, DEFINITION);
  await service.publish('user_owner', detail.form.id);

  const response = await call(`/forms/${detail.form.id}/insights`);
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'no_answers');
});
