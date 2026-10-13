import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/admin/waitlist', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { default: AdminWaitlistPage } = await import('../src/admin/AdminWaitlistPage.tsx');
after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { 'Content-Type': 'application/json' },
});
const data = (total, page = 1) => ({
  items: [{
    id: `entry-${page}`, email: `subscriber${page}@example.com`, createdAt: '2026-10-13T12:00:00Z',
    welcomeStatus: 'accepted', welcomeAttempts: 1, welcomeAcceptedAt: '2026-10-13T12:00:01Z', welcomeErrorCode: null,
  }], total, page, pageSize: 25, totalPages: Math.ceil(total / 25),
});

async function view(t, handler) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (path, init) => { calls.push({ path, init }); return handler(path); };
  const root = createRoot(document.getElementById('root'));
  t.after(async () => { await act(async () => root.unmount()); globalThis.fetch = original; });
  await act(async () => root.render(React.createElement(AdminWaitlistPage)));
  return { calls, button: label => [...document.querySelectorAll('button')].find(button => button.textContent === label) };
}

test('admin shows the all-pages subscriber total, and refresh and pagination fetch current counts', async t => {
  let total = 51;
  const page = await view(t, path => json(data(total, path.includes('page=2') ? 2 : 1)));
  assert.equal(document.querySelector('h2').textContent, 'Total subscribers: 51');
  assert.equal(document.querySelectorAll('tbody tr').length, 1, 'the total is not the current page length');
  assert.match(document.body.textContent, /Unique email addresses across all pages/);
  assert.equal(page.calls[0].path, '/api/admin/waitlist?page=1&limit=25');
  assert.equal(page.calls[0].init.credentials, 'same-origin');
  assert.equal(page.calls[0].init.cache, 'no-store');
  await act(async () => page.button('Next').click());
  assert.equal(page.calls.at(-1).path, '/api/admin/waitlist?page=2&limit=25');
  assert.equal(document.querySelector('h2').textContent, 'Total subscribers: 51');
  assert.match(document.body.textContent, /subscriber2@example.com/);
  total = 52;
  await act(async () => page.button('Refresh').click());
  assert.equal(document.querySelector('h2').textContent, 'Total subscribers: 52');
});

test('unavailable wait-list storage is shown as an error, never a fabricated zero count', async t => {
  await view(t, () => json({ error: 'Wait-list storage is temporarily unavailable.' }, 503));
  assert.match(document.querySelector('[role="alert"]').textContent, /Wait-list unavailable/);
  assert.equal(document.querySelector('h2'), null);
  assert.doesNotMatch(document.body.textContent, /Total subscribers: 0|No subscribers/);
});
