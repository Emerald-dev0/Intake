/**
 * The second way to choose a destination, as the panel actually renders it.
 *
 * Two options have to look like two different things, because they behave differently: a file Intake
 * makes and may set up, or a file somebody already has and may only append to. These tests mount the
 * real component against a stubbed Google and a stubbed server, press the real buttons, and read what
 * is on the screen — including the cases where the honest answer is "not this worksheet".
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
  id: 'form-1', provider: 'google', providerFormId: 'google-form-1', title: 'Feedback',
  status: 'created', failureStage: null, editUrl: null, responderUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z', description: null, source: 'created',
  lastSyncedAt: null, archivedAt: null, updatedAt: '2026-09-01T10:00:00.000Z',
};

const RETURN_TO = '/app/library?sheets=form-1';
const SPREADSHEET_ID = '1AbCdEfGhIjKlMnOpQrStUvWxYz0123456';
const HEADER = ['Response ID', 'Submitted at', 'Respondent email', 'What is your name?', 'Anything else?'];

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const sync = (overrides = {}) => ({
  spreadsheetId: 'SHEET_ID_1234567890abcdef',
  spreadsheetUrl: 'https://docs.google.com/spreadsheets/d/SHEET_ID_1234567890abcdef/edit',
  spreadsheetTitle: 'Feedback — Intake Responses',
  destination: 'created',
  sheetId: 0,
  sheetTitle: 'Responses',
  enabled: true,
  syncedCount: 12,
  lastSyncedAt: '2026-11-06T11:55:00.000Z',
  lastErrorCode: null,
  nextSyncAt: '2026-11-06T12:00:00.000Z',
  ...overrides,
});

const state = (name, overrides = {}, extra = {}) => ({
  state: name,
  canSync: extra.canSync ?? true,
  canPick: extra.canPick ?? true,
  pickerProblem: extra.pickerProblem ?? null,
  sync: overrides === null ? null : sync(overrides),
});

/**
 * A stand-in for `window.google`, so pressing the button opens something that answers immediately.
 * `picked` is what the fake dialog reports back, set per test.
 */
function installFakeGoogle() {
  const control = { picked: null, cancel: false, opened: 0 };
  class DocsView {
    setMimeTypes() { return this; }
    setIncludeFolders() { return this; }
    setSelectFolderEnabled() { return this; }
  }
  class PickerBuilder {
    setOAuthToken() { return this; }
    setDeveloperKey() { return this; }
    setAppId() { return this; }
    enableFeature() { return this; }
    addView() { return this; }
    setCallback(callback) { this.callback = callback; return this; }
    build() {
      return {
        setVisible: () => {
          control.opened += 1;
          queueMicrotask(() => {
            if (control.cancel) { this.callback({ action: 'cancel' }); return; }
            if (control.picked) {
              this.callback({
                action: 'picked',
                docs: [{ id: control.picked, name: 'Team tracker', mimeType: 'application/vnd.google-apps.spreadsheet' }],
              });
            }
          });
        },
      };
    }
  }
  window.google = {
    picker: {
      PickerBuilder, DocsView,
      ViewId: { SPREADSHEETS: 'spreadsheets' },
      Response: { ACTION: 'action', DOCUMENTS: 'docs' },
      Action: { PICKED: 'picked', CANCEL: 'cancel' },
      Document: { ID: 'id', NAME: 'name', MIME_TYPE: 'mimeType' },
      Feature: { SUPPORT_DRIVES: 'drives' },
    },
  };
  return control;
}

const inspection = (overrides = {}) => ({
  spreadsheetId: SPREADSHEET_ID,
  title: 'Team tracker',
  spreadsheetUrl: `https://docs.google.com/spreadsheets/d/${SPREADSHEET_ID}/edit`,
  worksheets: [
    { sheetId: 0, title: 'Responses', rowCount: 1000, columnCount: 26 },
    { sheetId: 7, title: 'Notes', rowCount: 200, columnCount: 5 },
  ],
  worksheet: null,
  assessment: null,
  header: HEADER,
  ...overrides,
});

const emptyVerdict = { verdict: 'empty', reason: null, existingRows: 0, existingIds: 0 };
const compatibleVerdict = { verdict: 'compatible', reason: null, existingRows: 3, existingIds: 3 };
const unsuitableVerdict = {
  verdict: 'unsuitable',
  reason: 'This worksheet already has content of its own in its first rows. Intake will not write into or over it — choose an empty worksheet, or one it set up before.',
  existingRows: 4,
  existingIds: 0,
};

async function mount(t, options = {}) {
  const originalFetch = globalThis.fetch;
  const originalGoogle = window.google;
  const control = options.noGoogle ? null : installFakeGoogle();
  if (options.noGoogle) delete window.google;

  const requests = [];
  globalThis.fetch = async (input, init = {}) => {
    const target = String(input);
    const method = (init.method ?? 'GET').toUpperCase();
    const body = init.body ? JSON.parse(String(init.body)) : null;
    requests.push({ target, method, body });

    if (method === 'GET' && target.endsWith('/sheets/picker')) {
      return options.picker ?? json({
        apiKey: `AIza${'e'.repeat(35)}`,
        appId: '123456789012',
        accessToken: 'ya29.test-token',
        tokenExpiresAt: new Date(Date.now() + 600_000).toISOString(),
      });
    }
    if (method === 'POST' && target.endsWith('/sheets/inspect')) {
      return options.inspect ? options.inspect(body) : json(inspection());
    }
    if (method === 'POST' && target.endsWith('/sheets/connect')) {
      return options.connect ? options.connect(body) : json(state('initial', {
        spreadsheetId: body?.spreadsheetId ?? SPREADSHEET_ID,
        spreadsheetTitle: 'Team tracker',
        destination: 'selected',
        sheetId: body?.sheetId ?? 0,
        sheetTitle: 'Responses',
        syncedCount: 0,
        lastSyncedAt: null,
      }), 201);
    }
    if (method === 'GET') return json(options.status ?? state('not_enabled', null));
    return json(state('initial', { syncedCount: 0 }));
  };

  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(SheetSync, {
    form: FORM,
    onClose: () => {},
    isPro: true,
    canSyncSheets: true,
    needsReconnect: false,
    returnTo: RETURN_TO,
  })));
  for (let i = 0; i < 40; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    if (container.querySelector('.insights-footer')) break;
  }

  const view = {
    container, requests, control,
    text: () => container.textContent ?? '',
    button: label => [...container.querySelectorAll('button')].find(element => new RegExp(label).test(element.textContent ?? '')) ?? null,
    checkbox: () => container.querySelector('.sheets-acknowledge input'),
    async press(label) {
      const button = view.button(label);
      assert.ok(button, `the "${label}" button is on the screen`);
      await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
      await settle();
    },
    async toggle() {
      const input = view.checkbox();
      assert.ok(input, 'the confirmation checkbox is on the screen');
      await act(async () => { input.click(); });
      await settle();
    },
    async restore() {
      await act(async () => root.unmount());
      container.remove();
      globalThis.fetch = originalFetch;
      if (originalGoogle === undefined) delete window.google; else window.google = originalGoogle;
    },
  };
  t.after(view.restore);
  return view;
}

async function settle() {
  for (let i = 0; i < 12; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
}

// ------------------------------------------------------------------- two options

test('an unconfigured form offers creating a file and connecting one, as different things', async (t) => {
  const view = await mount(t, { status: state('not_enabled', null) });
  const text = view.text();

  assert.ok(view.button(/Create the spreadsheet/), 'the Phase C path is still there, unchanged');
  assert.ok(view.button(/Connect an existing spreadsheet/), 'and the new one is beside it, not buried');
  assert.match(text, /create a spreadsheet for you/);
  assert.match(text, /connect one you already have/);
  assert.match(text, /only one Intake is then allowed to touch|the file you pick is the only one/i);
});

test('the panel never claims Intake can see the whole Drive', async (t) => {
  const view = await mount(t, { status: state('not_enabled', null) });
  const text = view.text();
  assert.equal(/browse (your )?(entire|whole|all of your) drive/i.test(text), false);
  assert.equal(/see all (of )?your (files|drive)/i.test(text), false);
  assert.match(text, /cannot open, read or change any other file in your Drive/);
});

test('when the chooser is not configured, the option says so instead of failing later', async (t) => {
  const view = await mount(t, {
    status: state('not_enabled', null, { canPick: false, pickerProblem: 'Connecting an existing spreadsheet is not set up on this server (GOOGLE_PICKER_API_KEY is not set). Creating a new spreadsheet still works.' }),
  });
  const connect = view.button(/Connect an existing spreadsheet/);
  assert.ok(connect, 'the option is visible, so nobody wonders where it went');
  assert.equal(connect.disabled, true);
  assert.match(view.text(), /GOOGLE_PICKER_API_KEY/);
});

// ------------------------------------------------------- picking, then inspecting

test('connecting a file opens Google’s chooser with a token from the server, and inspects what it returns', async (t) => {
  const view = await mount(t);
  view.control.picked = SPREADSHEET_ID;

  await view.press(/Connect an existing spreadsheet/);

  const picker = view.requests.find(request => request.target.endsWith('/sheets/picker'));
  assert.ok(picker, 'the page asks the server for a token rather than holding one');
  const inspect = view.requests.find(request => request.target.endsWith('/sheets/inspect'));
  assert.deepEqual(inspect.body, { spreadsheetId: SPREADSHEET_ID });
  assert.match(view.text(), /Team tracker/, 'and shows the file the server described');
});

test('the worksheets come from the server, and choosing one asks about that worksheet', async (t) => {
  const view = await mount(t, {
    inspect: body => json(inspection(body.sheetId === undefined ? {} : { worksheet: inspection().worksheets[1], assessment: emptyVerdict })),
  });
  view.control.picked = SPREADSHEET_ID;
  await view.press(/Connect an existing spreadsheet/);

  assert.match(view.text(), /Responses/);
  assert.match(view.text(), /Notes/);
  assert.match(view.text(), /Which worksheet should the answers go into/);

  const radio = [...view.container.querySelectorAll('input[type=radio]')][1];
  assert.ok(radio, 'each worksheet is a choice');
  await act(async () => { radio.click(); });
  await settle();

  const inspects = view.requests.filter(request => request.target.endsWith('/sheets/inspect'));
  assert.deepEqual(inspects.at(-1).body, { spreadsheetId: SPREADSHEET_ID, sheetId: 7 }, 'the numeric worksheet id, not its name');
});

test('an empty worksheet is described as one that will be set up, and the columns are listed', async (t) => {
  const view = await mount(t, {
    inspect: body => json(inspection(body.sheetId === undefined ? {} : { worksheet: inspection().worksheets[0], assessment: emptyVerdict })),
  });
  view.control.picked = SPREADSHEET_ID;
  await view.press(/Connect an existing spreadsheet/);
  await act(async () => { view.container.querySelector('input[type=radio]').click(); });
  await settle();

  const text = view.text();
  assert.match(text, /This worksheet is empty/);
  assert.match(text, /write its header row/);
  assert.match(text, /“Response ID”/);
  assert.match(text, /“What is your name\?”/);
});

test('a worksheet that already holds this form’s table says how many answers will be skipped', async (t) => {
  const view = await mount(t, {
    inspect: body => json(inspection(body.sheetId === undefined ? {} : { worksheet: inspection().worksheets[0], assessment: compatibleVerdict })),
  });
  view.control.picked = SPREADSHEET_ID;
  await view.press(/Connect an existing spreadsheet/);
  await act(async () => { view.container.querySelector('input[type=radio]').click(); });
  await settle();

  assert.match(view.text(), /already holds this form’s table/);
  assert.match(view.text(), /3 responses are already in it/);
});

test('a worksheet with other people’s data cannot be confirmed, and the reason is on the screen', async (t) => {
  const view = await mount(t, {
    inspect: body => json(inspection(body.sheetId === undefined ? {} : { worksheet: inspection().worksheets[1], assessment: unsuitableVerdict })),
  });
  view.control.picked = SPREADSHEET_ID;
  await view.press(/Connect an existing spreadsheet/);
  await act(async () => { view.container.querySelector('input[type=radio]').click(); });
  await settle();

  const confirm = view.button(/Connect this worksheet/);
  assert.ok(confirm);
  assert.equal(confirm.disabled, true, 'the dangerous action is not available');
  assert.match(view.text(), /content of its own/);
  assert.match(view.text(), /will not write into or over it/);
});

test('cancelling the chooser writes nothing and leaves the panel where it was', async (t) => {
  const view = await mount(t);
  view.control.cancel = true;

  await view.press(/Connect an existing spreadsheet/);

  assert.equal(view.requests.some(request => request.target.endsWith('/sheets/inspect')), false, 'nothing is inspected');
  assert.equal(view.requests.some(request => request.target.endsWith('/sheets/connect')), false, 'and nothing is connected');
  assert.match(view.text(), /Connect an existing spreadsheet/, 'the panel is exactly where it was');
  assert.equal(view.container.querySelector('.sheets-achieve'), null);
});

test('a chooser that is not configured after all is explained, not swallowed', async (t) => {
  const view = await mount(t, {
    picker: json({ error: 'Connecting an existing spreadsheet is not set up on this server.', code: 'picker_unavailable' }, 503),
  });
  await view.press(/Connect an existing spreadsheet/);
  assert.match(view.text(), /not set up on this server/);
});

test('a spreadsheet the server cannot read is explained in words a person can act on', async (t) => {
  const view = await mount(t, {
    inspect: () => json({ error: 'Google could not find that spreadsheet, or Intake cannot open it. Choose it again from your Drive.', code: 'spreadsheet_not_found' }, 404),
  });
  view.control.picked = SPREADSHEET_ID;
  await view.press(/Connect an existing spreadsheet/);
  assert.match(view.text(), /could not find that spreadsheet/);
});

// ------------------------------------------------------------------ connecting

test('confirming sends the file and worksheet, and the panel shows the chosen destination', async (t) => {
  const view = await mount(t, {
    inspect: body => json(inspection(body.sheetId === undefined ? {} : { worksheet: inspection().worksheets[0], assessment: emptyVerdict })),
  });
  view.control.picked = SPREADSHEET_ID;
  await view.press(/Connect an existing spreadsheet/);
  await act(async () => { view.container.querySelector('input[type=radio]').click(); });
  await settle();
  await view.press(/Connect this worksheet/);

  const connect = view.requests.find(request => request.target.endsWith('/sheets/connect'));
  assert.deepEqual(connect.body, { spreadsheetId: SPREADSHEET_ID, sheetId: 0 }, 'no replace flag when there is nothing to replace');

  const text = view.text();
  assert.match(text, /SPREADSHEET YOU CHOSE/);
  assert.match(text, /Team tracker/);
  assert.match(text, /tab “Responses”/);
  assert.match(text, /Writing the answers you already have/, 'and it starts from the beginning');
});

test('a sync Intake created is labelled as its own, so nobody thinks it is their file', async (t) => {
  const view = await mount(t, { status: state('up_to_date', { destination: 'created' }) });
  assert.match(view.text(), /SPREADSHEET INTAKE CREATED/);
  assert.match(view.text(), /Feedback — Intake Responses/);
});

// ------------------------------------------------------------------- switching

test('switching a live sync to another file explains the cost and needs an explicit yes', async (t) => {
  const view = await mount(t, {
    status: state('up_to_date', { destination: 'created' }),
    inspect: body => json(inspection(body.sheetId === undefined ? {} : { worksheet: inspection().worksheets[0], assessment: emptyVerdict })),
  });
  view.control.picked = SPREADSHEET_ID;

  await view.press(/Change destination/);
  await act(async () => { view.container.querySelector('input[type=radio]').click(); });
  await settle();

  assert.match(view.text(), /stop adding to its current spreadsheet/);
  assert.match(view.text(), /keeps every row it already has/);

  const confirm = view.button(/Switch to this worksheet/);
  assert.equal(confirm.disabled, true, 'the switch is not one click away');

  await view.toggle();
  assert.equal(view.button(/Switch to this worksheet/).disabled, false);

  await view.press(/Switch to this worksheet/);
  const connect = view.requests.find(request => request.target.endsWith('/sheets/connect'));
  assert.equal(connect.body.replace, true, 'and the server is told this was confirmed');
});

// ------------------------------------------------------------- recovery states

test('a deleted worksheet offers the worksheet picker as the way out', async (t) => {
  const view = await mount(t, { status: state('worksheet_missing') });
  const text = view.text();

  assert.match(text, /The worksheet is gone/);
  assert.match(text, /Everything already in the spreadsheet is untouched/);
  assert.ok(view.button(/Choose a worksheet to sync into/), 'the fix is one press away');
  assert.ok(view.button(/Open the spreadsheet/) || view.container.querySelector('a[href*="docs.google.com"]'));
});

test('a worksheet whose columns changed says so without blaming the person', async (t) => {
  const view = await mount(t, { status: state('worksheet_unsuitable') });
  assert.match(view.text(), /no longer looks like Intake’s table/);
  assert.match(view.text(), /will not write over somebody’s columns/);
});
