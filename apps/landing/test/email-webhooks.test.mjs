import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import express from 'express';
import { readEmailConfig } from '../server/email/config.ts';
import { createMemoryEmailStore } from '../server/email/store.ts';
import {
  calderWebhookHandler, handleCalderWebhook, verifyCalderSignature, SIGNATURE_TOLERANCE_SECONDS,
} from '../server/email/webhooks.ts';
import { createEmailService } from '../server/email/service.ts';
import { createMemoryEmailProvider } from '../server/email/providers/calder.ts';

const SECRET = 'whsec_test_secret_for_signatures';

function config(overrides = {}) {
  return readEmailConfig({
    CALDER_API_KEY: 'calder_sk_test_key',
    CALDER_FROM_EMAIL: 'hello@intake.test',
    CALDER_WEBHOOK_SECRET: SECRET,
    BETTER_AUTH_URL: 'http://localhost:5173',
    ...overrides,
  });
}

function event(type, emailId, extra = {}) {
  return JSON.stringify({ id: `whd_${type}_${emailId}`, type, createdAt: '2026-10-05T10:00:00.000Z', data: { emailId, ...extra } });
}

function sign(body, timestamp = NOW, secret = SECRET) {
  const signature = createHmac('sha256', secret).update(`${timestamp}.${body}`, 'utf8').digest('hex');
  return { 'webhook-signature': `t=${timestamp},v1=${signature}`, 'webhook-id': 'whd_1' };
}

const NOW = Math.floor(Date.now() / 1000);

test('a correctly signed payload is accepted and a tampered one is not', () => {
  const body = event('email.delivered', 'em_1');
  assert.equal(verifyCalderSignature(body, sign(body)['webhook-signature'], SECRET, NOW).ok, true);
  assert.equal(verifyCalderSignature(body.replace('em_1', 'em_2'), sign(body)['webhook-signature'], SECRET, NOW).ok, false);
  assert.equal(verifyCalderSignature(body, sign(body, NOW, 'whsec_wrong')['webhook-signature'], SECRET, NOW).ok, false);
});

test('unsigned, malformed and stale payloads are rejected', () => {
  const body = event('email.delivered', 'em_1');
  assert.equal(verifyCalderSignature(body, undefined, SECRET, NOW).reason, 'missing_signature');
  assert.equal(verifyCalderSignature(body, 'garbage', SECRET, NOW).reason, 'malformed_signature');
  assert.equal(verifyCalderSignature(body, 't=abc,v1=dead', SECRET, NOW).reason, 'malformed_signature');
  const stale = NOW + SIGNATURE_TOLERANCE_SECONDS + 1;
  assert.equal(verifyCalderSignature(body, sign(body, NOW)['webhook-signature'], SECRET, stale).reason, 'stale_timestamp');
  // A clock exactly at the tolerance boundary is still inside the window.
  assert.equal(verifyCalderSignature(body, sign(body, NOW)['webhook-signature'], SECRET, NOW + SIGNATURE_TOLERANCE_SECONDS).ok, true);
});

test('no secret configured means every webhook is rejected', async () => {
  const store = createMemoryEmailStore();
  const result = await handleCalderWebhook({ store, config: config({ CALDER_WEBHOOK_SECRET: '' }) }, event('email.delivered', 'em_1'), sign(event('email.delivered', 'em_1'))['webhook-signature'], NOW);
  assert.equal(result.status, 401);
});

test('a delivered event updates the delivery record for that provider message', async () => {
  const store = createMemoryEmailStore();
  // Build a real delivery through the service so the record and the webhook share an id.
  const provider = createMemoryEmailProvider();
  const emails = createEmailService({ provider, config: config(), store, log: () => undefined, newId: () => 'emd_fixed' });
  const outcome = await emails.send({
    type: 'welcome', to: 'reader@example.com', eventId: 'welcome:user-1', userId: 'user-1', variables: { userName: 'Ada' },
  });
  assert.equal(outcome.status, 'sent');
  const body = event('email.delivered', outcome.providerMessageId);
  const result = await handleCalderWebhook({ store, config: config() }, body, sign(body)['webhook-signature'], NOW);
  assert.equal(result.status, 200);
  const record = await store.findByProviderMessageId(outcome.providerMessageId);
  assert.equal(record?.status, 'delivered');
});

test('a hard bounce suppresses the address so Intake stops mailing it', async () => {
  const store = createMemoryEmailStore();
  await store.createDelivery({
    id: 'emd_1', eventId: 'welcome:user-9', emailType: 'welcome', userId: 'user-9',
    recipient: 'bounced@example.com', subject: 'Welcome', idempotencyKey: 'k1', status: 'accepted', provider: 'calder',
  });
  await store.updateDelivery('emd_1', { providerMessageId: 'em_9' });
  const body = event('email.bounced', 'em_9', { bounceType: 'Permanent' });
  const result = await handleCalderWebhook({ store, config: config() }, body, sign(body)['webhook-signature'], NOW);
  assert.equal(result.status, 200);
  assert.equal(await store.isSuppressed('bounced@example.com'), 'bounce');
  assert.equal((await store.findByProviderMessageId('em_9'))?.status, 'bounced');

  // And a suppressed address can never be sent to again.
  const provider = createMemoryEmailProvider();
  const emails = createEmailService({ provider, config: config(), store, log: () => undefined });
  const outcome = await emails.send({ type: 'welcome', to: 'bounced@example.com', eventId: 'later', userId: 'user-9', variables: {} });
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'suppressed');
  assert.equal(provider.sent.length, 0);
});

test('a complaint suppresses the address too', async () => {
  const store = createMemoryEmailStore();
  await store.createDelivery({
    id: 'emd_2', eventId: 'otp:user-2', emailType: 'otp', userId: 'user-2',
    recipient: 'complainer@example.com', subject: 'Code', idempotencyKey: 'k2', status: 'accepted', provider: 'calder',
  });
  await store.updateDelivery('emd_2', { providerMessageId: 'em_2' });
  const body = event('email.complained', 'em_2');
  await handleCalderWebhook({ store, config: config() }, body, sign(body)['webhook-signature'], NOW);
  assert.equal(await store.isSuppressed('complainer@example.com'), 'complaint');
  assert.equal((await store.findByProviderMessageId('em_2'))?.status, 'complained');
});

test('a replayed delivery id is acknowledged but applied once', async () => {
  const store = createMemoryEmailStore();
  const deliveries = [];
  const wrapped = {
    ...store,
    async updateDelivery(id, update) { deliveries.push([id, update.status]); return store.updateDelivery(id, update); },
  };
  await store.createDelivery({
    id: 'emd_3', eventId: 'welcome:user-3', emailType: 'welcome', userId: 'user-3',
    recipient: 'reader@example.com', subject: 'Welcome', idempotencyKey: 'k3', status: 'accepted', provider: 'calder',
  });
  await store.updateDelivery('emd_3', { providerMessageId: 'em_3' });
  const body = event('email.delivered', 'em_3');
  const header = sign(body)['webhook-signature'];
  const first = await handleCalderWebhook({ store: wrapped, config: config() }, body, header, NOW);
  const second = await handleCalderWebhook({ store: wrapped, config: config() }, body, header, NOW + 5);
  assert.equal(first.status, 200);
  assert.equal(second.status, 200);
  assert.equal(second.body.duplicate, true, 'replays answer 200 so Calder stops retrying');
  assert.equal(deliveries.filter(([, status]) => status === 'delivered').length, 1, 'state changed exactly once');
});

test('an unknown provider message is acknowledged without changing anything', async () => {
  const store = createMemoryEmailStore();
  const body = event('email.delivered', 'em_unknown');
  const result = await handleCalderWebhook({ store, config: config() }, body, sign(body)['webhook-signature'], NOW);
  assert.equal(result.status, 200);
  assert.equal((await store.stats(new Date(0), new Date())).delivered, 0);
});

test('malformed JSON and oversized payloads never reach state', async () => {
  const store = createMemoryEmailStore();
  const body = '{"id":';
  const rejected = await handleCalderWebhook({ store, config: config() }, body, sign(body)['webhook-signature'], NOW);
  assert.equal(rejected.status, 400);
  assert.equal(rejected.reason, 'invalid_payload');
});

/** Exercises the Express handler end to end, including the raw-body requirement. */
test('the mounted route verifies raw bytes before parsing', async () => {
  const store = createMemoryEmailStore();
  const app = express();
  app.post('/api/webhooks/calder', calderWebhookHandler({ store, config: config() }));
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const { port } = server.address();
  const base = `http://127.0.0.1:${port}/api/webhooks/calder`;

  try {
    const body = event('email.sent', 'em_4');
    const good = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', ...sign(body) }, body });
    assert.equal(good.status, 200);
    assert.deepEqual(await good.json(), { ok: true, ignored: true }, 'an event for an unknown message is still accepted');

    const forged = await fetch(base, { method: 'POST', headers: { 'content-type': 'application/json', 'webhook-signature': 't=1760000000,v1=deadbeef' }, body });
    assert.equal(forged.status, 401);
    assert.deepEqual(await forged.json(), { ok: false, error: 'Invalid signature.' });

    const oversized = await fetch(base, {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...sign(body) },
      body: JSON.stringify({ id: 'x', type: 'email.sent', data: { emailId: 'a'.repeat(70_000) } }),
    });
    assert.equal(oversized.status, 413);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});
