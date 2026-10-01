import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// Install DOM globals before importing React
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/app/library' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.FormData = dom.window.FormData;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
globalThis.React = React;
const { act, Suspense } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { routes } = await import('../src/app/routes.tsx');

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const FORM_1 = {
  id: 'form-1',
  provider: 'google',
  providerFormId: '1FAfakeForm0001abcdefghijklmnop',
  title: 'Project Registration',
  description: 'Register for final-year project showcase.',
  status: 'created',
  failureStage: null,
  editUrl: 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit',
  responderUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform',
  source: 'created',
  lastSyncedAt: '2026-10-01T09:00:00.000Z',
  archivedAt: null,
  createdAt: '2026-09-28T09:00:00.000Z',
  updatedAt: '2026-10-01T09:00:00.000Z',
};

const FORM_2 = {
  id: 'form-2',
  provider: 'google',
  providerFormId: '1FAfakeForm0002qrstuvwxyz123456',
  title: 'Faculty Feedback Survey',
  description: 'Anonymous faculty teaching feedback.',
  status: 'created',
  failureStage: null,
  editUrl: 'https://docs.google.com/forms/d/1FAfakeForm0002qrstuvwxyz123456/edit',
  responderUrl: 'https://docs.google.com/forms/d/e/1FAIpQLSfake2/viewform',
  source: 'imported',
  lastSyncedAt: null,
  archivedAt: null,
  createdAt: '2026-09-29T11:00:00.000Z',
  updatedAt: '2026-09-29T11:00:00.000Z',
};

function provider(id, overrides = {}) {
  return {
    id,
    name: id === 'google' ? 'Google Forms' : 'Microsoft Forms',
    accountName: id === 'google' ? 'Google account' : 'Microsoft account',
    description: 'Fixture provider',
    configured: true,
    setupEnv: ['GOOGLE_OAUTH_CLIENT_ID'],
    status: 'connected',
    accountEmail: 'ada@gmail.test',
    accountLabel: null,
    scopes: [],
    scopeLabels: [],
    connectedAt: null,
    canRefresh: true,
    revocation: 'supported',
    formsApi: id === 'google' ? 'supported' : 'unsupported',
    formsNote: 'Fixture note',
    permissionLinks: [],
    ...overrides,
  };
}

async function mountLibrary({ handlers = {}, forms = [FORM_1, FORM_2], start = '/app/library', google = {} } = {}) {
  sessionStorage.clear();
  const original = globalThis.fetch;
  const calls = [];

  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, init });
    const parsedUrl = new URL(url, 'http://localhost');
    const pathOnly = parsedUrl.pathname;
    const custom = handlers[`${method} ${url}`] || handlers[`${method} ${pathOnly}`];
    if (custom) return custom(init, calls, parsedUrl);

    if (pathOnly === '/api/me') return json({ user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' } });
    if (pathOnly === '/api/providers') return json({ providers: [provider('google', google), provider('microsoft')] });
    if (pathOnly === '/api/forms/library' && method === 'GET') {
      const q = parsedUrl.searchParams.get('query')?.toLowerCase();
      let filtered = forms;
      if (q) filtered = filtered.filter(f => f.title.toLowerCase().includes(q) || (f.description ?? '').toLowerCase().includes(q));
      return json({ requestId: 'req_lib_list', forms: filtered });
    }
    if (pathOnly === '/api/forms' && method === 'GET') {
      return json({ requestId: 'req_forms_list', forms });
    }
    throw new Error(`Unhandled fetch: ${method} ${url}`);
  };

  const router = createMemoryRouter(routes, { initialEntries: [start] });
  const root = createRoot(document.getElementById('root'));
  await act(async () => {
    root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router })));
  });

  const page = {
    router,
    calls,
    text: () => document.body.textContent,
    $: selector => document.querySelector(selector),
    $$: selector => [...document.querySelectorAll(selector)],
    button: label => [...document.querySelectorAll('button')].find(b => b.textContent.trim().includes(label)),
    async until(predicate, message) {
      for (let attempt = 0; attempt < 70 && !predicate(); attempt++) {
        await act(async () => { await new Promise(r => setTimeout(r, 10)); });
      }
      assert.ok(predicate(), `${message}\n--- page content ---\n${document.body.textContent}`);
    },
    async click(element) {
      assert.ok(element, 'expected element to click');
      await act(async () => { element.click(); });
    },
    async type(element, value) {
      assert.ok(element, 'expected input element');
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async unmount() {
      await act(async () => root.unmount());
      router.dispose();
      globalThis.fetch = original;
      sessionStorage.clear();
    },
  };

  await page.until(() => page.$('#library-search') || page.$('.library-head'), 'library page rendered');
  return page;
}

async function withLibraryPage(options, run) {
  const page = await mountLibrary(options);
  try {
    return await run(page);
  } finally {
    await page.unmount();
  }
}

// ---------------------------------------------------------------- tests

test('Form Library page displays persisted forms with substantiated metadata and links', () =>
  withLibraryPage({}, async page => {
    assert.equal(page.router.state.location.pathname, '/app/library');
    assert.match(page.text(), /Your Forms/);
    assert.match(page.text(), /Project Registration/);
    assert.match(page.text(), /Faculty Feedback Survey/);
    assert.match(page.text(), /Register for final-year project showcase/);

    // Badges
    assert.match(page.text(), /Intake/);
    assert.match(page.text(), /Imported/);
    assert.match(page.text(), /Published/);

    // Substantiated dates
    assert.match(page.text(), /Created Sep 28, 2026/);
    assert.match(page.text(), /Verified Oct 1, 2026/);

    // Links
    const openLinks = page.$$('a[href*="docs.google.com/forms"]');
    assert.ok(openLinks.length >= 2);
    assert.equal(openLinks[0].target, '_blank');
  }));

test('Form Library search filters cards by title and description', () =>
  withLibraryPage({}, async page => {
    await page.type(page.$('#library-search'), 'Project');
    await page.until(() => page.$$('.library-card').length === 1, 'only one form matches');
    assert.match(page.text(), /Project Registration/);
    assert.equal(page.text().includes('Faculty Feedback Survey'), false);

    // Clear search
    await page.click(page.$('.library-search-clear'));
    await page.until(() => page.$$('.library-card').length === 2, 'all forms restored');
  }));

test('Form details modal shows full information, live status check, and archive action', () =>
  withLibraryPage({
    handlers: {
      'POST /api/forms/library/form-1/refresh': () => json({
        requestId: 'req_ref1',
        ok: true,
        status: 'accessible',
        form: { ...FORM_1, title: 'Project Registration (Verified Live)' },
      }),
      'POST /api/forms/library/form-1/archive': () => json({
        requestId: 'req_arch1',
        ok: true,
        archived: true,
      }),
    },
  }, async page => {
    const detailsButtons = page.$$('button').filter(b => b.textContent.trim() === 'View details');
    assert.ok(detailsButtons.length >= 1);
    await page.click(detailsButtons[0]);

    // Modal is open
    await page.until(() => page.$('#details-title'), 'details modal opened');
    assert.match(page.text(), /1FAfakeForm0001abcdefghijklmnop/);
    assert.match(page.text(), /Created through Intake/);

    // Live status check
    const checkButton = page.button('Check live status ↻');
    assert.ok(checkButton);
    await page.click(checkButton);
    await page.until(() => page.text().includes('Form is accessible and accepting responses'), 'live status verified');

    // Archive button
    const archiveBtn = page.button('Archive form');
    assert.ok(archiveBtn);
    await page.click(archiveBtn);
    await page.until(() => page.button('Restore to active library'), 'form marked archived');
  }));

test('Removal from library requires explicit confirmation stating external Google Form is preserved', () =>
  withLibraryPage({
    handlers: {
      'DELETE /api/forms/library/form-1': () => json({
        requestId: 'req_del1',
        ok: true,
        removed: true,
        message: 'Form removed from Intake library.',
      }),
    },
  }, async page => {
    const detailsButtons = page.$$('button').filter(b => b.textContent.trim() === 'View details');
    await page.click(detailsButtons[0]);
    await page.until(() => page.button('Remove from Intake'), 'details modal opened');

    // Click Remove
    await page.click(page.button('Remove from Intake'));

    // Confirmation dialog appears
    await page.until(() => page.$('#confirm-remove-title'), 'confirmation dialog appears');
    assert.match(page.text(), /The external Google Form will NOT be deleted/);
    assert.ok(page.button('Keep in library'));
    assert.ok(page.button('Yes, remove from Intake'));

    // Confirm removal
    await page.click(page.button('Yes, remove from Intake'));
    await page.until(() => page.$$('.library-card').length === 1, 'card removed from list');
    assert.equal(page.text().includes('Project Registration'), false);
    assert.match(page.text(), /Faculty Feedback Survey/);
  }));

test('library mutations show failures and do not optimistically change local state', () =>
  withLibraryPage({
    handlers: {
      'POST /api/forms/library/form-1/archive': () => json({ error: 'Archive is temporarily unavailable.' }, 503),
      'DELETE /api/forms/library/form-1': () => json({ error: 'Removal is temporarily unavailable.' }, 503),
    },
  }, async page => {
    await page.click(page.$$('button').find(button => button.textContent.trim() === 'View details'));
    await page.until(() => page.button('Archive form'), 'details modal opened');

    await page.click(page.button('Archive form'));
    await page.until(() => page.text().includes('Archive is temporarily unavailable.'), 'archive failure is visible');
    assert.ok(page.button('Archive form'), 'failed archive did not alter the local record');

    await page.click(page.button('Remove from Intake'));
    await page.until(() => page.button('Yes, remove from Intake'), 'confirmation dialog opened');
    await page.click(page.button('Yes, remove from Intake'));
    await page.until(() => page.text().includes('Removal is temporarily unavailable.'), 'remove failure is visible');
    assert.equal(page.$$('.library-card').length, 2, 'failed removal did not hide the form');
    assert.ok(page.$('#confirm-remove-title'), 'confirmation remains open so the user can retry or cancel');
  }));

test('clicking Edit with Intake transitions to the edit workspace with the selected form', () =>
  withLibraryPage({}, async page => {
    const editButtons = page.$$('button').filter(b => b.textContent.trim() === 'Edit with Intake');
    assert.ok(editButtons.length >= 1);
    await page.click(editButtons[0]);

    // Navigates to /app/forms with mode edit and formRecordId
    await page.until(() => page.router.state.location.pathname === '/app/forms', 'navigated to forms page');
    assert.equal(page.router.state.location.state?.mode, 'edit');
    assert.equal(page.router.state.location.state?.initialRecordId, 'form-1');
  }));

test('empty library state renders helpful guidance and creation routes', () =>
  withLibraryPage({ forms: [] }, async page => {
    assert.match(page.text(), /Your form library is empty/);
    assert.match(page.text(), /Forms you create with Intake or import from your Google account/);
    assert.ok(page.button('Create your first form →'));
    assert.ok(page.button('Import an existing Google Form'));
  }));

test('provider disconnected notice appears when Google is not connected, but forms remain visible', () =>
  withLibraryPage({ google: { status: 'not_connected', accountEmail: null } }, async page => {
    assert.match(page.text(), /Your Google account is not connected/);
    assert.match(page.text(), /Saved forms remain available in your library/);
    assert.ok(page.$('a[href="/app/connections"]'));

    // Form records are still displayed
    assert.match(page.text(), /Project Registration/);
    assert.match(page.text(), /Faculty Feedback Survey/);
  }));
