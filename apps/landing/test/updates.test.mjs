import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { readFile } from 'node:fs/promises';
import { createUpdatesRouter } from '../server/updates/routes.ts';
import { createPostgresUpdatesStore } from '../server/updates/store.ts';

function fakePool(handler) {
  return {
    async query(sql, params = []) {
      return handler(String(sql), params);
    },
  };
}

async function mount(store) {
  const app = express();
  app.use('/api/updates', createUpdatesRouter({ store }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { server, base: `http://127.0.0.1:${server.address().port}` };
}

const post = (base, body) => fetch(`${base}/api/updates/subscribe`, {
  method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body),
});

test('a valid address subscribes; invalid ones are rejected', async () => {
  const subscribed = [];
  const { server, base } = await mount({ async subscribe(email, interest) { subscribed.push([email, interest]); return 'subscribed'; } });
  try {
    const ok = await post(base, { email: 'Ada@Example.com', interest: 'pro' });
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { status: 'subscribed' });
    assert.deepEqual(subscribed, [['ada@example.com', 'pro']], 'addresses are lowercased before storage');

    const def = await post(base, { email: 'bob@example.com' });
    assert.equal(def.status, 200);
    assert.deepEqual(subscribed[1], ['bob@example.com', 'updates'], 'interest defaults to updates');

    for (const bad of [{ email: 'not-an-email' }, { email: '' }, {}, { email: 'a@b' }]) {
      const res = await post(base, bad);
      assert.equal(res.status, 400, `${JSON.stringify(bad)} is rejected`);
      assert.match((await res.json()).error, /valid email/);
    }
  } finally {
    server.close();
  }
});

test('honeypot submissions are accepted and silently dropped', async () => {
  let calls = 0;
  const { server, base } = await mount({ async subscribe() { calls += 1; return 'subscribed'; } });
  try {
    const res = await post(base, { email: 'bot@example.com', website: 'http://spam.example' });
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { status: 'subscribed' });
    assert.equal(calls, 0, 'nothing reaches the store');
  } finally {
    server.close();
  }
});

test('store failures surface as temporary unavailability, never internals', async () => {
  const { server, base } = await mount({ async subscribe() { throw new Error('updates_store_unavailable'); } });
  try {
    const res = await post(base, { email: 'ada@example.com' });
    assert.equal(res.status, 503);
    assert.ok(!(await res.json()).error.includes('updates_store_unavailable'));
  } finally {
    server.close();
  }
});

test('the postgres store inserts idempotently and lowercases', async () => {
  const queries = [];
  const pool = fakePool((sql, params) => {
    queries.push([sql.split(' ').slice(0, 3).join(' '), params]);
    if (sql.startsWith('SELECT 1 FROM update_subscription')) return { rows: [{}], rowCount: 1 };
    return { rows: [], rowCount: 0 };
  });
  const store = createPostgresUpdatesStore(pool, () => 'us_test');
  assert.equal(await store.subscribe('Ada@Example.com', 'pro'), 'subscribed');
  const insert = queries.find(([sql]) => sql.startsWith('INSERT INTO update_subscription'));
  assert.deepEqual(insert[1], ['us_test', 'ada@example.com', 'pro']);
});

test('migration 016 owns the update subscriptions table', async () => {
  const text = await readFile(new URL('../db/migrations/016_update_subscriptions.sql', import.meta.url), 'utf8');
  const sql = text.replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS update_subscription \(/);
  assert.match(sql, /UNIQUE|unique/i);
});
