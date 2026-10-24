import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * Editing, as a conversation.
 *
 * `forms-page.test.mjs` proves the edit workflow end to end (inspect → proposal → confirm → verified
 * apply) but mounts the router twenty times, which is what tips this sandbox into the OOM killer.
 * This file mounts once and asserts only the shape a person experiences: one thread, the current
 * form as an artifact inside it, one composer at the bottom whose job changes, and the same confirm
 * boundary in the same place.
 */

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

const DRAFT_ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });

const record = {
  id: 'form-record-1', provider: 'google', providerFormId: 'google-form-1', title: 'Project registration',
  status: 'created', failureStage: null, editUrl: 'https://docs.google.com/forms/d/google-form-1/edit',
  responderUrl: 'https://docs.google.com/forms/d/google-form-1/viewform', createdAt: '2026-09-30T09:00:00.000Z',
};
const view = {
  providerFormId: 'google-form-1', title: 'Project registration', description: 'Register for the showcase.',
  editUrl: record.editUrl, responderUrl: record.responderUrl,
  items: [{ itemId: '00000001', index: 0, sectionIndex: 0, kind: 'question', questionId: '00000002',
    questionType: 'short_text', title: 'Full name', required: true, capabilities: ['update_title', 'update_required'] }],
  hasSections: false, hasBranching: false,
};
const draft = {
  id: DRAFT_ID, provider: 'google', version: 1, status: 'ready', current: view,
  plan: { formId: 'google-form-1', summary: 'Rename the form', operations: [{ type: 'update_title', title: 'Project registration 2027' }] },
  changes: [{ type: 'update_title', title: 'Form title', detail: '“Project registration” → “Project registration 2027”', destructive: false }],
  result: null, createdAt: '2026-10-01T09:00:00.000Z', updatedAt: '2026-10-01T09:00:00.000Z',
};
const provider = {
  id: 'google', name: 'Google Forms', accountName: 'Google account', description: 'Fixture provider',
  configured: true, setupEnv: ['GOOGLE_OAUTH_CLIENT_ID'], status: 'connected', accountEmail: 'ada@example.test',
  accountLabel: null, scopes: [], scopeLabels: [], connectedAt: null, canRefresh: true, revocation: 'supported',
  formsApi: 'supported', formsNote: 'Fixture note', permissionLinks: [],
};

const requests = [];
const original = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const method = init.method ?? 'GET';
  requests.push({ url, method, body: init.body });
  if (url === '/api/me') return json({ user: { id: 'u1', name: 'Test User', email: 'test@example.com' } });
  if (url === '/api/providers') return json({ providers: [provider] });
  if (url === '/api/forms' && method === 'GET') return json({ requestId: 'req_list1', forms: [record] });
  if (url === '/api/credits') return json({ credits: { plan: 'free', dailyRemaining: 20, monthlyRemaining: 0,
    nextDailyReset: '2026-10-25T00:00:00.000Z', nextMonthlyReset: '2026-11-01T00:00:00.000Z' } });
  if (url === '/api/forms/edit/inspect') return json({ requestId: 'req_inspect1', form: view });
  if (url === '/api/forms/edit/interpret') return json({ requestId: 'req_editplan1', status: 'ready', draft }, 201);
  throw new Error(`unexpected request ${method} ${url}`);
};

const router = createMemoryRouter(routes, { initialEntries: ['/app/forms'] });
const root = createRoot(document.getElementById('root'));
await act(async () => { root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))); });

const page = {
  text: () => document.body.textContent,
  $: selector => document.querySelector(selector),
  $$: selector => [...document.querySelectorAll(selector)],
  button: label => [...document.querySelectorAll('button')].find(button => button.textContent.trim() === label),
  async until(predicate, message) {
    for (let attempt = 0; attempt < 70 && !predicate(); attempt++) await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
    assert.ok(predicate(), `${message}\n--- page ---\n${document.body.textContent}`);
  },
  async fill(selector, value) {
    const field = document.querySelector(selector);
    await act(async () => {
      Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(field, value);
      field.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
    });
  },
  async send(selector) { await act(async () => { document.querySelector(selector).form.requestSubmit(); }); },
};

test('editing is one thread: the form and the plan are artifacts, the composer keeps its place', async () => {
  await page.until(() => page.$('#form-request'), 'the create view renders');
  await act(async () => { page.button('Edit an existing form').click(); });
  await page.until(() => page.$('#edit-form-record'), 'the selection card renders');

  // The page opens as a conversation, not a stepped form.
  assert.match(page.text(), /Keep the form/, 'the empty state still names the action');
  assert.ok(page.$$('.msg-row--intake .msg-intake').some(bubble => /First, the form itself/.test(bubble.textContent)),
    'Intake says what it needs first');
  assert.ok(page.$('.msg-row--wide #edit-form-record'), 'selection lives in the thread as an artifact');
  assert.equal(page.$('.thread-composer'), null, 'there is nothing to type until a form is chosen');

  await act(async () => { page.button('Inspect current form →').click(); });
  await page.until(() => page.$('#edit-request'), 'the change composer appears');

  const composer = page.$('#edit-request').closest('.thread-composer');
  assert.ok(composer, 'the change request is typed into the chat composer');
  assert.match(composer.textContent, /Enter to send/, 'the composer explains its own keys');
  assert.ok(page.$$('.msg-row--wide').some(row => row.textContent.includes('Full name')), 'the current form is an artifact');
  assert.match(page.text(), /Here is the current form, read-only/, 'Intake introduces the artifact before it');

  await page.fill('#edit-request', 'Rename the form.');
  await page.send('#edit-request');
  await page.until(() => page.$('#edit-review-title'), 'the proposal renders as an artifact');

  assert.equal(page.$('#edit-review-title').textContent, 'Rename the form');
  assert.match(page.text(), /Nothing has been sent to Google/, 'the assistant says the boundary out loud');
  assert.deepEqual(JSON.parse(requests.find(request => request.url === '/api/forms/edit/interpret').body).target,
    { kind: 'record', formRecordId: 'form-record-1' }, 'the request still names the original form');
  assert.equal(page.button('Confirm and apply edit →').disabled, true, 'confirmation still needs the checkbox');
  assert.equal(requests.some(request => request.url === '/api/forms/edit/confirm'), false, 'nothing applies itself');

  // Revising uses the same box at the bottom: the conversation continues, the page does not move.
  const revising = page.$('#edit-revision').closest('.thread-composer');
  assert.ok(revising, 'revision happens in the chat composer');
  assert.equal(revising, composer, 'the composer keeps its place in the DOM');
  assert.ok(page.button('Revise proposal →'));

  await act(async () => { root.unmount(); router.dispose(); globalThis.fetch = original; });
});
