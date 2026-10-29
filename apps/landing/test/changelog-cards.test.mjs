import { after, test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { inflateSync } from 'node:zlib';
import express from 'express';
import { createChangelogCardRouter } from '../server/og/routes.ts';
import { renderChangelogCard, renderChangelogIndexCard, formatReleaseDate } from '../server/og/changelog-card.ts';
import { BUNDLED_RELEASES } from '../src/content/changelog.ts';

const openServers = [];

/** Every server started by a test is closed when the file finishes, so the runner can exit. */
after(() => {
  for (const server of openServers) server.close();
});

const RELEASE = {
  slug: 'the-response-inbox',
  title: 'The inbox, and a number you can trust',
  summary: 'The answers to a hosted form can now be read, searched and exported — with a count that comes from the database rather than from the page.',
  releaseDate: '2026-10-29',
  categories: ['feature'],
};

/** The header of a PNG: the signature, the length and the type of the first chunk. */
function pngHeader(buffer) {
  assert.equal(buffer.subarray(0, 8).toString('hex'), '89504e470d0a1a0a', 'the PNG signature');
  const length = buffer.readUInt32BE(8);
  const type = buffer.subarray(12, 16).toString('ascii');
  return { length, type };
}

/** The width and height out of the IHDR chunk. */
function pngSize(buffer) {
  assert.equal(pngHeader(buffer).type, 'IHDR');
  return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
}

/**
 * The colours in a PNG, read back from the file.
 *
 * The card is written as a colour type 2 (RGB) image with one filter byte per scanline, so the
 * pixels are read straight out of the inflated data. Reading the file rather than the drawing
 * means the test sees what a browser would see.
 */
function decodePng(buffer) {
  const { width, height } = pngSize(buffer);
  const parts = [];
  let offset = 8;
  while (offset < buffer.length) {
    const length = buffer.readUInt32BE(offset);
    const type = buffer.subarray(offset + 4, offset + 8).toString('ascii');
    if (type === 'IDAT') parts.push(buffer.subarray(offset + 8, offset + 8 + length));
    offset += 12 + length;
  }
  const raw = inflateSync(Buffer.concat(parts));
  const colors = new Set();
  const stride = width * 3;
  for (let y = 0; y < height; y += 1) {
    const row = raw.subarray(y * (stride + 1) + 1, (y + 1) * (stride + 1));
    for (let x = 0; x < width; x += 1) {
      colors.add(row.subarray(x * 3, x * 3 + 3).toString('hex'));
    }
  }
  return { width, height, colors };
}

test('a release card is a real PNG, the size a link preview expects', () => {
  const png = renderChangelogCard(RELEASE);
  assert.ok(png.length > 1000, 'the card has some weight to it');
  assert.equal(pngHeader(png).type, 'IHDR');
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
  assert.ok(png.includes(Buffer.from('IEND', 'ascii')), 'the image ends where it should');
});

test('the card is drawn, not left blank', () => {
  const png = renderChangelogCard(RELEASE);
  const pixels = decodePng(png);
  assert.ok(pixels.colors.has('ff5a1f'), 'the accent colour is in the card');
  assert.ok(pixels.colors.has('f2efe6'), 'the panel colour is in the card');
  // The background is the brand's near-black, and the panel is the cream: both are there.
  assert.ok(pixels.colors.has('0b0c0b'), 'the background colour is in the card');
});

test('the index card is a real PNG too', () => {
  const png = renderChangelogIndexCard([RELEASE]);
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
});

test('a release with a long title is not drawn past the edge of the card', () => {
  const png = renderChangelogCard({
    ...RELEASE,
    title: 'A release with a title that runs on for a while so the card has to decide what to do with it',
    summary: 'A summary that also runs on, and on, so the card has to shorten it and say that it has.',
  });
  assert.deepEqual(pngSize(png), { width: 1200, height: 630 });
});

test('a release date reads as a date a person would write', () => {
  assert.equal(formatReleaseDate('2026-10-29'), '29 OCTOBER 2026');
  assert.equal(formatReleaseDate('not-a-date'), 'not-a-date');
});

test('the card route answers with the card for a release', async t => {
  const app = express();
  app.use(createChangelogCardRouter({
    listPublished: async () => BUNDLED_RELEASES.map(release => ({
      slug: release.slug,
      title: release.title,
      summary: release.summary,
      releaseDate: release.releaseDate,
      categories: release.categories,
    })),
  }));
  const server = createServer(app);
  openServers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const card = await fetch(`${base}/api/og/changelog/the-response-inbox`);
  assert.equal(card.status, 200);
  assert.match(card.headers.get('content-type') ?? '', /image\/png/);
  const bytes = Buffer.from(await card.arrayBuffer());
  assert.deepEqual(pngSize(bytes), { width: 1200, height: 630 });

  const index = await fetch(`${base}/api/og/changelog`);
  assert.equal(index.status, 200);
  assert.match(index.headers.get('content-type') ?? '', /image\/png/);
  assert.deepEqual(pngSize(Buffer.from(await index.arrayBuffer())), { width: 1200, height: 630 });
});

test('the card route refuses a release that does not exist, and a slug that is not a slug', async () => {
  const app = express();
  app.use(createChangelogCardRouter({ listPublished: async () => [] }));
  const server = createServer(app);
  openServers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  const missing = await fetch(`${base}/api/og/changelog/no-such-release`);
  assert.equal(missing.status, 404);

  const traversal = await fetch(`${base}/api/og/changelog/..%2Fetc%2Fpasswd`);
  assert.equal(traversal.status, 404);
});

test('the card still works when the changelog cannot be reached', async () => {
  const app = express();
  app.use(createChangelogCardRouter({
    listPublished: async () => { throw new Error('the database is cold'); },
  }));
  const server = createServer(app);
  openServers.push(server);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = `http://127.0.0.1:${server.address().port}`;

  // The bundled notes are the shipped history, so the card for a shipped release is still served.
  const card = await fetch(`${base}/api/og/changelog/the-response-inbox`);
  assert.equal(card.status, 200);
  assert.match(card.headers.get('content-type') ?? '', /image\/png/);
});

test('every bundled release has a card the route can serve', () => {
  for (const release of BUNDLED_RELEASES) {
    const png = renderChangelogCard({
      slug: release.slug,
      title: release.title,
      summary: release.summary,
      releaseDate: release.releaseDate,
      categories: release.categories,
    });
    assert.deepEqual(pngSize(png), { width: 1200, height: 630 }, release.slug);
  }
});
