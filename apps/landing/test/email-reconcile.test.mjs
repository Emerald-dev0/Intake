import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { mapProviderDeliveryStatus, reconcileDeliveries, stuckDeliveries } from '../server/email/reconcile.ts';

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;
let pool;

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
  await db.exec(await migration('010_email.sql'));
  pool = {
    async query(sql, params = []) {
      const result = await db.query(sql, params);
      return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
    },
  };
});

after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('TRUNCATE email_delivery'); });

let counter = 0;
/** A delivery as the service writes it: accepted by the provider, settled later or never. */
async function delivery({ status = 'queued', providerMessageId = `em_${++counter}`, ageMinutes = 30, emailType = 'otp' } = {}) {
  const id = `del_${counter}_${Math.random().toString(36).slice(2, 8)}`;
  const createdAt = new Date(Date.now() - ageMinutes * 60_000);
  await db.query(
    `INSERT INTO email_delivery (id, event_id, email_type, recipient, subject, status, provider, provider_message_id, idempotency_key, created_at, updated_at)
     VALUES ($1, $2, $3, 'ada@example.test', 'Subject', $4, 'calder', $5, $6, $7, $7)`,
    [id, `ev_${id}`, emailType, status, providerMessageId, `key:${id}`, createdAt],
  );
  return { id, providerMessageId };
}

const read = async id => (await db.query('SELECT status FROM email_delivery WHERE id = $1', [id])).rows[0].status;

test("the provider's vocabulary maps onto ours, and anything unknown stays unknown", () => {
  assert.equal(mapProviderDeliveryStatus('queued'), 'queued');
  assert.equal(mapProviderDeliveryStatus('sending'), 'queued');
  assert.equal(mapProviderDeliveryStatus('delivered'), 'delivered');
  assert.equal(mapProviderDeliveryStatus('Delivered'), 'delivered', 'case is not a reason to fail');
  assert.equal(mapProviderDeliveryStatus('failed'), 'failed_remote');
  assert.equal(mapProviderDeliveryStatus('bounced'), 'bounced');
  // Guessing here would mean reporting a status we invented to a user.
  assert.equal(mapProviderDeliveryStatus('weird_provider_state'), null);
  assert.equal(mapProviderDeliveryStatus(''), null);
});

test('a delivery the provider accepted and then failed is corrected, not left looking sent', async () => {
  // This is the exact shape of a real incident: 202 from the provider, `queued` in our table, and the
  // transport gave up ninety seconds later. Without reconciliation the row stays `queued` for ever.
  const { id, providerMessageId } = await delivery({ status: 'queued' });
  const result = await reconcileDeliveries({
    query: pool.query,
    status: async messageId => {
      assert.equal(messageId, providerMessageId);
      return { status: 'failed' };
    },
  });
  assert.equal(result.checked, 1);
  assert.equal(result.updated, 1);
  assert.deepEqual(result.changes, [{ id, emailType: 'otp', from: 'queued', to: 'failed_remote' }]);
  assert.equal(await read(id), 'failed_remote');
});

test('a settled delivery is never reopened, downgraded or un-bounced', async () => {
  const delivered = await delivery({ status: 'queued' });
  const bounced = await delivery({ status: 'bounced' });

  const first = await reconcileDeliveries({ query: pool.query, status: async () => ({ status: 'delivered' }) });
  assert.equal(first.updated, 1, 'only the open row moved');
  assert.equal(await read(delivered.id), 'delivered');
  assert.equal(await read(bounced.id), 'bounced', 'a bounce is final');

  // A later, weaker answer must not walk a delivered message backwards.
  const second = await reconcileDeliveries({ query: pool.query, status: async () => ({ status: 'sent' }) });
  assert.equal(second.updated, 0);
  assert.equal(await read(delivered.id), 'delivered');
});

test('rows too young to judge, and rows with no provider id, are left alone', async () => {
  const fresh = await delivery({ status: 'queued', ageMinutes: 1 });
  const noId = await delivery({ status: 'queued', providerMessageId: null, ageMinutes: 60 });

  const stuck = await stuckDeliveries({ query: pool.query, graceMs: 5 * 60_000 });
  assert.equal(stuck.some(row => row.id === fresh.id), false, 'a queued message moments old is not a problem yet');
  assert.equal(stuck.some(row => row.id === noId.id), false, 'there is nothing to ask about without an id');

  const result = await reconcileDeliveries({ query: pool.query, status: async () => ({ status: 'failed' }) });
  assert.equal(result.checked, 0);
  assert.equal(await read(fresh.id), 'queued');
});

test('an unreachable or unhelpful provider leaves the row honest rather than guessed', async () => {
  const unanswered = await delivery({ status: 'queued' });
  const nothing = await delivery({ status: 'queued' });

  const thrown = await reconcileDeliveries({
    query: pool.query,
    status: async messageId => { if (messageId === unanswered.providerMessageId) throw new Error('network'); return null; },
  });
  assert.equal(thrown.unreachable, 2, 'a thrown call and a null answer are both "no answer"');
  assert.equal(thrown.updated, 0);
  assert.equal(await read(unanswered.id), 'queued');
  assert.equal(await read(nothing.id), 'queued');

  const unknown = await reconcileDeliveries({ query: pool.query, status: async () => ({ status: 'some_new_state' }) });
  assert.equal(unknown.unknown, 2);
  assert.equal(await read(nothing.id), 'queued', 'an unrecognised state is not a reason to close a row');
});
