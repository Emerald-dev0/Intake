import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * The release migration, executed against a real PostgreSQL engine.
 *
 * The text of a migration proves nothing: an index expression that PostgreSQL considers
 * non-immutable is refused at apply time, long after it was written and reviewed. This runs the
 * migration for real, so that class of mistake fails here rather than on the live database.
 */

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;

before(async () => {
  db = new PGlite();
  // The release tables reference the Better Auth user table; the migration only needs its key.
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
});

after(async () => {
  await db.close();
});

test('the release migration applies to a real PostgreSQL', async () => {
  await db.exec(await migration('022_release_manager.sql'));

  const tables = await db.query(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' ORDER BY table_name`,
  );
  assert.deepEqual(
    tables.rows.map(row => row.table_name).filter(name => name !== 'user'),
    ['release', 'release_audit', 'release_checklist_item', 'release_source', 'release_webhook_event'],
    'the migration creates exactly the five release tables',
  );

  const indexes = await db.query(`SELECT indexname FROM pg_indexes WHERE tablename = 'release' ORDER BY indexname`);
  const names = indexes.rows.map(row => row.indexname);
  assert.ok(names.includes('release_published_idx'), 'the published list is indexed');
  assert.ok(names.includes('release_status_idx'), 'the status list is indexed');
});

test('the published index orders by the date the reader sees', async () => {
  // One release with an operator-set date and one without: the fallback is the publication
  // timestamp, read in UTC so it does not move with the session time zone.
  await db.exec(`
    INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, published_at)
    VALUES
      ('rel_index_dated', 'index-dated', 'Dated', 's', 'b', '{feature}', 'published', DATE '2026-10-01', TIMESTAMPTZ '2026-10-01T00:00:00Z'),
      ('rel_index_fallback', 'index-fallback', 'Fallback', 's', 'b', '{feature}', 'published', NULL, TIMESTAMPTZ '2026-10-20T23:30:00Z');
  `);

  const rows = await db.query(`
    SELECT slug FROM release
    WHERE status = 'published'
    ORDER BY COALESCE(release_date, (published_at AT TIME ZONE 'UTC')::date) DESC;
  `);
  const slugs = rows.rows.map(row => row.slug);
  assert.ok(slugs.indexOf('index-fallback') < slugs.indexOf('index-dated'),
    'the fallback date orders the release with no operator-set date');
  assert.ok(slugs.indexOf('index-fallback') < slugs.indexOf('launch'),
    'a release published in October sorts after one published in October 2026 the 20th');

  // The expression the migration uses is accepted; the obvious alternative is refused. The direct
  // date -> timestamptz cast depends on the session time zone, so it is STABLE, not IMMUTABLE, and
  // PostgreSQL refuses it in an index expression.
  await assert.rejects(
    db.exec(`CREATE INDEX release_bad_idx ON release (COALESCE(release_date, published_at) DESC)`),
    /immutable/i,
    'the timezone-dependent expression is refused by PostgreSQL',
  );
  await db.exec(
    `CREATE INDEX release_good_idx ON release (COALESCE(release_date, (published_at AT TIME ZONE 'UTC')::date) DESC)`,
  );
  await db.exec('DROP INDEX release_good_idx');
});

test('the migration can be applied twice without failing', async () => {
  // The runner records applied files, but an operator may re-run it by hand. Every statement is
  // additive and idempotent, so a second run changes nothing.
  await db.exec(await migration('022_release_manager.sql'));
  const rows = await db.query('SELECT count(*)::int AS count FROM release');
  assert.equal(rows.rows[0].count, 8, 'the seeded releases are not duplicated');
});

test('the deeper migration applies and brings the shipped copy with it', async () => {
  await db.exec(await migration('023_release_depth.sql'));

  const columns = await db.query(
    `SELECT column_name FROM information_schema.columns
      WHERE table_name = 'release' AND column_name IN ('highlights', 'audience')`,
  );
  assert.deepEqual(columns.rows.map(row => row.column_name).sort(), ['audience', 'highlights']);

  const { BUNDLED_RELEASES } = await import('../src/content/changelog.ts');
  const bundled = BUNDLED_RELEASES.find(release => release.slug === 'launch');
  const stored = await db.query(`SELECT summary, body, highlights, audience FROM release WHERE slug = 'launch'`);
  assert.equal(stored.rows[0].summary, bundled.summary, 'the database carries the same summary as the site');
  assert.equal(stored.rows[0].body, bundled.body, 'the database carries the same notes as the site');
  assert.deepEqual(stored.rows[0].highlights, bundled.highlights, 'the highlights are stored');
  assert.equal(stored.rows[0].audience, bundled.audience, 'the audience line is stored');

});

test('the developer page entry is seeded with the rest of the shipped releases', async () => {
  await db.exec(await migration('024_release_developers_page.sql'));
  await db.exec(await migration('027_release_hosted_forms.sql'));
  await db.exec(await migration('028_release_response_inbox.sql'));
  await db.exec(await migration('030_release_summaries.sql'));
  await db.exec(await migration('033_release_usage_numbers.sql'));
  await db.exec(await migration('034_release_answer_notices.sql'));
  await db.exec(await migration('035_release_delete_a_form.sql'));
  const { BUNDLED_RELEASES } = await import('../src/content/changelog.ts');

  // Every shipped release carries the current copy, not just the newest one.
  const shipped = await db.query(
    `SELECT slug, body FROM release WHERE slug = ANY($1) ORDER BY slug`,
    [BUNDLED_RELEASES.map(release => release.slug)],
  );
  assert.equal(shipped.rows.length, BUNDLED_RELEASES.length);
  for (const row of shipped.rows) {
    const release = BUNDLED_RELEASES.find(entry => entry.slug === row.slug);
    assert.ok(release, `${row.slug} is a release the site also bundles`);
    assert.equal(row.body, release.body, `${row.slug} carries the current notes`);
  }

  const release = BUNDLED_RELEASES.find(entry => entry.slug === 'intake-for-developers-page');
  assert.ok(release, 'the developer page has a changelog entry');
  const row = await db.query(`SELECT title, summary, body, highlights, audience, status FROM release WHERE slug = $1`, [release.slug]);
  assert.equal(row.rows.length, 1);
  assert.equal(row.rows[0].title, release.title);
  assert.equal(row.rows[0].body, release.body);
  assert.deepEqual(row.rows[0].highlights, release.highlights);
  assert.equal(row.rows[0].audience, release.audience);
  assert.equal(row.rows[0].status, 'published', 'a seeded release is published, not a draft');
});

test('a release keeps its slug, its state and its checklist decisions', async () => {
  const stored = await db.query(`SELECT slug, status FROM release WHERE id = 'rel_launch_2026_10_01'`);
  assert.equal(stored.rows[0].slug, 'launch');
  assert.equal(stored.rows[0].status, 'published');

  await db.exec(`
    INSERT INTO release_checklist_item (release_id, key, decision, note)
    VALUES ('rel_launch_2026_10_01', 'tests', 'confirmed', 'The suite passed.');
  `);
  const decision = await db.query(
    `SELECT decision, note FROM release_checklist_item WHERE release_id = 'rel_launch_2026_10_01' AND key = 'tests'`,
  );
  assert.equal(decision.rows[0].decision, 'confirmed');
  assert.equal(decision.rows[0].note, 'The suite passed.');

  // The same delivery id twice is one row: the delivery id is the idempotency key.
  await db.exec(`INSERT INTO release_webhook_event (delivery_id, event_type) VALUES ('d-1', 'ping')`);
  await db.exec(`INSERT INTO release_webhook_event (delivery_id, event_type) VALUES ('d-1', 'ping') ON CONFLICT (delivery_id) DO NOTHING`);
  const deliveries = await db.query('SELECT count(*)::int AS count FROM release_webhook_event');
  assert.equal(deliveries.rows[0].count, 1);
});
