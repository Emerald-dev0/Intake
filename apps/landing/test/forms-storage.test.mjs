import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { createMemoryFormStore } from '../server/forms/memory-store.ts';
import { createPostgresFormStore } from '../server/forms/postgres-store.ts';
import { SPEC_VERSION } from '../server/forms/specification.ts';
import { parseFormSpecification } from '../server/forms/validation.ts';
import { EXAMPLE_SPECIFICATION } from '../src/lib/forms.ts';

const NOW = new Date('2026-09-29T09:00:00Z');

function record(overrides = {}) {
  const parsed = parseFormSpecification(EXAMPLE_SPECIFICATION);
  return {
    id: 'form-1',
    userId: 'user-a',
    provider: 'google',
    externalAccountId: 'google-account-of-user-a',
    providerFormId: '1FAfakeForm0001abcdefghijklmnop',
    title: 'Final Year Project Registration',
    status: 'created',
    editUrl: 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit',
    responderUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform',
    failureStage: null,
    requestId: 'req_abc',
    specification: parsed.specification,
    specificationVersion: SPEC_VERSION,
    ...overrides,
  };
}

// ---------------------------------------------------------------- the migration

test('the form table ties every form to its Intake user and never stores credentials or responses', async () => {
  const source = await readFile(new URL('../db/migrations/002_forms.sql', import.meta.url), 'utf8');
  const sql = source.replace(/--.*$/gm, ''); // the header comment explains what is NOT stored, so match the statements only
  assert.match(sql, /CREATE TABLE IF NOT EXISTS form \(/);
  assert.match(sql, /user_id text NOT NULL REFERENCES "user"\(id\) ON DELETE CASCADE/);
  assert.match(sql, /provider text NOT NULL CHECK \(provider IN \('google', 'microsoft'\)\)/);
  assert.match(sql, /external_account_id text NOT NULL/);
  assert.match(sql, /provider_form_id text NOT NULL/);
  assert.match(sql, /title text NOT NULL/);
  assert.match(sql, /edit_url text/);
  assert.match(sql, /responder_url text/);
  assert.match(sql, /created_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /updated_at timestamptz NOT NULL DEFAULT now\(\)/);
  assert.match(sql, /UNIQUE \(provider, provider_form_id\)/);
  assert.match(sql, /status IN \('created', 'incomplete'\)/);
  assert.match(sql, /CREATE INDEX IF NOT EXISTS form_user_created_idx\s+ON form \(user_id, created_at DESC\)/);
  assert.doesNotMatch(sql, /token|secret|password|cipher|credential/i, 'no credential columns');
  assert.doesNotMatch(sql, /respons|answer|respondent/i, 'no respondent data');
});

test('a form that is incomplete must say where it stopped and can never carry a responder link', async () => {
  const sql = await readFile(new URL('../db/migrations/002_forms.sql', import.meta.url), 'utf8');
  assert.match(sql, /\(status = 'created' AND failure_stage IS NULL\) OR \(status = 'incomplete' AND failure_stage IS NOT NULL AND responder_url IS NULL\)/);
});

test('the form migration remains the second, idempotent, purely additive file', async () => {
  const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(file => file.endsWith('.sql')).sort();
  assert.deepEqual(files, ['001_provider_connections.sql', '002_forms.sql', '003_form_drafts.sql', '004_form_edit_drafts.sql', '005_form_library.sql']);
  const sql = await readFile(new URL('../db/migrations/002_forms.sql', import.meta.url), 'utf8');
  assert.doesNotMatch(sql.replace(/--.*$/gm, ''), /^\s*(DROP|ALTER|TRUNCATE|DELETE|UPDATE)\b/im, 'no statement changes or removes existing data');
  assert.equal((sql.match(/CREATE TABLE/g) ?? []).length, 1, 'one table');
  for (const statement of sql.match(/CREATE (TABLE|INDEX)[^;]*/g) ?? []) assert.match(statement, /IF NOT EXISTS/);
});

// ---------------------------------------------------------------- the Postgres store, without a database

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

test('saving inserts one parameterized row and maps it back', async () => {
  const stored = record();
  const pool = recordingPool([{
    id: stored.id,
    user_id: stored.userId,
    provider: stored.provider,
    external_account_id: stored.externalAccountId,
    provider_form_id: stored.providerFormId,
    title: stored.title,
    status: stored.status,
    edit_url: stored.editUrl,
    responder_url: stored.responderUrl,
    failure_stage: null,
    request_id: stored.requestId,
    specification: stored.specification,
    specification_version: 1,
    created_at: NOW,
    updated_at: NOW,
  }]);
  const store = createPostgresFormStore(pool);
  const saved = await store.save(stored, NOW);

  assert.equal(pool.queries.length, 1);
  const [{ sql, params }] = pool.queries;
  assert.match(sql, /^\s*INSERT INTO form \(/);
  assert.match(sql, /\$12::jsonb/);
  assert.equal(params.length, 14);
  assert.deepEqual(params.slice(0, 6), ['form-1', 'user-a', 'google', 'google-account-of-user-a', '1FAfakeForm0001abcdefghijklmnop', 'Final Year Project Registration']);
  assert.equal(typeof params[11], 'string', 'the specification is sent as JSON text and cast in SQL');
  assert.equal(JSON.parse(params[11]).title, 'Final Year Project Registration');
  assert.equal(params[13], NOW);
  assert.equal(sql.includes('Final Year Project Registration'), false, 'values are parameters, never part of the SQL text');

  assert.equal(saved.userId, 'user-a');
  assert.equal(saved.externalAccountId, 'google-account-of-user-a');
  assert.equal(saved.createdAt, NOW);
  assert.equal(saved.specification.questions.length, EXAMPLE_SPECIFICATION.questions.length);
});

test('listing is scoped to the user with parameters, newest first, and returns summaries only', async () => {
  const row = { id: 'form-1', provider: 'google', provider_form_id: 'abc12345', title: 'T', status: 'incomplete', failure_stage: 'publish', edit_url: 'https://docs.google.com/forms/d/abc12345/edit', responder_url: null, created_at: NOW };
  const pool = recordingPool([row]);
  const list = await createPostgresFormStore(pool).listForUser("user-a'; DROP TABLE form; --", 20);
  const [{ sql, params }] = pool.queries;
  assert.match(sql, /WHERE user_id = \$1/);
  assert.match(sql, /ORDER BY created_at DESC, id DESC/);
  assert.match(sql, /LIMIT \$2/);
  assert.deepEqual(params, ["user-a'; DROP TABLE form; --", 20]);
  assert.equal(sql.includes('DROP TABLE'), false);
  assert.deepEqual(list, [{ id: 'form-1', provider: 'google', providerFormId: 'abc12345', title: 'T', status: 'incomplete', failureStage: 'publish', editUrl: row.edit_url, responderUrl: null, createdAt: NOW }]);
  assert.equal(/specification|external_account_id|request_id|user_id,/.test(sql.split('FROM')[0]), false, 'the list does not select the specification, account or request id');
});

// ---------------------------------------------------------------- the in-memory store used by tests behaves the same

test('metadata refresh keeps an incomplete form responder URL null in both stores', async () => {
  const memory = createMemoryFormStore();
  await memory.save(record({ status: 'incomplete', failureStage: 'publish', responderUrl: null }), NOW);
  const input = { userId: 'user-a', id: 'form-1', providerFormId: '1FAfakeForm0001abcdefghijklmnop', externalAccountId: 'google-account-of-user-a',
    title: 'Fresh Google title', editUrl: 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit',
    responderUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform' };
  assert.equal(await memory.updateMetadata(input, new Date(NOW.getTime() + 1)), true);
  const refreshed = await memory.getForUser('user-a', 'form-1');
  assert.equal(refreshed.title, 'Fresh Google title');
  assert.equal(refreshed.responderUrl, null, 'an incomplete record cannot gain a responder link during an edit metadata refresh');

  const pool = recordingPool([], 1);
  const postgres = createPostgresFormStore(pool);
  assert.equal(await postgres.updateMetadata(input, new Date(NOW.getTime() + 1)), true);
  const [{ sql, params }] = pool.queries;
  assert.match(sql, /responder_url = CASE WHEN status = 'created' THEN COALESCE\(\$7, responder_url\) ELSE NULL END/);
  assert.match(sql, /status IN \('created', 'incomplete'\)/);
  assert.equal(params[6], input.responderUrl, 'the candidate link stays parameterized and the row status controls storage');
});

test('the memory store mirrors the database rules: unique provider form, per-user lists, stable order', async () => {
  const store = createMemoryFormStore();
  await store.save(record({ id: 'a', providerFormId: 'form-aaaa-1111' }), NOW);
  await assert.rejects(store.save(record({ id: 'b', providerFormId: 'form-aaaa-1111', userId: 'user-b' }), NOW), error => error.code === '23505');
  await store.save(record({ id: 'c', providerFormId: 'form-cccc-2222' }), NOW);
  await store.save(record({ id: 'd', providerFormId: 'form-dddd-3333', userId: 'user-b' }), NOW);
  await store.save(record({ id: 'e', providerFormId: 'form-eeee-4444' }), new Date(NOW.getTime() + 1000));

  const forA = await store.listForUser('user-a', 10);
  assert.deepEqual(forA.map(item => item.id), ['e', 'c', 'a'], 'newest first, ties broken by id descending, like the SQL');
  assert.deepEqual((await store.listForUser('user-b', 10)).map(item => item.id), ['d']);
  assert.deepEqual(await store.listForUser('nobody', 10), []);
  assert.equal((await store.listForUser('user-a', 2)).length, 2);
  assert.equal('specification' in forA[0], false);
  assert.equal('externalAccountId' in forA[0], false);
});
