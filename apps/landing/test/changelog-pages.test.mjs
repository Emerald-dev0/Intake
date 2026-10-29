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
    router,
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
  assert.match(view.text(), /Intake opens/);
});

test('when the live changelog cannot be loaded, the page says so and still shows the recorded history', async t => {
  const view = await mount({ handler: () => json({ error: 'The changelog is temporarily unavailable.' }, 503) });
  t.after(view.restore);
  assert.match(view.text(), /Live releases could not be loaded/);
  assert.match(view.text(), /Intake opens/);
  assert.doesNotMatch(view.text(), /No releases have been published/);
});

test('the newest release is shown on its own, with the card a pasted link shows', async t => {
  const newest = { ...LIVE_RELEASE, slug: 'the-newest-release', title: 'The newest release', releaseDate: '2026-10-30', publishedAt: '2026-10-30T09:00:00.000Z' };
  const view = await mount({ handler: path => {
    if (path === '/api/releases') return json({ releases: [newest], total: 1 });
    return json({ error: 'not found' }, 404);
  } });
  t.after(view.restore);

  const hero = view.container.querySelector('.mk-changes-hero');
  assert.ok(hero, 'the latest release has a panel of its own');
  // The newest release is the one in the panel, whatever else has shipped.
  assert.match(hero.textContent ?? '', /The newest release/);
  assert.ok(hero.querySelector('a[href="/changelog/the-newest-release"]'), 'the panel links to the release');
  const card = hero.querySelector('.mk-changes-hero__media img');
  assert.ok(card, 'the panel shows the card');
  assert.match(card.getAttribute('src') ?? '', /\/api\/og\/changelog\/the-newest-release/);
});

test('a reader can search the releases, and the search is written into the address', async t => {
  const view = await mount({ handler: path => {
    if (path === '/api/releases') return json({ releases: [LIVE_RELEASE], total: 1 });
    return json({ error: 'not found' }, 404);
  } });
  t.after(view.restore);

  const input = view.container.querySelector('#mk-changes-search-input');
  assert.ok(input, 'there is a search box');
  assert.equal(input.getAttribute('type'), 'search');
  // A reader who remembers one word finds the release that mentions it.
  const type = (value) => {
    const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
    setter.call(input, value);
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  };
  await act(async () => { type('inbox'); });

  assert.match(view.text(), /The inbox, and a number you can trust/, 'the release that mentions it is shown');
  assert.doesNotMatch(view.text(), /Typeform is now a creation target/, 'the rest are filtered out');
  assert.match(view.text(), /\d+ of \d+ releases/, 'the count says what was found');
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, '/changelog?q=inbox', 'the search is in the address, so it can be shared');
});

test('a search that matches nothing says so instead of showing an empty page', async t => {
  const view = await mount({ handler: path => {
    if (path === '/api/releases') return json({ releases: [LIVE_RELEASE], total: 1 });
    return json({ error: 'not found' }, 404);
  } });
  t.after(view.restore);

  const input = view.container.querySelector('#mk-changes-search-input');
  const setter = Object.getOwnPropertyDescriptor(dom.window.HTMLInputElement.prototype, 'value').set;
  await act(async () => {
    setter.call(input, 'xylophone');
    input.dispatchEvent(new dom.window.Event('input', { bubbles: true }));
  });

  assert.match(view.text(), /Nothing matched/);
  assert.match(view.text(), /Show every release/);
});

test('the kind of release can be filtered, and the filter is in the address too', async t => {
  const view = await mount({ handler: path => {
    if (path === '/api/releases') return json({ releases: [LIVE_RELEASE], total: 1 });
    return json({ error: 'not found' }, 404);
  } });
  t.after(view.restore);

  const button = [...view.container.querySelectorAll('.mk-changes-filter')]
    .find(node => node.textContent === 'improvement');
  assert.ok(button, 'there is a filter for each kind of release');
  assert.equal(button.getAttribute('aria-pressed'), 'false');
  await act(async () => { button.click(); });

  assert.equal(button.getAttribute('aria-pressed'), 'true', 'the chosen filter says so');
  assert.match(view.text(), /The mail reads properly now/, 'the improvement is shown');
  assert.doesNotMatch(view.text(), /Typeform is now a creation target/, 'the features are not');
  assert.equal(view.router.state.location.pathname + view.router.state.location.search, '/changelog?c=improvement');
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

test('a release page shows the highlights, who it is for, and a table of contents that reaches each section', async t => {
  const view = await mount({
    path: '/changelog/a-live-release',
    handler: path => {
      if (path === '/api/releases/a-live-release') {
        return json({
          release: {
            ...LIVE_RELEASE,
            audience: 'For teams that already live in Typeform.',
            highlights: ['One sentence in, a question list out.', 'Nothing is created until you approve it.'],
            body: [
              '## What changed',
              'The composer grew a second target.',
              '',
              '## Why it matters',
              'One flow, two providers.',
              '',
              '## How to use it',
              'Pick the provider first.',
              '',
              '## What is not there yet',
              'Editing a Typeform in place.',
            ].join('\n'),
          },
        });
      }
      return json({ error: 'not found' }, 404);
    },
  });
  t.after(view.restore);

  // The short version, above the notes.
  assert.match(view.text(), /One sentence in, a question list out\./);
  assert.match(view.text(), /Nothing is created until you approve it\./);
  assert.match(view.text(), /For teams that already live in Typeform\./);
  assert.match(view.text(), /Who this is for/);

  // The table of contents, and every link in it reaches a heading that exists.
  assert.match(view.text(), /In this release/);
  const contents = view.container.querySelectorAll('.mk-release__contents a');
  assert.equal(contents.length, 4);
  const headings = [...view.container.querySelectorAll('.mk-release__body h2')];
  for (const link of contents) {
    const id = link.getAttribute('href')?.slice(1) ?? '';
    assert.ok(id, 'every entry points at a section');
    const heading = headings.find(node => node.id === id);
    assert.ok(heading, `the section "${id}" exists on the page`);
    assert.equal(heading.tagName, 'H2');
  }
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

test('a shipped release is still readable when the changelog cannot be reached', async t => {
  // The live changelog can be unavailable — a cold database, a migration that has not run. A
  // release that shipped is still in the notes bundled with the site, so the reader is shown it
  // and told where it came from, rather than being shown an error.
  const view = await mount({
    path: '/changelog/the-response-inbox',
    handler: () => json({ error: 'The changelog is temporarily unavailable.' }, 503),
  });
  t.after(view.restore);
  assert.match(view.text(), /The inbox, and a number you can trust/);
  assert.match(view.text(), /bundled with the site/);
  assert.doesNotMatch(view.text(), /could not be loaded/);
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
    // Every release says what changed in a few lines, and names who it is for.
    assert.ok(release.highlights.length >= 3, `${release.slug} has highlights`);
    assert.ok(release.audience && release.audience.length > 10, `${release.slug} names its audience`);
    // The notes are written as sections, and they are not all the same sections: a release that
    // repeated one template would read like a form letter.
    const headings = [...release.body.matchAll(/^## (.+)$/gm)].map(match => match[1]);
    assert.ok(headings.length >= 3, `${release.slug} has sections`);
    // The headings are the release's own, not a fixed template: the page turns them into a
    // table of contents, so they have to read like something a person wrote.
    assert.ok(headings.every(heading => heading.length > 3 && heading.length < 60), `${release.slug} has readable headings`);
  }
  const allHeadings = new Set(BUNDLED_RELEASES.flatMap(release => [...release.body.matchAll(/^## (.+)$/gm)].map(match => match[1])));
  assert.ok(allHeadings.size >= 15, 'the releases do not all share the same headings');
});

test('the release notes are written in a plain voice, not marketing filler', () => {
  const banned = [/seamlessly/i, /revolution/i, /game[- ]changer/i, /cutting[- ]edge/i, /unlock/i, /delve/i, /robust/i];
  for (const release of BUNDLED_RELEASES) {
    const text = `${release.title} ${release.summary} ${release.audience ?? ''} ${release.body}`;
    for (const pattern of banned) {
      assert.doesNotMatch(text, pattern, `${release.slug} does not say "${pattern.source}"`);
    }
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
