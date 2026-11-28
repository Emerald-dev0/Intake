/**
 * Whether this deployment can open Google's file chooser, and what it is allowed to tell the page.
 *
 * The Picker is configured in the Cloud console, not in code: an API key restricted to this site,
 * the project number, and the OAuth client everybody already has. A server without those has to say
 * so plainly — "connect an existing spreadsheet" is then unavailable — rather than opening a dialog
 * that fails after somebody has already agreed to it.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { readPickerConfig, publicPickerConfig } from '../server/forms/sheets/picker.ts';
import { createSheetsRouter } from '../server/forms/sheets/routes.ts';
import { connection, createFakeSheets, createMemorySyncStore, FORM, FORMS_SCOPE, SHEETS_SCOPE } from './helpers/sheets-harness.mjs';

const API_KEY = `AIza${'b'.repeat(35)}`;
const APP_ID = '123456789012';

const env = overrides => ({ ...overrides });

// --------------------------------------------------------------------------- config

test('a server with the API key and project number can open the chooser', () => {
  const config = readPickerConfig(env({ GOOGLE_PICKER_API_KEY: API_KEY, GOOGLE_PICKER_APP_ID: APP_ID }));
  assert.equal(config.available, true);
  assert.equal(config.apiKey, API_KEY);
  assert.equal(config.appId, APP_ID);
  assert.equal(config.problem, null);
});

test('an unset key turns the option off, and says what the operator has to set', () => {
  const config = readPickerConfig(env({}));
  assert.equal(config.available, false);
  assert.equal(config.apiKey, null);
  assert.match(config.problem, /GOOGLE_PICKER_API_KEY/);
  assert.match(config.problem, /Creating a new spreadsheet still works/, 'and says what is not lost');
});

test('a key that is not a Google API key is refused rather than shipped to the browser', () => {
  for (const bad of ['not-a-key', 'AIzaSHORT', `${API_KEY} `, 'sk_live_123']) {
    const config = readPickerConfig(env({ GOOGLE_PICKER_API_KEY: bad.trim(), GOOGLE_PICKER_APP_ID: APP_ID }));
    // A well-formed key with stray whitespace trims to the same string, so only genuinely wrong
    // shapes fail here.
    if (bad.trim() === API_KEY) continue;
    assert.equal(config.available, false, `${bad} must not be treated as a key`);
    assert.match(config.problem ?? '', /GOOGLE_PICKER_API_KEY/);
  }
});

test('the project number is checked too, because a project name would fail in the browser', () => {
  const config = readPickerConfig(env({ GOOGLE_PICKER_API_KEY: API_KEY, GOOGLE_PICKER_APP_ID: 'my-intake-project' }));
  assert.equal(config.available, false);
  assert.match(config.problem ?? '', /project number/);
});

test('the project number is optional', () => {
  const config = readPickerConfig(env({ GOOGLE_PICKER_API_KEY: API_KEY }));
  assert.equal(config.available, true);
  assert.equal(config.appId, null);
});

test('the page gets the public key and a token, and never a client secret', () => {
  const config = readPickerConfig(env({ GOOGLE_PICKER_API_KEY: API_KEY, GOOGLE_PICKER_APP_ID: APP_ID }));
  const published = publicPickerConfig(config, { accessToken: 'ya29.short-lived', expiresAt: '2026-11-10T12:00:00.000Z' });
  const serialised = JSON.stringify(published);

  assert.deepEqual(Object.keys(published).sort(), ['accessToken', 'apiKey', 'appId', 'tokenExpiresAt']);
  assert.equal(serialised.includes('client_secret'), false);
  assert.equal(serialised.includes('refresh'), false);
  assert.equal(published.apiKey, API_KEY);
});

test('a server that cannot open the chooser cannot be asked for its configuration', () => {
  assert.throws(
    () => publicPickerConfig(readPickerConfig(env({})), { accessToken: 'ya29', expiresAt: '2026-11-10T12:00:00.000Z' }),
    /picker_unavailable/,
  );
});

// ---------------------------------------------------------------------------- route

async function boot(options = {}) {
  const sheets = options.sheets ?? createFakeSheets();
  const store = options.store ?? createMemorySyncStore();
  const deps = {
    getSession: async () => (options.signedIn === false ? null : { id: 'user-a', email: 'a@intake.test', name: 'Ada' }),
    getForm: async () => (options.foreignForm ? { ok: false } : { ok: true, form: FORM }),
    entitlement: async () => options.entitlement ?? { plan: 'pro', subscriptionStatus: 'active' },
    // A token with an hour left, the way a healthy connection arrives: the route refuses one that
    // has already lapsed rather than handing the browser something unusable.
    getConnection: async () => options.connection
      ?? connection({
        scopes: ['openid', 'email', FORMS_SCOPE, SHEETS_SCOPE],
        accessTokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
      }),
    syncs: store,
    google: { async getForm() { return { items: [] }; } },
    sheets: sheets.client,
    picker: options.picker ?? readPickerConfig({ GOOGLE_PICKER_API_KEY: API_KEY, GOOGLE_PICKER_APP_ID: APP_ID }),
  };
  const app = express();
  app.use(express.json());
  app.use('/api/forms', createSheetsRouter(deps));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  return {
    base,
    get: path => fetch(`${base}${path}`, { headers: { accept: 'application/json' } }),
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('a signed-in owner is given a token the chooser can use, and it is never cached', async () => {
  const world = await boot();
  try {
    const response = await world.get(`/api/forms/${FORM.id}/sheets/picker`);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const body = await response.json();
    assert.equal(body.apiKey, API_KEY);
    assert.equal(body.appId, APP_ID);
    assert.equal(body.accessToken, 'ACCESS_TOKEN', 'the connection’s own short-lived token');
    assert.ok(body.tokenExpiresAt);
    assert.equal(JSON.stringify(body).includes('refresh'), false);
  } finally { await world.close(); }
});

test('a server without the key answers 503 and explains, instead of half-opening a dialog', async () => {
  const world = await boot({ picker: readPickerConfig({}) });
  try {
    const response = await world.get(`/api/forms/${FORM.id}/sheets/picker`);
    assert.equal(response.status, 503);
    const body = await response.json();
    assert.equal(body.code, 'picker_unavailable');
    assert.match(body.error, /GOOGLE_PICKER_API_KEY/);
  } finally { await world.close(); }
});

test('the status call says whether the chooser exists, so the screen never offers a dead button', async () => {
  const ready = await boot();
  try {
    const body = await (await ready.get(`/api/forms/${FORM.id}/sheets`)).json();
    assert.equal(body.canPick, true);
    assert.equal(body.pickerProblem, null);
  } finally { await ready.close(); }

  const bare = await boot({ picker: readPickerConfig({}) });
  try {
    const body = await (await bare.get(`/api/forms/${FORM.id}/sheets`)).json();
    assert.equal(body.canPick, false);
    assert.match(body.pickerProblem, /GOOGLE_PICKER_API_KEY/);
  } finally { await bare.close(); }
});

test('no token is handed out without the spreadsheet permission or for a foreign form', async () => {
  const missingScope = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE] }) });
  try {
    const response = await missingScope.get(`/api/forms/${FORM.id}/sheets/picker`);
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'sheets_scope_required');
  } finally { await missingScope.close(); }

  const foreign = await boot({ foreignForm: true });
  try {
    assert.equal((await foreign.get(`/api/forms/${FORM.id}/sheets/picker`)).status, 404);
  } finally { await foreign.close(); }

  const signedOut = await boot({ signedIn: false });
  try {
    assert.equal((await signedOut.get(`/api/forms/${FORM.id}/sheets/picker`)).status, 401);
  } finally { await signedOut.close(); }
});

test('an already-expired token is reported as expired, not handed over', async () => {
  const world = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE, SHEETS_SCOPE], accessTokenExpiresAt: '2020-01-01T00:00:00.000Z' }) });
  try {
    const response = await world.get(`/api/forms/${FORM.id}/sheets/picker`);
    assert.equal(response.status, 409);
    const body = await response.json();
    assert.equal(body.code, 'token_expired');
    assert.equal(JSON.stringify(body).includes('ACCESS_TOKEN'), false);
  } finally { await world.close(); }
});
