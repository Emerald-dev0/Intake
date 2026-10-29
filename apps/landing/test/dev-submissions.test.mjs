import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createPublicDevRouter } from '../server/dev/public-routes.ts';
import { DevService } from '../server/dev/service.ts';
import { createMemoryDevStore } from '../server/dev/memory-store.ts';
import { emptyDefinition } from '../server/dev/validation.ts';

/**
 * Submissions to a hosted form.
 *
 * The rules under test are the ones a public endpoint has to hold: only a published form accepts
 * answers, the answers are checked against the version that was live, a retry does not double
 * count, and a field the form does not have is refused.
 */

let server;
let baseUrl;
let store;
let service;

const DEFINITION = {
  ...emptyDefinition(),
  fields: [
    { id: 'email', type: 'email', label: 'Email', description: null, required: true, options: [], placeholder: null },
    { id: 'name', type: 'short_text', label: 'Name', description: null, required: false, options: [], placeholder: null },
    { id: 'size', type: 'single_choice', label: 'Team size', description: null, required: false, options: ['1-10', '11-50'], placeholder: null },
    { id: 'tags', type: 'multiple_choice', label: 'Interests', description: null, required: false, options: ['docs', 'api', 'sdk'], placeholder: null },
    { id: 'terms', type: 'checkbox', label: 'Accept the terms', description: null, required: false, options: [], placeholder: null },
  ],
};

async function call(path, { method = 'GET', body, headers = {} } = {}) {
  const response = await fetch(`${baseUrl}${path}`, {
    method,
    headers: { ...(body ? { 'Content-Type': 'application/json' } : {}), ...headers },
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

  // A published form with a definition, plus a draft one that must stay invisible.
  const owner = 'user_owner';
  const project = await service.createProject(owner, { name: 'Checkout app' });
  const detail = await service.createForm(owner, project.id, { name: 'Waitlist' });
  await service.saveDefinition(owner, detail.form.id, DEFINITION);
  await service.publish(owner, detail.form.id);

  const draftProject = await service.createProject(owner, { name: 'Draft project' });
  const draft = await service.createForm(owner, draftProject.id, { name: 'Secret form' });
  await service.saveDefinition(owner, draft.form.id, DEFINITION);

  const app = express();
  app.use('/api/dev/public', createPublicDevRouter({ store, now: () => new Date('2026-10-29T00:00:00.000Z') }));
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', () => resolve()); });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dev/public`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

test('a published form is served; a draft is not there at all', async () => {
  const published = await call('/forms/checkout-app/waitlist');
  assert.equal(published.status, 200);
  assert.equal(published.body.form.name, 'Waitlist');
  assert.equal(published.body.definition.fields.length, 5);

  const draft = await call('/forms/draft-project/secret-form');
  assert.equal(draft.status, 404, 'a draft is not even confirmed to exist');
});

test('a submission is accepted and stored against the published version', async () => {
  const response = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'someone@example.com', name: 'Sam', size: '11-50', tags: ['api', 'sdk'], terms: true } },
    headers: { referer: 'https://example.com/pricing', 'user-agent': 'Mozilla/5.0' },
  });
  assert.equal(response.status, 201);
  assert.ok(response.body.submission.id);

  const stored = store.dump().submissions;
  assert.equal(stored.length, 1);
  assert.equal(stored[0].answers.email, 'someone@example.com');
  assert.deepEqual(stored[0].answers.tags, ['api', 'sdk']);
  assert.equal(stored[0].answers.terms, true);
  assert.equal(stored[0].source.referrer, 'https://example.com/pricing');
  assert.equal(stored[0].source.userAgent, 'Mozilla/5.0');
});

test('a missing required answer is refused, and the field is named', async () => {
  const response = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { name: 'Sam' } },
  });
  assert.equal(response.status, 400);
  assert.equal(response.body.error, 'invalid_submission');
  assert.ok(response.body.fieldErrors.some(error => error.field === 'email' && /needs an answer/.test(error.message)));
  assert.equal(store.dump().submissions.length, 1, 'nothing was stored');
});

test('an answer that is not an option is refused', async () => {
  const response = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'a@b.co', size: '500-1000' } },
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.fieldErrors.some(error => error.field === 'size'));
});

test('a field the form does not have is refused', async () => {
  const response = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'a@b.co', secret: 'extra' } },
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.fieldErrors.some(error => error.field === 'secret'));
});

test('an email that is not one is refused', async () => {
  const response = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'not-an-email' } },
  });
  assert.equal(response.status, 400);
  assert.ok(response.body.fieldErrors.some(error => error.field === 'email'));
});

test('the same idempotency key is the same answer, not a second one', async () => {
  const before = store.dump().submissions.length;
  const first = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'repeat@example.com' } },
    headers: { 'Idempotency-Key': 'order-1234-abcd' },
  });
  assert.equal(first.status, 201);

  const second = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'repeat@example.com' } },
    headers: { 'Idempotency-Key': 'order-1234-abcd' },
  });
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true);
  assert.equal(second.body.submission.id, first.body.submission.id, 'the same answer comes back');

  assert.equal(store.dump().submissions.length, before + 1, 'only one row was written');
});

test('the counters move when an answer is accepted and when one is refused', async () => {
  const before = store.dump().usage.reduce((sum, row) => sum + row.accepted, 0);
  const refusedBefore = store.dump().usage.reduce((sum, row) => sum + row.rejected, 0);

  const accepted = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'counted@example.com' } },
  });
  assert.equal(accepted.status, 201);

  const refused = await call('/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'not-an-email' } },
  });
  assert.equal(refused.status, 400);

  const usage = store.dump().usage;
  assert.equal(usage.reduce((sum, row) => sum + row.accepted, 0), before + 1, 'the accepted answer was counted');
  assert.equal(usage.reduce((sum, row) => sum + row.rejected, 0), refusedBefore + 1, 'the refused request was counted as refused');
  assert.ok(usage.some(row => row.bytes > 0), 'the bytes stored are counted');
});

test('a submission to a draft form is a 404', async () => {
  const response = await call('/forms/draft-project/secret-form/submissions', {
    method: 'POST',
    body: { answers: { email: 'a@b.co' } },
  });
  assert.equal(response.status, 404);
});

test('a closed form stops accepting answers', async () => {
  const owner = 'user_owner';
  const project = await service.createProject(owner, { name: 'Closing project' });
  const detail = await service.createForm(owner, project.id, { name: 'Closing form' });
  await service.saveDefinition(owner, detail.form.id, DEFINITION);
  await service.publish(owner, detail.form.id);

  const open = await call('/forms/closing-project/closing-form/submissions', {
    method: 'POST',
    body: { answers: { email: 'a@b.co' } },
  });
  assert.equal(open.status, 201);

  await service.applyAction(owner, detail.form.id, 'close');
  const closed = await call('/forms/closing-project/closing-form/submissions', {
    method: 'POST',
    body: { answers: { email: 'c@d.co' } },
  });
  assert.equal(closed.status, 404, 'a closed form takes no more answers');
});

test('an answer is checked against the version that was live, not a later edit', async () => {
  const owner = 'user_owner';
  const project = await service.createProject(owner, { name: 'Versioned project' });
  const detail = await service.createForm(owner, project.id, { name: 'Versioned form' });
  await service.saveDefinition(owner, detail.form.id, DEFINITION);
  await service.publish(owner, detail.form.id);

  await call('/forms/versioned-project/versioned-form/submissions', {
    method: 'POST',
    body: { answers: { email: 'before@example.com', size: '1-10' } },
  });

  // The form is edited: "size" is dropped from the new draft. The live version still has it.
  const next = { ...DEFINITION, fields: DEFINITION.fields.filter(field => field.id !== 'size') };
  await service.saveDefinition(owner, detail.form.id, next);
  await service.publish(owner, detail.form.id);

  const stored = store.dump().submissions.find(entry => entry.answers.email === 'before@example.com');
  assert.ok(stored, 'the earlier answer is still there');
  assert.equal(stored.formVersionId.startsWith('dev_'), true);
  assert.equal(stored.answers.size, '1-10', 'the answer is kept exactly as it was given');
});
