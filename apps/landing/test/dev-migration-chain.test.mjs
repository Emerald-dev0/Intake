import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * The developer platform's migrations, applied in the order they ship in.
 *
 * A migration that does not apply is a deployment that breaks, and the two tables that come from
 * earlier migrations of the same product — the credit ledger and the AI operation log — have to
 * exist first, with the constraints they had before. So this test creates them the way the
 * product created them, then runs 025, 026, 029, 031 and 032 in order, the way the runner does.
 *
 * The point is not that the SQL parses. It is that a developer with a fresh database can run the
 * migrations and get the tables the server expects, with the rules the server relies on.
 */

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

const CHAIN = [
  '025_developer_workspace.sql',
  '026_dev_submissions.sql',
  '029_dev_insights_operation.sql',
  '031_dev_usage_daily.sql',
  '032_dev_notification_preferences.sql',
];

let db;

before(async () => {
  db = new PGlite();
  // The accounts table the product already has.
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
  // The credit ledger and the AI operation log, as the earlier migrations left them.
  await db.exec(`
    CREATE TABLE credit_ledger (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      bucket text NOT NULL,
      amount integer NOT NULL,
      entry_type text NOT NULL,
      operation_type text,
      period_key text,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT credit_ledger_operation_type_check CHECK (
        operation_type IS NULL OR operation_type IN (
          'form_create', 'form_edit', 'form_revise',
          'subscription_grant', 'credit_purchase', 'promotion_grant'
        )
      )
    );
    CREATE TABLE ai_operation (
      id text PRIMARY KEY,
      user_id text NOT NULL,
      operation_type text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT ai_operation_operation_type_check CHECK (
        operation_type IN ('form_create', 'form_edit', 'form_revise')
      )
    );
  `);
});

after(async () => {
  await db.close();
});

test('the developer migrations apply in order, on a database that has the product tables', async () => {
  for (const name of CHAIN) {
    await db.exec(await migration(name));
  }

  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  const names = tables.rows.map(row => row.table_name);
  for (const expected of ['dev_form', 'dev_form_version', 'dev_project', 'dev_submission', 'dev_usage_daily', 'dev_notification_preference']) {
    assert.ok(names.includes(expected), `${expected} exists after the chain runs`);
  }
});

test('the summary operation is a name the credit ledger now accepts', async () => {
  // The ledger's constraint is what stops a summary from being written as something it is not.
  await db.exec(`
    INSERT INTO credit_ledger (id, user_id, bucket, amount, entry_type, operation_type)
    VALUES ('led_dev_1', 'user_a', 'daily', -3, 'consumption', 'dev_insights');
  `);
  const row = await db.query(`SELECT operation_type FROM credit_ledger WHERE id = 'led_dev_1'`);
  assert.equal(row.rows[0].operation_type, 'dev_insights');

  await assert.rejects(
    db.exec(`
      INSERT INTO credit_ledger (id, user_id, bucket, amount, entry_type, operation_type)
      VALUES ('led_dev_2', 'user_a', 'daily', -3, 'consumption', 'not_a_real_operation');
    `),
    'the constraint still refuses an operation that does not exist',
  );
});

test('the usage counters only count upwards', async () => {
  await db.exec(`INSERT INTO "user" (id) VALUES ('user_a')`);
  await db.exec(`
    INSERT INTO dev_project (id, user_id, name, slug, description, status, created_at, updated_at)
    VALUES ('dev_proj_usage', 'user_a', 'Checkout', 'checkout-usage', 'A project', 'active', now(), now())
  `);
  await db.exec(`
    INSERT INTO dev_usage_daily (project_id, day, accepted, rejected, bytes)
    VALUES ('dev_proj_usage', DATE '2026-10-29', 4, 1, 2048)
  `);
  await assert.rejects(
    db.exec(`
      INSERT INTO dev_usage_daily (project_id, day, accepted, rejected, bytes)
      VALUES ('dev_proj_usage', DATE '2026-10-29', -1, 0, 0)
    `),
    'a negative count is refused',
  );
});

test('a notification preference is off unless somebody turns it on', async () => {
  await db.exec(`
    INSERT INTO dev_notification_preference (id, user_id, project_id, mode, threshold)
    VALUES ('dev_pref_1', 'user_a', 'dev_proj_usage', 'off', 10)
  `);
  const row = await db.query(`SELECT mode, threshold FROM dev_notification_preference WHERE id = 'dev_pref_1'`);
  assert.equal(row.rows[0].mode, 'off');

  await assert.rejects(
    db.exec(`
      INSERT INTO dev_notification_preference (id, user_id, project_id, mode, threshold)
      VALUES ('dev_pref_2', 'user_a', 'dev_proj_usage', 'sometimes', 10)
    `),
    'a mode that does not exist is refused',
  );

  await assert.rejects(
    db.exec(`
      INSERT INTO dev_notification_preference (id, user_id, project_id, mode, threshold)
      VALUES ('dev_pref_3', 'user_a', 'dev_proj_usage', 'threshold', 0)
    `),
    'a threshold of zero answers is refused',
  );
});

test('one preference per account and project', async () => {
  await assert.rejects(
    db.exec(`
      INSERT INTO dev_notification_preference (id, user_id, project_id, mode, threshold)
      VALUES ('dev_pref_4', 'user_a', 'dev_proj_usage', 'digest', 10)
    `),
    'the same account and project cannot have two preferences',
  );
});
