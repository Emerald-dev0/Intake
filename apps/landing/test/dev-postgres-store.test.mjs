import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresDevStore } from '../server/dev/store.ts';

/**
 * The developer store against a real PostgreSQL engine.
 *
 * The rule under test is the deployment order. The column that remembers which AI operation
 * wrote a form arrives with migration 039, and migrations are run by an operator against the
 * live database — not by the server when it starts. So a server that is already running can
 * find itself talking to a schema that does not have that column yet, and the console must
 * still work: it forgets the operation key rather than throwing at the developer.
 */

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
  await db.exec(`INSERT INTO "user" (id) VALUES ('user_a')`);
  await db.exec(await migration('025_developer_workspace.sql'));
});

after(async () => {
  await db.close();
});

test('the store works before the operation-key column exists', async () => {
  const store = createPostgresDevStore(db);
  const project = await store.createProject({
    id: 'dev_proj_before',
    userId: 'user_a',
    name: 'Checkout',
    slug: 'checkout',
    description: null,
    status: 'active',
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
    updatedAt: new Date('2026-10-29T00:00:00.000Z'),
  });
  assert.equal(project.id, 'dev_proj_before');

  const created = await store.createForm({
    id: 'dev_form_before',
    projectId: 'dev_proj_before',
    name: 'Waitlist',
    slug: 'waitlist',
    status: 'draft',
    sourceOperationKey: 'op_before',
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
    updatedAt: new Date('2026-10-29T00:00:00.000Z'),
  });
  assert.equal(created.id, 'dev_form_before');
  assert.equal(created.sourceOperationKey, null, 'the key is forgotten rather than refused');

  const forms = await store.listForms('dev_proj_before');
  assert.equal(forms.length, 1);
  assert.equal(forms[0].name, 'Waitlist');
  assert.equal(forms[0].sourceOperationKey, null);

  const found = await store.getForm('dev_form_before');
  assert.equal(found.slug, 'waitlist');
  const bySlug = await store.getFormBySlug('dev_proj_before', 'waitlist');
  assert.equal(bySlug.id, 'dev_form_before');
});

test('once the column exists, the store keeps the operation key', async () => {
  await db.exec(await migration('039_dev_form_source_operation_key.sql'));
  // The store remembers what it found a moment ago, so a fresh process is simulated here.
  const store = createPostgresDevStore(db);

  const created = await store.createForm({
    id: 'dev_form_after',
    projectId: 'dev_proj_before',
    name: 'Beta application',
    slug: 'beta-application',
    status: 'draft',
    sourceOperationKey: 'op_after',
    createdAt: new Date('2026-10-29T00:00:00.000Z'),
    updatedAt: new Date('2026-10-29T00:00:00.000Z'),
  });
  assert.equal(created.sourceOperationKey, 'op_after');

  const forms = await store.listForms('dev_proj_before');
  const remembered = forms.find(form => form.id === 'dev_form_after');
  assert.equal(remembered.sourceOperationKey, 'op_after');
});
