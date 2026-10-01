import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createMemoryFormStore } from '../server/forms/memory-store.ts';
import { createPostgresFormStore } from '../server/forms/postgres-store.ts';
import { SPEC_VERSION } from '../server/forms/specification.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';
import { EXAMPLE_SPECIFICATION } from '../src/lib/forms.ts';

const NOW = new Date('2026-10-01T10:00:00Z');

function sampleRecord(overrides = {}) {
  const parsed = parseFormSpecification(EXAMPLE_SPECIFICATION);
  return {
    id: 'lib-form-1',
    userId: 'user-a',
    provider: 'google',
    externalAccountId: 'google-account-of-user-a',
    providerFormId: '1FAfakeForm0001abcdefghijklmnop',
    title: 'Final Year Project Registration',
    description: 'Registration form for computer science students.',
    status: 'created',
    editUrl: 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit',
    responderUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform',
    failureStage: null,
    requestId: 'req_library_1',
    specification: parsed.specification,
    specificationVersion: SPEC_VERSION,
    source: 'created',
    lastSyncedAt: NOW,
    archivedAt: null,
    ...overrides,
  };
}

// ---------------------------------------------------------------- migration tests

test('the 005_form_library migration extends form with description, source, sync and archive fields', async () => {
  const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  assert.ok(files.includes('005_form_library.sql'));

  const sql = await readFile(new URL('../db/migrations/005_form_library.sql', import.meta.url), 'utf8');
  assert.match(sql, /ALTER TABLE form ADD COLUMN IF NOT EXISTS description text/);
  assert.match(sql, /ALTER TABLE form ADD COLUMN IF NOT EXISTS source text NOT NULL DEFAULT 'created'/);
  assert.match(sql, /ALTER TABLE form ADD COLUMN IF NOT EXISTS last_synced_at timestamptz/);
  assert.match(sql, /ALTER TABLE form ADD COLUMN IF NOT EXISTS archived_at timestamptz/);
  assert.match(sql, /ALTER TABLE form ALTER COLUMN specification DROP NOT NULL/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS form_user_library_idx\s+ON form \(user_id, archived_at, created_at DESC\)/);
  assert.doesNotMatch(sql, /token|password|secret|credential|response_data/i, 'no sensitive tokens or responses stored');
});

// ---------------------------------------------------------------- Postgres store query structure

function recordingPool(rows = [], rowCount = rows.length) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows, rowCount };
    },
  };
}

test('postgres store listLibrary filters by user, respects active/archive filter and limits', async () => {
  const row = {
    id: 'form-1',
    provider: 'google',
    provider_form_id: '1FAfake1',
    title: 'Student Survey',
    description: 'Annual survey',
    status: 'created',
    failure_stage: null,
    edit_url: 'https://docs.google.com/forms/d/1FAfake1/edit',
    responder_url: 'https://docs.google.com/forms/d/e/1FAfake1/viewform',
    source: 'created',
    last_synced_at: NOW,
    archived_at: null,
    created_at: NOW,
    updated_at: NOW,
  };
  const pool = recordingPool([row]);
  const store = createPostgresFormStore(pool);

  const active = await store.listLibrary('user-a', { archived: false, limit: 10 });
  assert.equal(pool.queries.length, 1);
  const [{ sql, params }] = pool.queries;
  assert.match(sql, /WHERE user_id = \$1/);
  assert.match(sql, /AND archived_at IS NULL/);
  assert.match(sql, /ORDER BY created_at DESC, id DESC/);
  assert.match(sql, /LIMIT \$2/);
  assert.deepEqual(params, ['user-a', 10]);
  assert.equal(active[0].title, 'Student Survey');
  assert.equal(active[0].source, 'created');
});

test('postgres store listLibrary searches title and description with parameterized ILIKE', async () => {
  const pool = recordingPool([]);
  const store = createPostgresFormStore(pool);

  await store.listLibrary('user-a', { query: 'Registration', sort: 'title_asc' });
  assert.equal(pool.queries.length, 1);
  const [{ sql, params }] = pool.queries;
  assert.match(sql, /WHERE user_id = \$1/);
  assert.match(sql, /AND \(title ILIKE \$2 OR COALESCE\(description, ''\) ILIKE \$2\)/);
  assert.match(sql, /ORDER BY LOWER\(title\) ASC, id ASC/);
  assert.deepEqual(params[1], '%Registration%');
  assert.equal(sql.includes('Registration'), false, 'query parameter is parameterized');
});

test('postgres store archive and remove operations are strictly scoped to user and id', async () => {
  const pool = recordingPool([], 1);
  const store = createPostgresFormStore(pool);

  const archived = await store.archive('user-a', 'form-1', true, NOW);
  assert.equal(archived, true);
  assert.match(pool.queries[0].sql, /UPDATE form SET archived_at = CASE WHEN \$3 = true THEN \$4 ELSE NULL END, updated_at = \$4 WHERE user_id = \$1 AND id = \$2/);
  assert.deepEqual(pool.queries[0].params, ['user-a', 'form-1', true, NOW]);

  const removed = await store.remove('user-a', 'form-1');
  assert.equal(removed, true);
  assert.match(pool.queries[1].sql, /DELETE FROM form WHERE user_id = \$1 AND id = \$2/);
  assert.deepEqual(pool.queries[1].params, ['user-a', 'form-1']);
});

test('postgres store touchSync updates metadata and last_synced_at without altering ownership', async () => {
  const pool = recordingPool([], 1);
  const store = createPostgresFormStore(pool);

  const sync = await store.touchSync('user-a', 'form-1', {
    title: 'Updated Title',
    description: 'Updated Description',
    editUrl: 'https://docs.google.com/forms/d/abc/edit',
    responderUrl: 'https://docs.google.com/forms/d/e/abc/viewform',
  }, NOW);

  assert.equal(sync, true);
  assert.match(pool.queries[0].sql, /UPDATE form SET title = \$3, description = \$4, edit_url = \$5/);
  assert.match(pool.queries[0].sql, /last_synced_at = \$7, updated_at = \$7/);
  assert.match(pool.queries[0].sql, /WHERE user_id = \$1 AND id = \$2/);
  assert.deepEqual(pool.queries[0].params, [
    'user-a',
    'form-1',
    'Updated Title',
    'Updated Description',
    'https://docs.google.com/forms/d/abc/edit',
    'https://docs.google.com/forms/d/e/abc/viewform',
    NOW,
  ]);
});

// ---------------------------------------------------------------- Memory store lifecycle and constraints

test('memory store isolates user records, supports filtering, searching, and sorting', async () => {
  const store = createMemoryFormStore();
  const t0 = new Date('2026-09-01T10:00:00Z');
  const t1 = new Date('2026-09-02T10:00:00Z');
  const t2 = new Date('2026-09-03T10:00:00Z');

  await store.save(sampleRecord({ id: 'form-a1', userId: 'user-a', providerFormId: 'id-a1', title: 'Beta Registration', description: 'Early access signups', source: 'created' }), t0);
  await store.save(sampleRecord({ id: 'form-a2', userId: 'user-a', providerFormId: 'id-a2', title: 'Alpha Feedback', description: 'Product survey', source: 'imported' }), t1);
  await store.save(sampleRecord({ id: 'form-a3', userId: 'user-a', providerFormId: 'id-a3', title: 'Archived Form', description: 'Old event', source: 'created', archivedAt: t2 }), t2);
  await store.save(sampleRecord({ id: 'form-b1', userId: 'user-b', providerFormId: 'id-b1', title: 'Beta Registration', description: 'User B registration' }), t1);

  // User isolation
  const aForms = await store.listLibrary('user-a', { archived: 'all' });
  assert.equal(aForms.length, 3);
  assert.ok(aForms.every(f => f.id.startsWith('form-a')));
  const bForms = await store.listLibrary('user-b', { archived: 'all' });
  assert.equal(bForms.length, 1);
  assert.equal(bForms[0].id, 'form-b1');

  // Active vs Archived filter
  const activeOnly = await store.listLibrary('user-a', { archived: false });
  assert.deepEqual(activeOnly.map(f => f.id), ['form-a2', 'form-a1']);

  const archivedOnly = await store.listLibrary('user-a', { archived: true });
  assert.deepEqual(archivedOnly.map(f => f.id), ['form-a3']);

  // Source filter
  const createdOnly = await store.listLibrary('user-a', { source: 'created', archived: 'all' });
  assert.deepEqual(createdOnly.map(f => f.id), ['form-a3', 'form-a1']);

  const importedOnly = await store.listLibrary('user-a', { source: 'imported', archived: 'all' });
  assert.deepEqual(importedOnly.map(f => f.id), ['form-a2']);

  // Query search
  const searchBeta = await store.listLibrary('user-a', { query: 'beta', archived: 'all' });
  assert.equal(searchBeta.length, 1);
  assert.equal(searchBeta[0].id, 'form-a1');

  const searchDesc = await store.listLibrary('user-a', { query: 'survey', archived: 'all' });
  assert.equal(searchDesc.length, 1);
  assert.equal(searchDesc[0].id, 'form-a2');

  // Sorting
  const sortedTitleAsc = await store.listLibrary('user-a', { sort: 'title_asc', archived: 'all' });
  assert.deepEqual(sortedTitleAsc.map(f => f.title), ['Alpha Feedback', 'Archived Form', 'Beta Registration']);

  const sortedTitleDesc = await store.listLibrary('user-a', { sort: 'title_desc', archived: 'all' });
  assert.deepEqual(sortedTitleDesc.map(f => f.title), ['Beta Registration', 'Archived Form', 'Alpha Feedback']);

  const sortedOldest = await store.listLibrary('user-a', { sort: 'oldest', archived: 'all' });
  assert.deepEqual(sortedOldest.map(f => f.id), ['form-a1', 'form-a2', 'form-a3']);
});

test('memory store prevents duplicate provider forms across users', async () => {
  const store = createMemoryFormStore();
  await store.save(sampleRecord({ id: 'form-1', userId: 'user-a', providerFormId: 'unique-google-id' }), NOW);
  await assert.rejects(
    store.save(sampleRecord({ id: 'form-2', userId: 'user-b', providerFormId: 'unique-google-id' }), NOW),
    error => error.code === '23505',
    'cannot save the same provider form id twice',
  );
});

test('memory store archive, unarchive, remove, and getByProviderFormId work correctly', async () => {
  const store = createMemoryFormStore();
  await store.save(sampleRecord({ id: 'form-1', userId: 'user-a', providerFormId: 'g-12345' }), NOW);

  // Retrieve by providerFormId
  const byProvider = await store.getByProviderFormId('user-a', 'google', 'g-12345');
  assert.ok(byProvider);
  assert.equal(byProvider.id, 'form-1');
  assert.equal(await store.getByProviderFormId('user-b', 'google', 'g-12345'), null, 'user scoping enforced');

  // Archive
  const archiveResult = await store.archive('user-a', 'form-1', true, new Date(NOW.getTime() + 1000));
  assert.equal(archiveResult, true);
  const archivedForm = await store.getForUser('user-a', 'form-1');
  assert.ok(archivedForm?.archivedAt);

  // Unarchive
  const unarchiveResult = await store.archive('user-a', 'form-1', false, new Date(NOW.getTime() + 2000));
  assert.equal(unarchiveResult, true);
  const restoredForm = await store.getForUser('user-a', 'form-1');
  assert.equal(restoredForm?.archivedAt, null);

  // Remove
  const removeOtherUser = await store.remove('user-b', 'form-1');
  assert.equal(removeOtherUser, false, 'cannot remove another user record');
  const removeSuccess = await store.remove('user-a', 'form-1');
  assert.equal(removeSuccess, true);
  assert.equal(await store.getForUser('user-a', 'form-1'), null);
});
