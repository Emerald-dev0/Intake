import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import { readFile } from 'node:fs/promises';

const dom = new JSDOM('<div id="root"></div>', { url: 'https://intake.test/changelog', pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.location = dom.window.location;
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
const React = await import('react');
const { act } = React;
const { createRoot } = await import('react-dom/client');
const { createMemoryRouter, RouterProvider } = await import('react-router-dom');
const { ChangelogPage, ReleaseDetailPage } = await import('../src/marketing/Changelog.tsx');
const { BUNDLED_RELEASES } = await import('../src/content/changelog.ts');
const { SITE_URL } = await import('../src/content/site.ts');

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

async function mount({ path = '/changelog', handler }) {
  const original = globalThis.fetch;
  const calls = [];
  globalThis.fetch = async (input, init) => {
    calls.push(String(input));
    if (String(input).startsWith('/api/analytics')) return new Response('', { status: 204 });
    return handler(String(input), init);
  };
  const router = createMemoryRouter([
    { path: '/changelog', element: React.createElement(ChangelogPage) },
    { path: '/changelog/:slug', element: React.createElement(ReleaseDetailPage) },
  ], { initialEntries: [path] });
  const container = document.createElement('div');
  document.body.appendChild(container);
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(RouterProvider, { router })));
  return {
    calls,
    container,
    text: () => container.textContent ?? '',
    restore: async () => { await act(async () => root.unmount()); container.remove(); globalThis.fetch = original; },
  };
}

test('the changelog index lists every published release and links to its permanent page', async t => {
  const view = await mount({ handler: path => {
    if (path === '/api/releases') return json({ releases: [LIVE_RELEASE], total: 1 });
    return json({ error: 'not found' }, 404);
  } });
  t.after(view.restore);

  assert.match(view.text(), /A live release/);
  const link = view.container.querySelector('a[href="/changelog/a-live-release"]');
  assert.ok(link, 'each release links to its own permanent page');
  assert.equal(link.textContent, 'A live release');
  // The bundled releases are still there, so the index is a history and not a single entry.
  assert.match(view.text(), /Launch/);
});

test('when the live changelog cannot be loaded, the page says so and still shows the recorded history', async t => {
  const view = await mount({ handler: () => json({ error: 'The changelog is temporarily unavailable.' }, 503) });
  t.after(view.restore);
  assert.match(view.text(), /Live releases could not be loaded/);
  assert.match(view.text(), /Launch/);
  assert.doesNotMatch(view.text(), /No releases have been published/);
});

test('a release page shows the announcement and carries its own canonical and social metadata', async t => {
  const view = await mount({
    path: '/changelog/a-live-release',
    handler: path => {
      if (path === '/api/releases/a-live-release') return json({ release: LIVE_RELEASE });
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  assert.match(view.text(), /A live release/);
  assert.match(view.text(), /Something that shipped yesterday/);
  assert.match(view.text(), /What changed/);
  assert.match(view.text(), /October 28, 2026/);
  assert.match(view.text(), /Feature/);
  assert.match(view.text(), /Back to the changelog/);

  const canonical = document.head.querySelector('link[rel="canonical"]');
  assert.equal(canonical?.getAttribute('href'), `${SITE_URL}/changelog/a-live-release`);
  const meta = name => document.head.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content');
  assert.equal(meta('og:title'), 'A live release — Intake changelog');
  assert.equal(meta('og:url'), `${SITE_URL}/changelog/a-live-release`);
  assert.equal(meta('og:type'), 'article');
  assert.equal(meta('article:published_time'), '2026-10-28T09:00:00.000Z');
  assert.equal(meta('twitter:card'), 'summary_large_image');

  const schema = JSON.parse(document.getElementById('intake-page-schema')?.textContent ?? '{}');
  assert.equal(schema['@type'], 'Article');
  assert.equal(schema.headline, 'A live release');
});

test('a release with a screenshot uses it for the social card', async t => {
  const view = await mount({
    path: '/changelog/a-live-release',
    handler: path => {
      if (path === '/api/releases/a-live-release') {
        return json({ release: { ...LIVE_RELEASE, heroImageUrl: 'https://intake.test/shots/release.png' } });
      }
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  const meta = name => document.head.querySelector(`meta[property="${name}"], meta[name="${name}"]`)?.getAttribute('content');
  assert.equal(meta('og:image'), 'https://intake.test/shots/release.png');
  assert.equal(meta('twitter:image'), 'https://intake.test/shots/release.png');
  const image = view.container.querySelector('.mk-release__media img');
  assert.ok(image, 'the screenshot is shown above the notes');
  assert.equal(image.getAttribute('src'), 'https://intake.test/shots/release.png');
  assert.equal(image.getAttribute('alt'), 'Screenshot for A live release');
});

test('a release that was never published is a not-found page, not a blank one', async t => {
  const view = await mount({
    path: '/changelog/not-a-release',
    handler: path => {
      if (path === '/api/releases/not-a-release') return json({ error: 'No such release.' }, 404);
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);
  assert.match(view.text(), /That release is not here/);
  assert.match(view.text(), /Back to the changelog/);
});

test('a release that cannot be fetched is reported as unavailable rather than guessed', async t => {
  const view = await mount({
    path: '/changelog/a-live-release',
    handler: () => json({ error: 'The changelog is temporarily unavailable.' }, 503),
  });
  t.after(view.restore);
  assert.match(view.text(), /could not be loaded/);
  assert.doesNotMatch(view.text(), /A live release exists/);
});

test('the copy button only claims success when the clipboard accepted the link', async t => {
  const view = await mount({
    path: '/changelog/a-live-release',
    handler: path => {
      if (path === '/api/releases/a-live-release') return json({ release: LIVE_RELEASE });
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  const button = [...view.container.querySelectorAll('button')].find(entry => entry.textContent === 'Copy link');
  assert.ok(button);
  await act(async () => button.click());
  // jsdom has no clipboard in this environment, so the honest answer is a failure, not "copied".
  assert.match(view.text(), /Copying failed/);
  assert.doesNotMatch(view.text(), /Link copied/);
});

test('the bundled releases are the shipped history: dated, categorised and each with its own slug', () => {
  assert.ok(BUNDLED_RELEASES.length >= 5);
  const slugs = BUNDLED_RELEASES.map(release => release.slug);
  assert.equal(new Set(slugs).size, slugs.length, 'every release has its own slug');
  for (const release of BUNDLED_RELEASES) {
    assert.match(release.releaseDate, /^\d{4}-\d{2}-\d{2}$/);
    assert.ok(release.title.length > 0);
    assert.ok(release.summary.length > 0);
    assert.ok(release.categories.length > 0, `${release.slug} is categorised`);
    assert.match(release.body, /## What changed/);
  }
});

test('the release pages are styled for both widths and keep their focus ring', async () => {
  const [marketing, admin] = await Promise.all([
    readFile('src/styles/marketing.css', 'utf8'),
    readFile('src/styles/admin.css', 'utf8'),
  ]);
  // The release article wraps rather than overflows, and the console grid collapses on a narrow
  // screen; the public pages keep the shared focus treatment.
  assert.match(marketing, /\.mk-release__share \{/);
  assert.match(marketing, /flex-wrap: wrap/);
  assert.match(marketing, /\.marketing-page :focus-visible/);
  assert.match(admin, /@media \(max-width: 1080px\)/);
  assert.match(admin, /\.admin-release__grid/);
});

test('the release notes renderer refuses to turn an unsafe link into a target', async () => {
  const { ReleaseMarkdown } = await import('../src/lib/release-markdown.tsx');
  const container = document.createElement('div');
  document.body.appendChild(container);
  const React = await import('react');
  const { createRoot } = await import('react-dom/client');
  const { act } = React;
  const root = createRoot(container);
  await act(async () => root.render(React.createElement(ReleaseMarkdown, {
    body: '## What changed\nA [safe link](/guides) and an [unsafe one](javascript:alert(1)).',
  })));
  const links = [...container.querySelectorAll('a')];
  assert.equal(links.length, 1, 'only the safe link becomes an anchor');
  assert.equal(links[0].getAttribute('href'), '/guides');
  assert.match(container.textContent, /unsafe one/, 'the unsafe link is still readable as text');
  await act(async () => root.unmount());
  container.remove();
});
