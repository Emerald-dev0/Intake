import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { readCoreServerConfig } from '../server/config.ts';
import {
  createMemoryRateLimitStore,
  createPostgresRateLimitStore,
  consumeRequestLimit,
  setRateLimitHeaders,
} from '../server/security/rate-limit.ts';

const SECRET = 'a-production-auth-secret-longer-than-32-characters';

function productionEnv(overrides = {}) {
  return {
    NODE_ENV: 'production',
    BETTER_AUTH_SECRET: SECRET,
    BETTER_AUTH_URL: 'https://intake.example',
    DATABASE_URL: 'postgresql://intake:secret@db.example/intake?sslmode=require',
    PORT: '3001',
    API_TRUST_PROXY_HOPS: '1',
    ...overrides,
  };
}

test('production configuration fails fast for weak secrets, insecure origins, database TLS, ports, and proxy depth', () => {
  assert.throws(() => readCoreServerConfig(productionEnv({ BETTER_AUTH_SECRET: 'changeme' })), /BETTER_AUTH_SECRET/);
  assert.throws(() => readCoreServerConfig(productionEnv({ BETTER_AUTH_SECRET: 'your_example_secret_that_is_not_random' })), /BETTER_AUTH_SECRET/);
  assert.throws(() => readCoreServerConfig(productionEnv({ BETTER_AUTH_URL: 'http://intake.example' })), /HTTPS/);
  assert.throws(() => readCoreServerConfig(productionEnv({ DATABASE_URL: 'postgresql://db.example/intake?sslmode=prefer' })), /require TLS/);
  assert.throws(() => readCoreServerConfig(productionEnv({ PORT: '0' })), /PORT/);
  assert.throws(() => readCoreServerConfig(productionEnv({ API_TRUST_PROXY_HOPS: '9' })), /API_TRUST_PROXY_HOPS/);

  const config = readCoreServerConfig(productionEnv());
  assert.equal(config.publicOrigin, 'https://intake.example');
  assert.equal(config.port, 3001);
  assert.equal(config.trustProxyHops, 1);
  assert.equal(config.production, true);
});

test('the fixed-window store rejects excess calls, resets at the boundary, and emits a safe retry header', async () => {
  let now = Date.parse('2026-10-01T12:00:01.000Z');
  const store = createMemoryRateLimitStore(() => now);
  const rule = { limit: 2, windowSeconds: 60 };
  assert.equal((await store.consume('test.user', 'user-a', rule)).allowed, true);
  assert.equal((await store.consume('test.user', 'user-a', rule)).allowed, true);
  const rejected = await store.consume('test.user', 'user-a', rule);
  assert.equal(rejected.allowed, false);
  assert.equal(rejected.remaining, 0);
  assert.equal(rejected.retryAfterSeconds, 59);

  const headers = new Map();
  setRateLimitHeaders({ set: (name, value) => headers.set(name, value) }, rejected.retryAfterSeconds);
  assert.equal(headers.get('Retry-After'), '59');

  now += 60_000;
  assert.equal((await store.consume('test.user', 'user-a', rule)).allowed, true);
});

test('request abuse controls enforce both user and network limits and fail closed on storage errors', async () => {
  const req = { ip: '203.0.113.8', socket: {} };
  const unavailable = await consumeRequestLimit({ consume: async () => { throw new Error('database unavailable'); } }, 'ai.interpret', 'user-a', req);
  assert.deepEqual(unavailable, { ok: false, reason: 'unavailable' });

  let networkCalls = 0;
  const store = {
    async consume(scope) {
      if (scope.endsWith('.network')) networkCalls += 1;
      return scope.endsWith('.network')
        ? { allowed: false, retryAfterSeconds: 17, limit: 1, remaining: 0 }
        : { allowed: true, retryAfterSeconds: 17, limit: 1, remaining: 0 };
    },
  };
  assert.deepEqual(await consumeRequestLimit(store, 'forms.create', 'user-a', req), { ok: false, reason: 'rate_limited', retryAfterSeconds: 17 });
  assert.equal(networkCalls, 1);

  networkCalls = 0;
  const userDenied = {
    async consume(scope) {
      if (scope.endsWith('.network')) networkCalls += 1;
      return { allowed: false, retryAfterSeconds: 9, limit: 1, remaining: 0 };
    },
  };
  assert.deepEqual(await consumeRequestLimit(userDenied, 'forms.create', 'user-a', req), { ok: false, reason: 'rate_limited', retryAfterSeconds: 9 });
  assert.equal(networkCalls, 0, 'a denied user cannot drain a shared proxy/network bucket');
});

test('the PostgreSQL limiter stores one-way subject hashes rather than raw user or network identifiers', async () => {
  const calls = [];
  const pool = {
    async query(sql, params) {
      calls.push({ sql, params });
      return { rows: [{ request_count: 1, retry_after_seconds: 30 }], rowCount: 1 };
    },
  };
  const store = createPostgresRateLimitStore(pool, SECRET);
  await store.consume('ai.interpret.user', 'user:user-private-id', { limit: 8, windowSeconds: 600 });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].params[0], 'ai.interpret.user');
  assert.match(calls[0].params[1], /^[0-9a-f]{64}$/);
  assert.equal(JSON.stringify(calls).includes('user-private-id'), false);
});

test('production-hardening migration is additive and enforces edit-draft ownership', async () => {
  const text = await readFile(new URL('../db/migrations/006_production_hardening.sql', import.meta.url), 'utf8');
  const sql = text.replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS api_rate_limit/);
  assert.match(sql, /subject_hash text NOT NULL CHECK \(subject_hash ~ '\^\[0-9a-f\]\{64\}\$'\)/);
  assert.match(sql, /UNIQUE \(user_id, id\)/);
  assert.match(sql, /FOREIGN KEY \(user_id, form_record_id\)\s+REFERENCES form \(user_id, id\)/);
  assert.match(sql, /ON DELETE SET NULL \(form_record_id\)/);
  assert.doesNotMatch(sql, /\b(access_token|refresh_token|request_body|ip_address)\b/i);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im);
});
