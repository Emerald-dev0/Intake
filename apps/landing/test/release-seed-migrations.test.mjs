import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';

/**
 * The release migrations, applied to a real PostgreSQL engine.
 *
 * A release migration that does not apply is a changelog entry that never appears, and one that
 * applies with the wrong words is a changelog entry that says something the product does not do.
 * So these tests run the SQL against a database shaped the way migrations 022 and 023 left it,
 * and then read back what was seeded.
 *
 * The point is not that the SQL parses. It is that the entry lands, it lands as published, and
 * the notes it carries are the notes the site shows.
 */

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

const RELEASE_SCHEMA = `
  CREATE TABLE "user" (id text PRIMARY KEY);
  CREATE TABLE release (
    id text PRIMARY KEY CHECK (char_length(id) BETWEEN 8 AND 64),
    slug text NOT NULL UNIQUE CHECK (char_length(slug) BETWEEN 3 AND 80 AND slug ~ '^[a-z0-9]+(-[a-z0-9]+)*$'),
    title text NOT NULL DEFAULT '' CHECK (char_length(title) <= 140),
    summary text NOT NULL DEFAULT '' CHECK (char_length(summary) <= 320),
    body text NOT NULL DEFAULT '' CHECK (char_length(body) <= 20000),
    categories text[] NOT NULL DEFAULT '{}',
    status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','in_review','approved','awaiting_deployment','published','cancelled')),
    release_date date,
    links jsonb NOT NULL DEFAULT '[]'::jsonb,
    hero_image_url text,
    share_text text CHECK (share_text IS NULL OR char_length(share_text) <= 600),
    author_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
    author_name text,
    author_email text,
    approved_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
    approved_at timestamptz,
    published_at timestamptz,
    published_by_user_id text REFERENCES "user"(id) ON DELETE SET NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    updated_at timestamptz NOT NULL DEFAULT now(),
    highlights text[] NOT NULL DEFAULT '{}',
    audience text
  );
`;

let db;

before(async () => {
  db = new PGlite();
  await db.exec(RELEASE_SCHEMA);
});

after(async () => {
  await db.close();
});

test('the release migrations apply in order and seed published entries', async () => {
  await db.exec(await migration('038_release_intake_for_developers.sql'));
  await db.exec(await migration('040_release_describe_a_form_in_a_sentence.sql'));
  await db.exec(await migration('041_release_every_release_opens.sql'));

  const rows = await db.query(
    `SELECT slug, status, published_at FROM release
      WHERE slug IN ('intake-for-developers', 'describe-a-form-in-a-sentence', 'every-release-opens')
      ORDER BY slug`,
  );
  assert.equal(rows.rows.length, 3);
  for (const row of rows.rows) {
    assert.equal(row.status, 'published', `${row.slug} is public as soon as it is seeded`);
    assert.ok(row.published_at, `${row.slug} says when it was published`);
  }
});

test('the seeded entry carries the highlights and the notes the site shows', async () => {
  const row = await db.query(
    `SELECT title, summary, body, categories, highlights, audience FROM release WHERE slug = 'describe-a-form-in-a-sentence'`,
  );
  const release = row.rows[0];
  assert.ok(release, 'the entry exists');
  assert.equal(release.categories.length, 1);
  assert.equal(release.categories[0], 'feature');
  assert.equal(release.highlights.length, 5, 'five highlights, as the bundled entry has');
  assert.ok(release.audience && release.audience.length > 0, 'the entry says who it is for');
  assert.ok(release.body.length > 1000, 'the notes are the full notes, not a summary');
});

test('the notes do not claim a hosted form cannot do something it can', async () => {
  const row = await db.query(`SELECT body FROM release WHERE slug = 'describe-a-form-in-a-sentence'`);
  const body = row.rows[0].body;

  // A sign-in form is two questions — an email address and a one-time code — so the notes must
  // not list it among the things a hosted form cannot do.
  assert.ok(
    !/only appears for some people — a sign-in/.test(body),
    'a sign-in is not listed as unsupported',
  );
  assert.ok(/one-time code/.test(body), 'the notes explain the sign-in in one sentence');
});

test('the entry and the bundled notes say the same thing', async () => {
  // The site shows the bundled notes when the database is unreachable, and the database when it
  // is not. The two have to agree, or the changelog says one thing on a good day and another on
  // a bad one.
  const { BUNDLED_RELEASES } = await import('../src/content/changelog.ts');
  const bundled = BUNDLED_RELEASES.find(entry => entry.slug === 'describe-a-form-in-a-sentence');
  assert.ok(bundled, 'the bundled notes have the entry');

  const row = await db.query(
    `SELECT title, summary, body, categories, highlights, audience FROM release WHERE slug = 'describe-a-form-in-a-sentence'`,
  );
  const seeded = row.rows[0];

  assert.equal(seeded.title, bundled.title);
  assert.equal(seeded.summary, bundled.summary);
  assert.equal(seeded.body, bundled.body);
  assert.deepEqual(seeded.categories, bundled.categories);
  assert.deepEqual(seeded.highlights, bundled.highlights);
  assert.equal(seeded.audience, bundled.audience);
});

test('the routing fix entry and the bundled notes say the same thing', async () => {
  const { BUNDLED_RELEASES } = await import('../src/content/changelog.ts');
  const bundled = BUNDLED_RELEASES.find(entry => entry.slug === 'every-release-opens');
  assert.ok(bundled, 'the bundled notes have the entry');

  const row = await db.query(
    `SELECT title, summary, body, categories, highlights, audience FROM release WHERE slug = 'every-release-opens'`,
  );
  const seeded = row.rows[0];
  assert.ok(seeded, 'the entry is seeded');

  assert.equal(seeded.title, bundled.title);
  assert.equal(seeded.summary, bundled.summary);
  assert.equal(seeded.body, bundled.body);
  assert.deepEqual(seeded.categories, bundled.categories);
  assert.deepEqual(seeded.highlights, bundled.highlights);
  assert.equal(seeded.audience, bundled.audience);
});
