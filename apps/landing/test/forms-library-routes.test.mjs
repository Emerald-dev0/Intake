import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createFormsRouter } from '../server/forms/routes.ts';
import { createMemoryFormStore } from '../server/forms/memory-store.ts';
import { ORIGIN, createWorld, form, shortText } from './helpers/forms-harness.mjs';

const SIMPLE = form([shortText('name', { title: 'Full name', required: true })], { title: 'Project Registration' });

async function bootServer(options = {}) {
  const world = createWorld(options.world);
  const parts = world.engine(options.engine ?? {});
  const users = { current: { id: 'user-a', email: 'a@intake.test', name: 'Ada' } };
  const app = express();
  app.use('/api/forms', createFormsRouter({
    engine: parts.engine,
    getSession: async () => users.current,
    env: world.env,
    log: world.log,
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/forms`;

  async function call(method, body, { headers = {}, raw = false, path = '', origin = ORIGIN } = {}) {
    const response = await fetch(base + path, {
      method,
      headers: {
        ...(method === 'POST' || method === 'DELETE'
          ? { 'content-type': 'application/json', ...(origin === null ? {} : { origin }) }
          : {}),
        ...headers,
      },
      body: body === undefined ? undefined : raw ? body : JSON.stringify(body),
    });
    const text = await response.text();
    let json = null;
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
    return { status: response.status, json, text, headers: response.headers };
  }

  return {
    world,
    users,
    ...parts,
    post: (path, body, options) => call('POST', body, { path, ...options }),
    get: (path = '', options) => call('GET', undefined, { path, ...options }),
    delete: (path, options) => call('DELETE', undefined, { path, ...options }),
    call,
    async close() {
      await new Promise(resolve => server.close(resolve));
    },
  };
}

async function withLibraryServer(options, run) {
  const app = await bootServer(options);
  try {
    return await run(app);
  } finally {
    await app.close();
  }
}

// ---------------------------------------------------------------- library listing, search, filtering

test('GET /api/forms/library lists user forms with rich metadata and enforces user isolation', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    await app.world.connect('user-b');

    // Create a form for user-a
    const createdA = await app.call('POST', { provider: 'google', specification: SIMPLE });
    assert.equal(createdA.status, 201);
    const formAId = createdA.json.form.id;

    // Switch to user-b and create a form
    app.users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };
    const createdB = await app.call('POST', { provider: 'google', specification: form([shortText('q', { title: 'Q' })], { title: 'User B Form' }) });
    assert.equal(createdB.status, 201);

    // User B list
    const listB = await app.get('/library');
    assert.equal(listB.status, 200);
    assert.equal(listB.json.forms.length, 1);
    assert.equal(listB.json.forms[0].title, 'User B Form');

    // Switch back to User A
    app.users.current = { id: 'user-a', email: 'a@intake.test', name: 'Ada' };
    const listA = await app.get('/library');
    assert.equal(listA.status, 200);
    assert.equal(listA.json.forms.length, 1);
    assert.equal(listA.json.forms[0].id, formAId);
    assert.equal(listA.json.forms[0].title, 'Project Registration');
    assert.equal(listA.json.forms[0].source, 'created');
    assert.ok(listA.json.forms[0].createdAt);
  }));

test('GET /api/forms/library supports query search and filtering by source and archive status', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');

    // Create two forms with distinct titles
    await app.call('POST', { provider: 'google', specification: form([shortText('name', { title: 'Name' })], { title: 'Conference Registration' }) });
    const second = await app.call('POST', { provider: 'google', specification: form([shortText('feedback', { title: 'Feedback' })], { title: 'Feedback Survey' }) });
    const secondId = second.json.form.id;

    // Search query
    const searchRes = await app.get('/library?query=Conference');
    assert.equal(searchRes.status, 200);
    assert.equal(searchRes.json.forms.length, 1);
    assert.equal(searchRes.json.forms[0].title, 'Conference Registration');

    // Archive the second form
    const archiveRes = await app.post(`/library/${secondId}/archive`, {});
    assert.equal(archiveRes.status, 200);
    assert.equal(archiveRes.json.archived, true);

    // Active forms by default
    const activeForms = await app.get('/library');
    assert.equal(activeForms.json.forms.length, 1);
    assert.equal(activeForms.json.forms[0].title, 'Conference Registration');

    // Filter archived forms
    const archivedForms = await app.get('/library?archived=true');
    assert.equal(archivedForms.json.forms.length, 1);
    assert.equal(archivedForms.json.forms[0].id, secondId);

    // Unarchive the second form
    const unarchiveRes = await app.post(`/library/${secondId}/unarchive`, {});
    assert.equal(unarchiveRes.status, 200);
    assert.equal(unarchiveRes.json.archived, false);

    const afterRestore = await app.get('/library');
    assert.equal(afterRestore.json.forms.length, 2);
  }));

// ---------------------------------------------------------------- ownership and security

test('user cannot inspect, archive, or remove another user form', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    await app.world.connect('user-b');

    const createdA = await app.call('POST', { provider: 'google', specification: SIMPLE });
    const formAId = createdA.json.form.id;

    // Switch to user-b
    app.users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };

    // Inspect
    const inspect = await app.get(`/library/${formAId}`);
    assert.equal(inspect.status, 404);

    // Archive
    const archive = await app.post(`/library/${formAId}/archive`, {});
    assert.equal(archive.status, 400);

    // Remove
    const remove = await app.delete(`/library/${formAId}`);
    assert.equal(remove.status, 400);

    // Switch back to user-a: record still exists
    app.users.current = { id: 'user-a', email: 'a@intake.test', name: 'Ada' };
    const record = await app.get(`/library/${formAId}`);
    assert.equal(record.status, 200);
    assert.equal(record.json.form.id, formAId);
  }));

test('cross-site mutations to library endpoints are rejected with 403', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    const created = await app.call('POST', { provider: 'google', specification: SIMPLE });
    const formId = created.json.form.id;

    const evilArchive = await app.call('POST', {}, { path: `/library/${formId}/archive`, origin: 'https://evil.example' });
    assert.equal(evilArchive.status, 403);

    const evilDelete = await app.call('DELETE', {}, { path: `/library/${formId}`, origin: 'https://evil.example' });
    assert.equal(evilDelete.status, 403);
  }));

// ---------------------------------------------------------------- removal semantics (never delete provider form)

test('DELETE /api/forms/library/:id removes Intake reference without deleting provider form', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    const created = await app.call('POST', { provider: 'google', specification: SIMPLE });
    const formId = created.json.form.id;
    const providerFormId = created.json.form.providerFormId;

    assert.ok(app.world.fake.forms.has(providerFormId), 'form exists in provider');

    const removeRes = await app.delete(`/library/${formId}`);
    assert.equal(removeRes.status, 200);
    assert.equal(removeRes.json.ok, true);
    assert.equal(removeRes.json.removed, true);
    assert.match(removeRes.json.message, /remains in your Google account/);

    // Record is removed from Intake
    const listAfter = await app.get('/library');
    assert.equal(listAfter.json.forms.length, 0);

    // External provider form is strictly preserved!
    assert.ok(app.world.fake.forms.has(providerFormId), 'provider form was NOT deleted');
  }));

// ---------------------------------------------------------------- live status check and metadata refresh

test('POST /api/forms/library/:id/refresh verifies provider accessibility and updates metadata', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    const created = await app.call('POST', { provider: 'google', specification: SIMPLE });
    const formId = created.json.form.id;
    const providerFormId = created.json.form.providerFormId;

    // Simulate an external title change in Google Forms
    const providerForm = app.world.fake.forms.get(providerFormId);
    providerForm.info.title = 'Renamed in Google Forms';

    const refreshRes = await app.post(`/library/${formId}/refresh`, {});
    assert.equal(refreshRes.status, 200);
    assert.equal(refreshRes.json.ok, true);
    assert.equal(refreshRes.json.status, 'accessible');
    assert.equal(refreshRes.json.form.title, 'Renamed in Google Forms');
    assert.ok(refreshRes.json.form.lastSyncedAt);

    // Verify metadata persisted locally
    const getRes = await app.get(`/library/${formId}`);
    assert.equal(getRes.json.form.title, 'Renamed in Google Forms');
  }));

test('live provider failures distinguish missing vs unavailable vs disconnected without deleting local records', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    const created = await app.call('POST', { provider: 'google', specification: SIMPLE });
    const formId = created.json.form.id;
    const providerFormId = created.json.form.providerFormId;

    // 1. Missing in Google (404)
    app.world.fake.forms.delete(providerFormId);
    const missingRes = await app.post(`/library/${formId}/refresh`, {});
    assert.equal(missingRes.status, 200);
    assert.equal(missingRes.json.ok, false);
    assert.equal(missingRes.json.status, 'missing');
    assert.match(missingRes.json.error, /could not find this form/);

    // Local record is NOT deleted!
    const localAfterMissing = await app.get(`/library/${formId}`);
    assert.equal(localAfterMissing.status, 200);

    // 2. Provider network error / unavailable (500)
    app.world.fake.forms.set(providerFormId, { info: { title: 'Test' }, items: [], revisionId: '1' });
    app.world.fake.failOn('forms.get', { status: 503, googleStatus: 'UNAVAILABLE', message: 'Backend error' });

    const unavailableRes = await app.post(`/library/${formId}/refresh`, {});
    assert.equal(unavailableRes.status, 200);
    assert.equal(unavailableRes.json.ok, false);
    assert.equal(unavailableRes.json.status, 'unavailable');
    assert.match(unavailableRes.json.error, /temporarily unreachable/);
    assert.equal(unavailableRes.json.status, 'unavailable', 'never marked deleted on network failure');

    // Local record is still intact
    const localAfterUnavailable = await app.get(`/library/${formId}`);
    assert.equal(localAfterUnavailable.status, 200);
  }));

// ---------------------------------------------------------------- importing existing forms

test('POST /api/forms/library/import imports existing Google Form and prevents duplicates', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');

    // Create a form in the fake Google provider
    const externalId = '1FAfakeExternalForm1234567890';
    app.world.fake.forms.set(externalId, {
      formId: externalId,
      info: { title: 'Existing Research Survey', description: 'Faculty research survey' },
      items: [],
      revisionId: 'rev1',
    });

    const url = `https://docs.google.com/forms/d/${externalId}/edit`;
    const importRes = await app.post('/library/import', { url });
    assert.equal(importRes.status, 201);
    assert.equal(importRes.json.form.title, 'Existing Research Survey');
    assert.equal(importRes.json.form.source, 'imported');
    assert.equal(importRes.json.alreadyExists, false);

    // Re-importing returns existing without creating duplicate
    const secondImport = await app.post('/library/import', { url });
    assert.equal(secondImport.status, 200);
    assert.equal(secondImport.json.alreadyExists, true);
    assert.equal(secondImport.json.form.id, importRes.json.form.id);

    // Verify it appears in library with source=imported
    const list = await app.get('/library?source=imported');
    assert.equal(list.json.forms.length, 1);
    assert.equal(list.json.forms[0].id, importRes.json.form.id);
  }));

test('POST /api/forms/library/import rejects invalid URLs and shortlinks safely', () =>
  withLibraryServer({}, async app => {
    await app.world.connect('user-a');
    for (const bad of ['not a url', 'https://example.com/form', 'https://forms.gle/shortLink', '']) {
      const res = await app.post('/library/import', { url: bad });
      assert.equal(res.status, 400);
      assert.match(res.json.error, /Google Forms (?:edit )?URL/i);
    }
  }));
