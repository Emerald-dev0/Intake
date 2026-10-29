import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDevRouter } from '../server/dev/routes.ts';
import { createPublicDevRouter } from '../server/dev/public-routes.ts';
import { DevService } from '../server/dev/service.ts';
import { createMemoryDevStore } from '../server/dev/memory-store.ts';
import { createDevNotifier } from '../server/dev/notifications.ts';
import { emptyDefinition } from '../server/dev/validation.ts';

/**
 * Notifications about new answers.
 *
 * The rules under test: nothing is sent until somebody opts in, one notice covers a threshold of
 * answers rather than one notice per answer, the same notice is never sent twice, and no email is
 * ever written to a respondent.
 */

let server;
let baseUrl;
let store;
let service;
let sent;
let formId;
let projectId;

const DEFINITION = {
  ...emptyDefinition(),
  fields: [{ id: 'email', type: 'email', label: 'Email', description: null, required: true, options: [], placeholder: null }],
};

async function call(path, { method = 'GET', body, userId = 'user_owner' } = {}) {
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

  const project = await service.createProject('user_owner', { name: 'Checkout app' });
  projectId = project.id;
  const detail = await service.createForm('user_owner', project.id, { name: 'Waitlist' });
  formId = detail.form.id;
  await service.saveDefinition('user_owner', formId, DEFINITION);
  await service.publish('user_owner', formId);

  sent = [];
  const notifier = createDevNotifier({
    store,
    emails: {
      async send(request) {
        sent.push(request);
        return { status: 'sent', messageId: `m_${sent.length}` };
      },
    },
    user: async userId => (userId === 'user_owner' ? { id: userId, email: 'owner@example.com', name: 'Owner' } : null),
    publicOrigin: 'https://intake.test',
    now: () => new Date('2026-10-29T00:00:00.000Z'),
  });

  const app = express();
  app.use('/api/dev/public', createPublicDevRouter({ store, notify: input => notifier.answersReceived(input) }));
  app.use('/api/dev', createDevRouter({
    service,
    store,
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

test('the preference is off until somebody asks for it', async () => {
  const response = await call(`/projects/${projectId}/notifications`);
  assert.equal(response.status, 200);
  assert.equal(response.body.mode, 'off');
});

test('an answer arrives and nothing is sent, because nobody asked', async () => {
  sent = [];
  const response = await call('/public/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'someone@example.com' } },
  });
  assert.equal(response.status, 201);
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(sent.length, 0, 'no email without an opt-in');
});

test('a preference can be set, and it is per account', async () => {
  const response = await call(`/projects/${projectId}/notifications`, {
    method: 'PUT',
    body: { mode: 'threshold', threshold: 3 },
  });
  assert.equal(response.status, 200);
  assert.equal(response.body.mode, 'threshold');
  assert.equal(response.body.threshold, 3);

  const other = await call(`/projects/${projectId}/notifications`, { userId: 'user_stranger' });
  assert.equal(other.status, 404, 'somebody else cannot even see the preference');
});

test('a bad preference is refused with a sentence', async () => {
  const response = await call(`/projects/${projectId}/notifications`, {
    method: 'PUT',
    body: { mode: 'whenever', threshold: 3 },
  });
  assert.equal(response.status, 400);
  assert.match(response.body.message, /off, every N answers, or a daily digest/);
});

test('the threshold is reached, and one notice covers the answers', async () => {
  sent = [];
  for (let index = 0; index < 3; index += 1) {
    const response = await call('/public/forms/checkout-app/waitlist/submissions', {
      method: 'POST',
      body: { answers: { email: `person${index}@example.com` } },
    });
    assert.equal(response.status, 201);
  }
  await new Promise(resolve => setTimeout(resolve, 60));

  assert.equal(sent.length, 1, 'three answers, one notice — not one notice per answer');
  assert.equal(sent[0].type, 'dev_answers_received');
  assert.equal(sent[0].to, 'owner@example.com');
  assert.match(sent[0].eventId, /^dev-answers:/);
  assert.equal(sent[0].variables.answerCount, '3');
});

test('the notice goes to the owner, and never to a respondent', async () => {
  assert.equal(sent.length, 1);
  const recipients = sent.map(message => message.to);
  assert.ok(!recipients.includes('person0@example.com'));
  assert.ok(!recipients.includes('person1@example.com'));
  assert.ok(!recipients.includes('person2@example.com'));
});

test('the same notice is not sent twice', async () => {
  sent = [];
  // The counter was reset by the notice, so nothing is due until the threshold is met again.
  await call('/public/forms/checkout-app/waitlist/submissions', {
    method: 'POST',
    body: { answers: { email: 'later@example.com' } },
  });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(sent.length, 0, 'one answer is not enough for the threshold of three');

  for (let index = 0; index < 2; index += 1) {
    await call('/public/forms/checkout-app/waitlist/submissions', {
      method: 'POST',
      body: { answers: { email: `more${index}@example.com` } },
    });
  }
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(sent.length, 1, 'the next notice is one notice again');
  assert.equal(sent[0].variables.answerCount, '3');
});

test('turning the preference off stops the notices', async () => {
  await call(`/projects/${projectId}/notifications`, { method: 'PUT', body: { mode: 'off' } });
  sent = [];
  for (let index = 0; index < 4; index += 1) {
    await call('/public/forms/checkout-app/waitlist/submissions', {
      method: 'POST',
      body: { answers: { email: `quiet${index}@example.com` } },
    });
  }
  await new Promise(resolve => setTimeout(resolve, 60));
  assert.equal(sent.length, 0);
});
