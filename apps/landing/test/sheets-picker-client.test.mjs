/**
 * Google's file chooser, as the browser half of "connect an existing spreadsheet".
 *
 * All of Google's dialog is faked here, which is the point: what is being tested is the contract
 * around it — one spreadsheet id out, a cancel, or a plain-language failure. Never a token leaking
 * into a URL, never a folder accepted as a destination, never a dialog built on a token that has
 * already expired.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { openSpreadsheetPicker, PICKER_SCRIPT_URL, SPREADSHEET_MIME } from '../src/lib/picker.ts';

const TOKEN = {
  apiKey: `AIza${'c'.repeat(35)}`,
  appId: '123456789012',
  accessToken: 'ya29.short-lived-access-token',
  tokenExpiresAt: new Date(Date.now() + 3_600_000).toISOString(),
};

/**
 * A fake `window.google` that records how it was configured and answers with whatever the test
 * wants a person to have done.
 */
function fakeGoogle(behaviour = {}) {
  const seen = { views: [], builder: [], appId: null, feature: null };

  class DocsView {
    constructor(viewId) { seen.views.push({ viewId }); this.mime = null; this.folders = null; }
    setMimeTypes(types) { this.mime = types; return this; }
    setIncludeFolders(value) { this.folders = value; return this; }
    setSelectFolderEnabled(value) { this.folders = value; return this; }
  }

  class PickerBuilder {
    constructor() { this.parts = {}; seen.builder.push(this.parts); }
    addView(view) { this.parts.view = view; return this; }
    setOAuthToken(token) { this.parts.token = token; return this; }
    setDeveloperKey(key) { this.parts.developerKey = key; return this; }
    setAppId(appId) { seen.appId = appId; this.parts.appId = appId; return this; }
    enableFeature(feature) { seen.feature = feature; return this; }
    setCallback(callback) { this.parts.callback = callback; return this; }
    build() {
      return {
        setVisible: visible => {
          seen.visible = visible;
          // Google calls back asynchronously, after the dialog is on screen.
          if (behaviour.callback) {
            const callback = this.parts.callback;
            queueMicrotask(() => behaviour.callback(callback));
          }
        },
      };
    }
  }

  const google = {
    picker: {
      PickerBuilder,
      DocsView,
      ViewId: { SPREADSHEETS: 'spreadsheets' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType' },
      Feature: { SUPPORT_DRIVES: 'drives' },
    },
  };

  return { google, seen };
}

/** Dependencies for a page that has never loaded Google's script. */
function deps(google, { scriptFails = false, gapiNeverLoads = false, timeoutMs = 50 } = {}) {
  const calls = { scripts: [], loaded: 0 };
  return {
    calls,
    deps: {
      getGoogle: () => google,
      getGapi: () => (google ? { load: (library, done) => { calls.loaded += 1; if (!gapiNeverLoads) done(); } } : null),
      loadScript: async url => {
        calls.scripts.push(url);
        if (scriptFails) throw new Error('network');
      },
      timeoutMs,
    },
  };
}

const spreadsheet = id => ({ id, name: 'Q4 feedback', mimeType: SPREADSHEET_MIME });

test('a picked spreadsheet comes back as an id, and only the id is trusted', async () => {
  const picked = [];
  const { google, seen } = fakeGoogle({ callback: cb => { picked.push('yes'); cb({ action: 'picked', docs: [spreadsheet('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456')] }); } });
  const { deps: d } = deps(google);

  const outcome = await openSpreadsheetPicker(TOKEN, d);
  assert.deepEqual(outcome, { kind: 'picked', spreadsheetId: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', name: 'Q4 feedback' });
  assert.deepEqual(picked, ['yes']);
  assert.equal(seen.visible, true);
});

test('the dialog is built with the token, the public key and the project number', async () => {
  const { google, seen } = fakeGoogle({ callback: cb => cb({ action: 'cancel' }) });
  const { deps: d } = deps(google);
  await openSpreadsheetPicker(TOKEN, d).catch(() => {});

  const parts = seen.builder[0];
  assert.equal(parts.token, TOKEN.accessToken);
  assert.equal(parts.developerKey, TOKEN.apiKey);
  assert.equal(seen.appId, TOKEN.appId, 'the Cloud project number, so the key belongs to the project');
  assert.equal(seen.visible, true);
});

test('only spreadsheets are offered: the view is the spreadsheets view and the mime filter is pinned', async () => {
  const { google, seen } = fakeGoogle({ callback: cb => cb({ action: 'cancel' }) });
  const { deps: d } = deps(google);
  await openSpreadsheetPicker(TOKEN, d);

  assert.equal(seen.views[0].viewId, 'spreadsheets');
  assert.equal(seen.builder[0].view.mime, SPREADSHEET_MIME);
  assert.equal(seen.builder[0].view.folders, false, 'folders cannot be selected as a destination');
});

test('closing the dialog is a cancel, not a failure, and writes nothing', async () => {
  const { google } = fakeGoogle({ callback: cb => cb({ action: 'cancel' }) });
  const { deps: d } = deps(google);
  assert.deepEqual(await openSpreadsheetPicker(TOKEN, d), { kind: 'cancelled' });
});

test('a Google script that will not load is a failure the screen can explain', async () => {
  const { deps: d } = deps(null, { scriptFails: true });
  const outcome = await openSpreadsheetPicker(TOKEN, d);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.code, 'load_failed');
  assert.match(outcome.message, /did not load/);
  assert.match(outcome.message, /create a new spreadsheet/, 'and offers the path that still works');
});

test('a page that has never loaded Google fetches the loader once, then loads the picker through it', async () => {
  const { google } = fakeGoogle({ callback: cb => cb({ action: 'cancel' }) });
  const calls = { scripts: [], loaded: 0 };
  let ready = false;
  const cold = {
    getGoogle: () => (ready ? google : null),
    getGapi: () => ({ load: (library, done) => { calls.loaded += 1; assert.equal(library, 'picker'); ready = true; done(); } }),
    loadScript: async url => { calls.scripts.push(url); },
    timeoutMs: 50,
  };

  await openSpreadsheetPicker(TOKEN, cold);
  assert.deepEqual(calls.scripts, [PICKER_SCRIPT_URL]);
  assert.equal(calls.loaded, 1, 'gapi.load is what actually fetches the picker library');

  // A second visit reuses what the page already has.
  await openSpreadsheetPicker(TOKEN, cold);
  assert.deepEqual(calls.scripts, [PICKER_SCRIPT_URL], 'the script tag is not added twice');
  assert.equal(calls.loaded, 1);
});

test('a picker library that never arrives is reported instead of hanging the screen', async () => {
  const { deps: d } = deps(null, { gapiNeverLoads: true, timeoutMs: 20 });
  const outcome = await openSpreadsheetPicker(TOKEN, d);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.code, 'load_failed');
});

test('an expired token is caught before the dialog opens', async () => {
  const { google } = fakeGoogle({ callback: cb => cb({ action: 'cancel' }) });
  const { deps: d, calls } = deps(google);
  const outcome = await openSpreadsheetPicker({ ...TOKEN, tokenExpiresAt: '2020-01-01T00:00:00.000Z' }, d);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.code, 'token_expired');
  assert.deepEqual(calls.scripts, [], 'no script fetch, no dialog');
});

test('a server with no key or token cannot even start', async () => {
  const { deps: d } = deps(null);
  for (const config of [{ ...TOKEN, apiKey: '' }, { ...TOKEN, accessToken: '' }]) {
    const outcome = await openSpreadsheetPicker(config, d);
    assert.equal(outcome.kind, 'failed');
    assert.equal(outcome.code, 'not_configured');
  }
});

test('a folder or a non-spreadsheet document is refused even if Google sends it', async () => {
  const cases = [
    [{ id: '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456', name: 'Folder', mimeType: 'application/vnd.google-apps.folder' }],
    [{ id: 'short', name: 'Odd', mimeType: SPREADSHEET_MIME }],
    [{ id: '../../etc/passwd', name: 'Nope', mimeType: SPREADSHEET_MIME }],
    [],
  ];
  for (const docs of cases) {
    const { google } = fakeGoogle({ callback: cb => cb({ action: 'picked', docs }) });
    const { deps: d } = deps(google);
    const outcome = await openSpreadsheetPicker(TOKEN, d);
    assert.equal(outcome.kind, 'failed', `${JSON.stringify(docs)} must not become a destination`);
    assert.equal(outcome.code, 'picker_failed');
  }
});

test('a builder that throws is a failure, not an unhandled rejection', async () => {
  const { deps: d } = deps({ picker: { get PickerBuilder() { throw new Error('blocked'); } } });
  const outcome = await openSpreadsheetPicker(TOKEN, d);
  assert.equal(outcome.kind, 'failed');
  assert.equal(outcome.code, 'picker_failed');
});

test('the same outcome is only reported once, whatever Google sends afterwards', async () => {
  let callbacks;
  const { google } = fakeGoogle({ callback: cb => { callbacks = cb; } });
  const { deps: d } = deps(google);
  const promise = openSpreadsheetPicker(TOKEN, d);
  // Let the builder run, then answer twice, the way a double-click on the dialog can.
  await new Promise(resolve => setTimeout(resolve, 5));
  callbacks({ action: 'cancel' });
  callbacks({ action: 'picked', docs: [spreadsheet('1AbCdEfGhIjKlMnOpQrStUvWxYz0123456')] });
  assert.deepEqual(await promise, { kind: 'cancelled' });
});

test('no access token is ever put in a URL', async () => {
  const { google } = fakeGoogle({ callback: cb => cb({ action: 'cancel' }) });
  const { deps: d, calls } = deps(google);
  await openSpreadsheetPicker(TOKEN, d);
  for (const src of calls.scripts) {
    assert.equal(src.includes(TOKEN.accessToken), false);
    assert.equal(src.includes(TOKEN.apiKey), false);
    assert.equal(src.includes('refresh'), false);
  }
});
