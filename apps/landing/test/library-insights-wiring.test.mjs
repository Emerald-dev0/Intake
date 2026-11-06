/**
 * The library's own view of what a connection may read.
 *
 * The insights modal used to be told, in code, that response reading was always allowed — so the
 * permission panel could never appear, and a person without the permission was left with a bare
 * error. The state now comes from the connection the server reported. These tests mount the real
 * library component and check that the state it passes on is the server's, not a constant.
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
const { MemoryRouter } = await import('react-router-dom');
const { FormLibrary } = await import('../src/app/FormLibrary.tsx');

after(() => dom.window.close());

const FORM = {
  id: 'form-1',
  provider: 'google',
  providerFormId: 'google-form-1',
  title: 'Feedback',
  status: 'created',
  failureStage: null,
  editUrl: 'https://docs.google.com/forms/d/google-form-1/edit',
  responderUrl: 'https://docs.google.com/forms/d/e/google-form-1/viewform',
  createdAt: '2026-09-01T10:00:00.000Z',
  description: null,
  source: 'created',
  lastSyncedAt: null,
  archivedAt: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

function provider(overrides = {}) {
  return {
    id: 'google',
    name: 'Google Forms',
    accountName: 'Google',
    description: 'Fixture provider',
    configured: true,
    setupEnv: [],
    status: 'connected',
    accountEmail: 'ada@gmail.com',
    accountLabel: 'Ada',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/forms.body'],
    scopeLabels: ['Sign you in', 'See your email', 'Create and edit your forms'],
    capabilities: [],
    connectedAt: '2026-09-01T10:00:00.000Z',
    canRefresh: true,
    revocation: 'supported',
    formsApi: 'supported',
    formsNote: 'Fixture note',
    permissionLinks: [],
    ...overrides,
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

/** Mount the real library with one Google form and the given connection state. */
async function mountLibrary(connection, insightsResponse, path = '/app/library') {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async input => {
    const target = String(input);
    requests.push(target);
    if (target.startsWith('/api/forms/library')) return json({ forms: [FORM] });
    if (target === '/api/credits') return json({ credits: { plan: 'pro', subscriptionStatus: 'active' } });
    if (target.includes('/insights')) return insightsResponse;
    return json({}, 404);
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(MemoryRouter, { initialEntries: [path] },
    React.createElement(FormLibrary, { providers: { status: 'ready', providers: [connection] }, reloadProviders: () => {} }))));
  for (let i = 0; i < 40 && !container.textContent.includes('View insights'); i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
  }
  return {
    container,
    requests,
    text: () => container.textContent ?? '',
    click: async selector => {
      const button = [...container.querySelectorAll('button')].find(node => node.textContent?.includes(selector));
      assert.ok(button, `a button labelled ${selector} must be on the page`);
      await act(async () => { button.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
      for (let i = 0; i < 40; i++) {
        await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
        if (container.querySelector('.insights-pro-required') || container.querySelector('.insights-footer')) break;
      }
    },
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('a connection without the permission leads to the authorization panel, not a bare error', async t => {
  const view = await mountLibrary(
    provider(),
    json({ error: 'Enable response summaries first.', code: 'responses_scope_required' }, 403),
  );
  t.after(view.restore);

  await view.click('View insights');
  assert.match(view.text(), /Allow response reading/);
  assert.doesNotMatch(view.text(), /responses_scope_required/);
  // The connection already said the permission is missing, so the request that is certain to be
  // refused is not made.
  assert.equal(view.requests.some(target => target.includes('/insights')), false);
});

test('a connection with the permission shows the summaries', async t => {
  const view = await mountLibrary(
    provider({ capabilities: ['responses'] }),
    json({
      status: 'ready',
      formId: 'form-1',
      title: 'Feedback',
      insights: { totalResponses: 2, truncated: false, questions: [{ id: 'q1', title: 'How was it?', kind: 'choice', answered: 2, choices: [{ label: 'Good', count: 2 }] }] },
    }),
  );
  t.after(view.restore);

  await view.click('View insights');
  assert.match(view.text(), /How was it\?/);
  assert.doesNotMatch(view.text(), /Allow response reading/);
});

test('coming back from the consent screen reopens the summary and says what happened', async t => {
  // The grant sends the person back to the form they were looking at. They should land on the
  // summary, and be told plainly that the permission was granted.
  const view = await mountLibrary(
    provider({ capabilities: ['responses'] }),
    json({
      status: 'ready',
      formId: 'form-1',
      title: 'Feedback',
      insights: { totalResponses: 2, truncated: false, questions: [{ id: 'q1', title: 'How was it?', kind: 'choice', answered: 2, choices: [{ label: 'Good', count: 2 }] }] },
    }),
    '/app/library?insights=form-1&grant=responses&result=connected&provider=google',
  );
  t.after(view.restore);

  assert.match(view.text(), /Google now lets Intake read the responses to your forms/);
  assert.match(view.text(), /How was it\?/, 'the summary they came back for is open');
  assert.doesNotMatch(view.text(), /Allow response reading/, 'they are not asked for it again');
});

test('a refused permission says what did not change, and asks for nothing', async t => {
  const view = await mountLibrary(
    provider(),
    json({ error: 'Enable response summaries first.', code: 'responses_scope_required' }, 403),
    '/app/library?insights=form-1&grant=responses&result=denied&provider=google',
  );
  t.after(view.restore);

  assert.match(view.text(), /You did not allow Intake to read form responses/);
  assert.match(view.text(), /the access you already gave Intake is exactly as it was/);
});
