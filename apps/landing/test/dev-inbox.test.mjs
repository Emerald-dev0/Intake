import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDevRouter } from '../server/dev/routes.ts';
import { DevService } from '../server/dev/service.ts';
import { createMemoryDevStore } from '../server/dev/memory-store.ts';
import { emptyDefinition } from '../server/dev/validation.ts';

/**
 * The response inbox.
 *
 * The counts are exact and the export matches what is on screen, and the answers are readable by
 * the account that owns the form and by nobody else.
 */

let server;
let baseUrl;
let store;
let service;
let formId;

const OWNER = 'user_owner';
const STRANGER = 'user_stranger';

const DEFINITION = {
  ...emptyDefinition(),
  fields: [
    { id: 'email', type: 'email', label: 'Email', description: null, required: true, options: [], placeholder: null },
    { id: 'note', type: 'short_text', label: 'Note', description: null, required: false, options: [], placeholder: null },
  ],
};

async function call(path, { method = 'GET', userId = OWNER, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, { method, headers: { 'x-test-user': userId, ...headers } });
  const text = await response.text();
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, body: json, text };
}

before(async () => {
  store = createMemoryDevStore();
  service = new DevService({ store, now: () => new Date('2026-10-29T00:00:00.000Z') });

  const project = await service.createProject(OWNER, { name: 'Checkout app' });
  const detail = await service.createForm(OWNER, project.id, { name: 'Waitlist' });
  formId = detail.form.id;
  await service.saveDefinition(OWNER, formId, DEFINITION);
  await service.publish(OWNER, formId);

  const submissions = [
    { email: 'ada@example.com', note: 'we use it for checkout' },
    { email: 'grace@example.com', note: '=cmd|calc' },
    { email: 'alan@example.com', note: 'nothing to say' },
  ];
  for (const answers of submissions) {
    await store.createSubmission({
      id: `sub_${answers.email.split('@')[0]}`,
      formId,
      formVersionId: detail.draftVersion.id,
      projectId: project.id,
      answers,
      source: {},
      idempotencyKey: null,
      submittedAt: new Date('2026-10-29T00:00:00.000Z'),
    });
  }

  // The counters are written by the public endpoint when an answer is accepted or refused.
  await store.recordUsage({ projectId: project.id, accepted: 3, bytes: 240, day: new Date('2026-10-29T00:00:00.000Z') });

  const app = express();
  app.use('/api/dev', createDevRouter({
    service,
    store,
    // The session is resolved per request, the way the real one is.
    getSession: async req => {
      const id = req.headers['x-test-user'];
      return id ? { id: String(id), email: `${String(id)}@example.com`, name: 'Test' } : null;
    },
  }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dev`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('the owner sees every answer, and the count is exact', async () => {
  const response = await call(`/forms/${formId}/submissions`);
  assert.equal(response.status, 200);
  assert.equal(response.body.total, 3);
  assert.equal(response.body.items.length, 3);
  assert.ok(response.body.perDay.length >= 1, 'the answers are counted per day');
  assert.equal(response.body.perDay[0].count, 3);
});

test('somebody else gets nothing, and is not told the answers exist', async () => {
  const response = await call(`/forms/${formId}/submissions`, { userId: STRANGER });
  assert.equal(response.status, 404);
});

test('the list pages', async () => {
  const first = await call(`/forms/${formId}/submissions?limit=2&offset=0`);
  assert.equal(first.body.items.length, 2);
  assert.equal(first.body.total, 3, 'the total is the whole set, not the page');

  const second = await call(`/forms/${formId}/submissions?limit=2&offset=2`);
  assert.equal(second.body.items.length, 1);
  const firstIds = first.body.items.map(item => item.id);
  const secondIds = second.body.items.map(item => item.id);
  assert.ok(!firstIds.some(id => secondIds.includes(id)), 'the pages do not overlap');
});

test('a search finds the answer that mentions the word', async () => {
  const response = await call(`/forms/${formId}/submissions?q=grace`);
  assert.equal(response.body.total, 1);
  assert.equal(response.body.items[0].answers.email, 'grace@example.com');
});

test('the export has the questions as its columns and one row per answer', async () => {
  const response = await call(`/forms/${formId}/submissions.csv`);
  assert.equal(response.status, 200);
  const lines = response.text.trim().split('\r\n');
  assert.equal(lines[0], 'Submitted at,Email,Note', 'the columns are the questions, in order');
  assert.equal(lines.length, 4, 'a header and three answers');

  // A value that a spreadsheet would treat as a formula is neutralised before it lands in the file.
  const dangerous = lines.find(line => line.includes('grace@example.com'));
  assert.match(dangerous, /'=cmd\|calc/, 'a value a spreadsheet would run is neutralised');
});

test('one answer can be read on its own', async () => {
  const list = await call(`/forms/${formId}/submissions`);
  const id = list.body.items[0].id;
  const response = await call(`/submissions/${id}`);
  assert.equal(response.status, 200);
  assert.equal(response.body.submission.id, id);
  assert.equal(response.body.form.id, formId);
});

test('an answer cannot be read by another account', async () => {
  const list = await call(`/forms/${formId}/submissions`);
  const id = list.body.items[0].id;
  const response = await call(`/submissions/${id}`, { userId: STRANGER });
  assert.equal(response.status, 404);
});

test('the usage counters count what was accepted and what was refused', async () => {
  const response = await call('/usage');
  assert.equal(response.status, 200);
  assert.equal(response.body.windowDays, 30);
  const row = response.body.projects.find(project => project.slug === 'checkout-app');
  assert.ok(row, 'the project is in the usage');
  assert.equal(row.accepted, 3, 'three answers were accepted');
  assert.equal(row.rejected, 0);
  assert.ok(row.bytes > 0, 'the bytes stored are counted');
  assert.equal(response.body.totals.accepted, 3);
});

test('the usage of one account does not include another account', async () => {
  const response = await call('/usage', { userId: STRANGER });
  assert.equal(response.status, 200);
  assert.equal(response.body.projects.length, 0);
  assert.equal(response.body.totals.accepted, 0);
});
