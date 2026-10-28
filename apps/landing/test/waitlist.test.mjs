import { after, before, beforeEach, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createServer } from 'node:http';
import { createHmac } from 'node:crypto';
import express from 'express';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresWaitlistStore } from '../server/waitlist/store.ts';
import { createWaitlistDelivery } from '../server/waitlist/delivery.ts';
import { createWaitlistRouter } from '../server/waitlist/routes.ts';
import { createMemoryRateLimitStore } from '../server/security/rate-limit.ts';
import { readEmailConfig } from '../server/email/config.ts';
import { createCalderProvider } from '../server/email/providers/calder.ts';
import { createEmailService } from '../server/email/service.ts';
import { createPostgresEmailStore } from '../server/email/store.ts';
import { handleCalderWebhook } from '../server/email/webhooks.ts';
import { WAITLIST_WELCOME_TEXT } from '../server/email/waitlist-welcome.ts';
import { isWaitlistEmail, normalizeWaitlistEmail } from '../src/lib/waitlist.ts';

let db;
let pool;
let store;
let emailStore;
const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
  for (const name of ['010_email.sql', '017_waitlist.sql', '018_waitlist_welcome.sql']) await db.exec(await migration(name));
  // Run the actual PostgreSQL statements, not a fake that would accept an unbound $1.
  pool = { async query(sql, params = []) {
    const result = await db.query(sql, params);
    return { rows: result.rows, rowCount: result.affectedRows ?? result.rows.length };
  } };
  store = createPostgresWaitlistStore(pool);
  emailStore = createPostgresEmailStore(pool);
});
after(async () => { await db?.close(); });
beforeEach(async () => { await db.exec('TRUNCATE waitlist, email_delivery, email_suppression, email_webhook_event'); });

function emailStack(handler, overrides = {}) {
  const config = readEmailConfig({
    CALDER_API_KEY: 'calder_sk_test_waitlist_contract', CALDER_FROM_EMAIL: 'system@intake.test',
    CALDER_REPLY_TO: 'support@intake.test', BETTER_AUTH_URL: 'https://intake.calder.click',
    CALDER_WEBHOOK_SECRET: 'whsec_waitlist_test_secret', ...overrides,
  });
  const calls = [];
  const provider = createCalderProvider({
    config, sleep: async () => undefined, random: () => .5,
    fetchImpl: async (url, init) => {
      const call = { url, init, body: JSON.parse(init.body) };
      calls.push(call);
      return handler ? handler(call, calls.length) : new Response(JSON.stringify({ id: `em_waitlist_${calls.length}`, status: 'queued' }), { status: 202 });
    },
  });
  const emails = createEmailService({ config, provider, store: emailStore, log: () => undefined });
  const delivery = createWaitlistDelivery({ store, emails });
  return { config, calls, emails, delivery };
}

async function mount(t, overrides = {}) {
  const app = express();
  app.use('/api/waitlist', createWaitlistRouter({ store, rateLimiter: createMemoryRateLimitStore(), ...overrides }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  return { base, post: (body, headers = {}) => fetch(`${base}/api/waitlist`, {
    method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body),
  }) };
}

async function row(id) { return (await db.query('SELECT * FROM waitlist WHERE id = $1', [id])).rows[0]; }
async function due(id) { await db.query("UPDATE waitlist SET welcome_next_attempt_at = now() - interval '1 second' WHERE id = $1", [id]); }

const APPROVED_TEXT = `Hey there,

I'm Daniel, the person building Intake, and I'm glad you're here.

We're building Intake to make working with information simpler — from collecting the right information to managing it without all the unnecessary manual work.

The idea is simple: you should be able to focus on what you need to get done, not spend so much time figuring out the tools you use to do it.

We're starting with AI-assisted form creation and editing, but this is only the beginning. Our vision for Intake goes beyond forms. We want to keep finding better ways to help people collect, organize, and work with information.

And we're just getting started.

We'll continue shipping updates, improving what we've built, and exploring new ways to make Intake more useful. As an early member of our community, you'll be among the first to hear about what's coming next.

We're building this to solve real problems, and your feedback can help shape what it becomes. If there's something you'd love Intake to help you do, just reply to this email. I'd genuinely love to hear from you.

Thanks for being here early and giving us a chance to build something worthwhile.

More soon!

Daniel
Founder, Intake
https://intake.calder.click`;

test('the migration merges old case variants, preserves the oldest event, and never revives removed entries', async () => {
  await db.exec('ALTER TABLE waitlist DROP CONSTRAINT waitlist_normalized_email');
  await db.query(`INSERT INTO waitlist (id, email, created_at) VALUES
    ('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', ' Ada@Example.com ', '2026-10-01'),
    ('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb', 'ada@example.com', '2026-10-02'),
    ('cccccccc-cccc-4ccc-8ccc-cccccccccccc', 'cccccccc-cccc-4ccc-8ccc-cccccccccccc_removed', '2026-10-03')`);
  await db.exec(await migration('018_waitlist_welcome.sql'));
  await db.exec(await migration('018_waitlist_welcome.sql'));
  const { items: rows, total } = await store.list({ limit: 10, offset: 0 });
  assert.equal(rows.length, 1, 'removed tombstones are not listed as subscribers');
  assert.equal(total, 1, 'removed tombstones do not inflate the subscriber total');
  const ada = rows.find(item => item.email === 'ada@example.com');
  assert.equal(ada.id, 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
  assert.equal(ada.welcomeStatus, 'pending');
  const removed = await row('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
  assert.equal(removed.welcome_status, 'suppressed');
  assert.equal(removed.welcome_error_code, 'legacy_removed');
  await assert.rejects(db.query("INSERT INTO waitlist (email) VALUES ('UPPER@example.com')"), /waitlist_normalized_email/);
});

test('admin subscriber totals cover all pages, deduplicate repeat joins, and exclude only removed entries', async () => {
  for (let i = 0; i < 31; i++) await store.subscribe(`subscriber${i}@example.com`);
  await store.subscribe(' SUBSCRIBER0@EXAMPLE.COM ');
  await db.query(`INSERT INTO waitlist (email, welcome_status, welcome_error_code)
    VALUES ('dddddddd-dddd-4ddd-8ddd-dddddddddddd_removed', 'suppressed', 'legacy_removed')`);
  await db.query(`UPDATE waitlist SET welcome_status = 'suppressed', welcome_error_code = 'email_suppressed'
    WHERE email = 'subscriber1@example.com'`);
  await db.query(`UPDATE waitlist SET welcome_status = 'blocked', welcome_error_code = 'email_authentication_failed'
    WHERE email = 'subscriber2@example.com'`);
  const first = await store.list({ limit: 25, offset: 0 });
  const second = await store.list({ limit: 25, offset: 25 });
  assert.equal(first.total, 31, 'total is not the current page length');
  assert.equal(second.total, 31, 'total stays the same on later pages');
  assert.equal(first.items.length, 25);
  assert.equal(second.items.length, 6);
  const emails = [...first.items, ...second.items].map(item => item.email);
  assert.equal(new Set(emails).size, 31);
  assert.ok(emails.includes('subscriber1@example.com'), 'mail suppression alone does not remove a signup');
  assert.ok(emails.includes('subscriber2@example.com'), 'failed welcomes still count as saved subscribers');
  assert.ok(emails.every(email => !email.endsWith('_removed')));
});

test('valid email normalization is shared with the browser, and unsafe/invalid recipients are rejected', () => {
  assert.equal(normalizeWaitlistEmail(' Ada+Early@Example.com '), 'ada+early@example.com');
  for (const email of ['ada@example.com', 'ada+early@example.co.uk', 'a@xn--example.test']) assert.equal(isWaitlistEmail(email), true, email);
  for (const email of ['', 'a@b', 'a@b..com', 'a@@b.com', '.a@example.com', 'a..b@example.com', 'a.@example.com',
    'a@-bad.com', 'a@bad-.com', 'Name <a@example.com>', 'a@example.com,b@example.com', 'a@b.com\r\nBcc: x@z.com',
    `${'a'.repeat(65)}@example.com`, `a@${'b'.repeat(64)}.com`]) assert.equal(isWaitlistEmail(email), false, email);
});

test('concurrent normalized signups have one durable row and only one worker can claim it', async () => {
  const entries = await Promise.all(Array.from({ length: 20 }, (_, i) => store.subscribe(i % 2 ? ' Ada@Example.com ' : 'ada@example.com')));
  assert.equal(new Set(entries.map(item => item.id)).size, 1);
  assert.equal((await store.list({ limit: 10, offset: 0 })).total, 1);
  const claims = await Promise.all(Array.from({ length: 15 }, () => store.claimWelcome(entries[0].id)));
  assert.equal(claims.filter(Boolean).length, 1);
  await store.finishWelcome(claims.find(Boolean), { status: 'accepted', nextAttemptAt: new Date(), errorCode: null });
  assert.equal(await store.claimWelcome(entries[0].id), null);
});

test('expired leases are recovered and a stale worker cannot overwrite the newer claim', async () => {
  const entry = await store.subscribe('lease@example.com');
  const old = await store.claimWelcome(entry.id);
  await db.query("UPDATE waitlist SET welcome_claimed_at = now() - interval '6 minutes' WHERE id = $1", [entry.id]);
  assert.deepEqual(await store.pendingIds(10), [entry.id]);
  const fresh = await store.claimWelcome(entry.id);
  assert.equal(fresh.attempt, old.attempt + 1);
  await store.finishWelcome(old, { status: 'blocked', nextAttemptAt: new Date(), errorCode: 'stale' });
  assert.equal((await row(entry.id)).welcome_status, 'sending');
  await store.finishWelcome(fresh, { status: 'accepted', nextAttemptAt: new Date(), errorCode: null });
  assert.equal((await row(entry.id)).welcome_status, 'accepted');
});

test('public joins are private, idempotent, and save before waking the welcome queue', async t => {
  let wakes = 0;
  const api = await mount(t, { onJoin: () => { wakes++; } });
  for (const email of [' Ada@Example.com ', 'ada@example.com']) {
    const response = await api.post({ email, website: '' });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.deepEqual(await response.json(), { status: 'joined' });
  }
  assert.equal(wakes, 2);
  const data = await store.list({ limit: 10, offset: 0 });
  assert.equal(data.total, 1);
  assert.equal(data.items[0].email, 'ada@example.com');
  assert.equal(data.items[0].welcomeStatus, 'pending');
  assert.equal((await fetch(`${api.base}/api/waitlist`)).status, 404, 'there is no public list/read endpoint');
});

test('invalid bodies, oversized requests, cross-site requests, and bots cannot enqueue mail', async t => {
  let writes = 0;
  const api = await mount(t, { store: { async subscribe() { writes++; } }, rateLimiter: { consume: async () => ({ allowed: true }) } });
  for (const body of [{}, { email: '' }, { email: 'bad' }, { email: 'a@b..com' }, { email: 'x@example.com', website: [] },
    { email: 'x@example.com', from: 'attacker@example.com' }, [], { email: 'a@b.com\nBcc: x@example.com' }]) {
    assert.equal((await api.post(body)).status, 400, JSON.stringify(body));
  }
  assert.equal((await api.post({ email: 'x@example.com', website: 'spam' })).status, 200);
  assert.equal((await api.post({ email: 'x@example.com' }, { 'Sec-Fetch-Site': 'cross-site' })).status, 403);
  const malformed = await fetch(`${api.base}/api/waitlist`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{' });
  assert.equal(malformed.status, 400);
  const oversized = await api.post({ email: 'x'.repeat(5_000) });
  assert.equal(oversized.status, 413);
  const wrongType = await fetch(`${api.base}/api/waitlist`, { method: 'POST', headers: { 'Content-Type': 'text/plain' }, body: 'x@example.com' });
  assert.equal(wrongType.status, 415);
  assert.equal(writes, 0);
});

test('rate limits fail closed and storage failures never claim a saved signup', async t => {
  let writes = 0;
  const blocked = await mount(t, {
    store: { async subscribe() { writes++; } }, rateLimiter: { consume: async () => ({ allowed: false, retryAfterSeconds: 73 }) },
  });
  const response = await blocked.post({ email: 'ada@example.com' });
  assert.equal(response.status, 429);
  assert.equal(response.headers.get('retry-after'), '73');
  const unavailable = await mount(t, { store: { async subscribe() { writes++; } }, rateLimiter: { async consume() { throw Error('secret storage error'); } } });
  assert.equal((await unavailable.post({ email: 'ada@example.com' })).status, 503);
  assert.equal(writes, 0);
  const targeted = await mount(t, {
    store: { async subscribe() { writes++; } },
    rateLimiter: { consume: async scope => ({ allowed: scope !== 'waitlist.join.email', retryAfterSeconds: 42 }) },
  });
  const recipientLimited = await targeted.post({ email: 'ada@example.com' });
  assert.equal(recipientLimited.status, 429);
  assert.equal(recipientLimited.headers.get('retry-after'), '42');
  assert.equal(writes, 0);
  let wakes = 0;
  const brokenDb = await mount(t, { store: { async subscribe() { throw Error('postgres://secret'); } }, onJoin: () => { wakes++; } });
  const failure = await brokenDb.post({ email: 'ada@example.com' });
  assert.equal(failure.status, 503);
  assert.doesNotMatch(await failure.text(), /postgres|secret|joined/);
  assert.equal(wakes, 0);
});

test('a successful join sends Daniel’s exact letter, from the right address, without creating an account', async t => {
  const stack = emailStack(null, { CALDER_TEMPLATE_WAITLIST_WELCOME: 'wrong-dashboard-copy' });
  const api = await mount(t, { onJoin: () => { void stack.delivery.flush(); } });
  assert.equal((await api.post({ email: 'Ada@Example.com' })).status, 200);
  await stack.delivery.flush();
  assert.equal(WAITLIST_WELCOME_TEXT, APPROVED_TEXT);
  assert.equal(stack.calls.length, 1);
  const { body, init, url } = stack.calls[0];
  assert.equal(url, 'https://api.calder.click/v1/emails');
  assert.equal(body.from, 'daniel@intake.calder.click');
  assert.equal(body.reply_to, 'daniel@intake.calder.click', 'the system reply-to must not steal Daniel’s replies');
  assert.equal(body.to, 'ada@example.com');
  assert.equal(body.stream, 'transactional');
  // The letter is still Daniel's, word for word. What changed is the envelope: the new shell adds a
  // footer outside the letter (why you are on the list, and a way off it), so the body is asserted as
  // a prefix rather than the whole message.
  assert.ok(body.text.startsWith(APPROVED_TEXT), 'Daniel\'s copy is still verbatim and unedited');
  assert.match(body.text, /joined the Intake wait-list/, 'the footer says why the letter arrived');
  assert.doesNotMatch(body.text, /Unsubscribe: /, 'no link is invented when the caller supplies none');
  assert.equal(body.template, undefined, 'dashboard aliases cannot replace the approved wait-list letter');
  assert.doesNotMatch(body.html, /required to keep your account secure|Welcome in|<script/);
  assert.match(body.html, /Founder, Intake/);
  const entry = (await store.list({ limit: 10, offset: 0 })).items[0];
  assert.equal(entry.welcomeStatus, 'accepted');
  assert.equal(init.headers['idempotency-key'], `intake:waitlist-welcome:waitlist:${entry.id}`);
  assert.equal((await db.query('SELECT count(*)::int AS count FROM "user"')).rows[0].count, 0);
  for (let i = 0; i < 3; i++) {
    await api.post({ email: 'ada@example.com' });
    await stack.delivery.flush();
  }
  assert.equal(stack.calls.length, 1, 'rejoining never resends an accepted welcome');
});

test('transient delivery failures remain queued; retries update the original record and keep identical bytes', async () => {
  const first = emailStack(() => new Response(JSON.stringify({ error: { code: 'internal_error' } }), { status: 503 }));
  const entry = await store.subscribe('retry@example.com');
  await first.delivery.flush();
  assert.equal(first.calls.length, 3, 'provider retries are bounded');
  const failed = await row(entry.id);
  assert.equal(failed.welcome_status, 'pending');
  assert.equal(failed.welcome_error_code, 'email_provider_unavailable');
  assert.ok(failed.welcome_next_attempt_at > new Date());
  const original = (await db.query('SELECT * FROM email_delivery')).rows[0];
  assert.equal(original.status, 'failed');
  await store.subscribe('RETRY@example.com');
  assert.equal((await row(entry.id)).welcome_next_attempt_at.getTime(), failed.welcome_next_attempt_at.getTime());
  await due(entry.id);
  const recovered = emailStack(); // a fresh process/service, using the durable database
  await recovered.delivery.flush();
  assert.equal((await row(entry.id)).welcome_status, 'accepted');
  const updated = (await db.query('SELECT * FROM email_delivery')).rows;
  assert.equal(updated.length, 1);
  assert.equal(updated[0].id, original.id);
  assert.equal(updated[0].status, 'accepted');
  assert.equal(updated[0].provider_message_id, 'em_waitlist_1');
  assert.equal(first.calls[0].init.headers['idempotency-key'], recovered.calls[0].init.headers['idempotency-key']);
  assert.deepEqual(first.calls[0].body, recovered.calls[0].body, 'every retry is the same business message');
});

test('missing configuration keeps the signup pending, and later setup sends it with a traceable canonical record', async () => {
  const unavailable = emailStack(null, { CALDER_API_KEY: '', CALDER_FROM_EMAIL: '' });
  const entry = await store.subscribe('later@example.com');
  await unavailable.delivery.flush();
  assert.equal(unavailable.calls.length, 0);
  assert.equal((await row(entry.id)).welcome_status, 'pending');
  assert.equal((await row(entry.id)).welcome_error_code, 'email_provider_not_configured');
  const previous = (await db.query('SELECT * FROM email_delivery')).rows[0];
  await due(entry.id);
  const configured = emailStack();
  await configured.delivery.flush();
  const recorded = (await db.query('SELECT * FROM email_delivery')).rows[0];
  assert.equal(recorded.id, previous.id);
  assert.equal(recorded.provider, 'calder');
  assert.ok(recorded.subject.includes('Daniel'));
  assert.equal(recorded.status, 'accepted');
  assert.equal((await row(entry.id)).welcome_status, 'accepted');
});

test('suppression and permanent sender failures are terminal, never emailed on repeated joins', async () => {
  await emailStore.suppress('bounced@example.com', 'bounce', 'test');
  const blocked = emailStack(() => new Response(JSON.stringify({ error: { code: 'domain_not_verified' } }), { status: 403 }));
  const suppressed = await store.subscribe('bounced@example.com');
  const unverified = await store.subscribe('sender@example.com');
  await blocked.delivery.flush();
  assert.equal((await row(suppressed.id)).welcome_status, 'suppressed');
  assert.equal((await row(unverified.id)).welcome_status, 'blocked');
  assert.equal((await row(unverified.id)).welcome_error_code, 'email_sender_not_verified');
  assert.equal(blocked.calls.length, 1, 'suppressed addresses never reach the provider');
  await store.subscribe('sender@example.com');
  await blocked.delivery.flush();
  assert.equal(blocked.calls.length, 1, 'a permanent failure needs operator intervention, not automatic retries');
});

test('lost outbox finishes recover from the local acceptance record even after provider replay expiry', async () => {
  const entry = await store.subscribe('accepted@example.com');
  const first = emailStack();
  await first.delivery.flush();
  // Simulate a process crash between local provider acceptance and settling the outbox lease.
  await db.query("UPDATE waitlist SET welcome_status = 'sending', welcome_claimed_at = now() - interval '6 minutes' WHERE id = $1", [entry.id]);
  const restarted = emailStack();
  await restarted.delivery.flush();
  assert.equal(restarted.calls.length, 0, 'local acceptance prevents a second provider send altogether');
  assert.equal((await row(entry.id)).welcome_status, 'accepted');
});

test('delivery webhooks correlate the welcome and confirm inbox delivery, not just provider acceptance', async () => {
  const entry = await store.subscribe('delivered@example.com');
  const stack = emailStack();
  await stack.delivery.flush();
  const record = (await db.query('SELECT * FROM email_delivery')).rows[0];
  assert.equal(record.status, 'accepted');
  const timestamp = Math.floor(Date.now() / 1000);
  const body = JSON.stringify({ id: 'whd_waitlist_delivered', type: 'email.delivered', createdAt: new Date().toISOString(), data: { emailId: record.provider_message_id } });
  const signature = createHmac('sha256', stack.config.webhookSecret).update(`${timestamp}.${body}`).digest('hex');
  const result = await handleCalderWebhook({ store: emailStore, config: stack.config, log: () => undefined }, body, `t=${timestamp},v1=${signature}`, timestamp);
  assert.equal(result.status, 200);
  assert.equal((await emailStore.findByProviderMessageId(record.provider_message_id)).status, 'delivered');
  assert.equal((await row(entry.id)).welcome_status, 'accepted', 'outbox acceptance is intentionally a separate state');
});

test('overlapping worker flushes are bounded and do not email a backlog entry twice', async () => {
  for (let i = 0; i < 10; i++) await store.subscribe(`reader-${i}@example.com`);
  let inFlight = 0;
  let maximum = 0;
  const seen = [];
  const stack = emailStack(async call => {
    inFlight++;
    maximum = Math.max(maximum, inFlight);
    seen.push(call.body.to);
    await new Promise(resolve => setTimeout(resolve, 5));
    inFlight--;
    return new Response(JSON.stringify({ id: `em_${call.body.to.split('@')[0]}`, status: 'queued' }), { status: 202 });
  });
  const other = createWaitlistDelivery({ store, emails: stack.emails });
  await Promise.all([stack.delivery.flush(), stack.delivery.flush(), other.flush()]);
  assert.equal(seen.length, 10);
  assert.equal(new Set(seen).size, 10);
  assert.ok(maximum <= 6, 'each independent worker sends at most three at a time');
  assert.equal((await store.list({ limit: 20, offset: 0 })).items.every(item => item.welcomeStatus === 'accepted'), true);
  await stack.delivery.stop();
  await stack.delivery.flush();
  assert.equal(seen.length, 10);
});
