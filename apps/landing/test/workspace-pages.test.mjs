import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The signed-in page system and the home status strip.
 *
 * The rule under test is the one this product keeps breaking when it is not written down: a source
 * that could not be read must never be rendered as a confident zero. Everything else here is
 * furniture — one heading, one empty state, one error state — but that one is honesty.
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
const { PageHeader, EmptyState, ErrorState, Skeleton } = await import('../src/app/components/PagePrimitives.tsx');
after(() => dom.window.close());

const CREDITS = {
  plan: 'free', subscriptionStatus: 'none', availableCredits: 18, dailyCredits: 20,
  dailyRemaining: 18, nextDailyReset: new Date(Date.now() + 5 * 3_600_000).toISOString(),
};

const PROVIDERS = [
  { id: 'google', name: 'Google Forms', status: 'connected', accountName: 'Google account', accountEmail: 'ada@example.com' },
];

const json = body => new Response(JSON.stringify(body), { status: 200, headers: { 'content-type': 'application/json' } });

function outlet(overrides = {}) {
  return {
    user: { id: 'u1', name: 'Ada Lovelace', email: 'ada@example.com' },
    providers: { status: 'ready', providers: PROVIDERS },
    reloadProviders: () => {},
    credits: { status: 'ready', credits: CREDITS, costGuide: null },
    reloadCredits: () => {},
    noteCredits: () => {},
    newChatNonce: 0,
    ...overrides,
  };
}

async function mountHome(t, overrides) {
  const original = globalThis.fetch;
  globalThis.fetch = async path => (String(path).startsWith('/api/forms') ? json({ forms: [] }) : json({}));
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

test('the home status strip reports plan, credits with a reset, and provider count', async t => {
  await mountHome(t);
  const text = statusText();
  assert.match(text, /Plan.*Free/s);
  assert.match(text, /Credits.*18/s);
  assert.match(text, /daily credits reset in 4 hours|daily credits reset in 5 hours/i, 'the reset is stated in plain words, not an ISO timestamp');
  assert.doesNotMatch(text, /\d{4}-\d{2}-\d{2}T/, 'no raw ISO timestamp reaches the screen');
  assert.match(text, /Providers.*1 connected/s);
  assert.match(text, /Next.*Open your library/s);
});

test('an unreadable credit balance is an error with a retry, never a zero', async t => {
  await mountHome(t, { credits: { status: 'error', credits: null, costGuide: null } });
  const text = statusText();
  assert.match(text, /Could not check/i);
  assert.doesNotMatch(text, /\b0\b/, 'no invented zero credits');
  const retry = [...document.querySelectorAll('.home__status button')].find(node => /retry/i.test(node.textContent ?? ''));
  assert.ok(retry, 'the strip offers a way to try again');
});

test('no connected provider produces the one action that unblocks the account', async t => {
  await mountHome(t, { providers: { status: 'ready', providers: [] } });
  const text = statusText();
  assert.match(text, /None connected/);
  assert.match(text, /Next.*Connect a provider/);
});

test('out of credits points at plans instead of the library', async t => {
  await mountHome(t, {
    credits: { status: 'ready', credits: { ...CREDITS, availableCredits: 0, dailyRemaining: 0 }, costGuide: null },
  });
  assert.match(statusText(), /Next.*See plans/);
});

function renderPrimitives(t) {
  function Sample() {
    return React.createElement('div', null,
      React.createElement(PageHeader, { kicker: 'LIBRARY', title: 'Your forms', description: 'Everything you made.', actions: React.createElement('a', { className: 'btn', href: '/app/forms' }, 'New form →') }),
      React.createElement(EmptyState, { title: 'Nothing here yet', detail: 'Make one and it will appear.' }),
      React.createElement(ErrorState, { title: 'Could not load', detail: 'The records are unreachable.', onRetry: () => {} }),
      React.createElement(Skeleton, { label: 'Loading your library', variant: 'card' }),
    );
  }
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); document.getElementById('root').innerHTML = ''; });
  return act(async () => root.render(React.createElement(Sample)));
}

test('the shared primitives are one heading, one empty state, one error state', async t => {
  await renderPrimitives(t);

  const heading = document.querySelector('.ui-head');
  assert.ok(heading);
  assert.equal(heading.querySelector('.ui-kicker').textContent, 'LIBRARY');
  assert.equal(heading.querySelector('h1').textContent, 'Your forms');
  assert.ok(heading.querySelector('.ui-head__actions a'), 'the action sits in the heading row');

  // An empty state is not an alert; an error is. They must not be the same element type.
  assert.equal(document.querySelector('.ui-empty')?.getAttribute('role'), null);
  assert.equal(document.querySelector('.ui-error')?.getAttribute('role'), 'alert');
  assert.match(document.querySelector('.ui-error').textContent, /Could not load/);

  const skeleton = document.querySelector('.ui-skeleton');
  assert.equal(skeleton.getAttribute('role'), 'status');
  assert.equal(skeleton.getAttribute('aria-label'), 'Loading your library', 'one polite announcement, labelled with what is loading');
});
