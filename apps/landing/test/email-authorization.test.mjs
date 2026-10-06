import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { readEmailConfig } from '../server/email/config.ts';
import { createMemoryEmailStore } from '../server/email/store.ts';
import { createEmailService } from '../server/email/service.ts';
import { createMemoryEmailProvider } from '../server/email/providers/calder.ts';
import { createOtpService, createMemoryOtpStore, OTP_MAX_ATTEMPTS } from '../server/email/otp.ts';
import { createAccountEmailRouter } from '../server/email/routes.ts';
import { createMemoryRateLimitStore } from '../server/security/rate-limit.ts';

const HASH_KEY = 'intake-authorization-test-hash-key-000000';

function config(overrides = {}) {
  return readEmailConfig({
    CALDER_API_KEY: 'calder_sk_test_key',
    CALDER_FROM_EMAIL: 'hello@intake.test',
    BETTER_AUTH_URL: 'http://localhost:5173',
    ...overrides,
  });
}

/**
 * A tiny harness: one router, one real OTP service, one real email service, and a directory that
 * is the only source of truth for addresses. Sessions are injected per request.
 */
function harness({
  user = { id: 'user-1', name: 'Ada', email: 'ada@example.com', emailVerified: false },
  abuse = null,
  sessionFails = false,
} = {}) {
  const clock = { now: Date.now() };
  const state = { user, session: user, notifierCalls: [], resetCalls: [], setEmail: [], verified: [], clock };
  const store = createMemoryEmailStore();
  const provider = createMemoryEmailProvider();
  const emails = createEmailService({ provider, config: config(), store, log: () => undefined });
  const otp = createOtpService({
    store: createMemoryOtpStore({ now: () => clock.now }),
    emails,
    hashKey: HASH_KEY,
    now: () => new Date(clock.now),
    log: () => undefined,
  });
  const app = express();
  app.use(createAccountEmailRouter({
    emails,
    otp,
    notifier: {
      async welcome(userId) { state.notifierCalls.push(['welcome', userId]); },
      async passwordChanged(userId) { state.notifierCalls.push(['passwordChanged', userId]); },
      async emailChanged(userId, previous, next) { state.notifierCalls.push(['emailChanged', userId, previous, next]); },
      async googleConnected() {}, async googleDisconnected() {},
      async providerConnected() {}, async providerDisconnected() {},
      async creditsLow() {}, async newSignIn() { return false; },
    },
    config: config(),
    getSession: async () => {
      if (sessionFails) throw new Error('session store is down');
      return state.session;
    },
    users: {
      async getById(id) { return id === state.user.id ? { ...state.user } : null; },
      async setEmailVerified(id) { state.verified.push(id); state.user = { ...state.user, emailVerified: true }; },
      async setEmail(id, email) { state.setEmail.push([id, email]); state.user = { ...state.user, email }; },
    },
    requestPasswordReset: async email => { state.resetCalls.push(email); },
    abuseLimiter: abuse,
    hashKey: HASH_KEY,
    log: () => undefined,
  }));
  // Express needs an error handler for the asyncRoute wrapper to have something to hand errors to.
  app.use((error, _req, res, _next) => res.status(500).json({ error: 'internal' }));
  return { app, state, provider, store, otp, advance: ms => { clock.now += ms; } };
}

async function withServer(app, run) {
  const server = app.listen(0);
  await new Promise(resolve => server.once('listening', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run(base);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const post = (base, path, body = {}, headers = {}) => fetch(`${base}${path}`, {
  method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body),
});

/** The code only exists inside the rendered email, exactly as it does for a real user. */
function codeFrom(provider) {
  const html = provider.sent.at(-1)?.html ?? '';
  const match = html.match(/letter-spacing:\.42em[^>]*>(\d{6})</) ?? html.match(/>\s*(\d{6})\s*</);
  assert.ok(match, 'the OTP email must render the code');
  return match[1];
}

test('the public capability hint leaks no provider, address or key', async () => {
  const { app } = harness();
  await withServer(app, async base => {
    const response = await fetch(`${base}/config`);
    const body = await response.json();
    assert.deepEqual(body, { deliveryConfigured: true, verificationRequired: true });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const raw = await response.text().catch(() => '');
    assert.doesNotMatch(raw + JSON.stringify(body), /calder|sk_|@intake\./i);
  });
});

test('every account email route refuses an anonymous caller', async () => {
  const { app, state } = harness();
  state.session = null;
  await withServer(app, async base => {
    const routes = [
      ['GET', '/status'], ['POST', '/verify'], ['POST', '/verify/confirm'], ['POST', '/change'], ['POST', '/change/confirm'],
    ];
    for (const [method, path] of routes) {
      const response = await (method === 'GET'
        ? fetch(`${base}${path}`)
        : post(base, path, { code: '123456', email: 'attacker@example.com' }));
      assert.equal(response.status, 401, `${path} must require a session`);
      assert.equal((await response.json()).error, 'Not authenticated');
    }
  });
});

test('a verification email goes to the address on the account, not the one in the request', async () => {
  const { app, state, provider } = harness();
  await withServer(app, async base => {
    const response = await post(base, '/verify', { email: 'attacker@example.com', to: 'attacker@example.com' });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'sent');
    assert.equal(provider.sent.length, 1);
    assert.equal(provider.sent[0].to, state.user.email);
    assert.equal(provider.sent[0].to, 'ada@example.com');
  });
});

test('a code confirms verification, marks the account verified and fires the welcome email once', async () => {
  const { app, state, provider } = harness();
  await withServer(app, async base => {
    await post(base, '/verify', {});
    const code = codeFrom(provider);
    const response = await post(base, '/verify/confirm', { code });
    assert.equal(response.status, 200);
    assert.equal((await response.json()).status, 'verified');
    assert.deepEqual(state.verified, ['user-1']);
    assert.deepEqual(state.notifierCalls, [['welcome', 'user-1']]);

    // Replaying the same code cannot verify anything a second time: the challenge is destroyed.
    assert.equal((await post(base, '/verify/confirm', { code })).status, 400);
    assert.equal(state.notifierCalls.length, 1);
  });
});

test('wrong codes count down, then lock the challenge', async () => {
  const { app, provider } = harness();
  await withServer(app, async base => {
    await post(base, '/verify', {});
    const code = codeFrom(provider);
    const wrong = code === '000000' ? '111111' : '000000';

    for (let attempt = 1; attempt <= OTP_MAX_ATTEMPTS - 1; attempt += 1) {
      const response = await post(base, '/verify/confirm', { code: wrong });
      assert.equal(response.status, 400);
      assert.match((await response.json()).error, new RegExp(`${OTP_MAX_ATTEMPTS - attempt} attempts? left`));
    }
    const locked = await post(base, '/verify/confirm', { code: wrong });
    assert.equal(locked.status, 429);

    // The locked challenge is destroyed, so even the correct code no longer resolves to anything.
    assert.equal((await post(base, '/verify/confirm', { code })).status, 400);
  });
});

test('a malformed code is rejected before any state is touched', async () => {
  const { app, provider } = harness();
  await withServer(app, async base => {
    await post(base, '/verify', {});
    for (const code of ['', '12345', 'abcdef', '1234567', { not: 'a string' }]) {
      const response = await post(base, '/verify/confirm', { code });
      assert.equal(response.status, 400);
    }
    assert.equal(provider.sent.length, 1);
  });
});

test('an expired code is reported as expired, not as an unknown challenge', async () => {
  const { app, provider, advance } = harness();
  await withServer(app, async base => {
    await post(base, '/verify', {});
    const code = codeFrom(provider);
    advance(11 * 60 * 1000); // OTP_TTL_SECONDS is ten minutes.
    const response = await post(base, '/verify/confirm', { code });
    assert.equal(response.status, 410);
    assert.match((await response.json()).error, /expired/i);
  });
});

test('changing an email requires the code sent to the new address and only then rewrites it', async () => {
  const { app, state, provider } = harness({ user: { id: 'user-1', name: 'Ada', email: 'ada@example.com', emailVerified: true } });
  await withServer(app, async base => {
    assert.equal((await post(base, '/change', { email: 'not-an-email' })).status, 400);
    assert.equal((await post(base, '/change', { email: 'ada@example.com' })).status, 400, 'the current address is not a change');

    const sent = await post(base, '/change', { email: 'ada.new@example.com' });
    assert.equal(sent.status, 200);
    assert.equal(provider.sent.at(-1).to, 'ada.new@example.com');

    // The old address is untouched until the code lands.
    assert.deepEqual(state.setEmail, []);

    const confirmed = await post(base, '/change/confirm', { code: codeFrom(provider) });
    assert.equal(confirmed.status, 200);
    assert.equal((await confirmed.json()).email, 'ada.new@example.com');
    assert.deepEqual(state.setEmail, [['user-1', 'ada.new@example.com']]);
    assert.deepEqual(state.notifierCalls, [['emailChanged', 'user-1', 'ada@example.com', 'ada.new@example.com']]);
  });
});

test('a code issued for one purpose cannot be used for another', async () => {
  const { app, provider } = harness();
  await withServer(app, async base => {
    await post(base, '/change', { email: 'other@example.com' });
    const code = codeFrom(provider);
    const response = await post(base, '/verify/confirm', { code });
    assert.equal(response.status, 400, 'a change code must not verify the account');
  });
});

test('password reset never discloses whether an account exists', async () => {
  const { app, state } = harness();
  state.session = null;
  await withServer(app, async base => {
    const known = await post(base, '/password/reset', { email: 'ada@example.com' });
    assert.equal(known.status, 202);
    assert.deepEqual(await known.json(), { status: 'accepted' });

    const unknown = await post(base, '/password/reset', { email: 'nobody@example.com' });
    assert.equal(unknown.status, 202);
    assert.deepEqual(await unknown.json(), { status: 'accepted' }, 'identical response for both addresses');

    const invalid = await post(base, '/password/reset', { email: 'nope' });
    assert.equal(invalid.status, 400);
    assert.deepEqual(state.resetCalls, ['ada@example.com', 'nobody@example.com']);
  });
});

test('password reset is rate limited per address and per network', async () => {
  const { app, state } = harness({ abuse: createMemoryRateLimitStore(() => Date.now(), HASH_KEY) });
  state.session = null;
  await withServer(app, async base => {
    let limited = null;
    for (let attempt = 0; attempt < 8; attempt += 1) {
      const response = await post(base, '/password/reset', { email: 'ada@example.com' });
      if (response.status === 429) { limited = response; break; }
    }
    assert.ok(limited, 'repeated reset requests must be throttled');
    assert.equal(limited.headers.get('retry-after') !== null, true, 'a 429 carries Retry-After');
    // A different address is still served: the block is per address, not global.
    const other = await post(base, '/password/reset', { email: 'someone.else@example.com' });
    assert.equal(other.status, 202);
  });
});

test('signed-in verification is rate limited per user', async () => {
  const { app } = harness({ abuse: createMemoryRateLimitStore(() => Date.now(), HASH_KEY) });
  await withServer(app, async base => {
    let limited = false;
    for (let attempt = 0; attempt < 30; attempt += 1) {
      const response = await post(base, '/verify', {});
      if (response.status === 429) { limited = true; break; }
    }
    assert.equal(limited, true);
  });
});

test('a session lookup failure is a 503, never an open door', async () => {
  const { app } = harness({ sessionFails: true });
  await withServer(app, async base => {
    const response = await post(base, '/verify', {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'Session temporarily unavailable');
  });
});

test('an email delivery failure surfaces as a retryable 503 with a usable message', async () => {
  const { app, provider } = harness();
  await withServer(app, async base => {
    const { EmailError } = await import('../server/email/errors.ts');
    provider.failWith(new EmailError('email_provider_unavailable', 'Calder is unreachable', { retryable: true }));
    const response = await post(base, '/verify', {});
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.status, 'delivery_failed');
    // The user is told what to do, and nothing internal (provider name, error code class) leaks.
    assert.match(body.error, /try again shortly/i);
    assert.doesNotMatch(body.error, /calder|email_provider/i);
  });
});
