import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import { createAdminRouter, parseAdminEmails } from '../server/admin/routes.ts';

const env = { ADMIN_EMAILS: 'owner@example.com, OPS@intake.example' };

function createStore(calls = []) {
  return {
    async getIdentity(id) {
      calls.push(['identity', id]);
      if (id === 'owner-id') return { id, name: 'Intake Owner', email: 'OWNER@example.com', emailVerified: true };
      if (id === 'regular-id') return { id, name: 'Regular User', email: 'regular@example.com', emailVerified: true };
      return null;
    },
    async getOverview(bounds) { calls.push(['overview', bounds.range]); return { range: bounds.range, users: { total: 4 } }; },
    async listUsers(input) { calls.push(['users', input]); return { items: [], page: input.page, pageSize: input.limit, total: 0, totalPages: 0 }; },
    async getUserDetail(id) { calls.push(['detail', id]); return null; },
    async listAi(input) { calls.push(['ai', input]); return { items: [], page: input.page, pageSize: input.limit, total: 0, totalPages: 0, available: false, reason: 'no table', trackingSince: null, summary: null }; },
    getCredits() { calls.push(['credits']); return { available: false, reason: 'no ledger', summary: null, items: [] }; },
    async listForms(input) { calls.push(['forms', input]); return { items: [], page: input.page, pageSize: input.limit, total: 0, totalPages: 0, available: true, reason: null }; },
    async getProviders() { calls.push(['providers']); return { generatedAt: new Date(), google: {}, microsoft: {}, ai: {} }; },
    async getSystem() { calls.push(['system']); return { generatedAt: new Date() }; },
    async listActivity(input) { calls.push(['activity', input]); return { items: [], page: input.page, pageSize: input.limit, total: 0, totalPages: 0, sources: {} }; },
    async listErrors(input) { calls.push(['errors', input]); return { items: [], page: input.page, pageSize: input.limit, total: 0, totalPages: 0, sources: {}, resolutionTrackingAvailable: false }; },
  };
}

async function startApi({ store = createStore(), session = () => null, rateLimiter, adminEmails = env.ADMIN_EMAILS } = {}) {
  const app = express();
  const limiter = rateLimiter ?? { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) };
  app.use('/api/admin', createAdminRouter({ store, getSession: session, rateLimiter: limiter, env: { ADMIN_EMAILS: adminEmails } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    base: `http://127.0.0.1:${address.port}`,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

function cookieSession(req) {
  const cookie = req.headers.cookie ?? '';
  if (cookie.includes('sid=owner')) return { id: 'owner-id', email: 'attacker-supplied-email@example.com', name: 'Client Name' };
  if (cookie.includes('sid=regular')) return { id: 'regular-id', email: 'owner@example.com', name: 'Spoofed Owner' };
  return null;
}

test('admin identity allowlist is exact, case-insensitive, and rejects wildcard entries', () => {
  assert.deepEqual([...parseAdminEmails(' OWNER@example.com,*,@intake.example,ops@intake.example,')], ['owner@example.com', 'ops@intake.example']);
  assert.deepEqual([...parseAdminEmails(undefined)], []);
});

test('unauthenticated and client-forged admin state receive 401 before admin data is accessed', async () => {
  const calls = [];
  const api = await startApi({ store: createStore(calls), session: cookieSession });
  try {
    const response = await fetch(`${api.base}/api/admin/users?isAdmin=true&userId=owner-id`);
    assert.equal(response.status, 401);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    assert.match(response.headers.get('x-robots-tag'), /noindex/);
    assert.deepEqual(calls, []);
  } finally { await api.close(); }
});

test('a signed-in non-admin cannot authorize itself with a forged email, query, or JSON body', async () => {
  const calls = [];
  const api = await startApi({ store: createStore(calls), session: cookieSession });
  try {
    const response = await fetch(`${api.base}/api/admin/overview?isAdmin=true&email=owner%40example.com`, {
      method: 'POST',
      headers: { cookie: 'sid=regular', 'content-type': 'application/json' },
      body: JSON.stringify({ isAdmin: true, email: 'owner@example.com', userId: 'owner-id' }),
    });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Administrator access requires a verified allowlisted account.' });
    assert.deepEqual(calls, [['identity', 'regular-id']]);
  } finally { await api.close(); }
});

test('authorized admin is decided from the server-loaded Better Auth identity; endpoints verify it independently', async () => {
  const calls = [];
  const api = await startApi({ store: createStore(calls), session: cookieSession });
  try {
    const access = await fetch(`${api.base}/api/admin/access?isAdmin=false`, { headers: { cookie: 'sid=owner' } });
    assert.equal(access.status, 200);
    assert.deepEqual(await access.json(), { admin: { id: 'owner-id', name: 'Intake Owner', email: 'OWNER@example.com' }, readOnly: true });

    const result = await fetch(`${api.base}/api/admin/overview?range=30d`, { headers: { cookie: 'sid=owner' } });
    assert.equal(result.status, 200);
    assert.equal((await result.json()).range, '30d');
    assert.ok(calls.filter(call => call[0] === 'identity').length >= 2, 'every endpoint resolves the session and allowlist again');
    assert.ok(calls.some(call => call[0] === 'overview' && call[1] === '30d'));
    assert.ok(calls.every(call => call[0] !== 'users'), 'forged query state never enabled user access');
  } finally { await api.close(); }
});

test('an allowlisted but unverified Better Auth email cannot claim administrator access', async () => {
  const calls = [];
  const store = createStore(calls);
  store.getIdentity = async id => {
    calls.push(['identity', id]);
    return { id, name: 'Unverified Owner', email: 'owner@example.com', emailVerified: false };
  };
  const api = await startApi({ store, session: cookieSession });
  try {
    const response = await fetch(`${api.base}/api/admin/access`, { headers: { cookie: 'sid=owner' } });
    assert.equal(response.status, 403);
    assert.deepEqual(await response.json(), { error: 'Administrator access requires a verified allowlisted account.' });
    assert.deepEqual(calls, [['identity', 'owner-id']]);
  } finally { await api.close(); }
});

test('admin API direct access without a Better Auth session is rejected even for detail routes', async () => {
  const api = await startApi({ store: createStore(), session: cookieSession });
  try {
    const response = await fetch(`${api.base}/api/admin/users/another-user?admin=1`);
    assert.equal(response.status, 401);
  } finally { await api.close(); }
});

test('an expired or logged-out admin session loses access on the next request', async () => {
  let active = true;
  const api = await startApi({
    store: createStore(),
    session: async () => active ? { id: 'owner-id', email: 'owner@example.com', name: 'Owner' } : null,
  });
  try {
    assert.equal((await fetch(`${api.base}/api/admin/access`)).status, 200);
    active = false;
    assert.equal((await fetch(`${api.base}/api/admin/users`)).status, 401);
  } finally { await api.close(); }
});

test('admin searches are bounded, server-side and rate-limited independently from user limits', async () => {
  const calls = [];
  const api = await startApi({
    store: createStore(calls), session: cookieSession,
    rateLimiter: { consume: async (scope, subject, rule) => {
      calls.push(['limit', scope, subject, rule.limit]);
      return { allowed: scope !== 'admin.search', retryAfterSeconds: 13 };
    } },
  });
  try {
    const denied = await fetch(`${api.base}/api/admin/users?q=owner`, { headers: { cookie: 'sid=owner' } });
    assert.equal(denied.status, 429);
    assert.equal(denied.headers.get('retry-after'), '13');
    assert.match(calls.find(call => call[0] === 'limit')[1], /^admin\./);
    assert.equal(calls.find(call => call[0] === 'limit')[2], 'admin:owner-id');
    assert.equal(calls.some(call => call[0] === 'users'), false);

    const invalid = await fetch(`${api.base}/api/admin/overview?range=all`, { headers: { cookie: 'sid=owner' } });
    assert.equal(invalid.status, 400);
  } finally { await api.close(); }
});
