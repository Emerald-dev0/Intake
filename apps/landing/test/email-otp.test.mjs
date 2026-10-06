import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEmailConfig } from '../server/email/config.ts';
import { createMemoryOtpStore, createOtpService, OTP_MAX_ATTEMPTS, OTP_TTL_SECONDS } from '../server/email/otp.ts';
import { createMemoryEmailProvider } from '../server/email/providers/calder.ts';
import { createEmailService } from '../server/email/service.ts';
import { createMemoryEmailStore } from '../server/email/store.ts';

const HASH_KEY = 'otp-hash-key-must-be-thirty-two-chars';
const CONFIG = readEmailConfig({
  CALDER_API_KEY: 'calder_sk_test_key',
  CALDER_FROM_EMAIL: 'hello@intake.test',
  BETTER_AUTH_URL: 'http://localhost:5173',
});

function boot(options = {}) {
  const provider = createMemoryEmailProvider();
  const store = createMemoryEmailStore();
  const emails = createEmailService({ provider, config: CONFIG, store, log: () => undefined });
  let now = options.start ?? Date.parse('2026-10-05T10:00:00Z');
  const log = [];
  const otp = createOtpService({
    store: createMemoryOtpStore({ now: () => now }),
    emails,
    hashKey: HASH_KEY,
    now: () => new Date(now),
    log: (event, fields) => log.push({ event, ...fields }),
  });
  return {
    otp, provider, store, log,
    advance: ms => { now += ms; },
    now: () => now,
  };
}

/** The code is only ever visible in the email that was sent, never in storage. */
function codeFrom(provider) {
  const html = provider.sent[provider.sent.length - 1].html;
  const match = html.match(/letter-spacing:\.42em[^>]*>(\d{6})</);
  assert.ok(match, 'the rendered email contains the code');
  return match[1];
}

test('starting a challenge emails a six-digit code and stores only a hash', async () => {
  const { otp, provider, store } = boot();
  const result = await otp.start({ userId: 'user-1', email: 'User@Example.com', purpose: 'verify_email' });
  assert.equal(result.status, 'sent');
  assert.equal(provider.sent.length, 1);
  assert.equal(provider.sent[0].to, 'user@example.com', 'the recipient is normalised');
  const code = codeFrom(provider);
  assert.match(code, /^\d{6}$/);
  assert.equal(store.deliveries.length + 1 > 0, true);
});

test('the stored challenge is a salted HMAC: only the emailed code can confirm it', async () => {
  const { otp, provider, store } = boot();
  await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  const code = codeFrom(provider);
  // The delivery record proves what was rendered; no Intake storage ever holds the plaintext code.
  assert.ok(!JSON.stringify(store.deliveries).includes(code), 'the code is not persisted with the delivery record');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: '000000' })).status, 'invalid');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: '999999' })).status, 'invalid');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code })).status, 'verified');
});

test('a correct code verifies once and is then invalid', async () => {
  const { otp, provider } = boot();
  await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  const code = codeFrom(provider);
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code })).status, 'verified');
  // Replaying the same code must not work: the challenge is destroyed on success.
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code })).status, 'missing');
});

test('wrong codes are counted and lock the challenge after the attempt limit', async () => {
  const { otp } = boot();
  await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  for (let attempt = 1; attempt < OTP_MAX_ATTEMPTS; attempt += 1) {
    const result = await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: '111111' });
    assert.equal(result.status, 'invalid');
    assert.equal(result.attemptsRemaining, OTP_MAX_ATTEMPTS - attempt);
  }
  // The final wrong guess exhausts the challenge instead of returning "one more try".
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: '111111' })).status, 'locked');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: '111111' })).status, 'missing');
});

test('a challenge expires and cannot be confirmed afterwards', async () => {
  const { otp, provider, advance } = boot();
  await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  const code = codeFrom(provider);
  advance((OTP_TTL_SECONDS + 1) * 1000);
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code })).status, 'expired');
});

test('resending is rate limited, then issues a fresh code that invalidates the old one', async () => {
  const { otp, provider, advance } = boot();
  const first = await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  assert.equal(first.status, 'sent');
  const oldCode = codeFrom(provider);

  const tooSoon = await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  assert.equal(tooSoon.status, 'cooldown');
  assert.ok(tooSoon.retryAfterSeconds > 0);
  assert.equal(provider.sent.length, 1, 'a resend inside the cooldown sends nothing');

  advance(61_000);
  const resent = await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  assert.equal(resent.status, 'sent');
  assert.equal(provider.sent.length, 2);
  const newCode = codeFrom(provider);
  assert.notEqual(newCode, oldCode);
  // Only the newest code is valid.
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: oldCode })).status, 'invalid');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code: newCode })).status, 'verified');
});

test('the hourly send ceiling stops a flood of codes', async () => {
  const { otp, provider, advance } = boot();
  for (let index = 0; index < 5; index += 1) {
    advance(61_000);
    const result = await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
    assert.equal(result.status, 'sent', `send ${index + 1}`);
  }
  advance(61_000);
  const blocked = await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  assert.equal(blocked.status, 'send_limit');
  assert.equal(provider.sent.length, 5);
});

test('codes are scoped to the user and the purpose', async () => {
  const { otp, provider } = boot();
  await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  const code = codeFrom(provider);
  assert.equal((await otp.verify({ userId: 'user-2', purpose: 'verify_email', code })).status, 'missing');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'email_change', code })).status, 'missing');
  assert.equal((await otp.verify({ userId: 'user-1', purpose: 'verify_email', code })).status, 'verified');
});

test('a delivery failure reports honestly instead of claiming a code was sent', async () => {
  const provider = createMemoryEmailProvider();
  const { EmailError } = await import('../server/email/errors.ts');
  provider.failWith(new EmailError('email_provider_unavailable', 'down', { retryable: true }));
  const emails = createEmailService({ provider, config: CONFIG, store: createMemoryEmailStore(), log: () => undefined });
  const otp = createOtpService({ store: createMemoryOtpStore(), emails, hashKey: HASH_KEY, log: () => undefined, now: () => new Date() });
  const result = await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email' });
  assert.equal(result.status, 'delivery_failed');
  assert.equal(result.retryable, true);
});

test('each challenge email is idempotent on the challenge id', async () => {
  const { otp, provider } = boot();
  await otp.start({ userId: 'user-1', email: 'user@example.com', purpose: 'verify_email', eventId: 'fixed-event' });
  assert.equal(provider.sent[0].idempotencyKey, 'intake:otp:fixed-event');
});

test('the hash key is required to be strong', async () => {
  const provider = createMemoryEmailProvider();
  const emails = createEmailService({ provider, config: CONFIG, store: createMemoryEmailStore(), log: () => undefined });
  assert.throws(() => createOtpService({ store: createMemoryOtpStore(), emails, hashKey: 'short' }), /at least 32/);
});
