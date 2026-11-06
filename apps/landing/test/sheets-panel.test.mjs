/**
 * What a person sees in the spreadsheet panel.
 *
 * Syncing happens somewhere else, on a schedule, so this screen carries all the meaning: whether
 * the permission has been allowed, whether the first sync is still running, how many rows are in
 * the sheet, and — when it stops — what to do next. These tests mount the real component and read
 * what it actually renders.
 */

import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/app/library', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { SheetSync } = await import('../src/app/components/SheetSync.tsx');

after(() => dom.window.close());

const FORM = {
  id: 'form-1',
  provider: 'google',
  providerFormId: 'google-form-1',
  title: 'Feedback',
  status: 'created',
  failureStage: null,
  editUrl: null,
  responderUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  description: null,
  source: 'created',
  lastSyncedAt: null,
  archivedAt: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const RETURN_TO = '/app/library?sheets=form-1&grant=sheets';

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sync = (overrides = {}) => ({
  spreadsheetId: 'SHEET_ID_1234567890abcdef',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_1234567890abcdef/edit',
  sheetTitle: 'Responses',
  enabled: true,
  syncedCount: 0,
  lastSyncedAt: null,
  lastErrorCode: null,
  nextSyncAt: '2026-11-06T12:05:00.000Z',
  ...overrides,
});

const state = (name, overrides = {}, canSync = true) => ({ state: name, canSync, sync: overrides === null ? null : sync(overrides) });

/**
 * Mount the panel. `status` answers the GET; `action` answers any POST or DELETE and defaults to
 * echoing a sensible next state.
 */
async function mount(t, options = {}) {
  const originalFetch = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    requests.push({ target, method });
    if (method === 'GET') return typeof options.status === 'function' ? options.status() : json(options.status ?? state('not_enabled', null));
    return options.action ? options.action(target, method) : json(state('initial', { syncedCount: 0 }));
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(SheetSync, {
    form: FORM,
    onClose: () => {},
    isPro: options.isPro ?? true,
    canSyncSheets: options.canSyncSheets ?? true,
    needsReconnect: options.needsReconnect ?? false,
    returnTo: RETURN_TO,
  })));
  for (let i = 0; i < 40; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    if (container.querySelector('.insights-footer') || container.querySelector('.insights-pro-required')) break;
  }

  const view = {
    container,
    requests,
    text: () => container.textContent ?? '',
    button: label => [...container.querySelectorAll('button')].find(element => new RegExp(label).test(element.textContent ?? '')) ?? null,
    formAction: pattern => [...container.querySelectorAll('form')].map(form => form.getAttribute('action')).find(action => pattern.test(action ?? '')) ?? null,
    async press(label) {
      const button = view.button(label);
      assert.ok(button, `the "${label}" button is on the screen`);
      await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
      await act(async () => { await new Promise(resolve => setTimeout(resolve, 25)); });
    },
    async restore() {
      await act(async () => root.unmount());
      container.remove();
      globalThis.fetch = originalFetch;
    },
  };
  t.after(view.restore);
  return view;
}

// ------------------------------------------------------------------ the permission

test('before anything is created, the panel explains the permission and what will be written', async (t) => {
  const view = await mount(t, { status: state('not_enabled', null) });
  const text = view.text();

  assert.match(text, /one column per question/);
  assert.match(text, /create and update spreadsheets it made itself/);
  assert.match(text, /cannot open,\s*read or change any other file in your Drive/);
  assert.match(text, /not instant/, 'the copy never claims instant sync');
  assert.match(text, /every minute/);
  assert.match(text, /does not\s+keep a copy of the answers/, 'and never promises zero retention either');
  assert.match(text, /record which response IDs it has\s+written/);
  assert.equal(view.requests.filter(request => request.method !== 'GET').length, 0, 'nothing is sent to Google by looking');
  assert.equal(view.formAction(/\/api\/providers\/google\/extend/), null, 'with the permission already allowed there is nothing to ask for');
  assert.ok(view.button('Create the spreadsheet'), 'the only action is the one that does the work');
});

test('a person without the permission is sent to Google, and only for that one permission', async (t) => {
  const view = await mount(t, { status: state('awaiting_authorization', null, false), canSyncSheets: false });
  const action = view.formAction(/\/api\/providers\/google\/extend/);

  assert.ok(action, 'the allow button is a plain form post, so the browser can follow it');
  assert.match(action, /capability=sheets/);
  assert.match(action, /return_to=%2Fapp%2Flibrary%3Fsheets%3Dform-1/);
  assert.match(action, /^\/api\/providers\/google\/extend\?/, 'and it is a same-site path');
  assert.equal(view.button('Create the spreadsheet'), null, 'nothing can be created before the permission exists');
});

test('a lapsed Google connection sends the person to reconnect, not to a new permission', async (t) => {
  const view = await mount(t, { status: state('reconnect_required', null, false), needsReconnect: true });
  const action = view.formAction(/\/api\/providers\/google\/connect/);
  assert.ok(action);
  assert.match(view.text(), /Connect again/);
});

// ---------------------------------------------------------------------- creating

test('creating a spreadsheet asks once and then shows the first sync running', async (t) => {
  const view = await mount(t, {
    status: state('not_enabled', null),
    action: () => json(state('initial', { syncedCount: 0 })),
  });

  await view.press('Create the spreadsheet');

  const posts = view.requests.filter(request => request.method === 'POST');
  assert.equal(posts.length, 1);
  assert.equal(posts[0].target, '/api/forms/form-1/sheets');
  assert.match(view.text(), /Writing the answers you already have/);
  assert.match(view.text(), /runs in the background/, 'the browser is never held open for the historical sync');
});

test('a first sync that is still running says how much has been written', async (t) => {
  const view = await mount(t, { status: state('syncing', { syncedCount: 240 }) });
  assert.match(view.text(), /Adding answers…/);
  assert.match(view.text(), /240 written so far/);
  assert.ok(view.button('Close'), 'and can be closed without stopping it');
});

// ---------------------------------------------------------------------- healthy

test('a finished sync shows the count, the last time, and a link to the spreadsheet', async (t) => {
  const view = await mount(t, {
    status: state('up_to_date', { syncedCount: 1274, lastSyncedAt: '2026-11-06T11:58:00.000Z' }),
  });

  assert.match(view.text(), /1,274/);
  assert.match(view.text(), /Last synced/);
  const link = [...view.container.querySelectorAll('a')].find(anchor => /Open the spreadsheet/.test(anchor.textContent ?? ''));
  assert.ok(link);
  assert.equal(link.getAttribute('target'), '_blank');
  assert.equal(link.getAttribute('rel'), 'noopener noreferrer');
  assert.match(link.getAttribute('href'), /^https:\/\/docs\.google\.com\/spreadsheets\/d\//);
});

test('checking for new responses now asks the server and does not create another spreadsheet', async (t) => {
  const view = await mount(t, {
    status: state('up_to_date', { syncedCount: 12 }),
    action: () => json(state('initial', { syncedCount: 12 })),
  });

  await view.press('Check for new responses now');
  const posts = view.requests.filter(request => request.method === 'POST');
  assert.equal(posts.at(-1).target, '/api/forms/form-1/sheets/sync');
  assert.equal(view.requests.filter(request => request.target === '/api/forms/form-1/sheets' && request.method === 'POST').length, 0);
});

test('stopping a sync says it keeps the spreadsheet', async (t) => {
  const view = await mount(t, {
    status: state('up_to_date', { syncedCount: 12 }),
    action: () => json(state('disabled', { enabled: false, syncedCount: 12 })),
  });

  await view.press('Stop syncing');
  const deletes = view.requests.filter(request => request.method === 'DELETE');
  assert.equal(deletes.length, 1);
  assert.equal(deletes[0].target, '/api/forms/form-1/sheets');
  assert.match(view.text(), /The spreadsheet and everything already written to it are\s+untouched/);
  assert.ok(view.button('Resume syncing'), 'and resuming is offered in place');
});

test('resuming a stopped sync uses the same spreadsheet', async (t) => {
  const view = await mount(t, {
    status: state('disabled', { enabled: false, syncedCount: 12 }),
    action: () => json(state('initial', { syncedCount: 12 })),
  });

  await view.press('Resume syncing');
  const posts = view.requests.filter(request => request.method === 'POST');
  assert.equal(posts.at(-1).target, '/api/forms/form-1/sheets/enable');
  assert.match(view.text(), /Writing the answers you already have|Adding answers/);
});

// ---------------------------------------------------------------------- problems

test('a temporary pause is described as temporary, with no error code in sight', async (t) => {
  const view = await mount(t, { status: state('delayed', { lastErrorCode: 'rate_limited', syncedCount: 8 }) });
  assert.match(view.text(), /Taking a short break/);
  assert.match(view.text(), /tries again on its own/);
  assert.equal(view.text().includes('rate_limited'), false);
  assert.equal(view.text().includes('429'), false);
});

test('a removed permission is explained, and the fix is one press', async (t) => {
  const view = await mount(t, { status: state('permission_revoked', { lastErrorCode: 'permission_revoked' }) });
  assert.match(view.text(), /no longer lets Intake update the spreadsheet/);
  const action = view.formAction(/\/api\/providers\/google\/extend/);
  assert.match(action ?? '', /capability=sheets/);
  assert.equal(view.text().includes('permission_revoked'), false);
});

test('a spreadsheet that cannot be reached offers a new one and promises nothing is deleted', async (t) => {
  const view = await mount(t, {
    status: state('destination_unavailable', { lastErrorCode: 'destination_unavailable' }),
    action: () => json(state('initial')),
  });
  assert.match(view.text(), /deleted, or moved/);
  assert.match(view.text(), /never deletes or moves files in your Drive/);
  await view.press('Start a new spreadsheet');
  assert.equal(view.requests.filter(request => request.method === 'POST').at(-1).target, '/api/forms/form-1/sheets');
});

test('changed questions are explained rather than synced into the wrong columns', async (t) => {
  const view = await mount(t, { status: state('questions_changed', { lastErrorCode: 'questions_changed' }) });
  assert.match(view.text(), /questions changed/i);
  assert.match(view.text(), /mislabel/);
  assert.ok(view.button('Start a new spreadsheet'));
});

test('an unexplained failure offers a retry and a way to check the connection', async (t) => {
  const view = await mount(t, {
    status: state('failed', { lastErrorCode: 'internal_error' }),
    action: () => json(state('initial')),
  });
  assert.match(view.text(), /Syncing stopped/);
  const link = [...view.container.querySelectorAll('a')].find(anchor => /Check the connection/.test(anchor.textContent ?? ''));
  assert.equal(link?.getAttribute('href'), '/app/connections');
  await view.press('Try again now');
  assert.equal(view.requests.filter(request => request.method === 'POST').at(-1).target, '/api/forms/form-1/sheets/sync');
});

test('a refusal from the server is shown as a sentence, never as the response body', async (t) => {
  const view = await mount(t, {
    status: state('not_enabled', null),
    action: () => json({ error: 'Too many requests. Wait briefly and try again.', code: 'rate_limited' }, 429),
  });

  await view.press('Create the spreadsheet');
  assert.match(view.text(), /Too many requests/);
  assert.equal(view.text().includes('GoogleSheetsApiError'), false);
  assert.equal(view.text().includes('stack'), false);
});

test('an account without Pro is told what it is part of, and nothing is created', async (t) => {
  const view = await mount(t, { isPro: false });
  assert.match(view.text(), /part of Pro/);
  assert.ok([...view.container.querySelectorAll('a')].some(anchor => anchor.getAttribute('href') === '/app/billing'));
  assert.equal(view.requests.filter(request => request.method === 'POST').length, 0);
});

test('the panel always says how to switch syncing off', async (t) => {
  const view = await mount(t, { status: state('up_to_date', { syncedCount: 3 }) });
  assert.match(view.text(), /Stopping a sync never deletes the spreadsheet/);
});
