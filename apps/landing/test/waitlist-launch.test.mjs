import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import {
  createPostgresLaunchStore, isWaitlistId, unsubscribeToken, unsubscribeUrl, verifyUnsubscribeToken,
} from '../server/waitlist/launch.ts';
import { createUnsubscribeRouter } from '../server/waitlist/unsubscribe.ts';
import { createPostgresWaitlistStore } from '../server/waitlist/store.ts';

const SECRET = 'test-secret-must-be-at-least-32-characters';
const ORIGIN = 'https://intake.example';
const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;
let pool;
let launch;
let waitlist;

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
  for (const name of ['010_email.sql', '017_waitlist.sql', '018_waitlist_welcome.sql', '021_waitlist_launch.sql']) {
    await db.exec(await migration(name));
  }
  pool = {
    async query(sql, params = []) {
      const result = await db.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  };
  launch = createPostgresLaunchStore(pool);
  waitlist = createPostgresWaitlistStore(pool);
});

after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('TRUNCATE waitlist, waitlist_launch_send'); });

async function join(addresses) {
  const ids = [];
  for (const address of addresses) ids.push((await waitlist.subscribe(address)).id);
  return ids;
}

test('a campaign is owed once per subscriber, and recording it settles the debt', async () => {
  await join(['one@example.test', 'two@example.test', 'three@example.test']);
  const first = await launch.pending('launch_announcement', 10);
  assert.equal(first.length, 3);
  assert.equal(await launch.countPending('launch_announcement'), 3);

  await launch.record(first[0], 'launch_announcement', 'delivery-1', 'accepted');
  const second = await launch.pending('launch_announcement', 10);
  assert.equal(second.length, 2, 'a delivered row is not owed again');
  assert.equal(second.some(row => row.id === first[0].id), false);

  // The whole point of the table: running the sender twice must not mail anyone twice.
  await launch.record(first[0], 'launch_announcement', 'delivery-1', 'accepted');
  assert.equal(await launch.countPending('launch_announcement'), 2);
});

test('the two launch letters are separate debts, and a failure is retried', async () => {
  const [id] = await join(['one@example.test']);
  const recipient = { id, email: 'one@example.test' };

  await launch.record(recipient, 'launch_announcement', 'delivery-1', 'accepted');
  assert.equal(await launch.countPending('launch_announcement'), 0);
  assert.equal(await launch.countPending('launch_note'), 1, 'the personal note is still owed');

  // A failed attempt must not stop the next run from trying again.
  await launch.record({ id: (await join(['two@example.test']))[0], email: 'two@example.test' }, 'launch_announcement', 'delivery-2', 'failed');
  const pending = await launch.pending('launch_announcement', 10);
  assert.deepEqual(pending.map(row => row.email), ['two@example.test']);
});

test('an unsubscribe removes someone from every future campaign, permanently', async () => {
  const [keep, leave] = await join(['keep@example.test', 'leave@example.test']);
  assert.equal(await launch.unsubscribe(leave), true);
  assert.equal(await launch.unsubscribe(leave), false, 'unsubscribing twice is not an error, just a no-op');

  const pending = await launch.pending('launch_note', 10);
  assert.deepEqual(pending.map(row => row.email), ['keep@example.test']);
  assert.equal(await launch.countPending('launch_announcement'), 1);
  const stored = await db.query('SELECT unsubscribed_at FROM waitlist WHERE id = $1', [keep]);
  assert.equal(stored.rows[0].unsubscribed_at, null, 'nobody else is touched');
});

test('an unsubscribe link is bound to one row and cannot be forged', () => {
  const id = '3f1a6c2e-8b4d-4f7a-9c1e-2d5b8a0f4e61';
  const token = unsubscribeToken(id, SECRET);
  assert.equal(token.length, 32);
  assert.equal(verifyUnsubscribeToken(id, token, SECRET), true);
  assert.equal(verifyUnsubscribeToken(id, token, `${SECRET}-other`), false, 'another secret cannot mint links');
  assert.equal(verifyUnsubscribeToken(id, token.slice(0, 31) + (token.endsWith('A') ? 'B' : 'A'), SECRET), false);
  assert.equal(verifyUnsubscribeToken('3f1a6c2e-8b4d-4f7a-9c1e-2d5b8a0f4e62', token, SECRET), false, 'a different row rejects it');
  assert.equal(verifyUnsubscribeToken(id, '', SECRET), false);
  assert.equal(verifyUnsubscribeToken(id, 'x'.repeat(32), SECRET), false);
  assert.equal(isWaitlistId('not-a-uuid'), false);
  assert.equal(isWaitlistId(id), true);

  const url = new URL(unsubscribeUrl(ORIGIN, id, SECRET));
  assert.equal(url.origin, ORIGIN);
  assert.equal(url.pathname, '/api/waitlist/unsubscribe');
  assert.equal(url.searchParams.get('id'), id);
  assert.equal(url.searchParams.get('token'), token);
  assert.equal(url.toString().includes('@'), false, 'no address may ever appear in a link');
});

test('the unsubscribe page is reachable, honest, and reveals nothing about the list', async () => {
  const [id] = await join(['reader@example.test']);
  const app = express();
  app.use('/api/waitlist/unsubscribe', createUnsubscribeRouter({ store: launch, secret: SECRET }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}/api/waitlist/unsubscribe`;
  try {
    const forged = await fetch(`${base}?id=${id}&token=${'a'.repeat(32)}`);
    assert.equal(forged.status, 400);
    assert.match(await forged.text(), /not valid/i);
    const still = await db.query('SELECT unsubscribed_at FROM waitlist WHERE id = $1', [id]);
    assert.equal(still.rows[0].unsubscribed_at, null, 'a forged link changes nothing');

    const unknown = await fetch(`${base}?id=3f1a6c2e-8b4d-4f7a-9c1e-2d5b8a0f4e61&token=${'a'.repeat(32)}`);
    assert.equal(unknown.status, 400, 'an id that does not exist answers the same as a forged token');

    const real = await fetch(`${base}?id=${id}&token=${unsubscribeToken(id, SECRET)}`);
    assert.equal(real.status, 200);
    const html = await real.text();
    assert.match(html, /off the list/i);
    assert.match(html, /password reset/, 'it says which mail still arrives, rather than pretending none will');
    assert.equal(html.includes('@'), false, 'the page never repeats the address back');
    const gone = await db.query('SELECT unsubscribed_at FROM waitlist WHERE id = $1', [id]);
    assert.ok(gone.rows[0].unsubscribed_at instanceof Date);

    const again = await fetch(`${base}?id=${id}&token=${unsubscribeToken(id, SECRET)}`);
    assert.equal(again.status, 200, 'clicking twice is not an error page');
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
