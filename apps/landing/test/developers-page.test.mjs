import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/developers', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { DevelopersPage } = await import('../src/marketing/DevelopersPage.tsx');
const { SITE_URL } = await import('../src/content/site.ts');

after(() => dom.window.close());

async function mount({ path = '/developers' } = {}) {
  const original = globalThis.fetch;
  globalThis.fetch = async input => {
    if (String(input).startsWith('/api/analytics')) return new Response('', { status: 204 });
    return new Response('{}', { status: 200, headers: { 'Content-Type': 'application/json' } });
  };
  const router = createMemoryRouter([{ path: '/developers', element: React.createElement(DevelopersPage) }], { initialEntries: [path] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(RouterProvider, { router })));
  return {
    container,
    text: () => container.textContent ?? '',
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('the developers page says what exists, what is being built, and what is not promised', async t => {
  const view = await mount();
  t.after(view.restore);

  const statuses = [...view.container.querySelectorAll('.mk-dev__status')];
  assert.ok(statuses.length >= 8, 'every capability carries a status');
  const labels = statuses.map(node => node.textContent);
  assert.ok(labels.includes('Building'), 'the capabilities being built are marked as such');
  assert.ok(labels.includes('Not promised'), 'the things nobody should plan around are marked as such');

  // The board is pinned exactly. A capability moves to "Shipping" when it works, and the badge is
  // the promise — so the list of what claims to work is a test, not a promise in a comment.
  const shipping = [...view.container.querySelectorAll('.mk-dev__capabilities li')]
    .filter(node => node.querySelector('.mk-dev__status--shipping'))
    .map(node => node.querySelector('h3')?.textContent);
  assert.deepEqual(shipping, [
    'Projects, forms and versions',
    'A hosted form page and an embed snippet',
    'The field types developers actually use',
    'Submissions validated on the server',
    'A response inbox with search, filters and CSV export',
    'Pause, close and reopen without a redeploy',
    'AI summaries on the credits you already have',
    'Per-project usage you can look at',
    'Answer notices on your terms',
  ]);

  // And the things that do not exist are still named as things that do not exist.
  const notPromised = [...view.container.querySelectorAll('.mk-dev__capabilities li')]
    .filter(node => node.querySelector('.mk-dev__status--not-promised'))
    .map(node => node.querySelector('h3')?.textContent);
  assert.deepEqual(notPromised, ['Webhooks to your own backend', 'A JavaScript SDK and API keys']);

  // The page is honest about the two things developers ask about first.
  assert.match(view.text(), /cannot read your page/);
  assert.match(view.text(), /not available yet/);
});

test('the developers page carries its own metadata', async t => {
  const view = await mount();
  t.after(view.restore);

  assert.match(document.title, /Developers/);
  const canonical = document.head.querySelector('link[rel="canonical"]');
  assert.equal(canonical?.getAttribute('href'), `${SITE_URL}/developers`);
  const meta = name => document.head.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content');
  assert.equal(meta('og:url'), `${SITE_URL}/developers`);
  assert.ok(meta('description')?.length > 60, 'the description says something');
});

test('the developer page carries structured data that matches the questions it shows', async t => {
  const view = await mount();
  t.after(view.restore);

  const script = document.head.querySelector('script[type="application/ld+json"]');
  assert.ok(script, 'the page carries structured data');
  const parsed = JSON.parse(script.textContent);
  assert.equal(parsed['@type'], 'FAQPage');
  const questions = parsed.mainEntity.map(entry => entry.name);
  const shown = [...view.container.querySelectorAll('.mk-faq-item h3 button span:first-child')].map(node => node.textContent);
  assert.deepEqual(questions, shown, 'the structured data is the same questions the page shows');
});

test('the developer questions open and close', async t => {
  const view = await mount();
  t.after(view.restore);

  const buttons = [...view.container.querySelectorAll('.mk-faq-item button')];
  assert.ok(buttons.length >= 5, 'the questions are there');
  const first = buttons[0];
  assert.equal(first.getAttribute('aria-expanded'), 'true', 'the first question is open');

  const second = buttons[1];
  await act(async () => { second.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(second.getAttribute('aria-expanded'), 'true', 'the clicked question opens');
  assert.equal(first.getAttribute('aria-expanded'), 'false', 'the other one closes');
});

test('the call to action offers a real way in', async t => {
  const view = await mount();
  t.after(view.restore);

  // Signed out, the page offers the updates list — a real, working subscription — rather than a
  // button that goes nowhere.
  const form = view.container.querySelector('#dev-notify');
  assert.ok(form, 'the notification form is there');
  assert.ok(view.text(), 'the page explains what happens next');
});
