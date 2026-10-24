import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The chat shell, rendered through the real router.
 *
 * `forms-page.test.mjs` covers the workflow in depth but mounts the whole workspace twenty times,
 * which is what pushes this sandbox out of memory. This file mounts twice and only asserts what the
 * conversation looks like — the parts a person reads: the assistant's own sentence, the question it
 * asks, and the composer they answer in.
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
const { EXAMPLE_SPECIFICATION } = await import('../src/lib/forms.ts');
const { parseFormSpecification } = await import('../server/forms/validation.ts');

const SPEC = parseFormSpecification(EXAMPLE_SPECIFICATION).specification;
const ID = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
const draft = () => ({
  id: ID, provider: 'google', version: 1, status: 'ready', specification: SPEC,
  assumptions: ['Phone number is optional.'], warnings: [], result: null,
  createdAt: '2026-10-24T09:00:00.000Z', updatedAt: '2026-10-24T09:00:00.000Z',
});
const provider = (id) => ({
  id, name: id === 'google' ? 'Google Forms' : id === 'typeform' ? 'Typeform' : 'Microsoft Forms',
  accountName: id === 'typeform' ? 'Typeform' : 'Google account', description: 'Fixture provider',
  configured: true, setupEnv: ['FIXTURE_CLIENT_ID'], status: 'connected', accountEmail: 'ada@example.test',
  accountLabel: null, scopes: [], scopeLabels: [], connectedAt: null, canRefresh: true, revocation: 'supported',
  formsApi: id === 'microsoft' ? 'unsupported' : 'supported', formsNote: 'Fixture note', permissionLinks: [],
});

async function mount(handlers = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    const method = init.method ?? 'GET';
    const custom = handlers[`${method} ${url}`];
    if (custom) return custom(init);
    if (url === '/api/me') return json({ user: { id: 'u1', name: 'Test User', email: 'test@example.com' } });
    if (url === '/api/providers') return json({ providers: [provider('google'), provider('microsoft'), provider('typeform')] });
    if (url === '/api/forms' && method === 'GET') return json({ requestId: 'req_list1', forms: [] });
    if (url === '/api/credits') return json({ credits: { plan: 'free', dailyRemaining: 20, monthlyRemaining: 0,
      nextDailyReset: '2026-10-25T00:00:00.000Z', nextMonthlyReset: '2026-11-01T00:00:00.000Z' } });
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
    async type(value) {
      const element = document.querySelector('#form-request');
      await act(async () => {
        Object.getOwnPropertyDescriptor(dom.window.HTMLTextAreaElement.prototype, 'value').set.call(element, value);
        element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
      });
    },
    async send() { await act(async () => { document.querySelector('#form-request').form.requestSubmit(); }); },
    async unmount() { await act(async () => root.unmount()); router.dispose(); globalThis.fetch = original; },
  };
  await page.until(() => page.$('#form-request'), 'composer rendered');
  return page;
}

test('the empty workspace offers starters, a named conversation, and a composer that explains itself', async () => {
  const page = await mount();
  try {
    assert.match(page.text(), /Describe it/, 'the landing state names the action');
    assert.ok(document.querySelector('.sidebar-new').textContent.includes('New chat'), 'a new conversation is one click away');
    const starters = page.$$('.composer-starter');
    assert.equal(starters.length, 3, 'three real requests instead of an empty box');
    assert.match(starters[0].textContent, /RSVP/);
    assert.match(document.querySelector('.composer-shortcut').textContent, /Enter to send/);
    assert.match(document.querySelector('.composer-shortcut').textContent, /Shift \+ Enter/);
    // One greeting bubble from Intake, addressed as a person, not a system notice.
    const greeting = document.querySelector('.msg-row--intake .msg-intake');
    assert.ok(greeting, 'Intake opens the conversation');
    assert.match(greeting.textContent, /^Hi/);

    // A starter fills the composer, ready to edit, and does not send on click.
    await act(async () => { starters[1].click(); });
    assert.match(document.querySelector('#form-request').value, /Customer feedback survey/);
    assert.equal(document.querySelector('.msg-row--user'), null, 'choosing a starter does not send it');
  } finally { await page.unmount(); }
});

test('what the model says appears as its own message, above the artifact it describes', async () => {
  const page = await mount({
    'POST /api/forms/interpret': () => json({
      requestId: 'req_1', status: 'ready',
      reply: 'Five questions, all required. I left phone numbers unvalidated because Google Forms cannot check them.',
      draft: draft(),
    }, 201),
  });
  try {
    await page.type('Registration form with name, email and phone');
    await page.send();
    await page.until(() => page.$('#review-title'), 'the proposal renders');

    const bubbles = page.$$('.msg-row--intake .msg-intake');
    const spoken = bubbles.find(bubble => bubble.textContent.includes('Five questions, all required'));
    assert.ok(spoken, 'the model sentence is rendered as a chat bubble');
    assert.equal(spoken.className.includes('msg-wide'), false, 'words stay a message, not a full-width card');
    assert.ok(document.querySelector('.msg-avatar--intake'), 'the assistant has a face');

    // The person's own turn is on the right, with their words intact.
    const mine = document.querySelector('.msg-row--user .msg-user');
    assert.match(mine.textContent, /Registration form with name/);
    assert.ok(document.querySelector('.msg-avatar--you'));

    // Order matters: the message comes before the proposal card, the way a person would explain it.
    const rows = [...document.querySelectorAll('.msg-row')];
    const spokenIndex = rows.findIndex(row => row.textContent.includes('Five questions, all required'));
    const reviewIndex = rows.findIndex(row => row.querySelector('#review-title'));
    assert.ok(spokenIndex >= 0 && reviewIndex > spokenIndex, 'the sentence introduces the proposal');
  } finally { await page.unmount(); }
});

test('a clarifying question reads as one question, with Intake explaining why first', async () => {
  const page = await mount({
    'POST /api/forms/interpret': () => json({
      requestId: 'req_2', status: 'needs_clarification',
      reply: 'Happy to build that. I need one thing first.',
      question: 'Which departments should appear in the list?',
    }),
  });
  try {
    await page.type('A department sign-up form');
    await page.send();
    await page.until(() => page.$('.msg-question'), 'the question renders in the thread');

    const ask = page.$$('.msg-row--intake .msg-intake').find(bubble => bubble.textContent.includes('I need one thing first'));
    assert.ok(ask, 'the explanation is its own message, not folded into the question');
    assert.match(page.$('.msg-question').textContent, /Which departments should appear/);
    // The composer switches to answering mode instead of starting over.
    assert.match(document.querySelector('#form-request').placeholder, /Answer/);
    assert.match(page.text(), /Continue →/);
  } finally { await page.unmount(); }
});
