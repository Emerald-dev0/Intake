import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/admin/mail', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: AdminMailPage } = await import('../src/admin/AdminMailPage.tsx');
after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});

const PEOPLE = [
  { id: 'user_001', name: 'Ada Lovelace', email: 'ada@example.com', verified: true, createdAt: '2026-01-02T00:00:00Z' },
  { id: 'user_002', name: 'Grace Hopper', email: 'grace@example.com', verified: false, createdAt: '2026-01-03T00:00:00Z' },
];

const LIST = {
  items: PEOPLE, page: 1, pageSize: 25, total: 2, totalPages: 1, cap: 100,
  segments: { all: 'every account', verified: 'accounts with a verified address', unverified: 'accounts whose address is not verified yet' },
};

const PREVIEW = {
  previewId: '11111111-2222-3333-4444-555555555555',
  subject: 'A small change to your Intake account',
  html: '<!doctype html><html><body><p>Hi Ada,</p><p>Body copy.</p></body></html>',
  text: 'Hi Ada,\n\nBody copy.',
  sample: { name: 'Ada', email: 'a***@example.com' },
  recipients: { total: 1, cap: 100, overCap: false, segmentLabel: '1 chosen account' },
  ready: true,
  tokens: ['name'],
  draft: { subject: 'A small change to your Intake account', heading: '', body: 'Body copy.', buttonLabel: '', buttonUrl: '' },
};

function button(label) {
  return [...document.querySelectorAll('button')].find(node => (node.textContent ?? '').startsWith(label));
}

function field(label) {
  const groups = [...document.querySelectorAll('.admin-field')];
  const group = groups.find(node => (node.querySelector('span')?.textContent ?? '').startsWith(label));
  return group?.querySelector('input, textarea') ?? null;
}

async function setValue(element, value) {
  const prototype = element.tagName === 'TEXTAREA' ? dom.window.HTMLTextAreaElement.prototype : dom.window.HTMLInputElement.prototype;
  await act(async () => {
    Object.getOwnPropertyDescriptor(prototype, 'value').set.call(element, value);
    element.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });
}

async function view(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, init) => {
    calls.push({ path, init });
    return handler(path, init);
  };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); globalThis.fetch = original; document.getElementById('root').innerHTML = ''; });
  await act(async () => root.render(React.createElement(AdminMailPage)));
  return { calls };
}

test('the compose screen loads real accounts and sends only what was previewed', async t => {
  const { calls } = await view(t, (path, init) => {
    if (path.startsWith('/api/admin/mail/recipients')) return json(LIST);
    if (path === '/api/admin/mail/sends') return json({ items: [], ready: true });
    if (path === '/api/admin/mail/preview') return json(PREVIEW);
    if (path === '/api/admin/mail/send') {
      return json({
        sendId: PREVIEW.previewId, total: 1, sent: 1, skipped: 0, failed: 0,
        results: [{ userId: 'user_001', name: 'Ada Lovelace', email: 'a***@example.com', status: 'sent', errorCode: null }],
      });
    }
    throw new Error(`unexpected ${path} ${init?.method ?? 'GET'}`);
  });

  assert.equal(calls[0].path, '/api/admin/mail/recipients?page=1&limit=25');
  assert.match(document.body.textContent, /ada@example\.com/);

  // Nothing can be previewed with an empty selection.
  assert.equal(button('Preview the email').disabled, true);

  await act(async () => document.querySelectorAll('.admin-mail-people input[type="checkbox"]')[0].click());
  assert.match(document.querySelector('.admin-heading-action').textContent, /1 selected/);

  await setValue(field('Subject'), 'A small change to your Intake account');
  await setValue(field('Message'), 'Body copy.');

  await act(async () => button('Preview the email').click());
  const previewCall = calls.find(call => call.path === '/api/admin/mail/preview');
  assert.equal(previewCall.init.method, 'POST');
  const previewBody = JSON.parse(previewCall.init.body);
  assert.deepEqual(previewBody.selection, { kind: 'ids', ids: ['user_001'] });
  assert.equal(previewBody.draft.subject, 'A small change to your Intake account');

  const frame = document.querySelector('iframe.admin-mail-preview');
  assert.ok(frame, 'the rendered email is shown as an iframe, not injected into the dashboard');
  assert.equal(frame.getAttribute('sandbox'), '', 'the preview may not run scripts or reach the dashboard origin');
  assert.match(frame.getAttribute('srcdoc'), /Hi Ada/);
  assert.match(document.body.textContent, /Rendered by the server from the same template/);

  const send = button('Send 1 message');
  assert.equal(send.disabled, true, 'sending requires an explicit acknowledgement first');
  await act(async () => document.querySelector('.admin-mail-ack input[type="checkbox"]').click());
  assert.equal(button('Send 1 message').disabled, false);

  await act(async () => button('Send 1 message').click());
  const sendCall = calls.find(call => call.path === '/api/admin/mail/send');
  const sendBody = JSON.parse(sendCall.init.body);
  assert.equal(sendBody.previewId, PREVIEW.previewId, 'the send is tied to the preview the admin read');
  assert.equal(sendBody.confirmedRecipients, 1);
  assert.deepEqual(sendBody.selection, { kind: 'ids', ids: ['user_001'] });

  assert.match(document.querySelector('[role="status"]').textContent, /1 of 1 messages accepted/);
  assert.match(document.body.textContent, /sending\.|Each accepted message is its own delivery record/);
});

test('editing after a preview invalidates it, and a refused send says nothing went out', async t => {
  let previewCount = 0;
  const { calls } = await view(t, (path, init) => {
    if (path.startsWith('/api/admin/mail/recipients')) return json(LIST);
    if (path === '/api/admin/mail/sends') return json({ items: [], ready: true });
    if (path === '/api/admin/mail/preview') { previewCount += 1; return json({ ...PREVIEW, previewId: `preview-${previewCount}` }); }
    if (path === '/api/admin/mail/send') {
      return json({ error: 'recipient_count_changed', message: 'The number of recipients changed. Preview again before sending.' }, 409);
    }
    throw new Error(`unexpected ${path} ${init?.method ?? 'GET'}`);
  });

  await act(async () => document.querySelectorAll('.admin-mail-people input[type="checkbox"]')[0].click());
  await setValue(field('Subject'), 'Hello');
  await setValue(field('Message'), 'Hi {{name}}');
  await act(async () => button('Preview the email').click());
  assert.ok(document.querySelector('iframe.admin-mail-preview'));

  // Changing the copy after previewing means the approved bytes are stale: the send stays on screen
  // but refuses to fire until the admin looks at the new version.
  await setValue(field('Message'), 'Hi {{name}}, changed my mind');
  assert.equal(button('Send 1 message').disabled, true);
  assert.match(document.body.textContent, /changed since this preview/);

  await act(async () => button('Preview the email').click());
  await act(async () => document.querySelector('.admin-mail-ack input[type="checkbox"]').click());
  await act(async () => button('Send 1 message').click());

  const alert = document.querySelector('[role="alert"]');
  assert.match(alert.textContent, /Nothing was sent/);
  assert.match(alert.textContent, /number of recipients changed/i);
  assert.equal(document.querySelector('iframe.admin-mail-preview'), null, 'the stale preview is withdrawn, not left up');
  assert.ok(calls.filter(call => call.path === '/api/admin/mail/send').length === 1);
});

test('an unreachable mail stack is reported instead of showing an empty directory', async t => {
  await view(t, path => (path === '/api/admin/mail/sends'
    ? json({ error: 'mail_unavailable', message: 'Composed mail is not configured on this server.' }, 503)
    : json({ error: 'mail_unavailable', message: 'Composed mail is not configured on this server.' }, 503)));

  assert.match(document.querySelector('[role="alert"]').textContent, /Accounts unavailable/);
  assert.match(document.body.textContent, /not configured on this server/);
  assert.doesNotMatch(document.body.textContent, /No accounts match/);
});
