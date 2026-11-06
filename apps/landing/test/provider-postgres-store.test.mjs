/**
 * The provider store against a real PostgreSQL engine.
 *
 * The rule under test is the deployment order. The columns that remember what an authorization
 * asked for and where to send the person afterwards arrive with migration 042, and migrations are
 * run by an operator against the live database — not by the server when it starts. So a server
 * that is already running can find itself talking to a schema that does not have those columns
 * yet, and connecting a provider must still work: the request is forgotten rather than refused.
 */

import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { createPostgresStore } from '../server/providers/postgres-store.ts';

const migration = name => readFile(new URL(`../db/migrations/${name}`, import.meta.url), 'utf8');

let db;

/**
 * PGlite does not speak the `pg` pool API the provider store uses, so it is given a small adapter
 * that does: a pool with `query`, and a `connect` that hands out a client with `release`.
 */
function poolFor(database) {
  return {
    async query(text, params) {
      const result = await database.query(text, params);
      return { rows: result.rows, rowCount: result.rows.length };
    },
    async connect() {
      return {
        query: (text, params) => poolFor(database).query(text, params),
        release() {},
      };
    },
  };
}

before(async () => {
  db = new PGlite();
  await db.exec('CREATE TABLE "user" (id text PRIMARY KEY)');
  await db.exec(`INSERT INTO "user" (id) VALUES ('user_a')`);
  await db.exec(await migration('001_provider_connections.sql'));
});

after(async () => {
  await db.close();
});

function transaction(overrides = {}) {
  return {
    id: 'tx-1',
    userId: 'user_a',
    provider: 'google',
    stateHash: 'state-hash-1',
    codeVerifierCiphertext: 'cipher',
    nonceHash: 'nonce-hash',
    redirectUri: 'https://intake.test/api/providers/google/callback',
    requestedScopes: ['openid', 'email', 'https://www.googleapis.com/auth/forms.body'],
    returnTo: '/app/library?insights=form-1&grant=responses',
    expiresAt: new Date('2026-11-06T10:10:00.000Z'),
    ...overrides,
  };
}

test('the store works before the transaction-context columns exist', async () => {
  const store = createPostgresStore(poolFor(db));
  await store.createTransaction(transaction(), new Date('2026-11-06T10:00:00.000Z'));
  const consumed = await store.consumeTransaction('state-hash-1', 'user_a', 'google', new Date('2026-11-06T10:00:01.000Z'));
  assert.equal(consumed.ok, true);
  assert.deepEqual(consumed.transaction.requestedScopes, [], 'the request is forgotten rather than refused');
  assert.equal(consumed.transaction.returnTo, null);
});

test('the store records the request and the return path once the columns exist', async () => {
  await db.exec(await migration('042_provider_oauth_transaction_context.sql'));
  const store = createPostgresStore(poolFor(db));
  await store.createTransaction(transaction({ id: 'tx-2', stateHash: 'state-hash-2' }), new Date('2026-11-06T10:00:00.000Z'));
  const consumed = await store.consumeTransaction('state-hash-2', 'user_a', 'google', new Date('2026-11-06T10:00:01.000Z'));
  assert.equal(consumed.ok, true);
  assert.deepEqual(consumed.transaction.requestedScopes, ['openid', 'email', 'https://www.googleapis.com/auth/forms.body']);
  assert.equal(consumed.transaction.returnTo, '/app/library?insights=form-1&grant=responses');
});

test('a connection still saves and reads its scopes and tokens', async () => {
  const store = createPostgresStore(poolFor(db));
  await store.saveConnection({
    id: 'connection-1',
    userId: 'user_a',
    provider: 'google',
    status: 'connected',
    externalAccountId: 'google-sub',
    externalAccountEmail: 'ada@gmail.com',
    externalAccountLabel: 'Ada',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/forms.body'],
    accessTokenCiphertext: 'access-cipher',
    accessTokenExpiresAt: new Date('2026-11-06T11:00:00.000Z'),
    refreshTokenCiphertext: 'refresh-cipher',
    lastAuthorizedAt: new Date('2026-11-06T10:00:00.000Z'),
    lastRefreshedAt: null,
  });
  const stored = await store.getConnection('user_a', 'google');
  assert.equal(stored.status, 'connected');
  assert.deepEqual(stored.scopes, ['openid', 'email', 'https://www.googleapis.com/auth/forms.body']);
  assert.equal(stored.refreshTokenCiphertext, 'refresh-cipher');
});
