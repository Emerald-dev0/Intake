/**
 * What a person is shown when they open Response Insights.
 *
 * The insights modal is the only screen in the product that can ask for a permission it does not
 * already have, so it has to be plain about three things: which permission is missing, why it is
 * needed, and what pressing the button will do. It also has to keep quiet when the permission is
 * already there — a person who already allowed response reading must never be asked again.
 *
 * The panel posts to the existing incremental authorization endpoint as a plain form, because the
 * browser has to navigate to Google's consent screen. These tests mount the real component.
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
const { Insights } = await import('../src/app/components/Insights.tsx');

after(() => dom.window.close());

const FORM = {
  id: 'form-1',
  provider: 'google',
  providerFormId: 'google-form-1',
  title: 'Feedback',
  status: 'created',
  failureStage: null,
  editUrl: null,
  responderUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  description: null,
  source: 'created',
  lastSyncedAt: null,
  archivedAt: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

const RETURN_TO = '/app/library?insights=form-1&grant=responses';

const READY = {
  status: 'ready',
  formId: 'form-1',
  title: 'Feedback',
  insights: {
    totalResponses: 2,
    truncated: false,
    questions: [{ id: 'q1', title: 'How was it?', kind: 'choice', answered: 2, choices: [{ label: 'Good', count: 2 }] }],
  },
};

/** Mount the real insights modal against a stubbed server. */
async function mount(props, handler) {
  const original = globalThis.fetch;
  const requests = [];
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    requests.push({ target, init });
    return handler(target, init);
  };
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Insights, {
    form: FORM,
    onClose: () => {},
    isPro: true,
    canReadResponses: null,
    needsReconnect: false,
    returnTo: RETURN_TO,
    ...props,
  })));
  for (let i = 0; i < 40; i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 5)); });
    if (container.querySelector('.insights-footer') || container.querySelector('.insights-pro-required')) break;
  }
  return {
    container,
    requests,
    text: () => container.textContent ?? '',
    formAction: () => container.querySelector('form')?.getAttribute('action') ?? null,
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

test('a person without the permission is told which one is needed, and why', async t => {
  const view = await mount({ canReadResponses: false }, () => json({ error: 'nope' }, 403));
  t.after(view.restore);

  assert.match(view.text(), /read the responses to your forms/i);
  assert.match(view.text(), /separate, optional permission/i);
  assert.match(view.text(), /does not store the answers/i);
  // The button is one explicit action, not a link to somewhere else.
  assert.match(view.text(), /Allow response reading/);
});

test('the permission is asked for through the existing extend endpoint, and returns to where it started', async t => {
  const view = await mount({ canReadResponses: false }, () => json({ error: 'nope' }, 403));
  t.after(view.restore);

  const action = view.formAction();
  assert.ok(action, 'the panel posts a form');
  assert.match(action, /^\/api\/providers\/google\/extend\?/);
  assert.match(action, /capability=responses/);
  assert.match(action, /return_to=%2Fapp%2Flibrary%3Finsights%3Dform-1%26grant%3Dresponses/);
});

test('a person who already has the permission is never asked for it again', async t => {
  const view = await mount({ canReadResponses: true }, () => json(READY));
  t.after(view.restore);

  assert.match(view.text(), /How was it\?/);
  assert.doesNotMatch(view.text(), /Allow response reading/);
  assert.equal(view.formAction(), null, 'no permission form is offered');
});

test('a server that says the permission is missing shows the same panel', async t => {
  // The connection state can be stale, and the server is the authority. When it says the
  // permission is missing, the panel appears — the same one, with the same action.
  const view = await mount({ canReadResponses: true }, () => json({ error: 'Enable response summaries first.', code: 'responses_scope_required' }, 403));
  t.after(view.restore);

  assert.match(view.text(), /Allow response reading/);
  assert.doesNotMatch(view.text(), /responses_scope_required/, 'the raw error code is never shown to a person');
});

test('a connection that has to be made again offers the reconnect action instead', async t => {
  const view = await mount({ needsReconnect: true }, () => json({ error: 'Reconnect Google Forms first.', code: 'reauthorization_required' }, 403));
  t.after(view.restore);

  assert.match(view.text(), /Connect Google Forms/);
  assert.match(view.formAction() ?? '', /\/api\/providers\/google\/connect\?/);
  assert.doesNotMatch(view.text(), /reauthorization_required/);
});

test('a person who is not on Pro is offered the plan, not a permission', async t => {
  const view = await mount({ isPro: false, canReadResponses: false }, () => json({ error: 'nope' }, 403));
  t.after(view.restore);

  assert.match(view.text(), /Response insights are a Pro feature/);
  assert.match(view.text(), /View Plans/);
  assert.doesNotMatch(view.text(), /Allow response reading/);
});
