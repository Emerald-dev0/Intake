import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * The developer workspace migration, executed against a real PostgreSQL engine.
 *
 * The constraints in this migration are the rules the server relies on: a project belongs to one
 * person, a form has one address inside its project, and a form has at most one published version.
 * A constraint that PostgreSQL refuses to create is a rule the service would have to enforce by
 * hand, so the migration is run for real here.
 */

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
});

after(async () => {
  await db.close();
});

test('the developer workspace migration applies to a real PostgreSQL', async () => {
  await db.exec(await migration('025_developer_workspace.sql'));

  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  assert.deepEqual(
    tables.rows.map(row => row.table_name).filter(name => name !== 'user'),
    ['dev_form', 'dev_form_version', 'dev_project'],
    'the migration creates exactly the three workspace tables',
  );
});

test('a project belongs to one person, and one address inside that account', async () => {
  await db.exec(`INSERT INTO "user" (id) VALUES ('user_a'), ('user_b')`);

  await db.exec(`
    INSERT INTO dev_project (id, user_id, name, slug, description, status, created_at, updated_at)
    VALUES ('dev_proj_one', 'user_a', 'Checkout', 'checkout', 'A project', 'active', now(), now())
  `);

  // The same address may exist under a different account: two people may both have a "Checkout".
  await db.exec(`
    INSERT INTO dev_project (id, user_id, name, slug, description, status, created_at, updated_at)
    VALUES ('dev_proj_two', 'user_b', 'Checkout', 'checkout', NULL, 'active', now(), now())
  `);

  await assert.rejects(
    db.exec(`
      INSERT INTO dev_project (id, user_id, name, slug, description, status, created_at, updated_at)
      VALUES ('dev_proj_three', 'user_a', 'Checkout again', 'checkout', NULL, 'active', now(), now())
    `),
    'the same account cannot have two projects with the same address',
  );
});

test('an address that is not a readable slug is refused', async () => {
  await assert.rejects(
    db.exec(`
      INSERT INTO dev_project (id, user_id, name, slug, description, status, created_at, updated_at)
      VALUES ('dev_proj_bad', 'user_a', 'Bad', 'Not A Slug!', NULL, 'active', now(), now())
    `),
    'the address has to be lowercase letters, numbers and dashes',
  );
});

test('a form has one address inside its project', async () => {
  await db.exec(`
    INSERT INTO dev_form (id, project_id, name, slug, status, created_at, updated_at)
    VALUES ('dev_form_one', 'dev_proj_one', 'Waitlist', 'waitlist', 'draft', now(), now())
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO dev_form (id, project_id, name, slug, status, created_at, updated_at)
      VALUES ('dev_form_two', 'dev_proj_one', 'Waitlist again', 'waitlist', 'draft', now(), now())
    `),
    'the same project cannot have two forms with the same address',
  );
});

test('a form has at most one published version', async () => {
  await db.exec(`
    INSERT INTO dev_form_version (id, form_id, version, definition, state, created_at, published_at)
    VALUES ('dev_ver_one', 'dev_form_one', 1, '{"fields":[]}'::jsonb, 'published', now(), now())
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO dev_form_version (id, form_id, version, definition, state, created_at, published_at)
      VALUES ('dev_ver_two', 'dev_form_one', 2, '{"fields":[]}'::jsonb, 'published', now(), now())
    `),
    'a second published version would make the live definition ambiguous',
  );
  // A draft beside a published version is fine: that is how an edit works.
  await db.exec(`
    INSERT INTO dev_form_version (id, form_id, version, definition, state, created_at, published_at)
    VALUES ('dev_ver_three', 'dev_form_one', 2, '{"fields":[]}'::jsonb, 'draft', now(), NULL)
  `);
});

test('deleting an account takes its projects, forms and versions with it', async () => {
  await db.exec(`DELETE FROM "user" WHERE id = 'user_a'`);
  const projects = await db.query(`SELECT id FROM dev_project WHERE user_id = 'user_a'`);
  assert.equal(projects.rows.length, 0);
  const forms = await db.query(`SELECT id FROM dev_form WHERE project_id = 'dev_proj_one'`);
  assert.equal(forms.rows.length, 0, 'the forms go with the project');
  const versions = await db.query(`SELECT id FROM dev_form_version WHERE form_id = 'dev_form_one'`);
  assert.equal(versions.rows.length, 0, 'the versions go with the form');
});
