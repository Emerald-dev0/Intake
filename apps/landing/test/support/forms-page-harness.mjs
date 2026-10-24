import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

// React DOM chooses its event system at import time; install DOM globals before importing the app.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost/app/forms' });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.sessionStorage = dom.window.sessionStorage;
const sessionStorage = dom.window.sessionStorage;
globalThis.FormData = dom.window.FormData;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act, Suspense } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { routes } = await import('../../src/app/routes.tsx');
const { EXAMPLE_SPECIFICATION } = await import('../../src/lib/forms.ts');
const { parseFormSpecification } = await import('../../server/forms/validation.ts');

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
const EDIT_FORM_ID = '1FAfakeForm0001abcdefghijklmnop';
const EDIT_RECORD_ID = 'form-record-1';
const EDIT_DRAFT_ID = 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb';
const EDIT_VIEW = { providerFormId: EDIT_FORM_ID, title: 'Project registration', description: 'Register for the showcase.', editUrl: EDIT, responderUrl: RESPOND,
  items: [{ itemId: '00000001', index: 0, sectionIndex: 0, kind: 'question', questionId: '00000002', questionType: 'short_text', title: 'Full name', required: true, capabilities: ['update_title', 'update_description', 'update_required', 'update_type', 'delete', 'move'] }], hasSections: false, hasBranching: false };
const editDraft = (overrides = {}) => ({ id: EDIT_DRAFT_ID, provider: 'google', version: 1, status: 'ready', current: EDIT_VIEW,
  plan: { formId: EDIT_FORM_ID, summary: 'Rename the form', operations: [{ type: 'update_title', title: 'Project registration 2027' }] },
  changes: [{ type: 'update_title', title: 'Form title', detail: '“Project registration” → “Project registration 2027”', destructive: false }], result: null,
  createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z', ...overrides });
const editSuccess = { ok: true, requestId: 'req_editdone1', providerFormId: EDIT_FORM_ID, title: 'Project registration 2027', editUrl: EDIT, responderUrl: RESPOND, recordUpdated: true };
const failure = (body, status = 502) => json({ error: 'Failed.', code: 'provider_error', requestId: 'req_failed1', ...body }, status);
function provider(id, overrides = {}) {
  return { id, name: id === 'google' ? 'Google Forms' : 'Microsoft Forms', accountName: id === 'google' ? 'Google account' : 'Microsoft account', description: 'Fixture provider',
    configured: true, setupEnv: ['GOOGLE_OAUTH_CLIENT_ID'], status: 'connected', accountEmail: 'ada@gmail.test', accountLabel: null, scopes: [], scopeLabels: [], connectedAt: null,
    canRefresh: true, revocation: 'supported', formsApi: id === 'google' ? 'supported' : 'unsupported', formsNote: 'Fixture note', permissionLinks: [], ...overrides };
}

async function mount({ handlers = {}, google = {}, typeform = {}, recent = [], start = '/app/forms', savedDraftId = null } = {}) {
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
    if (url === '/api/providers') return json({ providers: [
      provider('google', google),
      provider('microsoft'),
      provider('typeform', { name: 'Typeform', accountName: 'Typeform', formsApi: 'supported', setupEnv: ['TYPEFORM_OAUTH_CLIENT_ID'], status: 'connected', accountEmail: 'ada@typeform.test', ...typeform }),
    ] });
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
/** A saved form record as `/api/forms` returns it: the entry point for every edit test. */
const recentGoogleForm = { id: EDIT_RECORD_ID, provider: 'google', providerFormId: EDIT_FORM_ID, title: 'Project registration', status: 'created', failureStage: null, editUrl: EDIT, responderUrl: RESPOND, createdAt: '2026-09-30T09:00:00.000Z' };

async function withPage(options, run) { const page = await mount(options); try { return await run(page); } finally { await page.unmount(); } }
async function describe(page) { await page.type(page.$('#form-request'), 'Create a final-year project registration form with name, email and accommodation.'); await page.click(page.button('Send →')); await page.until(() => page.$('#review-title'), 'draft review is visible'); }

export {
  withPage, mount, describe, draft, ready, created, provider, editDraft, editSuccess, failure, json,
  SPEC, ID, EDIT, RESPOND, EDIT_FORM_ID, EDIT_RECORD_ID, EDIT_DRAFT_ID, EDIT_VIEW,
  act, dom, sessionStorage, recentGoogleForm,
};
