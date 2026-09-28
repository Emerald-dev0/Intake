import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash, createSign, generateKeyPairSync } from 'node:crypto';
import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import express from 'express';
import { createTokenCipher, credentialAad } from '../server/providers/crypto.ts';
import { createMemoryStore } from '../server/providers/memory-store.ts';
import { buildAuthorizationUrl, createPkce, redact } from '../server/providers/oauth.ts';
import { FORBIDDEN_SCOPE_MARKERS, providerDefinition, supportedProviders } from '../server/providers/registry.ts';
import { createProviderRouter } from '../server/providers/routes.ts';
import { createProviderService } from '../server/providers/service.ts';
import { parseProviderList, resultMessage, RESULT_CODES } from '../src/lib/connections.ts';

const SECRET = 'test-secret-must-be-at-least-32-characters';
const ORIGIN = 'http://localhost:5173';
const GOOGLE_SCOPE = 'openid email https://www.googleapis.com/auth/forms.body';
const ACCESS = 'ACCESS_TOKEN_SHOULD_NOT_LEAK';
const REFRESH = 'REFRESH_TOKEN_SHOULD_NOT_LEAK';
const { privateKey, publicKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const jwk = { ...publicKey.export({ format: 'jwk' }), kid: 'test-key', alg: 'RS256', use: 'sig' };

function env(overrides = {}) {
  return {
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: SECRET,
    GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: 'test-google-client-secret',
    MICROSOFT_OAUTH_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
    MICROSOFT_OAUTH_CLIENT_SECRET: 'test-microsoft-client-secret',
    ...overrides,
  };
}

function cipher() {
  return createTokenCipher({ authSecret: SECRET });
}

function signIdToken(payload) {
  const header = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'test-key', typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const data = `${header}.${body}`;
  return `${data}.${createSign('RSA-SHA256').update(data).sign(privateKey).toString('base64url')}`;
}

function microsoftToken(nonce) {
  return signIdToken({
    iss: 'https://login.microsoftonline.com/9188040d-6c67-4c5b-b112-36a304b66dad/v2.0',
    aud: '11111111-1111-1111-1111-111111111111',
    tid: '9188040d-6c67-4c5b-b112-36a304b66dad',
    oid: 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa',
    name: 'Ada Microsoft',
    preferred_username: 'ada@outlook.com',
    nonce,
    exp: Math.floor(Date.now() / 1000) + 600,
    nbf: Math.floor(Date.now() / 1000) - 10,
  });
}

async function boot(options = {}) {
  const users = {
    current: { id: 'user-a', email: 'a@intake.test', name: 'Ada' },
    identity: 'google-sub',
    pendingMicrosoftToken: '',
    store: createMemoryStore(),
  };
  const calls = { token: 0, refresh: 0, revoke: 0, refreshMode: 'ok' };
  const http = {
    async postForm(url, body) {
      const params = new URLSearchParams(body.toString());
      if (String(url).endsWith('/revoke')) {
        calls.revoke += 1;
        return { status: 200, json: {} };
      }
      calls.token += 1;
      if (params.get('grant_type') === 'refresh_token') {
        calls.refresh += 1;
        if (calls.refreshMode === 'invalid_grant') return { status: 400, json: { error: 'invalid_grant' } };
        return { status: 200, json: { access_token: 'REFRESHED_ACCESS_TOKEN', expires_in: 3600, token_type: 'Bearer', scope: GOOGLE_SCOPE } };
      }
      if (options.tokenStatus) return { status: options.tokenStatus, json: { error: options.tokenError || 'server_error' } };
      if (String(url).includes('login.microsoftonline.com')) {
        return { status: 200, json: { access_token: 'MS_ACCESS_SHOULD_NOT_LEAK', refresh_token: 'MS_REFRESH_SHOULD_NOT_LEAK', expires_in: 3600, token_type: 'Bearer', scope: 'openid profile email offline_access', id_token: users.pendingMicrosoftToken } };
      }
      return { status: 200, json: { access_token: ACCESS, refresh_token: REFRESH, expires_in: 3600, token_type: 'Bearer', scope: options.scope || GOOGLE_SCOPE } };
    },
    async getJson(url, headers = {}) {
      if (String(url).includes('/discovery/')) return { status: 200, json: { keys: [jwk] } };
      assert.match(headers.authorization || '', /^Bearer /);
      return { status: 200, json: { sub: users.identity, email: 'ada@gmail.com', email_verified: true, name: 'Ada Lovelace' } };
    },
  };
  const runtime = options.env || env();
  const service = createProviderService({ store: users.store, http, cipher: cipher(), env: runtime, now: options.now });
  const app = express();
  app.use('/api/providers', createProviderRouter({ service, env: runtime, getSession: async () => users.current }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    app: `http://127.0.0.1:${server.address().port}`,
    calls,
    users,
    service,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function connect(base, provider, users) {
  const start = await fetch(`${base}/api/providers/${provider}/connect`, { method: 'POST', redirect: 'manual', headers: { origin: ORIGIN } });
  const url = new URL(start.headers.get('location'));
  if (provider === 'microsoft' && users) users.pendingMicrosoftToken = microsoftToken(url.searchParams.get('nonce'));
  const callback = await fetch(`${base}/api/providers/${provider}/callback?${new URLSearchParams({ code: `code-${provider}`, state: url.searchParams.get('state') })}`, { redirect: 'manual' });
  return new URL(callback.headers.get('location'), ORIGIN).searchParams.get('result');
}

test('provider scopes stay limited to identity and the forms access that actually exists', () => {
  const runtime = env();
  for (const provider of supportedProviders(runtime)) {
    const blob = provider.scopes.join(' ').toLowerCase();
    for (const marker of FORBIDDEN_SCOPE_MARKERS) assert.equal(blob.includes(marker), false, `${provider.id} requested ${marker}`);
  }
  assert.deepEqual(providerDefinition('google', runtime).requiredScopes, ['https://www.googleapis.com/auth/forms.body']);
  assert.deepEqual(providerDefinition('microsoft', runtime).scopes, ['openid', 'profile', 'email', 'offline_access']);
  assert.equal(providerDefinition('google', runtime).formsApi, 'supported');
  assert.equal(providerDefinition('microsoft', runtime).formsApi, 'unsupported');
  assert.equal(providerDefinition('microsoft', { ...runtime, MICROSOFT_OAUTH_TENANT: 'not a tenant' }).configurationError != null, true);
});

test('authorization URLs carry PKCE and never the client secret', () => {
  const { verifier, challenge } = createPkce();
  assert.notEqual(verifier, challenge);
  assert.equal(challenge, createHash('sha256').update(verifier).digest('base64url'));
  const url = new URL(buildAuthorizationUrl({
    endpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    clientId: 'test-google-client-id',
    redirectUri: `${ORIGIN}/api/providers/google/callback`,
    scopes: providerDefinition('google', env()).scopes,
    state: 'state-value',
    nonce: 'nonce-value',
    codeChallenge: challenge,
    extraParams: { access_type: 'offline' },
  }));
  assert.equal(url.searchParams.get('code_challenge_method'), 'S256');
  assert.equal(url.searchParams.get('response_type'), 'code');
  assert.equal(url.searchParams.get('redirect_uri'), `${ORIGIN}/api/providers/google/callback`);
  assert.equal(url.searchParams.has('client_secret'), false);
  assert.equal(url.toString().includes(verifier), false);
});

test('credential encryption is bound to the owning user', () => {
  const box = cipher();
  const payload = box.encrypt(ACCESS, credentialAad('user-a', 'google', 'access'));
  assert.equal(payload.includes(ACCESS), false);
  assert.equal(box.decrypt(payload, credentialAad('user-a', 'google', 'access')), ACCESS);
  assert.throws(() => box.decrypt(payload, credentialAad('user-b', 'google', 'access')));
  assert.throws(() => box.decrypt(payload, credentialAad('user-a', 'google', 'refresh')));
});

test('logs redact tokens, codes, and database URLs', () => {
  const redacted = redact('failed access_token=abc refresh_token=def code=ghi client_secret=jkl postgresql://user:pass@host/db eyJhbGciOi.eyJzdWIiOi.signature');
  assert.equal(redacted.includes('abc'), false);
  assert.equal(redacted.includes('pass@host'), false);
  assert.match(redacted, /\[redacted/);
});

test('the connection schema ties grants to the Intake user and stores ciphertext only', async () => {
  const sql = await readFile(new URL('../db/migrations/001_provider_connections.sql', import.meta.url), 'utf8');
  assert.match(sql, /user_id text NOT NULL REFERENCES "user"\(id\) ON DELETE CASCADE/);
  assert.match(sql, /UNIQUE \(user_id, provider\)/);
  assert.match(sql, /access_token_ciphertext/);
  assert.match(sql, /refresh_token_ciphertext/);
  assert.doesNotMatch(sql, /access_token text/);
  assert.doesNotMatch(sql, /refresh_token text/);
  assert.match(sql, /provider IN \('google', 'microsoft'\)/);
});

test('public connection responses cannot carry credentials', async () => {
  const { app, calls, close, users } = await boot();
  try {
    const start = await fetch(app + '/api/providers/google/connect', { method: 'POST', redirect: 'manual', headers: { origin: ORIGIN } });
    const location = new URL(start.headers.get('location'));
    assert.equal(location.origin, 'https://accounts.google.com');
    assert.equal(location.searchParams.has('client_secret'), false);
    const callback = await fetch(`${app}/api/providers/google/callback?${new URLSearchParams({ code: 'AUTH_CODE_SHOULD_NOT_LEAK', state: location.searchParams.get('state') })}`, { redirect: 'manual' });
    const done = new URL(callback.headers.get('location'), ORIGIN);
    assert.equal(done.searchParams.get('result'), 'connected');
    assert.equal(callback.headers.get('location').includes('AUTH_CODE_SHOULD_NOT_LEAK'), false);
    assert.equal(callback.headers.get('referrer-policy'), 'no-referrer');
    const body = await (await fetch(app + '/api/providers?userId=user-b', { headers: { accept: 'application/json' } })).text();
    assert.equal(body.includes(ACCESS), false);
    assert.equal(body.includes(REFRESH), false);
    assert.equal(body.includes('ciphertext'), false);
    assert.equal(body.includes('test-google-client-secret'), false);
    const parsed = parseProviderList(JSON.parse(body));
    assert.equal(parsed.find(provider => provider.id === 'google').status, 'connected');
    assert.equal(parsed.find(provider => provider.id === 'google').accountEmail, 'ada@gmail.com');
    assert.equal(parsed.find(provider => provider.id === 'microsoft').status, 'not_connected');
    assert.equal(calls.token, 1);
    const stored = await users.store.getConnection('user-a', 'google');
    assert.equal(stored.accessTokenCiphertext.includes(ACCESS), false);
  } finally {
    await close();
  }
});

test('a different Intake user cannot see or disconnect someone else’s connection', async () => {
  const { app, close, users, service } = await boot();
  try {
    assert.equal(await connect(app, 'google'), 'connected');
    users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };
    const parsed = parseProviderList(await (await fetch(app + '/api/providers', { headers: { accept: 'application/json' } })).json());
    assert.equal(parsed.find(provider => provider.id === 'google').status, 'not_connected');
    assert.equal(JSON.stringify(parsed).includes('ada@gmail.com'), false);
    const removed = await fetch(app + '/api/providers/google/disconnect', { method: 'POST', headers: { accept: 'application/json', origin: ORIGIN } });
    assert.equal((await removed.json()).revocation, 'not_attempted');
    assert.equal((await users.store.getConnection('user-a', 'google')).externalAccountEmail, 'ada@gmail.com');
    assert.equal((await service.getAuthorizedConnection('user-b', 'google')).reason, 'not_connected');
    const owned = await service.getAuthorizedConnection('user-a', 'google');
    assert.equal(owned.ok, true);
    assert.equal(owned.accessToken, ACCESS);
    assert.equal(owned.userId, 'user-a');
  } finally {
    await close();
  }
});

test('cancelled, denied, and invalid callbacks do not persist a connection', async () => {
  const { app, calls, close, users } = await boot();
  try {
    const cancelled = await fetch(app + '/api/providers/google/callback?error=access_denied&error_subcode=cancel&state=nope', { redirect: 'manual' });
    assert.equal(new URL(cancelled.headers.get('location'), ORIGIN).searchParams.get('result'), 'cancelled');
    const denied = await fetch(app + '/api/providers/microsoft/callback?error=access_denied', { redirect: 'manual' });
    assert.equal(new URL(denied.headers.get('location'), ORIGIN).searchParams.get('result'), 'denied');
    const invalid = await fetch(app + '/api/providers/google/callback?code=stolen&state=not-ours', { redirect: 'manual' });
    assert.equal(new URL(invalid.headers.get('location'), ORIGIN).searchParams.get('result'), 'invalid_state');
    assert.equal(invalid.headers.get('location').includes('stolen'), false);
    assert.equal(calls.token, 0);
    assert.equal(await users.store.getConnection('user-a', 'google'), null);
    assert.match(resultMessage('cancelled', 'google').text, /Nothing was connected/);
    assert.match(resultMessage('connected', 'google').text, /No form was created/);
    assert.match(resultMessage('connected', 'microsoft').text, /No form was created/);
  } finally {
    await close();
  }
});

test('expired state, a mismatched session, and a different external account are rejected', async () => {
  let clock = new Date('2026-09-28T12:00:00Z');
  const { app, calls, close, users } = await boot({ now: () => clock });
  try {
    const first = await fetch(app + '/api/providers/google/connect', { method: 'POST', redirect: 'manual', headers: { origin: ORIGIN } });
    const state = new URL(first.headers.get('location')).searchParams.get('state');
    clock = new Date('2026-09-28T12:11:00Z');
    const expired = await fetch(`${app}/api/providers/google/callback?code=late&state=${state}`, { redirect: 'manual' });
    assert.equal(new URL(expired.headers.get('location'), ORIGIN).searchParams.get('result'), 'expired_state');
    assert.equal(calls.token, 0);

    clock = new Date('2026-09-28T13:00:00Z');
    const second = await fetch(app + '/api/providers/google/connect', { method: 'POST', redirect: 'manual', headers: { origin: ORIGIN } });
    const stolenState = new URL(second.headers.get('location')).searchParams.get('state');
    users.current = { id: 'user-b', email: 'b@intake.test', name: 'Bea' };
    const mismatch = await fetch(`${app}/api/providers/google/callback?code=stolen&state=${stolenState}`, { redirect: 'manual' });
    assert.equal(new URL(mismatch.headers.get('location'), ORIGIN).searchParams.get('result'), 'invalid_state');
    users.current = { id: 'user-a', email: 'a@intake.test', name: 'Ada' };
    const replay = await fetch(`${app}/api/providers/google/callback?code=stolen&state=${stolenState}`, { redirect: 'manual' });
    assert.equal(new URL(replay.headers.get('location'), ORIGIN).searchParams.get('result'), 'invalid_state');
    assert.equal(calls.token, 0);

    assert.equal(await connect(app, 'google'), 'connected');
    users.identity = 'other-google-sub';
    assert.equal(await connect(app, 'google'), 'connection_conflict');
    assert.equal((await users.store.getConnection('user-a', 'google')).externalAccountId, 'google-sub');
  } finally {
    await close();
  }
});

test('disconnect removes the grant, revokes Google, and does not claim Microsoft revocation', async () => {
  const { app, calls, close, users } = await boot();
  try {
    assert.equal(await connect(app, 'google'), 'connected');
    const removed = await (await fetch(app + '/api/providers/google/disconnect', { method: 'POST', headers: { accept: 'application/json', origin: ORIGIN } })).json();
    assert.equal(removed.revocation, 'revoked');
    assert.equal(calls.revoke, 1);
    assert.equal(await users.store.getConnection('user-a', 'google'), null);

    assert.equal(await connect(app, 'microsoft', users), 'connected');
    const microsoft = await (await fetch(app + '/api/providers/microsoft/disconnect', { method: 'POST', headers: { accept: 'application/json', origin: ORIGIN } })).json();
    assert.equal(microsoft.revocation, 'unsupported');
    assert.equal(calls.revoke, 1);
    assert.equal(await users.store.getConnection('user-a', 'microsoft'), null);
    const body = await (await fetch(app + '/api/providers', { headers: { accept: 'application/json' } })).text();
    assert.equal(body.includes('MS_ACCESS_SHOULD_NOT_LEAK'), false);
    assert.equal(body.includes('MS_REFRESH_SHOULD_NOT_LEAK'), false);
  } finally {
    await close();
  }
});

test('missing configuration, insufficient scope, and a failed exchange do not create a connection', async () => {
  const bare = await boot({ env: env({ GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '' }) });
  try {
    const start = await fetch(bare.app + '/api/providers/google/connect', { method: 'POST', redirect: 'manual', headers: { origin: ORIGIN } });
    const location = new URL(start.headers.get('location'), ORIGIN);
    assert.equal(location.searchParams.get('result'), 'not_configured');
    assert.equal(start.headers.get('location').includes('accounts.google.com'), false);
    const listed = parseProviderList(await (await fetch(bare.app + '/api/providers', { headers: { accept: 'application/json' } })).json());
    assert.equal(listed.find(provider => provider.id === 'google').configured, false);
  } finally {
    await bare.close();
  }

  const insufficient = await boot({ scope: 'openid email' });
  try {
    assert.equal(await connect(insufficient.app, 'google'), 'insufficient_permissions');
    assert.equal(insufficient.calls.revoke, 1);
    assert.equal(await insufficient.users.store.getConnection('user-a', 'google'), null);
  } finally {
    await insufficient.close();
  }

  const broken = await boot({ tokenStatus: 400, tokenError: 'invalid_grant' });
  try {
    assert.equal(await connect(broken.app, 'google'), 'expired_code');
    assert.equal(await broken.users.store.getConnection('user-a', 'google'), null);
  } finally {
    await broken.close();
  }
});

test('expired grants refresh, and a rejected refresh cannot be used again', async () => {
  const { service, users, calls, close } = await boot();
  const box = cipher();
  const past = new Date('2026-09-28T11:00:00Z');
  const write = (token = REFRESH) => users.store.saveConnection({
    id: 'connection-1',
    userId: 'user-a',
    provider: 'google',
    status: 'connected',
    externalAccountId: 'google-sub',
    externalAccountEmail: 'ada@gmail.com',
    externalAccountLabel: 'Ada',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/forms.body'],
    accessTokenCiphertext: box.encrypt('old-access', credentialAad('user-a', 'google', 'access')),
    accessTokenExpiresAt: past,
    refreshTokenCiphertext: box.encrypt(token, credentialAad('user-a', 'google', 'refresh')),
    lastAuthorizedAt: past,
    lastRefreshedAt: null,
  });
  try {
    await write();
    const refreshed = await service.getAuthorizedConnection('user-a', 'google');
    assert.equal(refreshed.ok, true);
    assert.equal(refreshed.accessToken, 'REFRESHED_ACCESS_TOKEN');
    assert.equal((await service.getAuthorizedConnection('user-b', 'google')).ok, false);
    calls.refreshMode = 'invalid_grant';
    await write();
    const rejected = await service.getAuthorizedConnection('user-a', 'google');
    assert.equal(rejected.reason, 'reauthorization_required');
    const stored = await users.store.getConnection('user-a', 'google');
    assert.equal(stored.accessTokenCiphertext, null);
    assert.equal(stored.refreshTokenCiphertext, null);
  } finally {
    await close();
  }
});

test('unauthenticated and cross-site requests fail closed', async () => {
  const { app, close, users } = await boot();
  const signedIn = users.current;
  users.current = null;
  try {
    assert.equal((await fetch(app + '/api/providers', { headers: { accept: 'application/json' }, redirect: 'manual' })).status, 401);
    const callback = await fetch(app + '/api/providers/google/callback?code=secret-code&state=abc', { redirect: 'manual' });
    assert.equal(callback.headers.get('location').includes('secret-code'), false);
    assert.match(callback.headers.get('location'), /\/auth\/sign-in/);
    users.current = signedIn;
    const forged = await fetch(app + '/api/providers/google/connect', { method: 'POST', redirect: 'manual', headers: { origin: 'https://evil.example' } });
    assert.equal(forged.status, 403);
    assert.equal(forged.headers.get('location'), null);
  } finally {
    await close();
  }
});

test('client parsing ignores credential fields', () => {
  const parsed = parseProviderList({
    providers: [{
      id: 'google', name: 'Google Forms', accountName: 'Google', description: 'Connect', configured: true, setupEnv: [],
      status: 'connected', accountEmail: 'ada@gmail.com', accountLabel: 'Ada', scopes: ['openid'], scopeLabels: ['Confirm'],
      connectedAt: null, canRefresh: true, revocation: 'supported', formsApi: 'supported', formsNote: 'Not creating forms.',
      permissionLinks: [{ label: 'Google', href: 'https://myaccount.google.com/permissions' }, { label: 'Bad', href: 'javascript:alert(1)' }],
      accessToken: ACCESS, refreshToken: REFRESH,
    }],
  });
  assert.equal(JSON.stringify(parsed).includes(ACCESS), false);
  assert.equal(parsed[0].permissionLinks.length, 1);
  assert.equal(parseProviderList({ providers: [{ id: 'dropbox' }] }), null);
  for (const code of RESULT_CODES) assert.equal(typeof resultMessage(code, 'google').text, 'string');
});

test('provider routes do not return an authorized access token', async () => {
  const source = await readFile(new URL('../server/providers/routes.ts', import.meta.url), 'utf8');
  assert.doesNotMatch(source, /getAuthorizedConnection/);
  assert.doesNotMatch(source, /res\.json\([\s\S]*accessToken/);
});
