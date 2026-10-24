import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The home surface: one status strip and, for a new account, three steps that tick from server
 * state.
 *
 * The rule under test is the one this product keeps breaking when it is not written down: a source
 * that could not be read must never be rendered as a confident zero, and "could not check" is not
 * the same claim as "you have not done this".
 */

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/app', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { MemoryRouter, Routes, Route, Outlet } = await import('react-router-dom');
const { OverviewPage } = await import('../src/app/pages/OverviewPage.tsx');
after(() => dom.window.close());

const CREDITS = {
  plan: 'free', subscriptionStatus: 'none', availableCredits: 18, dailyCredits: 20,
  dailyRemaining: 18, nextDailyReset: new Date(Date.now() + 5 * 3_600_000).toISOString(),
};

const CONNECTED = [
  { id: 'google', name: 'Google Forms', status: 'connected', accountName: 'Google account', accountEmail: 'ada@example.com' },
];

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function outlet(overrides = {}) {
  return {
    user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
    providers: { status: 'ready', providers: CONNECTED },
    reloadProviders: () => {},
    credits: { status: 'ready', credits: CREDITS, costGuide: null },
    reloadCredits: () => {},
    noteCredits: () => {},
    newChatNonce: 0,
    ...overrides,
  };
}

async function mountHome(t, overrides = {}, formsBody = { forms: [] }) {
  const original = globalThis.fetch;
  globalThis.fetch = async path => (String(path).startsWith('/api/forms') ? json(formsBody) : json({}));
  function Shell() {
    return React.createElement(Outlet, { context: outlet(overrides) });
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); globalThis.fetch = original; document.getElementById('root').innerHTML = ''; });
  await act(async () => root.render(
    React.createElement(MemoryRouter, { initialEntries: ['/app'] },
      React.createElement(Routes, null,
        React.createElement(Route, { element: React.createElement(Shell) },
          React.createElement(Route, { path: '/app', element: React.createElement(OverviewPage) })),
      ),
    ),
  ));
  return root;
}

const statusText = () => document.querySelector('.home__status')?.textContent ?? '';
const steps = () => [...document.querySelectorAll('.home__first-run li')];

test('the status strip states plan, credits with a reset, providers, and the one next action', async t => {
  await mountHome(t);
  const text = statusText();
  assert.match(text, /Plan.*Free/s);
  assert.match(text, /Credits.*18/s);
  assert.match(text, /daily credits reset in 4 hours|daily credits reset in 5 hours/i, 'the reset is in plain words');
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/, 'no raw ISO timestamp reaches the screen');
  assert.match(text, /Providers.*1 connected/s);
  assert.match(text, /Next.*Open your library/s);
});

test('a provider is connected but nothing is made yet: exactly one step is ticked', async t => {
  await mountHome(t);
  const panel = document.querySelector('.home__first-run');
  assert.ok(panel, 'a new account sees the getting-started panel');
  assert.equal(panel.querySelector('header > span').textContent, '1 of 3');
  assert.deepEqual(steps().map(step => step.className), ['is-done', 'is-todo', 'is-todo']);
});

test('unreadable credits are an error with a retry, and an empty provider list is a fact', async t => {
  await mountHome(t, {
    credits: { status: 'error', credits: null, costGuide: null },
    providers: { status: 'ready', providers: [] },
  });
  const text = statusText();
  assert.match(text, /Could not check/i, 'credits are "could not check", not 0');
  assert.doesNotMatch(text, /0 credits|0 of 0/, 'no invented zero anywhere in the strip');
  assert.ok([...document.querySelectorAll('.home__status button')].some(node => /retry/i.test(node.textContent ?? '')), 'the strip offers a retry');
  assert.match(text, /None connected/, 'a list that loaded and is empty is a fact');
  assert.match(text, /Next.*Connect a provider/s, 'the one action that unblocks the account');
});

test('a step whose source failed is unknown, never "not done"', async t => {
  await mountHome(t, { providers: { status: 'error' } });
  assert.equal(steps()[0].className, 'is-unknown');
  assert.match(steps()[0].textContent, /Could not check/i);
});

test('with a live form and no credits left, the panel is gone and the next action is plans', async t => {
  await mountHome(
    t,
    { credits: { status: 'ready', credits: { ...CREDITS, availableCredits: 0, dailyRemaining: 0 }, costGuide: null } },
    { forms: [{
      id: 'f1', provider: 'google', providerFormId: 'pf1', title: 'Workshop RSVP', status: 'created',
      failureStage: null, editUrl: null, responderUrl: null, createdAt: '2026-10-01T00:00:00.000Z',
    }] },
  );
  assert.match(statusText(), /Next.*See plans/s);
  assert.equal(document.querySelector('.home__first-run'), null, 'nothing left to do, so nothing to say');
});
