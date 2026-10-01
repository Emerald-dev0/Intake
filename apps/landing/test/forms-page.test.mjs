import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// React DOM chooses its event system at import time; install DOM globals before importing the app.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/app/forms' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.sessionStorage = dom.window.sessionStorage;
globalThis.FormData = dom.window.FormData;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act, Suspense } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { routes } = await import('../src/app/routes.tsx');
const { EXAMPLE_SPECIFICATION } = await import('../src/lib/forms.ts');
const { parseFormSpecification } = await import('../server/forms/validation.ts');

const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const EDIT = 'https://docs.google.com/forms/d/1FAfakeForm0001abcdefghijklmnop/edit';
const RESPOND = 'https://docs.google.com/forms/d/e/1FAIpQLSfake1/viewform';
const SPEC = parseFormSpecification(EXAMPLE_SPECIFICATION).specification;
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const draft = (spec = SPEC, extra = {}) => ({ id: ID, provider: 'google', version: 1, status: 'ready', specification: spec, assumptions: ['Phone number is optional.'],
  warnings: [{ code: 'email_validation_unavailable', questionId: 'email', message: 'Google does not check email address format for this field.' }], result: null,
  createdAt: '2026-09-29T09:00:00.000Z', updatedAt: '2026-09-29T09:00:00.000Z', ...extra });
const ready = (spec = SPEC, extra = {}) => json({ requestId: 'req_interpret1', status: 'ready', draft: draft(spec, extra) }, 201);
const created = () => ({ requestId: 'req_created1', form: { id: 'form-record-1', provider: 'google', providerFormId: '1FAfakeForm0001abcdefghijklmnop', title: 'Final Year Project Registration', editUrl: EDIT, responderUrl: RESPOND, published: true, createdAt: '2026-09-29T09:00:00.000Z' }, warnings: [] });
const failure = (body, status = 502) => json({ error: 'Failed.', code: 'provider_error', requestId: 'req_failed1', ...body }, status);
function provider(id, overrides = {}) {
  return { id, name: id === 'google' ? 'Google Forms' : 'Microsoft Forms', accountName: id === 'google' ? 'Google account' : 'Microsoft account', description: 'Fixture provider',
    configured: true, setupEnv: ['GOOGLE_OAUTH_CLIENT_ID'], status: 'connected', accountEmail: 'ada@gmail.test', accountLabel: null, scopes: [], scopeLabels: [], connectedAt: null,
    canRefresh: true, revocation: 'supported', formsApi: id === 'google' ? 'supported' : 'unsupported', formsNote: 'Fixture note', permissionLinks: [], ...overrides };
}

async function mount({ handlers = {}, google = {}, recent = [], start = '/app/forms', savedDraftId = null } = {}) {
  sessionStorage.clear();
  if (savedDraftId) sessionStorage.setItem('intake:current-form-draft', savedDraftId);
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    calls.push({ url, method, init });
    const custom = handlers[`${method} ${url}`];
    if (custom) return custom(init, calls);
    if (url === '/api/me') return json({ user: { id: 'u1', name: 'Test User', email: 'test@example.com' } });
    if (url === '/api/providers') return json({ providers: [provider('google', google), provider('microsoft')] });
    if (url === '/api/forms' && method === 'GET') return json({ requestId: 'req_list1', forms: recent });
    throw new Error(`unexpected request ${method} ${url}`);
  };
  const router = createMemoryRouter(routes, { initialEntries: [start] });
  const root = createRoot(document.getElementById('root'));
  await act(async () => { root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))); });
  const page = {
    router, calls,
    text: () => document.body.textContent,
    $: selector => document.querySelector(selector),
    $$: selector => [...document.querySelectorAll(selector)],
    button: label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label),
    async until(predicate, message) {
      for (let attempt = 0; attempt < 70 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
      assert.ok(predicate(), `${message}\n--- page ---\n${document.body.textContent}`);
    },
    async click(element) { assert.ok(element, 'expected button'); await act(async () => { element.click(); }); },
    async type(element, value) {
      assert.ok(element, 'expected textarea');
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    posts: (suffix = '') => calls.filter(call => call.method === 'POST' && call.url === `/api/forms${suffix}`),
    async unmount() { await act(async () => root.unmount()); router.dispose(); globalThis.fetch = original; sessionStorage.clear(); },
  };
  await page.until(() => page.$('#form-request') || page.$('#review-title') || page.$('#future-prompt'), 'workspace page rendered');
  return page;
}
async function withPage(options, run) { const page = await mount(options); try { return await run(page); } finally { await page.unmount(); } }
async function describe(page) { await page.type(page.$('#form-request'), 'Create a final-year project registration form with name, email and accommodation.'); await page.click(page.button('Understand my form →')); await page.until(() => page.$('#review-title'), 'draft review is visible'); }

// ------------------------------------------------------------------ describe, clarify, review

test('the protected workspace starts with natural language, never a JSON editor or a provider create request', () => withPage({}, async page => {
  assert.equal(page.router.state.location.pathname, '/app/forms');
  assert.ok(page.$('a[href="/app/forms"].active'));
  assert.ok(page.$('label[for="form-request"]'));
  assert.equal(page.$('#form-specification'), null);
  assert.equal(page.button('Create form →'), undefined);
  assert.match(page.text(), /Describe it/);
  assert.match(page.text(), /Microsoft Forms creation is not available/);
  assert.equal(page.posts('/confirm').length, 0);
}));

test('interpretation shows a loading state, then a readable review with routing and warnings; Google is untouched', () => {
  let resolve;
  const pending = new Promise(ok => { resolve = ok; });
  return withPage({ handlers: { 'POST /api/forms/interpret': () => pending } }, async page => {
    await page.type(page.$('#form-request'), 'Register for my project');
    await page.click(page.button('Understand my form →'));
    assert.ok(page.button('Understanding your request…').disabled);
    assert.match(page.text(), /No form is being created yet/);
    assert.equal(page.posts('/confirm').length, 0);
    resolve(ready());
    await page.until(() => page.$('#review-title'), 'a review appears');
    assert.equal(page.$('#review-title').textContent, 'Final Year Project Registration');
    assert.equal(page.$$('.draft-item').length, SPEC.questions.length);
    assert.match(page.$('.draft-review').textContent, /Email · short answer/);
    assert.match(page.$('.draft-review').textContent, /Optional/);
    assert.match(page.$('.draft-review').textContent, /ROUTING SECTION/);
    assert.match(page.$('.draft-review').textContent, /Science/);
    assert.match(page.$('.draft-review').textContent, /Google does not check email address format/);
    assert.ok(page.button('Create form →'));
    assert.ok(page.button('Edit with Intake'));
    assert.ok(page.button('Cancel'));
    assert.equal(page.posts('/confirm').length, 0, 'never auto-creates because a model returned a spec');
    assert.equal(sessionStorage.getItem('intake:current-form-draft'), ID);
  });
});

test('clarification is a focused follow-up and its answer is sent with the original request', () => withPage({ handlers: {
  'POST /api/forms/interpret': (init, calls) => calls.filter(call => call.url === '/api/forms/interpret').length === 1
    ? json({ status: 'needs_clarification', question: 'Which departments should respondents choose from?' }) : ready(),
} }, async page => {
  await page.type(page.$('#form-request'), 'List our departments.');
  await page.click(page.button('Understand my form →'));
  await page.until(() => page.$('#clarification-answer'), 'the question is displayed');
  assert.match(page.text(), /Which departments/);
  assert.equal(page.posts('/confirm').length, 0);
  await page.type(page.$('#clarification-answer'), 'Computer Science, Economics, Statistics');
  await page.click(page.button('Continue →'));
  await page.until(() => page.$('#review-title'), 'a draft appears');
  const second = JSON.parse(page.posts('/interpret')[1].init.body);
  assert.deepEqual(second, { provider: 'google', request: 'List our departments.', clarification: 'Computer Science, Economics, Statistics' });
}));

test('unsupported requests and model failures are recoverable without inventing a draft', () => withPage({ handlers: {
  'POST /api/forms/interpret': (_init, calls) => calls.filter(call => call.url === '/api/forms/interpret').length === 1
    ? json({ status: 'unsupported', explanation: 'File uploads cannot be created through this Google adapter.' })
    : failure({ code: 'model_not_configured', error: 'OPENAI_API_KEY is missing. Nothing was created.' }, 503),
} }, async page => {
  await page.type(page.$('#form-request'), 'Collect a file');
  await page.click(page.button('Understand my form →'));
  assert.match(page.text(), /File uploads cannot be created/);
  assert.equal(page.$('#review-title'), null);
  await page.click(page.button('Understand my form →'));
  assert.match(page.text(), /OPENAI_API_KEY is missing/);
  assert.ok(!page.button('Understand my form →').disabled);
  assert.equal(page.posts('/confirm').length, 0);
}));

// ------------------------------------------------------------------ revisions and confirmation

test('editing with Intake sends only the draft id/version and instruction; preserves review until a revised draft returns', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/revise': () => {
    const spec = structuredClone(SPEC);
    spec.questions.find(q => q.id === 'email').required = false;
    spec.questions.splice(2, 0, { id: 'student_id', title: 'Student ID', type: 'short_text', required: true });
    return json({ status: 'ready', draft: draft(spec, { version: 2 }) });
  },
} }, async page => {
  await describe(page);
  await page.click(page.button('Edit with Intake'));
  await page.type(page.$('#revision-request'), 'Make email optional and add a student ID question.');
  await page.click(page.button('Apply change →'));
  await page.until(() => page.$$('.draft-item').length === SPEC.questions.length + 1, 'updated review');
  assert.match(page.$('.draft-review').textContent, /Student ID/);
  assert.equal(page.$$('.draft-item').find(item => item.textContent.includes('Email address')).textContent.includes('Optional'), true);
  assert.deepEqual(JSON.parse(page.posts('/revise')[0].init.body), { draftId: ID, version: 1, request: 'Make email optional and add a student ID question.' });
  assert.equal(page.posts('/confirm').length, 0);
  await page.click(page.button('Edit with Intake'));
  assert.ok(page.$('#revision-request'), 'another revision can be requested');
}));

test('a failed revision leaves the review and confirmation intact', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/revise': () => failure({ error: 'Intake could not validate the interpretation.', code: 'model_invalid_output', outcome: 'not_created' }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Edit with Intake'));
  await page.type(page.$('#revision-request'), 'Add a date picker.');
  await page.click(page.button('Apply change →'));
  assert.match(page.text(), /could not validate the interpretation/);
  assert.equal(page.$('#review-title').textContent, SPEC.title);
  assert.ok(page.button('Create form →'));
  assert.equal(page.posts('/confirm').length, 0);
}));

test('confirmation is explicit, progress locks the action, success renders only real safe URLs and recent forms reload', () => {
  let resolve;
  const pending = new Promise(ok => { resolve = ok; });
  return withPage({ handlers: {
    'POST /api/forms/interpret': () => ready(),
    'POST /api/forms/confirm': () => pending,
  } }, async page => {
    await describe(page);
    await page.click(page.button('Create form →'));
    assert.ok(page.button('Creating your form…').disabled);
    assert.match(page.text(), /Google is building your form/);
    assert.equal(page.posts('/confirm').length, 1);
    await page.click(page.button('Creating your form…'));
    assert.equal(page.posts('/confirm').length, 1, 'double click does nothing');
    const success = { ...created(), draft: draft(SPEC, { status: 'created', result: { ok: true, ...created() } }) };
    resolve(json(success, 201));
    await page.until(() => page.text().includes('Form created.'), 'creation success');
    assert.equal(page.button('Create form →'), undefined);
    const links = page.$$('.draft-result a');
    assert.deepEqual(links.map(link => link.href), [RESPOND, EDIT]);
    assert.ok(links.every(link => link.target === '_blank' && link.rel.includes('noreferrer')));
    assert.ok(page.button('Start another form →'));
    assert.ok(page.calls.filter(call => call.url === '/api/forms' && call.method === 'GET').length >= 2);
    assert.deepEqual(Object.keys(JSON.parse(page.posts('/confirm')[0].init.body)).sort(), ['confirm', 'draftId', 'version']);
    assert.equal(JSON.parse(page.posts('/confirm')[0].init.body).confirm, true);
  });
});

test('provider not connected retains the reviewed draft and links to Connections, not sign-in', () => withPage({ google: { status: 'not_connected', accountEmail: null }, handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/confirm': () => failure({ error: 'Google is not connected. Nothing was created.', code: 'provider_not_connected', outcome: 'not_created', draft: draft() }, 409),
} }, async page => {
  await describe(page);
  assert.ok(page.$('a[href="/app/connections"]'));
  await page.click(page.button('Create form →'));
  assert.match(page.text(), /Google is not connected\. Nothing was created/);
  assert.ok(page.button('Create form →'), 'retry remains possible after connecting');
  assert.equal(page.router.state.location.pathname, '/app/forms');
}));

test('partial or unknown outcomes disable repeat creation and keep the real partial link', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/confirm': () => failure({ error: 'Questions were not accepted. A partly built form exists.', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' }, draft: draft(SPEC, { status: 'blocked', result: { ok: false, failure: { error: 'Questions were not accepted. A partly built form exists.', code: 'provider_error', requestId: 'req_failed1', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' } } } }) }),
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { status: 'blocked', result: { ok: false, failure: { error: 'Questions were not accepted. A partly built form exists.', code: 'provider_error', requestId: 'req_failed1', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' } } } }) }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Create form →'));
  assert.match(page.text(), /partly built form exists/);
  assert.match(page.text(), /Do not create this draft again/);
  assert.equal(page.button('Create form →'), undefined);
  assert.equal(page.$('a[href="' + EDIT + '"]') !== null, true);
  await page.click(page.button('Check draft status'));
  assert.equal(page.posts('/confirm').length, 1);
}));

test('a dropped confirmation response is uncertain: no automatic retry and draft status must be checked', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  'POST /api/forms/confirm': () => { throw new Error('connection dropped'); },
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { status: 'creating' }) }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Create form →'));
  assert.match(page.text(), /A Google Form may exist/);
  assert.equal(page.button('Create form →'), undefined);
  await page.click(page.button('Check draft status'));
  assert.equal(page.posts('/confirm').length, 1);
  assert.match(page.text(), /Creation was started/);
}));

test('cancel discards a ready draft, never calls the provider, and returns to the natural-language entry', () => withPage({ handlers: {
  'POST /api/forms/interpret': () => ready(),
  [`DELETE /api/forms/draft/${ID}`]: () => new Response(null, { status: 204 }),
} }, async page => {
  await describe(page);
  await page.click(page.button('Cancel'));
  assert.ok(page.$('#form-request'));
  assert.equal(page.$('#review-title'), null);
  assert.equal(sessionStorage.getItem('intake:current-form-draft'), null);
  assert.equal(page.posts('/confirm').length, 0);
  assert.equal(page.calls.filter(call => call.method === 'DELETE').length, 1);
}));

test('the overview input carries a private initial prompt into the creation workspace without putting it in a URL', () => withPage({ start: '/app' }, async page => {
  await page.type(page.$('#future-prompt'), 'Register our team');
  await page.click(page.button('Review my form →'));
  await page.until(() => page.$('#form-request'), 'forms page opened');
  assert.equal(page.$('#form-request').value, 'Register our team');
  assert.equal(page.router.state.location.pathname, '/app/forms');
  assert.equal(page.posts('/interpret').length, 0);
}));

test('reloading the tab resumes the user-owned specification from the server without a new model or Google call', () => withPage({ savedDraftId: ID, handlers: {
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { version: 4 }) }),
} }, async page => {
  await page.until(() => page.$('#review-title'), 'saved review loaded');
  assert.equal(page.$('#review-title').textContent, SPEC.title);
  assert.equal(page.$('#form-request'), null);
  assert.equal(page.posts('/interpret').length, 0);
  assert.equal(page.posts('/confirm').length, 0);
  assert.equal(page.calls.filter(call => call.url === `/api/forms/draft/${ID}`).length, 1);
}));

test('a blocked draft restored after reload shows its partial result but cannot create another form', () => withPage({ savedDraftId: ID, handlers: {
  [`GET /api/forms/draft/${ID}`]: () => json({ draft: draft(SPEC, { status: 'blocked', result: {
    ok: false, failure: { code: 'provider_error', error: 'Google built only part of the form.', requestId: 'req_partial1', outcome: 'partial', partialForm: { providerFormId: '1FAfakeForm0001abcdefghijklmnop', editUrl: EDIT, state: 'unpublished' } },
  } }) }),
} }, async page => {
  await page.until(() => page.$('#review-title'), 'saved partial result loaded');
  assert.match(page.text(), /Do not create this draft again/);
  assert.match(page.text(), /Google built only part of the form/);
  assert.equal(page.button('Create form →'), undefined);
  assert.equal(page.$(`a[href="${EDIT}"]`)?.href, EDIT);
  assert.equal(page.posts('/confirm').length, 0);
  assert.ok(page.button('Start a different form after checking Google →'));
}));
