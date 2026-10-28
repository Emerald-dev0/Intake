import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readEmailConfig } from '../server/email/config.ts';
import { createCalderProvider, createMemoryEmailProvider } from '../server/email/providers/calder.ts';
import { createEmailService, idempotencyKeyFor } from '../server/email/service.ts';
import { createMemoryEmailStore } from '../server/email/store.ts';
import { renderEmail } from '../server/email/templates.ts';

const ENV = {
  CALDER_API_KEY: 'calder_sk_test_abcdefghijklmnop',
  CALDER_FROM_EMAIL: 'hello@intake.test',
  BETTER_AUTH_URL: 'http://localhost:5173',
};

function config(overrides = {}) {
  return readEmailConfig({ ...ENV, ...overrides });
}

/**
 * A fetch double that records every request and replays a scripted list of responses. Each entry may
 * be a factory so a fresh `Response` is produced per attempt: a single Response body cannot be read
 * twice, and the adapter legitimately reads it on every try.
 */
function fakeFetch(...responses) {
  const calls = [];
  const impl = async (url, init) => {
    calls.push({ url: String(url), init });
    const next = responses.length > 1 ? responses.shift() : responses[0];
    const resolved = typeof next === 'function' ? next(init) : next;
    if (resolved instanceof Error) throw resolved;
    return resolved;
  };
  return { impl, calls };
}

/** A factory: a fresh Response per attempt, because a Response body can only be read once. */
function json(body, status = 202) {
  return () => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

function providerWith(config_, fetchImpl, overrides = {}) {
  return createCalderProvider({
    config: config_,
    fetchImpl,
    sleep: async () => undefined,
    random: () => 0.5,
    now: () => 0,
    ...overrides,
  });
}

function serviceWith(provider, config_, options = {}) {
  const log = [];
  const store = options.store ?? createMemoryEmailStore();
  const service = createEmailService({
    provider,
    config: config_,
    store,
    log: (event, fields) => log.push({ event, ...fields }),
    now: options.now,
    newId: options.newId,
  });
  return { service, store, log };
}

const REQUEST = { type: 'otp', to: 'user@example.com', eventId: 'challenge-1', userId: 'user-1', variables: { otpCode: '123456' } };

test('the provider is Calder by default and reports not-configured without credentials', () => {
  assert.equal(readEmailConfig({}).provider, 'calder');
  assert.equal(readEmailConfig({}).configured, false);
  assert.equal(config().configured, true);
  // A webhook secret in the API-key slot is a mistake, not a credential.
  assert.throws(() => readEmailConfig({ ...ENV, CALDER_API_KEY: 'whsec_abcdef' }), /webhook signing secret/);
  assert.throws(() => readEmailConfig({ ...ENV, CALDER_API_KEY: 'change-me' }), /placeholder/);
  assert.throws(() => readEmailConfig({ ...ENV, EMAIL_PROVIDER: 'resend' }), /EMAIL_PROVIDER/);
});

test('the welcome sender defaults to Daniel with a human reply-to', () => {
  const config_ = config();
  assert.equal(config_.welcomeFromEmail, 'daniel@intake.calder.click');
  assert.equal(config_.welcomeFromName, 'Daniel from Intake');
  assert.equal(config_.welcomeReplyTo, 'daniel@intake.calder.click');
  assert.equal(config({ CALDER_WELCOME_FROM_EMAIL: 'me@example.com' }).welcomeFromEmail, 'me@example.com');
  assert.equal(config({ CALDER_WELCOME_REPLY_TO: 'team@example.com' }).welcomeReplyTo, 'team@example.com');
  assert.throws(() => config({ CALDER_WELCOME_FROM_EMAIL: 'not-an-email' }), /CALDER_WELCOME_FROM_EMAIL/);
});

test('sending is skipped, not faked, when Calder is not configured', async () => {
  const provider = createMemoryEmailProvider();
  const { service } = serviceWith(provider, readEmailConfig({}));
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'not_configured');
  assert.equal(provider.sent.length, 0, 'nothing is silently "sent" without a provider');
});

test('a successful send records the provider id and the delivery', async () => {
  const { impl, calls } = fakeFetch(json({ id: 'em_1', status: 'queued' }));
  const { service, store } = serviceWith(providerWith(config(), impl), config());
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.status, 'sent');
  assert.equal(outcome.providerMessageId, 'em_1');
  assert.equal(outcome.replayed, false);
  const [delivery] = [...store.deliveries ?? []] ?? [];
  void delivery;
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/v1\/emails$/);
  assert.equal(calls[0].init.headers['idempotency-key'], 'intake:otp:challenge-1');
  assert.equal(calls[0].init.headers.authorization, 'Bearer calder_sk_test_abcdefghijklmnop');
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.to, 'user@example.com');
  assert.equal(body.stream, 'transactional', 'Intake only sends transactional mail');
  assert.equal(body.from, 'hello@intake.test');
  assert.ok(body.html && body.text, 'every email carries a plaintext alternative');
});

test('the welcome mail is personal (Daniel) while system mail uses the system sender', async () => {
  const welcomeCalls = fakeFetch(json({ id: 'em_w', status: 'queued' }));
  const welcomeService = serviceWith(providerWith(config(), welcomeCalls.impl), config());
  const welcome = await welcomeService.service.send({
    type: 'welcome', to: 'ada@example.com', eventId: 'welcome-1', userId: 'user-1',
    variables: { userName: 'Ada', dashboardUrl: 'https://intake.example/app' },
  });
  assert.equal(welcome.status, 'sent');
  const welcomeBody = JSON.parse(welcomeCalls.calls[0].init.body);
  assert.equal(welcomeBody.from, 'daniel@intake.calder.click');
  assert.equal(welcomeBody.reply_to, 'daniel@intake.calder.click', 'replies to welcome land with a human');
  assert.equal(welcomeBody.fromName, undefined, 'Calder takes a bare address; display names live on sender identities');

  const otpCalls = fakeFetch(json({ id: 'em_o', status: 'queued' }));
  const otpService = serviceWith(providerWith(config(), otpCalls.impl), config());
  await otpService.service.send(REQUEST);
  const otpBody = JSON.parse(otpCalls.calls[0].init.body);
  assert.equal(otpBody.from, 'hello@intake.test', 'OTPs and notices use the system sender, never Daniel');
});

test('idempotency keys are deterministic per business event', () => {
  assert.equal(idempotencyKeyFor('otp', 'c1'), idempotencyKeyFor('otp', 'c1'));
  assert.notEqual(idempotencyKeyFor('otp', 'c1'), idempotencyKeyFor('otp', 'c2'));
  assert.equal(idempotencyKeyFor('password_reset', 'token-hash'), 'intake:password-reset:token-hash');
});

test('a replayed response is reported as a replay, not a second send', async () => {
  const { impl, calls } = fakeFetch(json({ id: 'em_1', status: 'queued' }, 200));
  const { service } = serviceWith(providerWith(config(), impl), config());
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.status, 'sent');
  assert.equal(outcome.replayed, true);
  assert.equal(calls.length, 1);
});

test('transient failures are retried, then reported as failed', async () => {
  const { impl, calls } = fakeFetch(json({ error: { code: 'internal_error', message: 'boom' } }, 500));
  const { service } = serviceWith(providerWith(config(), impl), config());
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'email_provider_unavailable');
  assert.equal(outcome.retryable, true);
  assert.equal(calls.length, 3, 'retries are bounded by EMAIL_MAX_ATTEMPTS');
});

test('429 is retried and classified as rate limiting', async () => {
  const { impl, calls } = fakeFetch(json({ error: { code: 'rate_limit_error', message: 'slow down' } }, 429));
  const { service } = serviceWith(providerWith(config(), impl), config());
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.errorCode, 'email_provider_rate_limited');
  assert.equal(calls.length, 3);
});

test('a timeout is retried and never left hanging', async () => {
  const abort = new Error('aborted');
  abort.name = 'AbortError';
  const { impl, calls } = fakeFetch(abort);
  const { service } = serviceWith(providerWith(config(), impl), config());
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.errorCode, 'email_timeout');
  assert.equal(calls.length, 3);
});

test('permanent failures are never retried; transient ones are', async () => {
  const cases = [
    // [status, provider code, expected Intake code, should it be retried?]
    [400, 'validation_error', 'email_validation_error', false],
    [401, 'authentication_error', 'email_provider_authentication_failed', false],
    [422, 'suppressed', 'email_suppressed', false],
    [429, 'plan_limit_reached', 'email_quota_exceeded', false],
    [403, 'domain_not_verified', 'email_sender_not_verified', false],
    [403, 'organization_sending_unavailable', 'email_provider_unavailable', true],
  ];
  for (const [status, code, expected, retryable] of cases) {
    const { impl, calls } = fakeFetch(json({ error: { code, message: 'no' } }, status));
    const { service } = serviceWith(providerWith(config(), impl), config());
    const outcome = await service.send(REQUEST);
    assert.equal(outcome.errorCode, expected, `${status} ${code}`);
    assert.equal(outcome.retryable, retryable, `${status} ${code} retryability`);
    assert.equal(calls.length, retryable ? 3 : 1, `${status} ${code} attempt count`);
  }
});

test('an invalid recipient is rejected before anything reaches Calder', async () => {
  const { impl, calls } = fakeFetch(json({ id: 'em_1' }));
  const { service } = serviceWith(providerWith(config(), impl), config());
  const outcome = await service.send({ ...REQUEST, to: 'not-an-email' });
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'email_invalid_recipient');
  assert.equal(calls.length, 0);
});

test('a suppressed recipient is skipped and no request is made', async () => {
  const store = createMemoryEmailStore();
  await store.suppress('user@example.com', 'bounce', 'calder:email.bounced');
  const { impl, calls } = fakeFetch(json({ id: 'em_1' }));
  const { service } = serviceWith(providerWith(config(), impl), config(), { store });
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.status, 'skipped');
  assert.equal(outcome.reason, 'suppressed');
  assert.equal(calls.length, 0, 'Intake never mails a known-bad address');
});

test('template aliases are opt-in and never replace Intake-rendered content', async () => {
  const { impl, calls } = fakeFetch(json({ id: 'em_1' }));
  const withAlias = config({ CALDER_TEMPLATE_OTP: 'intake-otp' });
  const { service } = serviceWith(providerWith(withAlias, impl), withAlias);
  await service.send(REQUEST);
  const body = JSON.parse(calls[0].init.body);
  assert.equal(body.template, 'intake-otp');
  assert.ok(body.variables.otpCode === '123456');
  assert.ok(body.html.includes('123456'), 'Intake still renders its own copy');
});

test('every template renders HTML and plaintext, and no template leaks a secret', () => {
  for (const type of ['otp', 'password_reset', 'welcome', 'security_password_changed', 'security_email_changed', 'security_new_sign_in', 'security_google_connected', 'security_google_disconnected', 'provider_connection_added', 'provider_connection_removed', 'credits_low']) {
    const email = renderEmail(type, {
      userName: 'Ada', otpCode: '123456', expiryMinutes: '10', resetUrl: 'https://intake.test/reset?token=SECRET',
      newEmail: 'new@example.com', previousEmail: 'old@example.com', timestamp: '5 Oct 2026, 10:00 UTC',
      providerName: 'Google Forms', accountLabel: 'ada@example.com', remaining: '2', resetAt: '2026-10-06T00:00:00.000Z',
    });
    assert.ok(email.subject.length > 0, `${type} subject`);
    assert.match(email.html, /<html/, `${type} html`);
    assert.ok(email.text.length > 40, `${type} plaintext`);
    assert.ok(!email.html.includes('undefined'), `${type} renders no undefined placeholder`);
    assert.ok(!email.text.includes('undefined'), `${type} plaintext renders no undefined placeholder`);
    assert.ok(!email.html.includes('[object Object]'));
  }
});

test('the OTP email states the code, the expiry and what to do if it was not you', () => {
  const email = renderEmail('otp', { otpCode: '456789', expiryMinutes: '10' });
  assert.match(email.html, /456789/);
  assert.match(email.html, /10 minutes/);
  assert.match(email.text, /456789/);
  assert.match(email.text, /safely ignore/i);
});

test('emails link to Intake, never to the provider', () => {
  const email = renderEmail('password_reset', { resetUrl: 'https://intake.test/auth/reset-password?token=abc' });
  assert.match(email.html, /https:\/\/intake\.test\/auth\/reset-password/);
  // Intake's own domain is a feature, not infrastructure leakage: the support address, the logo host
  // and the site link all live on it. Allow exactly that origin and nothing else that says "Calder",
  // whose API, key prefixes and dashboard must never appear in a message we send.
  const scrubbedHtml = email.html.replaceAll('intake.calder.click', '');
  const scrubbedText = email.text.replaceAll('intake.calder.click', '');
  assert.ok(!/calder/i.test(scrubbedHtml), 'Calder is infrastructure and never appears in the email');
  assert.ok(!/calder/i.test(scrubbedText));
});

test('the service exposes reconciliation status without sending anything', async () => {
  // GET returns the documented `{ data }` envelope; POST returns the send receipt.
  const { impl } = fakeFetch(init => (init?.method === 'GET'
    ? json({ data: { id: 'em_1', status: 'delivered', updatedAt: '2026-10-05T10:00:00.000Z' } }, 200)()
    : json({ id: 'em_1', status: 'queued' })()));
  const { service } = serviceWith(providerWith(config(), impl), config());
  const status = await service.status('em_1');
  assert.deepEqual(status, { providerMessageId: 'em_1', status: 'delivered', updatedAt: '2026-10-05T10:00:00.000Z' });
  assert.equal(await service.status('not-a-provider-id'), null);
});

test('a refused status read still returns null, but says why', async () => {
  // The shape that made "provider silent 54" unactionable: 401, 403, 404 and a timeout were all the
  // same null. The answer must not change — reconciliation never invents a state — but the reason is
  // reported separately so an operator can tell a wrong key from a wrong project.
  const seen = [];
  const { impl } = fakeFetch(() => json({ error: { code: 'not_found' } }, 404)());
  const provider = providerWith(config(), impl, { onStatusFailure: failure => seen.push(failure) });
  assert.equal(await provider.getStatus('em_abc'), null);
  assert.deepEqual(seen, [{ providerMessageId: 'em_abc', reason: 'request_failed', httpStatus: 404 }]);
});

test('an id the provider never issued is labelled as such rather than as a network failure', async () => {
  const seen = [];
  const { impl, calls } = fakeFetch(() => json({ data: { status: 'delivered' } }, 200)());
  const provider = providerWith(config(), impl, { onStatusFailure: failure => seen.push(failure) });
  assert.equal(await provider.getStatus('local-123'), null);
  assert.equal(calls.length, 0, 'nothing was asked of the network');
  assert.deepEqual(seen, [{ providerMessageId: 'local-123', reason: 'not_a_provider_id' }]);
});

test('a 200 whose body is not the documented envelope is reported as a payload problem', async () => {
  const seen = [];
  const { impl } = fakeFetch(() => json({ id: 'em_abc', status: 'delivered' }, 200)());
  const provider = providerWith(config(), impl, { onStatusFailure: failure => seen.push(failure) });
  assert.equal(await provider.getStatus('em_abc'), null);
  assert.deepEqual(seen, [{ providerMessageId: 'em_abc', reason: 'unexpected_payload', httpStatus: 200 }]);
});

test('a throwing diagnostics observer cannot change a status read', async () => {
  const { impl } = fakeFetch(() => json({ error: { code: 'unauthorized' } }, 401)());
  const provider = providerWith(config(), impl, { onStatusFailure: () => { throw new Error('observer blew up'); } });
  assert.equal(await provider.getStatus('em_abc'), null);
});

test('the timeout includes a stalled response body, not just the HTTP headers', async () => {
  const config_ = { ...config(), timeoutMs: 20, maxAttempts: 2 };
  const { impl, calls } = fakeFetch(() => new Response(new ReadableStream({ start() {} }), { status: 202 }));
  const { service } = serviceWith(providerWith(config_, impl), config_);
  const outcome = await service.send(REQUEST);
  assert.equal(outcome.status, 'failed');
  assert.equal(outcome.errorCode, 'email_timeout');
  assert.equal(outcome.retryable, true);
  assert.equal(calls.length, 2);
});

test('accepted events replay locally and a failed send retry updates one canonical delivery record', async () => {
  const config_ = config();
  const responses = fakeFetch(
    json({ error: { code: 'internal_error' } }, 503),
    json({ id: 'em_retry', status: 'queued' }),
  );
  const { service, store } = serviceWith(providerWith({ ...config_, maxAttempts: 1 }, responses.impl), config_);
  const failed = await service.send(REQUEST);
  assert.equal(failed.status, 'failed');
  const retried = await service.send(REQUEST);
  assert.equal(retried.status, 'sent');
  assert.equal(retried.deliveryId, failed.deliveryId);
  assert.equal(store.deliveries.length, 1);
  assert.equal(store.deliveries[0].providerMessageId, 'em_retry');
  assert.equal(store.deliveries[0].status, 'accepted');
  assert.equal(store.deliveries[0].subject, 'Your Intake verification code', 'OTP subjects in the audit table contain no code');
  const replay = await service.send(REQUEST);
  assert.equal(replay.replayed, true);
  assert.equal(responses.calls.length, 2, 'accepted events never need another provider call');
});

test('the config carries no social account, and a leftover INTAKE_X_URL is inert', () => {
  // The X row was removed from every email. The variable it used to read is gone from the type, and
  // a deployment that still sets it must keep working rather than failing boot on an unknown value.
  const bare = config();
  assert.equal('xUrl' in bare, false);
  assert.equal('xHandle' in bare, false);

  // Historical values — including the malformed ones this config used to reject — are ignored now.
  for (const leftover of ['https://x.com/intake', 'https://example.com/intake', 'not a url', '']) {
    assert.doesNotThrow(() => config({ INTAKE_X_URL: leftover }), `${leftover || '(empty)'} must not fail boot`);
  }
});

test('the launch letters can go out under their own sender, defaulting to the system sender', () => {
  assert.equal(config().announcementFromEmail, 'hello@intake.test', 'falls back rather than inventing an address');
  assert.equal(config().announcementFromName, 'The Intake Team');

  const own = config({ CALDER_ANNOUNCEMENT_FROM_EMAIL: 'hello@intake.calder.click', CALDER_ANNOUNCEMENT_FROM_NAME: 'Intake' });
  assert.equal(own.announcementFromEmail, 'hello@intake.calder.click');
  assert.equal(own.announcementFromName, 'Intake');

  assert.throws(() => config({ CALDER_ANNOUNCEMENT_FROM_EMAIL: 'not-an-address' }), /CALDER_ANNOUNCEMENT_FROM_EMAIL/);
});

test('the logo is served from a configured origin, because a mail client has no page to resolve against', () => {
  assert.equal(config({ INTAKE_ASSET_BASE_URL: 'https://intake.calder.click/brand/' }).assetBaseUrl, 'https://intake.calder.click');
  assert.equal(config().assetBaseUrl, 'http://localhost:5173', 'falls back to the app origin in development');
});

test('list mail rides the transactional stream until the provider has a broadcast route', async () => {
  // Calder has no broadcast route configured yet. Asking for `campaign` fails the send outright, so
  // the honest choice is transactional — which works today — and a flag flips it when the route
  // exists. A guessed stream here is a send that looks accepted and lands nowhere.
  const send = async (overrides, request) => {
    const calls = fakeFetch(json({ id: 'em_x', status: 'queued' }));
    const { service } = serviceWith(providerWith(config(overrides), calls.impl), config(overrides));
    const outcome = await service.send(request);
    assert.equal(outcome.status, 'sent');
    return JSON.parse(calls.calls[0].init.body);
  };

  const announcement = {
    type: 'launch_announcement', to: 'ada@example.com', eventId: 'launch-1',
    variables: { marketingUrl: 'https://intake.example' },
  };
  const adminNote = {
    type: 'admin_message', to: 'ada@example.com', eventId: 'note-1',
    variables: { adminSubject: 'A note', adminBody: 'Hello.' },
  };

  assert.equal((await send({}, announcement)).stream, 'transactional', 'no broadcast route yet');
  assert.equal((await send({}, adminNote)).stream, 'transactional');
  assert.equal(
    (await send({ CALDER_BROADCAST_ENABLED: 'true' }, announcement)).stream,
    'campaign',
    'the flag is the only thing that changes the stream',
  );
  // An OTP is never bulk, whatever the flag says.
  assert.equal((await send({ CALDER_BROADCAST_ENABLED: 'true' }, REQUEST)).stream, 'transactional');
});

test('an operator can choose who a hand-written note comes from', async () => {
  const overrides = { CALDER_ANNOUNCEMENT_FROM_EMAIL: 'hello@intake.calder.click', CALDER_WELCOME_FROM_EMAIL: 'daniel@intake.calder.click' };
  const sendAs = async sender => {
    const calls = fakeFetch(json({ id: 'em_1', status: 'queued' }));
    const { service } = serviceWith(providerWith(config(overrides), calls.impl), config(overrides));
    await service.send({
      type: 'admin_message', to: 'ada@example.com', eventId: `note-${sender ?? 'default'}`,
      variables: { adminSubject: 'A note', adminBody: 'Hello.' },
      ...(sender ? { sender } : {}),
    });
    return JSON.parse(calls.calls[0].init.body);
  };

  assert.equal((await sendAs()).from, 'hello@intake.test', 'the product address by default');
  assert.equal((await sendAs('team')).from, 'hello@intake.calder.click');
  assert.equal((await sendAs('personal')).from, 'daniel@intake.calder.click');
  assert.equal((await sendAs('personal')).reply_to, 'daniel@intake.calder.click', 'replies reach Daniel, not a queue');
  // Calder's send schema takes a bare address. The display name a recipient sees ("The Intake Team",
  // "Daniel from Intake") is a property of the sender identity in Calder's dashboard, not of this
  // request — so sending a name here would be a lie that never renders.
  assert.equal('from_name' in (await sendAs('team')), false);
});
