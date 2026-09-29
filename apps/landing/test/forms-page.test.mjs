import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// React DOM decides at import time whether a DOM exists. The globals therefore come first and every
// module that loads React DOM (directly or through react-router-dom or the app routes) is imported
// after them; otherwise React falls back to a legacy change-event path that ignores typing.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/app/forms' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const React = await import('react');
const { act, Suspense } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { routes } = await import('../src/app/routes.tsx');
const { EXAMPLE_SPECIFICATION, EXAMPLE_SPECIFICATION_JSON } = await import('../src/lib/forms.ts');

const EDIT = 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit';
const RESPOND = 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform';

function provider(id, overrides = {}) {
  return {
    id,
    name: id === 'google' ? 'Google Forms' : 'Microsoft Forms',
    accountName: id === 'google' ? 'Google account' : 'Microsoft account',
    description: 'Fixture provider',
    configured: true,
    setupEnv: [`${id.toUpperCase()}_OAUTH_CLIENT_ID`, `${id.toUpperCase()}_OAUTH_CLIENT_SECRET`],
    status: 'not_connected',
    accountEmail: null,
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

const CONNECTED = { status: 'connected', accountEmail: 'ada@gmail.test' };
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const created = (overrides = {}) => ({
  requestId: 'req_success1',
  form: { id: 'form-record-1', provider: 'google', providerFormId: '1FAfakeForm0001abcdefghijklmnop', title: 'Final Year Project Registration', editUrl: EDIT, responderUrl: RESPOND, published: true, createdAt: '2026-09-29T09:00:00.000Z', ...overrides.form },
  warnings: [{ code: 'email_validation_unavailable', questionId: 'email', message: '"Email address" was created as a short-answer question. The Google Forms API cannot turn on email validation.' }],
  ...overrides.body,
});
const failure = (body, status = 502) => json({ error: 'Failed.', code: 'provider_error', requestId: 'req_failed01', ...body }, status);

/** Mount the real router at a path with fetch routed to handlers. Returns helpers and the request log. */
async function mount(path, { google = CONNECTED, handlers = {}, recent = [] } = {}) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, init });
    const custom = handlers[`${method} ${url}`];
    if (custom) return custom(init, calls);
    if (url === '/api/me') return json({ user: { id: 'u1', name: 'Test User', email: 'test@example.com' } });
    if (url === '/api/providers') return json({ providers: [provider('google', google), provider('microsoft')] });
    if (url === '/api/forms' && method === 'GET') return json({ requestId: 'req_list', forms: recent });
    throw new Error(`unexpected request ${method} ${url}`);
  };
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))); });
  const api = {
    router,
    calls,
    text: () => document.body.textContent,
    $: selector => document.querySelector(selector),
    $$: selector => [...document.querySelectorAll(selector)],
    button: label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label),
    async until(predicate, message) {
      for (let attempt = 0; attempt < 60 && !predicate(); attempt += 1) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      assert.ok(predicate(), `${message}\n--- page text ---\n${document.body.textContent}`);
    },
    async click(element) {
      await act(async () => { element.click(); });
    },
    async type(element, value) {
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    posts: () => calls.filter(call => call.method === 'POST' && call.url === '/api/forms'),
    async unmount() {
      await act(async () => root.unmount());
      router.dispose();
      globalThis.fetch = original;
    },
  };
  await api.until(() => api.text().includes('Create a form'), 'the forms page renders');
  return api;
}

async function withPage(path, options, run) {
  const page = await mount(path, options);
  try {
    await run(page);
  } finally {
    await page.unmount();
  }
}

const submit = page => page.click(page.button('Create form'));

// ---------------------------------------------------------------- idle

test('the forms page is a protected workspace route with the sidebar item active', () =>
  withPage('/app/forms', {}, async page => {
    assert.equal(page.router.state.location.pathname, '/app/forms');
    const link = page.$('a[href="/app/forms"]');
    assert.ok(link && link.className.includes('active'));
    assert.match(page.text(), /WORKSPACE\s*\/\s*FORMS/);
    assert.match(page.text(), /DEVELOPER PREVIEW/);
  }));

test('idle: Google is chosen, Microsoft is disabled with its reason, the editor starts with a valid example', () =>
  withPage('/app/forms', {}, async page => {
    const [google, microsoft] = page.$$('input[name="provider"]');
    assert.equal(google.value, 'google');
    assert.equal(google.checked, true);
    assert.equal(microsoft.value, 'microsoft');
    assert.equal(microsoft.disabled, true);
    assert.match(page.text(), /Microsoft Forms/);
    assert.match(page.text(), /Not available yet\. Microsoft publishes no supported API/);
    assert.match(page.text(), /Connected as ada@gmail\.test/);

    const editor = page.$('#form-specification');
    assert.equal(editor.value, EXAMPLE_SPECIFICATION_JSON);
    assert.deepEqual(JSON.parse(editor.value), EXAMPLE_SPECIFICATION);
    assert.equal(page.$('label[for="form-specification"]') !== null, true, 'the editor has a label');

    const button = page.button('Create form');
    assert.ok(button && !button.disabled);
    assert.equal(page.text().includes('Form created.'), false);
    assert.equal(page.posts().length, 0, 'nothing is created just by opening the page');
  }));

// ---------------------------------------------------------------- creating and success

test('creating shows progress and locks the form; success shows Form created. with the real links', () => {
  let resolvePost;
  const pending = new Promise(resolve => { resolvePost = resolve; });
  return withPage('/app/forms', { handlers: { 'POST /api/forms': () => pending } }, async page => {
    await submit(page);
    await page.until(() => page.button('Creating your form…'), 'the button says Creating your form…');
    assert.equal(page.button('Creating your form…').disabled, true);
    assert.equal(page.$('#form-specification').disabled, true);
    assert.equal(page.$('fieldset').disabled, true);
    assert.match(page.text(), /building it/);
    assert.equal(page.posts().length, 1, 'one request');

    // A second submit while one is running is ignored (Enter key, double click, script).
    await act(async () => { page.$('form.forms-panel').dispatchEvent(new dom.window.Event('submit', { bubbles: true, cancelable: true })); });
    assert.equal(page.posts().length, 1);

    resolvePost(json(created(), 201));
    await page.until(() => page.text().includes('Form created.'), 'success is shown');
    assert.ok(page.button('Create form'), 'the button is back to Create form');
    assert.equal(page.$('#form-specification').disabled, false);

    const banner = page.$('.form-banner.ok');
    assert.equal(banner.getAttribute('role'), 'status');
    const [open, edit] = [...banner.querySelectorAll('a')];
    assert.equal(open.textContent.replace('↗', '').trim(), 'Open form');
    assert.equal(open.href, RESPOND);
    assert.equal(edit.textContent.replace('↗', '').trim(), 'Edit form');
    assert.equal(edit.href, EDIT);
    for (const link of [open, edit]) {
      assert.equal(link.target, '_blank');
      assert.match(link.rel, /noreferrer/);
    }
    assert.match(banner.textContent, /Final Year Project Registration is published in your Google account and accepting responses/);
    assert.match(banner.textContent, /cannot turn on email validation/, 'warnings are shown');
    assert.match(banner.textContent, /Request req_success1/);
  });
});

test('the request carries only the provider and the specification, and the list is refreshed afterwards', () =>
  withPage('/app/forms', { handlers: { 'POST /api/forms': () => json(created(), 201) } }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('Form created.'), 'success');
    const [post] = page.posts();
    assert.equal(post.init.credentials, 'same-origin');
    assert.equal(post.init.cache, 'no-store');
    assert.equal(post.init.headers['content-type'], 'application/json');
    const body = JSON.parse(post.init.body);
    assert.deepEqual(Object.keys(body).sort(), ['provider', 'specification']);
    assert.equal(body.provider, 'google');
    assert.deepEqual(body.specification, EXAMPLE_SPECIFICATION);
    const lists = page.calls.filter(call => call.method === 'GET' && call.url === '/api/forms');
    assert.equal(lists.length, 2, 'loaded on mount, and again after the form was created');
  }));

test('an edited specification is what gets sent', () =>
  withPage('/app/forms', { handlers: { 'POST /api/forms': () => json(created(), 201) } }, async page => {
    const custom = { title: 'Hello', questions: [{ id: 'name', type: 'short_text', title: 'Name' }] };
    await page.type(page.$('#form-specification'), JSON.stringify(custom));
    await submit(page);
    await page.until(() => page.posts().length === 1, 'sent');
    assert.deepEqual(JSON.parse(page.posts()[0].init.body).specification, custom);
  }));

test('a created form with no verifiable respondent link or record says so instead of guessing', () =>
  withPage('/app/forms', { handlers: { 'POST /api/forms': () => json(created({ form: { responderUrl: null, id: null, createdAt: null } }), 201) } }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('Form created.'), 'success');
    const banner = page.$('.form-banner.ok');
    assert.equal(banner.querySelectorAll('a').length, 1, 'only the edit link');
    assert.match(banner.textContent, /did not return a respondent link that Intake could verify/);
    assert.match(banner.textContent, /could not save a record of this form/);
  }));

test('links that are not Google Forms https links are never rendered, whatever the server sends', () =>
  withPage('/app/forms', {
    handlers: { 'POST /api/forms': () => json(created({ form: { editUrl: 'javascript:alert(document.cookie)', responderUrl: 'https://evil.example/forms/d/e/x/viewform' } }), 201) },
    recent: [{ id: 'f1', provider: 'google', providerFormId: 'abc12345', title: 'Tampered', status: 'created', failureStage: null, editUrl: 'data:text/html,<script>alert(1)</script>', responderUrl: 'https://docs.google.com.evil.example/forms/d/e/x/viewform', createdAt: '2026-09-29T09:00:00.000Z' }],
  }, async page => {
    await page.until(() => page.text().includes('Tampered'), 'recent form listed');
    await submit(page);
    await page.until(() => page.text().includes('Form created.'), 'success');
    const hrefs = page.$$('a').map(link => link.getAttribute('href')).filter(Boolean);
    assert.equal(hrefs.some(href => href.startsWith('javascript:') || href.startsWith('data:') || href.includes('evil.example')), false, hrefs.join(', '));
    assert.equal(page.$('.form-banner.ok').querySelectorAll('a').length, 0);
  }));

// ---------------------------------------------------------------- connection states

test('not connected: the page offers Connect Google Forms with the existing connect flow and never redirects to sign-in', () =>
  withPage('/app/forms', {
    handlers: { 'POST /api/forms': () => failure({ error: 'Google is not connected to your Intake account. Connect Google Forms first. Nothing was created.', code: 'provider_not_connected', stage: 'connection', outcome: 'not_created', retryable: false }, 409) },
  }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('Google is not connected'), 'not-connected heading');
    const banner = page.$('.form-banner.warn[role="alert"]');
    assert.match(banner.textContent, /Nothing was created/);
    const connect = banner.querySelector('form[action="/api/providers/google/connect"]');
    assert.ok(connect, 'the same form POST the Connections screen uses');
    assert.equal(connect.method.toLowerCase(), 'post');
    assert.equal(connect.querySelector('button').textContent, 'Connect Google Forms');
    assert.equal(page.router.state.location.pathname, '/app/forms', 'a provider problem is not a sign-out');
    const providerLoads = page.calls.filter(call => call.url === '/api/providers');
    assert.equal(providerLoads.length, 2, 'provider status is refreshed so the page is not out of date');
  }));

test('authorization expired: the page offers Reconnect Google', () =>
  withPage('/app/forms', {
    handlers: { 'POST /api/forms': () => failure({ error: 'Your Google authorization has expired or was revoked. Reconnect Google, then try again. Nothing was created.', code: 'provider_reauthorization_required', stage: 'connection', outcome: 'not_created' }, 409) },
  }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('Google authorization needs renewing'), 'reauthorization heading');
    const form = page.$('.form-banner form[action="/api/providers/google/connect"]');
    assert.equal(form.querySelector('button').textContent, 'Reconnect Google');
    assert.equal(page.router.state.location.pathname, '/app/forms');
  }));

test('the connection state is shown before anything is submitted, and the server still decides', async () => {
  await withPage('/app/forms', { google: { status: 'not_connected' } }, async page => {
    await page.until(() => page.text().includes('Connect Google Forms'), 'connect prompt');
    assert.match(page.text(), /Not connected/);
    assert.ok(!page.button('Create form').disabled, 'advice only: the server checks on every request');
  });
  await withPage('/app/forms', { google: { status: 'reauthorization_required' } }, async page => {
    await page.until(() => page.text().includes('Reconnect Google'), 'reconnect prompt');
    assert.match(page.text(), /Reconnect required/, 'same wording as the Connections page');
    assert.equal(page.text().includes('Not connected'), false, 'a revoked grant is not the same as no grant');
  });
  await withPage('/app/forms', { google: { status: 'expired' } }, async page => {
    await page.until(() => page.text().includes('Reconnect Google'), 'reconnect prompt for an expired grant');
    assert.match(page.text(), /Expired/, 'the card uses the Connections wording; the notice says "expired" in lower case');
    assert.equal(page.text().includes('Not connected'), false);
  });
  await withPage('/app/forms', { google: { status: 'not_connected', configured: false } }, async page => {
    await page.until(() => page.text().includes('not set up on this Intake server'), 'setup notice');
    assert.equal(page.text().includes('Connect Google Forms'), false, 'no button that could only fail');
    assert.match(page.text(), /GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET/);
    assert.match(page.text(), /Setup required/);
  });
});

// ---------------------------------------------------------------- validation

test('validation errors say exactly what is invalid, where, and how to fix it, and keep the text', () => {
  const issues = [
    { code: 'options_required', path: 'questions[3].options', message: '"dropdown" question "department" needs at least one option.', hint: 'Add an "options" array such as ["Option A", "Option B"].' },
    { code: 'duplicate_question_id', path: 'questions[5].id', message: 'Question id "phone" is already used by questions[4].' },
  ];
  return withPage('/app/forms', {
    handlers: { 'POST /api/forms': () => failure({ error: 'The form specification is not valid. Nothing was created.', code: 'validation_failed', issues, outcome: 'not_created', retryable: false }, 422) },
  }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('The specification is not valid'), 'validation heading');
    const items = page.$$('.form-banner [aria-label="What to fix"] li');
    assert.equal(items.length, 2);
    assert.equal(items[0].querySelector('code').textContent, 'questions[3].options');
    assert.match(items[0].textContent, /needs at least one option/);
    assert.match(items[0].textContent, /Add an "options" array/);
    assert.equal(items[1].querySelector('code').textContent, 'questions[5].id');
    assert.equal(page.$('#form-specification').value, EXAMPLE_SPECIFICATION_JSON, 'the text is kept so it can be corrected');
    assert.equal(page.$$('.form-banner form[action="/api/providers/google/connect"]').length, 0);
  });
});

test('text that is not JSON is explained locally and never sent', () =>
  withPage('/app/forms', {}, async page => {
    await page.type(page.$('#form-specification'), '{ "title": "Broken", ');
    await submit(page);
    await page.until(() => page.$('#spec-json-error'), 'JSON error shown');
    assert.match(page.$('#spec-json-error').textContent, /This is not valid JSON/);
    assert.match(page.$('#spec-json-error').textContent, /Nothing was sent/);
    assert.equal(page.$('#spec-json-error').getAttribute('role'), 'alert');
    assert.equal(page.$('#form-specification').getAttribute('aria-invalid'), 'true');
    assert.equal(page.posts().length, 0);
    assert.ok(page.button('Create form'));
  }));

// ---------------------------------------------------------------- provider failures

test('a provider failure after the form exists is explained, links the partly built form, and refreshes the list', () =>
  withPage('/app/forms', {
    handlers: {
      'POST /api/forms': () => failure({
        error: 'Google created an empty form but did not accept the questions. Google rejected part of the form. A partly built form exists in your Google account and is not published. Open it to finish or delete it.',
        code: 'provider_rejected',
        provider: 'google',
        stage: 'add_questions',
        outcome: 'partial',
        retryable: false,
        detail: 'Invalid requests[2].createItem',
        partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' },
      }),
    },
  }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('The form was only partly created'), 'partial heading');
    const banner = page.$('.form-banner.bad');
    assert.match(banner.textContent, /partly built form exists in your Google account and is not published/);
    assert.match(banner.textContent, /Google said: Invalid requests\[2\]\.createItem/);
    assert.match(banner.textContent, /Request req_failed01/);
    const link = [...banner.querySelectorAll('a')].find(anchor => anchor.textContent.includes('Open partly built form'));
    assert.equal(link.href, EDIT);
    assert.equal(link.target, '_blank');
    assert.equal(page.calls.filter(call => call.method === 'GET' && call.url === '/api/forms').length, 2, 'the incomplete form is listed');
  }));

test('failures are worded for what actually happened: not created, unknown, or something else', async () => {
  const cases = [
    { body: { code: 'provider_rejected', outcome: 'not_created', error: 'Google rejected the request. Nothing was created.' }, heading: 'The form was not created' },
    { body: { code: 'provider_unavailable', outcome: 'unknown', error: 'Google took too long to answer. Google did not confirm the request, so a form may or may not exist. Check Google Forms before trying again.' }, heading: 'Intake could not confirm the result' },
    { body: { code: 'internal_error', error: 'Something went wrong inside Intake. The form may not have been created.' }, heading: 'Something went wrong' },
    { body: { code: 'rate_limited', outcome: 'not_created', error: 'Too many forms were created in a short time.' }, heading: 'Try again in a moment' },
    { body: { code: 'provider_not_supported', provider: 'microsoft', outcome: 'not_created', error: 'Microsoft Forms creation is not available yet.' }, heading: 'Creation is not available for this provider yet' },
  ];
  for (const { body, heading } of cases) {
    await withPage('/app/forms', { handlers: { 'POST /api/forms': () => failure(body, 500) } }, async page => {
      await submit(page);
      await page.until(() => page.text().includes(heading), heading);
      assert.match(page.$('.form-banner[role="alert"]').textContent, new RegExp(body.error.slice(0, 30).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
    });
  }
});

test('when Intake cannot be reached the page admits the result is unknown', () =>
  withPage('/app/forms', { handlers: { 'POST /api/forms': () => { throw new TypeError('network down'); } } }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('Intake could not confirm the result'), 'unknown heading');
    assert.match(page.$('.form-banner[role="alert"]').textContent, /a form may have been created/);
    assert.ok(page.button('Create form') && !page.button('Create form').disabled, 'the page is usable again');
  }));

test('an unreadable server answer is never shown as success', () =>
  withPage('/app/forms', { handlers: { 'POST /api/forms': () => new Response('<html>502 Bad Gateway</html>', { status: 200, headers: { 'content-type': 'text/html' } }) } }, async page => {
    await submit(page);
    await page.until(() => page.text().includes('Intake could not confirm the result') || page.text().includes('Something went wrong'), 'failure shown');
    assert.equal(page.text().includes('Form created.'), false);
  }));

test('a lapsed Intake session is explained and does not throw away the specification', () =>
  withPage('/app/forms', { handlers: { 'POST /api/forms': () => new Response('{}', { status: 401 }) } }, async page => {
    await page.type(page.$('#form-specification'), '{"title":"Keep me","questions":[]}');
    await submit(page);
    await page.until(() => page.text().includes('Your Intake session ended'), 'session message');
    assert.equal(page.$('#form-specification').value, '{"title":"Keep me","questions":[]}');
  }));

// ---------------------------------------------------------------- recent forms

test('recent forms are listed from the API with their links, and incomplete ones are marked', () =>
  withPage('/app/forms', {
    recent: [
      { id: 'f2', provider: 'google', providerFormId: 'abc12345', title: 'Second form', status: 'incomplete', failureStage: 'publish', editUrl: EDIT, responderUrl: null, createdAt: '2026-09-29T10:00:00.000Z' },
      { id: 'f1', provider: 'google', providerFormId: 'def67890', title: 'First form', status: 'created', failureStage: null, editUrl: EDIT, responderUrl: RESPOND, createdAt: '2026-09-29T09:00:00.000Z' },
    ],
  }, async page => {
    await page.until(() => page.text().includes('Second form'), 'list rendered');
    const rows = page.$$('.forms-row');
    assert.equal(rows.length, 2);
    assert.match(rows[0].textContent, /Incomplete/);
    assert.match(rows[0].textContent, /Stopped while publishing\. It is not published and does not accept responses/);
    assert.equal(rows[0].querySelectorAll('a').length, 1, 'no respondent link for an unpublished form');
    assert.match(rows[1].textContent, /Published/);
    assert.equal(rows[1].querySelectorAll('a').length, 2);
  }));

test('an empty list and a failing list are both said plainly', async () => {
  await withPage('/app/forms', { recent: [] }, async page => {
    await page.until(() => page.text().includes('Forms you create here will be listed'), 'empty state');
  });
  await withPage('/app/forms', { handlers: { 'GET /api/forms': () => new Response('{}', { status: 503 }) } }, async page => {
    await page.until(() => page.text().includes('couldn’t load your recent forms'), 'error state');
    assert.match(page.text(), /does not mean they are gone/);
    assert.ok(page.button('Try again'));
    assert.equal(page.router.state.location.pathname, '/app/forms');
  });
});

// ---------------------------------------------------------------- the rest of the workspace still says true things

test('the overview no longer says creation is unavailable, still asks the same question, and points at the preview', () =>
  withPage('/app', {}, async page => {
    await page.until(() => page.text().includes('What do you need'), 'overview heading');
    assert.equal(page.text().includes('Form creation is not available yet'), false);
    assert.equal(page.text().includes('Form creation is coming in a future release'), false);
    assert.ok(page.$('a[href="/app/forms"]'));
    assert.match(page.text(), /Plain-language requests are coming in a future release/);
    assert.ok(page.$('#future-prompt').disabled, 'the plain-language prompt is still not available');
  }));
