import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the built changelog documents carry their own metadata', async t => {
  let index;
  try {
    index = await readFile(new URL('../dist/changelog.html', import.meta.url), 'utf8');
  } catch {
    t.skip('the site has not been built (run `npx vite build` first)');
    return;
  }

  // The index points at its own card, at its own address, and lists the releases.
  assert.match(index, /<link rel="canonical" href="https?:\/\/[^"]+\/changelog" \/>/);
  assert.match(index, /<meta property="og:image" content="https?:\/\/[^"]+\/api\/og\/changelog" \/>/);
  assert.match(index, /<meta property="og:title" content="Changelog/);

  // The index is written as the index of its directory too, so `/changelog/` finds it.
  const directory = await readFile(new URL('../dist/changelog/index.html', import.meta.url), 'utf8');
  assert.equal(directory, index, 'the directory index and the document are the same');

  const release = await readFile(new URL('../dist/changelog/the-response-inbox/index.html', import.meta.url), 'utf8');
  assert.match(release, /<title>The inbox, and a number you can trust — Intake changelog<\/title>/);
  assert.match(release, /<meta property="og:type" content="article" \/>/);
  assert.match(release, /<meta property="og:image" content="https?:\/\/[^"]+\/api\/og\/changelog\/the-response-inbox" \/>/);
  assert.match(release, /<link rel="canonical" href="https?:\/\/[^"]+\/changelog\/the-response-inbox" \/>/);
  assert.match(release, /<meta property="article:published_time" content="2026-10-29" \/>/);
  // The notes themselves are in the document, so a crawler reads the release and not a stub.
  assert.match(release, /Reading the answers/);
  assert.match(release, /<h2 id="reading-the-answers">/);
});

test('every bundled release has a document of its own', async t => {
  const { BUNDLED_RELEASES } = await import('../src/content/changelog.ts');
  for (const release of BUNDLED_RELEASES) {
    const url = new URL(`../dist/changelog/${release.slug}/index.html`, import.meta.url);
    let html;
    try {
      html = await readFile(url, 'utf8');
    } catch {
      t.skip('the site has not been built (run `npx vite build` first)');
      return;
    }
    assert.match(html, new RegExp(`/changelog/${release.slug}`), `${release.slug} points at its own address`);
    assert.match(html, /<meta property="og:image" content="[^"]+\/api\/og\/changelog\//, `${release.slug} has a card`);
  }
});
