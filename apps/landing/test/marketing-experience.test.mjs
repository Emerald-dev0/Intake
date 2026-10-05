import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../src/app/routes.tsx';

// `pretendToBeVisual` gives jsdom a requestAnimationFrame, which the reveal and progress effects use.
const dom = new JSDOM('<div id="root"></div>', { url: 'http://localhost', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

async function waitFor(selector, attempts = 200) {
  for (let attempt = 0; attempt < attempts && !document.querySelector(selector); attempt += 1) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 20)); });
  }
  return document.querySelector(selector);
}

/**
 * Renders the public homepage and leaves it mounted so tests can interact with real nodes. The
 * returned teardown must run at the end of the test: React removes the tree from its container on
 * unmount, which would make later DOM queries look empty.
 */
async function renderHome(t) {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401 });
  const container = document.getElementById('root');
  const root = createRoot(container);
  let tornDown = false;
  const teardown = async () => {
    if (tornDown) return;
    tornDown = true;
    await act(async () => { root.unmount(); });
    globalThis.fetch = original;
  };
  t.after(teardown);
  await act(async () => {
    root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router: createMemoryRouter(routes, { initialEntries: ['/'] }) })));
  });
  assert.ok(await waitFor('.mk-faq-item'), 'the marketing homepage rendered');
  return { teardown, html: () => container.innerHTML, text: () => container.textContent ?? '' };
}

test('FAQ items are collapsed accordions that open and close one at a time', async (t) => {
  await renderHome(t);
  const items = [...document.querySelectorAll('.mk-faq-item')];
  assert.ok(items.length >= 6, `expected a real FAQ list, found ${items.length} items`);

  for (const item of items) {
    const button = item.querySelector('h3 > button');
    assert.ok(button, 'each question is a real button, not a heading alone');
    assert.equal(button.getAttribute('aria-expanded'), 'false', 'questions start closed');
    const panelId = button.getAttribute('aria-controls');
    const panel = document.getElementById(panelId);
    assert.ok(panel, 'aria-controls points at the answer panel');
    assert.equal(panel.getAttribute('role'), 'region');
    assert.equal(panel.getAttribute('aria-labelledby'), button.id);
    assert.ok(panel.hasAttribute('inert'), 'a closed answer is inert, so it cannot be read or focused');
    assert.ok(panel.textContent.trim().length > 0, 'the answer is in the DOM before it is animated open');
  }

  const first = items[0];
  const firstButton = first.querySelector('h3 > button');
  const firstPanel = document.getElementById(firstButton.getAttribute('aria-controls'));

  await act(async () => { firstButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(firstButton.getAttribute('aria-expanded'), 'true', 'clicking opens the answer');
  assert.equal(firstPanel.hasAttribute('inert'), false, 'an open answer is reachable again');
  assert.match(firstPanel.className, /mk-faq-item__panel/);

  await act(async () => { firstButton.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(firstButton.getAttribute('aria-expanded'), 'false', 'clicking again closes it');
  assert.ok(firstPanel.hasAttribute('inert'));
});

test('the homepage footer credits Emerald without a personal name, and keeps the column layout', async (t) => {
  await renderHome(t);
  const footer = document.querySelector('.mk-footer');
  assert.ok(footer, 'the public footer renders');
  const columns = [...footer.querySelectorAll('.mk-footer__column h2')].map(heading => heading.textContent);
  assert.deepEqual(columns, ['Product', 'Project', 'Google Forms'], 'footer keeps its three link columns');

  const credit = footer.querySelector('.mk-footer__credit');
  assert.ok(credit, 'the footer has a credit line');
  assert.match(credit.textContent ?? '', /^Designed by Emerald$/);
  assert.equal(credit.querySelector('a')?.getAttribute('href'), 'https://github.com/Emerald-dev0');
  assert.doesNotMatch(footer.textContent ?? '', /Oluwadare/, 'no personal name in the footer');
  assert.match(footer.textContent ?? '', /© \d{4} Intake/);
});

test('the homepage ships motion primitives, a menu sheet and no unfinished-work wording', async (t) => {
  const home = await renderHome(t);
  const text = home.text();

  // Scroll reveals and the animated example strip exist in the markup.
  assert.ok(document.querySelectorAll('.mk-reveal').length >= 10, 'sections animate in as they are reached');
  assert.ok(document.querySelector('.mk-marquee__track'), 'the example strip is rendered');
  assert.ok(document.querySelectorAll('.mk-marquee__row').length === 2, 'the strip duplicates its row for a seamless loop');

  // The mobile navigation is a real overlay with a labelled toggle.
  const toggle = document.querySelector('.mk-menu-toggle');
  assert.ok(toggle, 'small screens get a menu toggle');
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');
  const sheet = document.getElementById(toggle.getAttribute('aria-controls'));
  assert.ok(sheet?.className.includes('mk-sheet'));
  await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  assert.ok(sheet.className.includes('is-open'));
  await act(async () => { toggle.dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(toggle.getAttribute('aria-expanded'), 'false');

  // The product preview switches between creation and editing.
  const switches = [...document.querySelectorAll('.mk-preview-switch button')];
  assert.equal(switches.length, 2);
  assert.equal(switches[0].getAttribute('aria-pressed'), 'true');
  await act(async () => { switches[1].dispatchEvent(new dom.window.MouseEvent('click', { bubbles: true })); });
  assert.equal(document.querySelectorAll('.mk-preview-switch button')[1].getAttribute('aria-pressed'), 'true');

  for (const phrase of [/not available yet/i, /coming soon/i, /not implemented/i, /display-only/i, /AI-powered/i, /AI credits/i, /illustrative/i]) {
    assert.doesNotMatch(text, phrase, `the rendered homepage must not say: ${phrase}`);
  }
});
