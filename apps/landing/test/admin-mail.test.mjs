import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createAdminRouter } from '../server/admin/routes.ts';
import {
  MAIL_RECIPIENT_CAP, createMailService, parseComposeDraft, parseSelection, personalize,
} from '../server/admin/mail.ts';

const ORIGIN = 'https://intake.test';

const config = {
  provider: 'memory',
  baseUrl: '',
  apiKey: '',
  fromEmail: 'hello@intake.test',
  fromName: 'Intake',
  replyTo: null,
  welcomeFromEmail: 'daniel@intake.test',
  welcomeFromName: 'Daniel from Intake',
  welcomeReplyTo: null,
  senderId: null,
  timeoutMs: 1000,
  maxAttempts: 1,
  webhookSecret: '',
  templateAliases: {},
  appOrigin: ORIGIN,
  marketingOrigin: 'https://intake.test',
  configured: true,
};

const DRAFT = {
  subject: 'A small change to your Intake account',
  heading: 'A small change',
  body: 'Hi {{name}},\n\nWe moved the dashboard a little.\n\n{{email}} is still your sign-in address.',
  buttonLabel: 'Open the dashboard',
  buttonUrl: '/app',
};

function user(index, overrides = {}) {
  return {
    id: `user_${String(index).padStart(3, '0')}`,
    name: `Person ${index}`,
    email: `person${index}@example.com`,
    verified: index % 2 === 0,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...overrides,
  };
}

function fakeStore(users, { ready = true } = {}) {
  const recorded = [];
  const match = selection => (selection.kind === 'segment'
    ? users.filter(entry => (selection.segment === 'all'
      ? true
      : selection.segment === 'verified' ? entry.verified : !entry.verified))
    : users.filter(entry => selection.ids.includes(entry.id)));
  return {
    recorded,
    async ready() { return ready; },
    async count(selection) { return match(selection).length; },
    async resolve(selection, limit) { return match(selection).slice(0, limit); },
    async search({ query, segment, limit, offset }) {
      const inSegment = users.filter(entry => (segment === 'verified' ? entry.verified : segment === 'unverified' ? !entry.verified : true));
      const hits = query
        ? inSegment.filter(entry => entry.email.includes(query) || entry.name.toLowerCase().includes(query.toLowerCase()))
        : inSegment;
      return { items: hits.slice(offset, offset + limit), total: hits.length };
    },
    async record(record) { recorded.push(record); },
    async recent(limit) { return recorded.slice(-limit).reverse(); },
  };
}

function fakeEmail() {
  const calls = [];
  return {
    calls,
    async send(request) {
      calls.push(request);
      return { status: 'sent', deliveryId: `emd_${calls.length}`, providerMessageId: `em_${calls.length}`, replayed: false };
    },
  };
}

function build(users) {
  const store = fakeStore(users);
  const email = fakeEmail();
  const service = createMailService({
    store, config, send: email.send, now: () => new Date('2026-10-24T09:00:00.000Z'),
  });
  return { store, email, service };
}

// ── Draft rules ─────────────────────────────────────────────────────────────────────────────────

test('a draft is validated the same way on preview and on send', () => {
  const ok = parseComposeDraft(DRAFT, ORIGIN);
  assert.equal(ok.ok, true);
  assert.equal(ok.draft.buttonUrl, `${ORIGIN}/app`, 'a path is resolved against the app origin');

  const emptySubject = parseComposeDraft({ ...DRAFT, subject: '   ' }, ORIGIN);
  assert.equal(emptySubject.ok, false);
  assert.match(emptySubject.errors.subject, /needs a subject/);

  const twoLines = parseComposeDraft({ ...DRAFT, subject: 'Hello\nthere' }, ORIGIN);
  assert.equal(twoLines.ok, false, 'a subject is one line');

  const badLink = parseComposeDraft({ ...DRAFT, buttonUrl: 'javascript:alert(1)' }, ORIGIN);
  assert.equal(badLink.ok, false);
  assert.match(badLink.errors.buttonUrl, /https/);

  const labelWithoutLink = parseComposeDraft({ ...DRAFT, buttonUrl: '' }, ORIGIN);
  assert.equal(labelWithoutLink.ok, false, 'a button without a destination is refused');

  const unknownToken = parseComposeDraft({ ...DRAFT, body: 'Hi {{first_name}}' }, ORIGIN);
  assert.equal(unknownToken.ok, false, 'unknown placeholders are refused, not shipped literally');
  assert.match(unknownToken.errors.body, /\{\{first_name\}\}/);

  const bodyTooLong = parseComposeDraft({ ...DRAFT, body: 'x'.repeat(6001) }, ORIGIN);
  assert.equal(bodyTooLong.ok, false);
});

test('selection parsing accepts only segments and bounded id lists', () => {
  assert.deepEqual(parseSelection({ kind: 'segment', segment: 'verified' }), { kind: 'segment', segment: 'verified' });
  assert.equal(parseSelection({ kind: 'segment', segment: 'everyone' }), null);
  assert.deepEqual(parseSelection({ kind: 'ids', ids: ['a', 'a', 'b'] }), { kind: 'ids', ids: ['a', 'b'] });
  assert.equal(parseSelection({ kind: 'ids', ids: [] }), null);
  assert.equal(parseSelection({ kind: 'ids', ids: ['ok', 42] }), null);
  assert.equal(parseSelection(null), null);
});

test('placeholders resolve per recipient, never from the browser', () => {
  assert.equal(personalize('Hi {{name}} ({{email}})', { name: 'Ada Lovelace', email: 'ada@example.com' }), 'Hi Ada (ada@example.com)');
  assert.equal(personalize('Hi {{ name }}', { name: '', email: 'x@y.zz' }), 'Hi ');
});

// ── Preview ─────────────────────────────────────────────────────────────────────────────────────

test('the preview is rendered by the server from the same template as the send', async () => {
  const { service } = build([user(1), user(2)]);
  const parsed = parseComposeDraft(DRAFT, ORIGIN);
  const preview = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'all' } });

  assert.match(preview.previewId, /^[0-9a-f-]{36}$/);
  assert.equal(preview.subject, DRAFT.subject);
  assert.equal(preview.recipients.total, 2);
  assert.equal(preview.recipients.cap, MAIL_RECIPIENT_CAP);
  assert.equal(preview.recipients.overCap, false);
  assert.equal(preview.sample.name, 'Person');
  assert.match(preview.html, /Hi Person,/);
  assert.match(preview.html, /Open the dashboard/);
  assert.match(preview.html, new RegExp(`${ORIGIN}/app`));
  assert.ok(preview.text.includes('We moved the dashboard'), 'a plaintext alternative is produced too');
  assert.deepEqual(preview.tokens, ['email', 'name']);
  // The sample line identifies whose details were merged in, without echoing the address.
  assert.equal(preview.sample.email, 'p***@example.com');
});

test('copy is escaped, so a composed note cannot inject markup into the email', async () => {
  const { service } = build([user(1)]);
  const parsed = parseComposeDraft({ ...DRAFT, body: 'Hello <script>alert(1)</script> & "friends"' }, ORIGIN);
  const preview = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'all' } });
  assert.ok(!preview.html.includes('<script>'));
  assert.match(preview.html, /&lt;script&gt;/);
  assert.match(preview.html, /&amp; &quot;friends&quot;/);
});

// ── Send ───────────────────────────────────────────────────────────────────────────────────────

test('a send is one message per recipient, each with its own idempotency event id', async () => {
  const users = [user(1), user(2), user(3)];
  const { service, email, store } = build(users);
  const parsed = parseComposeDraft(DRAFT, ORIGIN);
  const preview = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'all' } });

  const result = await service.send({
    draft: parsed.draft,
    selection: { kind: 'segment', segment: 'all' },
    previewId: preview.previewId,
    confirmedRecipients: 3,
    adminUserId: 'admin_1',
  });

  assert.equal(result.total, 3);
  assert.equal(result.sent, 3);
  assert.equal(email.calls.length, 3, 'one delivery per person, not one batch');
  assert.deepEqual(email.calls.map(call => call.to).sort(), users.map(entry => entry.email).sort());
  assert.equal(new Set(email.calls.map(call => call.eventId)).size, 3);
  assert.ok(email.calls.every(call => call.eventId.startsWith(`${preview.previewId}:`)));
  assert.ok(email.calls.every(call => call.type === 'admin_message'));
  assert.ok(email.calls.every(call => call.variables.adminBody.includes('still your sign-in address')));
  assert.match(email.calls[0].variables.adminBody, /person1@example\.com/, 'each body greets its own recipient');
  assert.ok(!email.calls[0].variables.adminBody.includes('person2@example.com'));
  assert.deepEqual(store.recorded.map(entry => entry.id), [preview.previewId]);
  assert.deepEqual(
    { sent: store.recorded[0].sent, failed: store.recorded[0].failed, recipients: store.recorded[0].recipients },
    { sent: 3, failed: 0, recipients: 3 },
  );
});

test('a failed or skipped recipient is reported per person instead of hidden in a total', async () => {
  const users = [user(1), user(2), user(3)];
  const store = fakeStore(users);
  const outcomes = [`ok`, `skip`, `fail`];
  const service = createMailService({
    store,
    config,
    async send() {
      const next = outcomes.shift();
      if (next === 'skip') return { status: 'skipped', deliveryId: 'd', reason: 'suppressed' };
      if (next === 'fail') return { status: 'failed', deliveryId: 'd', errorCode: 'email_provider_unavailable', retryable: true };
      return { status: 'sent', deliveryId: 'd', providerMessageId: 'em_1', replayed: false };
    },
  });
  const parsed = parseComposeDraft(DRAFT, ORIGIN);
  const result = await service.send({
    draft: parsed.draft, selection: { kind: 'ids', ids: users.map(entry => entry.id) },
    previewId: 'preview-0001', confirmedRecipients: 3, adminUserId: 'admin_1',
  });
  assert.equal(result.sent, 1);
  assert.equal(result.skipped, 1);
  assert.equal(result.failed, 1);
  assert.equal(result.results.find(entry => entry.status === 'failed').errorCode, 'email_provider_unavailable');
  assert.ok(result.results.every(entry => entry.email.includes('*')), 'result rows carry masked addresses');
});

test('the recipient cap and the confirmed count are both enforced server-side', async () => {
  const many = Array.from({ length: MAIL_RECIPIENT_CAP + 1 }, (_value, index) => user(index + 1));
  const { service, email } = build(many);
  const parsed = parseComposeDraft(DRAFT, ORIGIN);
  const preview = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'all' } });
  assert.equal(preview.recipients.overCap, true);
  assert.equal(preview.recipients.total, MAIL_RECIPIENT_CAP + 1);

  await assert.rejects(
    service.send({
      draft: parsed.draft, selection: { kind: 'segment', segment: 'all' },
      previewId: preview.previewId, confirmedRecipients: MAIL_RECIPIENT_CAP + 1, adminUserId: 'admin_1',
    }),
    error => error.code === 'recipient_cap' && error.status === 400,
  );
  assert.equal(email.calls.length, 0, 'nothing is sent when the selection is too large');

  const mismatched = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'verified' } });
  await assert.rejects(
    service.send({
      draft: parsed.draft, selection: { kind: 'segment', segment: 'verified' },
      previewId: mismatched.previewId, confirmedRecipients: 999, adminUserId: 'admin_1',
    }),
    error => error.code === 'recipient_count_changed' && error.status === 409,
  );

  await assert.rejects(
    service.send({
      draft: parsed.draft, selection: { kind: 'ids', ids: ['nobody'] },
      previewId: 'preview-0002', confirmedRecipients: 0, adminUserId: 'admin_1',
    }),
    error => error.code === 'no_recipients',
  );
});

test('re-sending the same preview is idempotent: the same recipient keeps the same event id', async () => {
  const { service, email } = build([user(1), user(2)]);
  const parsed = parseComposeDraft(DRAFT, ORIGIN);
  const preview = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'all' } });
  const input = {
    draft: parsed.draft, selection: { kind: 'segment', segment: 'all' },
    previewId: preview.previewId, confirmedRecipients: 2, adminUserId: 'admin_1',
  };
  await service.send(input);
  await service.send(input);
  const first = email.calls.slice(0, 2).map(call => call.eventId).sort();
  const second = email.calls.slice(2).map(call => call.eventId).sort();
  assert.deepEqual(first, second, 'the provider key is derived from the preview id, not from the clock');
});

// ── Routes ────────────────────────────────────────────────────────────────────────────────────

const adminStore = {
  async getIdentity(id) {
    if (id === 'owner-id') return { id, name: 'Owner', email: 'owner@example.com', emailVerified: true };
    if (id === 'regular-id') return { id, name: 'Regular', email: 'regular@example.com', emailVerified: true };
    return null;
  },
};

function cookieSession(req) {
  const cookie = req.headers.cookie ?? '';
  if (cookie.includes('sid=owner')) return { id: 'owner-id' };
  if (cookie.includes('sid=regular')) return { id: 'regular-id' };
  return null;
}

async function startApi({ mail }) {
  const app = express();
  app.use('/api/admin', createAdminRouter({
    store: adminStore,
    getSession: cookieSession,
    rateLimiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
    env: { ADMIN_EMAILS: 'owner@example.com' },
    mail,
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return { base: `http://127.0.0.1:${address.port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('composed mail sits behind the same admin gate as everything else', async () => {
  const { service } = build([user(1), user(2)]);
  const api = await startApi({ mail: service });
  try {
    const anonymous = await fetch(`${api.base}/api/admin/mail/recipients`);
    assert.equal(anonymous.status, 401);

    const regular = await fetch(`${api.base}/api/admin/mail/recipients`, { headers: { cookie: 'sid=regular' } });
    assert.equal(regular.status, 403, 'a signed-in non-admin cannot enumerate addresses');

    const denied = await fetch(`${api.base}/api/admin/mail/send`, {
      method: 'POST',
      headers: { cookie: 'sid=regular', 'content-type': 'application/json' },
      body: JSON.stringify({ draft: DRAFT, selection: { kind: 'segment', segment: 'all' }, previewId: 'preview-0003', confirmedRecipients: 2 }),
    });
    assert.equal(denied.status, 403);
  } finally {
    await api.close();
  }
});

test('the route round-trip previews, refuses an unconfirmed count, and then sends', async () => {
  const { service, email } = build([user(1), user(2)]);
  const api = await startApi({ mail: service });
  const auth = { cookie: 'sid=owner', 'content-type': 'application/json' };
  try {
    const people = await fetch(`${api.base}/api/admin/mail/recipients?q=person&page=1&limit=10`, { headers: auth });
    assert.equal(people.status, 200);
    const listing = await people.json();
    assert.equal(listing.total, 2);
    assert.equal(listing.items[0].email, 'person1@example.com', 'an allowlisted admin may see addresses');

    const verified = await (await fetch(`${api.base}/api/admin/mail/recipients?segment=verified&page=1&limit=10`, { headers: auth })).json();
    assert.equal(verified.total, 1, 'the picker can narrow the directory to one segment');
    assert.equal(verified.cap, MAIL_RECIPIENT_CAP);

    const previewResponse = await fetch(`${api.base}/api/admin/mail/preview`, {
      method: 'POST', headers: auth, body: JSON.stringify({ draft: DRAFT, selection: { kind: 'segment', segment: 'all' } }),
    });
    assert.equal(previewResponse.status, 200);
    const preview = await previewResponse.json();
    assert.match(preview.html, /Hi Person,/);
    assert.equal(preview.recipients.total, 2);

    const unconfirmed = await fetch(`${api.base}/api/admin/mail/send`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ draft: DRAFT, selection: { kind: 'segment', segment: 'all' }, previewId: preview.previewId, confirmedRecipients: 1 }),
    });
    assert.equal(unconfirmed.status, 409);
    assert.equal((await unconfirmed.json()).error, 'recipient_count_changed');
    assert.equal(email.calls.length, 0);

    const sent = await fetch(`${api.base}/api/admin/mail/send`, {
      method: 'POST', headers: auth,
      body: JSON.stringify({ draft: DRAFT, selection: { kind: 'segment', segment: 'all' }, previewId: preview.previewId, confirmedRecipients: 2 }),
    });
    assert.equal(sent.status, 200);
    const result = await sent.json();
    assert.equal(result.sent, 2);
    assert.equal(email.calls.length, 2);

    const history = await (await fetch(`${api.base}/api/admin/mail/sends`, { headers: auth })).json();
    assert.equal(history.items.length, 1);
    assert.equal(history.items[0].subject, DRAFT.subject);
  } finally {
    await api.close();
  }
});

test('malformed bodies are rejected before any email is composed', async () => {
  const { service, email } = build([user(1)]);
  const api = await startApi({ mail: service });
  const auth = { cookie: 'sid=owner', 'content-type': 'application/json' };
  try {
    const badDraft = await fetch(`${api.base}/api/admin/mail/preview`, {
      method: 'POST', headers: auth, body: JSON.stringify({ draft: { ...DRAFT, subject: '' }, selection: { kind: 'segment', segment: 'all' } }),
    });
    assert.equal(badDraft.status, 400);
    assert.equal((await badDraft.json()).error, 'invalid_draft');

    const badSelection = await fetch(`${api.base}/api/admin/mail/preview`, {
      method: 'POST', headers: auth, body: JSON.stringify({ draft: DRAFT, selection: { kind: 'segment', segment: 'everyone' } }),
    });
    assert.equal(badSelection.status, 400);
    assert.equal((await badSelection.json()).error, 'invalid_selection');
    assert.equal(email.calls.length, 0);
  } finally {
    await api.close();
  }
});

test('without a mail stack the routes say so instead of pretending to send', async () => {
  const api = await startApi({ mail: undefined });
  try {
    const response = await fetch(`${api.base}/api/admin/mail/preview`, {
      method: 'POST',
      headers: { cookie: 'sid=owner', 'content-type': 'application/json' },
      body: JSON.stringify({ draft: DRAFT, selection: { kind: 'segment', segment: 'all' } }),
    });
    assert.equal(response.status, 503);
    assert.equal((await response.json()).error, 'mail_unavailable');
  } finally {
    await api.close();
  }
});

test('without the send-log table nothing is sent and nothing is claimed', async () => {
  const store = fakeStore([user(1), user(2)], { ready: false });
  const email = fakeEmail();
  const service = createMailService({ store, config, send: email.send });
  const parsed = parseComposeDraft(DRAFT, ORIGIN);

  const preview = await service.preview({ draft: parsed.draft, selection: { kind: 'segment', segment: 'all' } });
  assert.equal(preview.ready, false, 'the dashboard is told the log is missing before it offers a send');

  await assert.rejects(
    service.send({
      draft: parsed.draft, selection: { kind: 'segment', segment: 'all' },
      previewId: preview.previewId, confirmedRecipients: 2, adminUserId: 'admin_1',
    }),
    error => error.code === 'mail_unavailable' && error.status === 503,
  );
  assert.equal(email.calls.length, 0);
});
