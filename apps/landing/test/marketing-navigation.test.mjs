import { test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import React, { Suspense, act } from 'react';
import { createRoot } from 'react-dom/client';
import { createMemoryRouter, RouterProvider } from 'react-router-dom';
import { routes } from '../src/app/routes.tsx';

/**
 * The navigation.
 *
 * The changelog is its own page, with a permanent page per release, so it belongs in the bar
 * beside the other pages — and not only in the footer, where nobody looks.
 */

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

async function renderHome() {
  const original = globalThis.fetch;
  globalThis.fetch = async () => new Response(JSON.stringify({ error: 'not_authenticated' }), { status: 401 });
  const container = document.getElementById('root');
  const root = createRoot(container);
  await act(async () => {
    root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router: createMemoryRouter(routes, { initialEntries: ['/'] }) })));
  });
  assert.ok(await waitFor('.mk-nav-links'), 'the navigation rendered');
  return {
    container,
    teardown: async () => { await act(async () => { root.unmount(); }); globalThis.fetch = original; },
  };
}

test('the navigation links to the changelog and to the developers page', async t => {
  const view = await renderHome();
  t.after(view.teardown);

  const links = [...view.container.querySelectorAll('.mk-nav-links a')].map(node => node.getAttribute('href'));
  assert.ok(links.includes('/changelog'), 'the changelog is in the bar, not only in the footer');
  assert.ok(links.includes('/developers'), 'and so is the developer page');
});

test('the mobile menu carries the same pages', async t => {
  const view = await renderHome();
  t.after(view.teardown);

  const links = [...view.container.querySelectorAll('.mk-sheet__panel a')].map(node => node.getAttribute('href'));
  assert.ok(links.includes('/changelog'), 'the phone menu has the changelog too');
  assert.ok(links.includes('/developers'), 'and the developer page');
});

test('the footer still carries both pages', async t => {
  const view = await renderHome();
  t.after(view.teardown);

  const links = [...view.container.querySelectorAll('.mk-footer a')].map(node => node.getAttribute('href'));
  assert.ok(links.includes('/changelog'));
  assert.ok(links.includes('/developers'));
});
