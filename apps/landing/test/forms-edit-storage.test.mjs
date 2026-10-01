import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createMemoryFormEditDraftStore } from '../server/forms/edit-memory-store.ts';
import { createPostgresFormEditDraftStore } from '../server/forms/edit-postgres-store.ts';

const now = new Date('2026-09-30T12:00:00Z');
const id = '00000000-0000-4000-8000-000000000001';
const formId = '1FAfakeForm0001abcdefghijklmnop';
const snapshot = {
  providerFormId: formId,
  revisionId: '00000001',
  title: 'Workshop signup',
  description: 'A short form.',
  editUrl: `https://docs.google.com/forms/d/${formId}/edit`,
  responderUrl: null,
  items: [],
  hasSections: false,
  hasBranching: false,
  isQuiz: false,
};
const plan = { formId, summary: 'Rename the form', operations: [{ type: 'update_title', title: 'Workshop registration' }] };
const newDraft = {
  id,
  userId: 'user-a',
  provider: 'google',
  providerFormId: formId,
  formRecordId: 'form-record-1',
  externalAccountId: 'google-account-1',
  current: snapshot,
  plan,
};
const success = {
  ok: true,
  requestId: 'req_edit',
  providerFormId: formId,
  title: 'Workshop registration',
  editUrl: snapshot.editUrl,
  responderUrl: null,
  recordUpdated: true,
};
const row = overrides => ({
  id,
  user_id: 'user-a',
  provider: 'google',
  version: 1,
  status: 'ready',
  provider_form_id: formId,
  form_record_id: 'form-record-1',
  external_account_id: 'google-account-1',
  current_form: snapshot,
  edit_plan: plan,
  result: null,
  created_at: now,
  updated_at: now,
  ...overrides,
});
function pool(resultRow = row(), rowCount = 1) {
  const queries = [];
  return {
    queries,
    async query(sql, params) {
      queries.push({ sql, params });
      return { rows: [resultRow], rowCount };
    },
  };
}

test('memory edit drafts are owner-scoped, versioned with compare-and-swap, and persist verified snapshots', async () => {
  const store = createMemoryFormEditDraftStore();
  const created = await store.create(newDraft, now);
  assert.equal(created.status, 'ready');
  assert.equal(await store.get('user-b', id), null);
  assert.equal(await store.revise('user-b', id, 1, plan, now), null);
  assert.equal(await store.claim('user-b', id, 1, now), null);

  const revised = await store.revise('user-a', id, 1, plan, now);
  assert.equal(revised.version, 2);
  assert.equal(await store.revise('user-a', id, 1, plan, now), null);
  const claim = await store.claim('user-a', id, 2, now);
  assert.equal(claim.status, 'applying');
  assert.equal(await store.claim('user-a', id, 2, now), null);
  const verified = { ...snapshot, revisionId: '00000002', title: 'Workshop registration' };
  assert.equal(await store.finish('user-a', id, 'applied', success, now, verified), true);
  const saved = await store.get('user-a', id);
  assert.equal(saved.status, 'applied');
  assert.deepEqual(saved.current, verified);
  assert.deepEqual(saved.result, success);
  assert.equal(await store.claim('user-a', id, saved.version, now), null);
});

test('Postgres edit-draft store uses parameterized, owner-scoped CAS updates and stores the refreshed snapshot', async () => {
  const fake = pool(row({ current_form: snapshot, edit_plan: plan }));
  const store = createPostgresFormEditDraftStore(fake);
  await store.create(newDraft, now);
  await store.get('user-a', id);
  await store.revise('user-a', id, 1, plan, now);
  await store.claim('user-a', id, 1, now);
  await store.markStale('user-a', id, 1, { ok: false, failure: { error: 'stale', code: 'edit_stale', requestId: 'req_edit', outcome: 'stale' } }, now);
  const verified = { ...snapshot, revisionId: '00000002', title: 'Workshop registration' };
  await store.finish('user-a', id, 'applied', success, now, verified);
  await store.discard('user-a', id);

  assert.equal(fake.queries.length, 7);
  for (const { sql, params } of fake.queries) {
    assert.doesNotMatch(sql, /user-a|Workshop registration/);
    assert.ok(params.includes('user-a'), 'every read/write is scoped to the session user');
  }
  assert.match(fake.queries[0].sql, /^INSERT INTO form_edit_draft/);
  assert.deepEqual(JSON.parse(fake.queries[0].params[6]), snapshot);
  assert.deepEqual(JSON.parse(fake.queries[0].params[7]), plan);
  assert.match(fake.queries[1].sql, /WHERE user_id = \$1 AND id = \$2/);
  assert.match(fake.queries[2].sql, /version = version \+ 1/);
  assert.match(fake.queries[2].sql, /version = \$3 AND status = 'ready'/);
  assert.match(fake.queries[3].sql, /status = 'applying'/);
  assert.match(fake.queries[3].sql, /version = \$3 AND status = 'ready'/);
  assert.match(fake.queries[4].sql, /status = 'stale'/);
  assert.match(fake.queries[5].sql, /current_form = COALESCE\(\$6::jsonb, current_form\)/);
  assert.deepEqual(JSON.parse(fake.queries[5].params[5]), verified);
  assert.match(fake.queries[6].sql, /status = 'ready'/);
});
