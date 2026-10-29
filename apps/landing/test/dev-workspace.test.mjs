import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createDevRouter } from '../server/dev/routes.ts';
import { DevService } from '../server/dev/service.ts';
import { createMemoryDevStore } from '../server/dev/memory-store.ts';
import { emptyDefinition } from '../server/dev/validation.ts';

let server;
let baseUrl;
let store;

const OWNER = 'user_owner';
const STRANGER = 'user_stranger';

function authedRouter(userId) {
  const service = new DevService({ store, now: () => new Date('2026-10-29T00:00:00.000Z') });
  const app = express();
  app.use('/api/dev', createDevRouter({ service, getSession: async () => (userId ? { id: userId, email: `${userId}@example.com`, name: 'Test' } : null) }));
  return app;
}

before(async () => {
  store = createMemoryDevStore();
  const app = authedRouter(OWNER);
  await new Promise(resolve => {
    server = app.listen(0, '127.0.0.1', () => resolve());
  });
  baseUrl = `http://127.0.0.1:${server.address().port}/api/dev`;
});

after(async () => {
  await new Promise(resolve => server.close(resolve));
});

async function call(path, { method = 'GET', body, userId = OWNER } = {}) {
  const app = authedRouter(userId);
  const local = await new Promise(resolve => {
    const listener = app.listen(0, '127.0.0.1', () => resolve(listener));
  });
  const url = `http://127.0.0.1:${local.address().port}/api/dev${path}`;
  const response = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : {},
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await response.text();
  await new Promise(resolve => local.close(resolve));
  let json = null;
  try { json = text ? JSON.parse(text) : null; } catch { json = { raw: text }; }
  return { status: response.status, body: json };
}

test('a signed-out caller is told to sign in', async () => {
  const response = await call('/projects', { userId: null });
  assert.equal(response.status, 401);
  assert.equal(response.body.error, 'not_authenticated');
});

test('a project can be created, listed and found again', async () => {
  const created = await call('/projects', { method: 'POST', body: { name: 'Checkout app' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.project.name, 'Checkout app');
  assert.equal(created.body.project.slug, 'checkout-app', 'the address is derived from the name');

  const listed = await call('/projects');
  assert.equal(listed.status, 200);
  assert.ok(listed.body.projects.some(project => project.name === 'Checkout app'));

  const found = await call(`/projects/${created.body.project.id}`);
  assert.equal(found.status, 200);
  assert.equal(found.body.project.id, created.body.project.id);
});

test('two people cannot see or reach each other\'s projects', async () => {
  const mine = await call('/projects', { method: 'POST', body: { name: 'Private thing' } });
  const theirs = await call(`/projects/${mine.body.project.id}`, { userId: STRANGER });
  assert.equal(theirs.status, 404, 'somebody else\'s project is not even confirmed to exist');

  const theirList = await call('/projects', { userId: STRANGER });
  assert.ok(!theirList.body.projects.some(project => project.name === 'Private thing'));
});

test('a form starts as a draft with one editable version', async () => {
  const project = (await call('/projects', { method: 'POST', body: { name: 'Signup flow' } })).body.project;
  const created = await call(`/projects/${project.id}/forms`, { method: 'POST', body: { name: 'Waitlist' } });
  assert.equal(created.status, 201);
  assert.equal(created.body.form.status, 'draft');
  assert.equal(created.body.form.slug, 'waitlist');
  assert.equal(created.body.versions.length, 1);
  assert.equal(created.body.draftVersion.version, 1);
  assert.equal(created.body.publishedVersion, null, 'a new form has nothing published');
});

test('a definition is checked on the server, not in the browser', async () => {
  const project = (await call('/projects', { method: 'POST', body: { name: 'Validation' } })).body.project;
  const form = (await call(`/projects/${project.id}/forms`, { method: 'POST', body: { name: 'Contact' } })).body.form;

  const bad = await call(`/forms/${form.id}/definition`, {
    method: 'PUT',
    body: { definition: { fields: [{ id: 'a', type: 'short_text', label: '' }], theme: { primary: 'not-a-colour' } } },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, 'invalid_definition');
  assert.ok(bad.body.fieldErrors.some(error => error.path === 'fields.0.label'));
  assert.ok(bad.body.fieldErrors.some(error => error.path === 'theme.primary'));

  const good = await call(`/forms/${form.id}/definition`, {
    method: 'PUT',
    body: {
      definition: {
        fields: [
          { id: 'name', type: 'short_text', label: 'Your name', required: true },
          { id: 'email', type: 'email', label: 'Email', required: true },
          { id: 'size', type: 'dropdown', label: 'Team size', options: ['1-10', '11-50'] },
        ],
        theme: { mode: 'dark', primary: '#ff5a1f', background: '#101210', text: '#f2efe6', border: '#333', radius: 12 },
      },
    },
  });
  assert.equal(good.status, 200);
  assert.equal(good.body.draftVersion.definition.fields.length, 3);
  assert.equal(good.body.draftVersion.definition.theme.mode, 'dark');
});

test('a form with no fields cannot be published', async () => {
  const project = (await call('/projects', { method: 'POST', body: { name: 'Empty' } })).body.project;
  const form = (await call(`/projects/${project.id}/forms`, { method: 'POST', body: { name: 'Nothing' } })).body.form;

  const published = await call(`/forms/${form.id}/publish`, { method: 'POST' });
  assert.equal(published.status, 400);
  assert.equal(published.body.error, 'invalid_definition');
});

test('publishing freezes a version, and editing opens a new one', async () => {
  const project = (await call('/projects', { method: 'POST', body: { name: 'Freezing' } })).body.project;
  const form = (await call(`/projects/${project.id}/forms`, { method: 'POST', body: { name: 'Feedback' } })).body.form;

  await call(`/forms/${form.id}/definition`, {
    method: 'PUT',
    body: { definition: { ...emptyDefinition(), fields: [{ id: 'a', type: 'short_text', label: 'First' }] } },
  });
  const published = await call(`/forms/${form.id}/publish`, { method: 'POST' });
  assert.equal(published.status, 200);
  assert.equal(published.body.form.status, 'published');
  assert.equal(published.body.publishedVersion.version, 1);
  assert.equal(published.body.publishedVersion.state, 'published');

  // Editing a published form must not rewrite what is live.
  const edited = await call(`/forms/${form.id}/definition`, {
    method: 'PUT',
    body: { definition: { ...emptyDefinition(), fields: [{ id: 'a', type: 'short_text', label: 'Second' }] } },
  });
  assert.equal(edited.status, 200);
  assert.equal(edited.body.publishedVersion.version, 1, 'the live version is untouched');
  assert.equal(edited.body.publishedVersion.definition.fields[0].label, 'First');
  assert.equal(edited.body.draftVersion.version, 2, 'the edit opens the next version');
});

test('the lifecycle is enforced on the server', async () => {
  const project = (await call('/projects', { method: 'POST', body: { name: 'Lifecycle' } })).body.project;
  const form = (await call(`/projects/${project.id}/forms`, { method: 'POST', body: { name: 'State' } })).body.form;
  await call(`/forms/${form.id}/definition`, {
    method: 'PUT',
    body: { definition: { ...emptyDefinition(), fields: [{ id: 'a', type: 'short_text', label: 'Hi' }] } },
  });
  await call(`/forms/${form.id}/publish`, { method: 'POST' });

  const paused = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'pause' } });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.form.status, 'paused');

  const resumed = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'resume' } });
  assert.equal(resumed.body.form.status, 'published');

  const closed = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'close' } });
  assert.equal(closed.body.form.status, 'closed');

  const reopened = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'reopen' } });
  assert.equal(reopened.body.form.status, 'published');

  // A move that makes no sense is refused, not silently ignored.
  const nonsense = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'pause' } });
  assert.equal(nonsense.status, 200);
  const doublePause = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'pause' } });
  assert.equal(doublePause.status, 409);
  assert.equal(doublePause.body.error, 'invalid_transition');

  const unknown = await call(`/forms/${form.id}/state`, { method: 'POST', body: { action: 'teleport' } });
  assert.equal(unknown.status, 400);
  assert.equal(unknown.body.error, 'invalid_action');
});

test('a stranger cannot reach a form through its project', async () => {
  const project = (await call('/projects', { method: 'POST', body: { name: 'Guarded' } })).body.project;
  const form = (await call(`/projects/${project.id}/forms`, { method: 'POST', body: { name: 'Guarded form' } })).body.form;

  const read = await call(`/forms/${form.id}`, { userId: STRANGER });
  assert.equal(read.status, 404);

  const write = await call(`/forms/${form.id}/definition`, {
    method: 'PUT',
    userId: STRANGER,
    body: { definition: emptyDefinition() },
  });
  assert.equal(write.status, 404);

  const publish = await call(`/forms/${form.id}/publish`, { method: 'POST', userId: STRANGER });
  assert.equal(publish.status, 404);
});
