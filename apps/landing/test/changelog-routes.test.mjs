import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';

/**
 * The changelog at the address a release document is served from.
 *
 * Every release is written out as a document of its own, so a crawler and a link preview can read
 * it without running the site. That document is stored at an address ending in `index.html`, and
 * a host may serve it from there. A reader who arrived at that address used to be told the page
 * did not exist — on the page they were trying to read.
 *
 * These tests mount the real route table, not a copy of it, so a route that is removed from the
 * application fails here.
 */

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/changelog', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act, Suspense } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { routes } = await import('../src/app/routes.tsx');

after(() => dom.window.close());

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const LIVE_RELEASE = {
  slug: 'a-live-release',
  title: 'A live release',
  summary: 'Something that shipped yesterday.',
  body: '## What changed\nA live release exists.',
  categories: ['feature'],
  releaseDate: '2026-10-28',
  publishedAt: '2026-10-28T09:00:00.000Z',
  links: [{ label: 'Changelog', url: '/changelog' }],
  heroImageUrl: null,
};

/**
 * Mount the real application routes at one address.
 *
 * The pages are loaded lazily, so the render suspends and settles over a few turns; the harness
 * waits for the text it expects rather than assuming it is there on the first pass.
 */
async function mount({ path, handler, expect }) {
  const original = globalThis.fetch;
  globalThis.fetch = async (input, init) => {
    const target = String(input);
    if (target.startsWith('/api/analytics')) return new Response('', { status: 204 });
    return handler(target, init);
  };
  const router = createMemoryRouter(routes, { initialEntries: [path] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(Suspense, { fallback: 'Loading' }, React.createElement(RouterProvider, { router }))));
  for (let i = 0; i < 40 && !container.textContent.includes(expect); i++) {
    await act(async () => { await new Promise(resolve => setTimeout(resolve, 10)); });
  }
  return {
    router,
    container,
    text: () => container.textContent ?? '',
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('a release opens at the address its document is served from', async t => {
  const view = await mount({
    path: '/changelog/a-live-release/index.html',
    expect: 'A live release',
    handler: target => {
      if (target === '/api/releases/a-live-release') return json({ release: LIVE_RELEASE });
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  // The reader gets the release, not the site's not-found page.
  assert.match(view.text(), /A live release/);
  assert.match(view.text(), /Something that shipped yesterday/);
  assert.doesNotMatch(view.text(), /Page not found/);

  // And the address bar settles on the permanent address of the release, so the link they copy
  // is the link that keeps working.
  assert.equal(view.router.state.location.pathname, '/changelog/a-live-release');
});

test('a release that shipped still opens at the document address when the changelog cannot be reached', async t => {
  // The live changelog can be unavailable — a cold database, a migration that has not run. A
  // release that shipped is still in the notes bundled with the site, so the reader is shown it
  // at the document address too, rather than a not-found page.
  const view = await mount({
    path: '/changelog/the-response-inbox/index.html',
    expect: 'The inbox, and a number you can trust',
    handler: () => json({ error: 'The changelog is temporarily unavailable.' }, 503),
  });
  t.after(view.restore);

  assert.match(view.text(), /The inbox, and a number you can trust/);
  assert.doesNotMatch(view.text(), /Page not found/);
  assert.equal(view.router.state.location.pathname, '/changelog/the-response-inbox');
});

test('the changelog index opens at the address its own document is served from', async t => {
  const view = await mount({
    path: '/changelog/index.html',
    expect: 'What shipped, and what is next.',
    handler: target => {
      if (target === '/api/releases') return json({ releases: [LIVE_RELEASE], total: 1 });
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  // The index is the index — not a hunt for a release called "index.html".
  assert.match(view.text(), /What shipped, and what is next\./);
  assert.match(view.text(), /A live release/);
  assert.doesNotMatch(view.text(), /Loading the release/);
  assert.equal(view.router.state.location.pathname, '/changelog');
});

test('an address that is not a release document is still a not-found page', async t => {
  const view = await mount({
    path: '/changelog/a-release/extra/index.html',
    expect: 'Page not found',
    handler: () => json({ error: 'not found' }, 404),
  });
  t.after(view.restore);
  assert.match(view.text(), /Page not found/);
});
