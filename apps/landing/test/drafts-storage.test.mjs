import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createMemoryDraftStore } from '../server/forms/draft-memory-store.ts';
import { createPostgresDraftStore } from '../server/forms/draft-postgres-store.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';

const date = new Date('2026-09-29T09:00:00.000Z');
const spec = parseFormSpecification({ title: 'Registration', questions: [{ id: 'name', title: 'Full name', type: 'short_text', required: true }] }).specification;
const first = { id: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', userId: 'user-a', provider: 'google', specification: spec, assumptions: [], warnings: [] };

function pool(rows = [], rowCount = rows.length) {
  const queries = [];
  return { queries, async query(sql, params) { queries.push({ sql, params }); return { rows, rowCount }; } };
}
function row(input = first) {
  return { id: input.id, user_id: input.userId, provider: 'google', version: 1, status: 'ready', specification: spec, assumptions: [], warnings: [], result: null, created_at: date, updated_at: date };
}

test('the third additive migration owns server drafts and durable one-shot creation claims', async () => {
  const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  assert.deepEqual(files, ['001_provider_connections.sql', '002_forms.sql', '003_form_drafts.sql', '004_form_edit_drafts.sql', '005_form_library.sql', '006_production_hardening.sql', '007_ai_credits.sql', '007_ai_operations.sql', '008_ai_operation_compat.sql', '009_admin_indexes.sql']);
  const editText = await readFile(new URL('../db/migrations/004_form_edit_drafts.sql', import.meta.url), 'utf8');
  const editSql = editText.replace(/--.*$/gm, '');
  assert.match(editSql, /CREATE TABLE IF NOT EXISTS form_edit_draft \(/);
  assert.match(editSql, /provider text NOT NULL CHECK \(provider = 'google'\)/);
  assert.match(editSql, /status IN \('ready', 'applying', 'applied', 'blocked', 'stale'\)/);
  assert.match(editSql, /form_record_id text REFERENCES form\(id\) ON DELETE SET NULL/);
  assert.match(editSql, /current_form jsonb NOT NULL/);
  assert.match(editSql, /edit_plan jsonb NOT NULL/);
  assert.match(editSql, /current_form->>'providerFormId' = provider_form_id/);
  assert.match(editSql, /edit_plan->>'formId' = provider_form_id/);
  assert.doesNotMatch(editSql, /access_token|refresh_token|ciphertext|respondent|response_body/i);
  assert.doesNotMatch(editSql, /^\s*(DROP|ALTER|TRUNCATE|DELETE|UPDATE)\b/im, 'the edit draft migration is additive');
  for (const statement of editSql.match(/CREATE (TABLE|INDEX)[^;]*/g) ?? []) assert.match(statement, /IF NOT EXISTS/);

  const text = await readFile(new URL('../db/migrations/003_form_drafts.sql', import.meta.url), 'utf8');
  const sql = text.replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS form_draft \(/);
  assert.match(sql, /user_id text NOT NULL REFERENCES "user"\(id\) ON DELETE CASCADE/);
  assert.match(sql, /status IN \('ready', 'creating', 'created', 'blocked'\)/);
  assert.match(sql, /specification jsonb NOT NULL/);
  assert.match(sql, /version integer NOT NULL DEFAULT 1/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS form_draft_user_created_idx ON form_draft \(user_id, created_at DESC\)/);
  assert.doesNotMatch(sql, /^\s*(DROP|ALTER|TRUNCATE|DELETE|UPDATE)\b/im, 'no destructive SQL statements');
  assert.doesNotMatch(sql, /\b(access_token|refresh_token|ciphertext|provider_connection|response_body)\b/i, 'no credentials or respondent data');
});

test('memory store isolates owners, makes revision optimistic and claims one creation across concurrent requests', async () => {
  const store = createMemoryDraftStore();
  await store.create(first, date);
  assert.equal(await store.get('user-b', first.id), null);
  assert.equal(await store.revise('user-b', first.id, 1, { specification: spec, assumptions: [], warnings: [] }, date), null);
  assert.equal(await store.claim('user-b', first.id, 1, date), null);
  assert.equal(await store.discard('user-b', first.id), false);
  const revised = await store.revise('user-a', first.id, 1, { specification: spec, assumptions: ['Name required'], warnings: [] }, date);
  assert.equal(revised.version, 2);
  assert.equal((await store.get('user-a', first.id)).assumptions[0], 'Name required');
  assert.equal(await store.revise('user-a', first.id, 1, { specification: spec, assumptions: [], warnings: [] }, date), null);
  const claims = await Promise.all(Array.from({ length: 12 }, () => store.claim('user-a', first.id, 2, date)));
  assert.equal(claims.filter(Boolean).length, 1);
  assert.equal(await store.revise('user-a', first.id, 2, { specification: spec, assumptions: [], warnings: [] }, date), null);
  assert.equal(await store.discard('user-a', first.id), false);
  const result = { ok: true, requestId: 'req_1', form: { id: 'f1' }, warnings: [] };
  assert.equal(await store.finish('user-a', first.id, 'created', result, date), true);
  assert.equal(await store.finish('user-a', first.id, 'created', result, date), false);
  assert.equal(await store.claim('user-a', first.id, 2, date), null);
  assert.equal((await store.get('user-a', first.id)).result.form.id, 'f1');
});

test('a known not-created failure releases the draft, but a blocked/ambiguous failure never can be retried', async () => {
  const store = createMemoryDraftStore();
  await store.create(first, date);
  await store.claim('user-a', first.id, 1, date);
  const safe = { ok: false, failure: { error: 'Not connected', code: 'provider_not_connected', requestId: 'req_1', outcome: 'not_created' } };
  assert.equal(await store.finish('user-a', first.id, 'ready', safe, date), true);
  assert.ok(await store.claim('user-a', first.id, 1, date));
  const uncertain = { ok: false, failure: { error: 'Unknown', code: 'provider_error', requestId: 'req_2', outcome: 'unknown' } };
  assert.equal(await store.finish('user-a', first.id, 'blocked', uncertain, date), true);
  assert.equal(await store.claim('user-a', first.id, 1, date), null);
});

test('Postgres operations use parameterized user-scoped atomic compare-and-swap updates', async () => {
  const fake = pool([row()]);
  const store = createPostgresDraftStore(fake);
  await store.create(first, date);
  await store.get('user-a', first.id);
  await store.revise('user-a', first.id, 1, { specification: spec, assumptions: ['x'], warnings: [] }, date);
  await store.claim('user-a', first.id, 1, date);
  await store.finish('user-a', first.id, 'blocked', { ok: false, failure: { error: 'unknown', code: 'internal_error', requestId: 'req_1' } }, date);
  await store.discard('user-a', first.id);
  assert.equal(fake.queries.length, 6);
  for (const { sql, params } of fake.queries) {
    assert.equal(sql.includes('user-a'), false);
    assert.equal(params.includes('user-a'), true);
    assert.match(sql, /(?:user_id\s*=\s*\$1|INSERT INTO form_draft \()/);
  }
  for (const { sql } of fake.queries.slice(2, 5)) assert.match(sql, /WHERE user_id = \$1 AND id = \$2 AND .*status = 'ready'|WHERE user_id = \$1 AND id = \$2 AND status = 'creating'/);
  assert.match(fake.queries[2].sql, /version = \$3/);
  assert.match(fake.queries[3].sql, /version = \$3/);
  assert.match(fake.queries[3].sql, /status = 'creating'/);
  assert.equal(JSON.parse(fake.queries[0].params[3]).title, 'Registration');
  assert.equal(fake.queries[0].sql.includes('Registration'), false);
  assert.equal(fake.queries[4].params[2], 'blocked');
  assert.deepEqual((await store.get('user-a', first.id)).specification, spec);
});
