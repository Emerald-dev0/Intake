import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createAdminRouter } from '../server/admin/routes.ts';

async function api(t, { session = null, verified = true, email = 'owner@example.com', list, limiter } = {}) {
  const calls = [];
  const app = express();
  app.use('/api/admin', createAdminRouter({
    store: { async getIdentity() { return { id: 'owner', name: 'Owner', email, emailVerified: verified }; } },
    getSession: async () => session,
    rateLimiter: limiter ?? { consume: async () => ({ allowed: true }) }, env: { ADMIN_EMAILS: 'owner@example.com' },
    waitlist: { async list(input) { calls.push(input); return list ? list(input) : { items: [{ id: 'entry', email: 'private@example.com', welcomeStatus: 'accepted' }], total: 51 }; } },
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  return { calls, get: query => fetch(`http://127.0.0.1:${server.address().port}/api/admin/waitlist${query ?? ''}`) };
}

test('wait-list addresses are only exposed to a verified allowlisted Better Auth identity', async t => {
  for (const [options, status] of [[{}, 401], [{ session: { id: 'user' }, email: 'regular@example.com' }, 403], [{ session: { id: 'owner' }, verified: false }, 403]]) {
    const client = await api(t, options);
    const response = await client.get('?admin=1&email=owner@example.com');
    assert.equal(response.status, status);
    assert.doesNotMatch(await response.text(), /private@example.com/);
    assert.equal(client.calls.length, 0);
  }
});

test('authorized reads use bounded pagination and no-store responses', async t => {
  const client = await api(t, { session: { id: 'owner' } });
  const response = await client.get('?page=2&limit=25');
  assert.equal(response.status, 200);
  assert.equal(response.headers.get('cache-control'), 'no-store');
  assert.deepEqual(client.calls, [{ limit: 25, offset: 25 }]);
  const body = await response.json();
  assert.equal(body.total, 51);
  assert.equal(body.totalPages, 3);
  assert.equal(body.items[0].welcomeStatus, 'accepted');
  const bad = await client.get('?limit=500000');
  assert.equal(bad.status, 400);
});

test('wait-list reads remain rate-limited and storage failures do not masquerade as an empty list', async t => {
  const denied = await api(t, { session: { id: 'owner' }, limiter: { consume: async () => ({ allowed: false, retryAfterSeconds: 11 }) } });
  const limited = await denied.get();
  assert.equal(limited.status, 429);
  assert.equal(limited.headers.get('retry-after'), '11');
  assert.equal(denied.calls.length, 0);
  const broken = await api(t, { session: { id: 'owner' }, list: () => { throw Error('postgres://private'); } });
  const unavailable = await broken.get();
  assert.equal(unavailable.status, 503);
  assert.doesNotMatch(await unavailable.text(), /postgres|private|items/);
});
