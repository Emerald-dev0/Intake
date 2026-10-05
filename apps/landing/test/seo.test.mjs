import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const SITE_ORIGIN = 'https://intake-six-blue.vercel.app';
const CREATOR_NAME = 'Oluwadare Daniel — Emerald';
const SOCIAL_IMAGE_ALT = 'Intake showing a form proposal: a written request on the left, the questions it understood on the right.';

function metadata(html) {
  const entries = new Map();
  for (const [, attributes] of html.matchAll(/<meta\s+([^>]+)>/g)) {
    const key = attributes.match(/(?:name|property)="([^"]+)"/)?.[1];
    const value = attributes.match(/content="([^"]*)"/)?.[1];
    if (key && value !== undefined) entries.set(key, value);
  }
  return entries;
}

function escapeHtml(value) {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

test('production homepage metadata uses the verified production origin and an accurate social-image alt', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const meta = metadata(html);
  const canonical = html.match(/<link rel="canonical" href="([^"]+)"\s*\/>/)?.[1];

  assert.equal(canonical, `${SITE_ORIGIN}/`);
  assert.match(html, /<title>Intake — Google Forms, built from a sentence<\/title>/);
  assert.equal(meta.get('robots'), 'index,follow,max-image-preview:large');
  assert.equal(meta.get('author'), CREATOR_NAME);
  assert.equal(meta.get('og:type'), 'website');
  assert.equal(meta.get('og:site_name'), 'Intake');
  assert.ok(meta.get('description')?.includes('Google Forms'));
  assert.ok(meta.get('og:title')?.includes('Google Forms'));
  assert.ok(meta.get('og:description')?.includes('confirm'));
  assert.equal(meta.get('og:url'), `${SITE_ORIGIN}/`);
  assert.equal(meta.get('og:image'), `${SITE_ORIGIN}/og.png`);
  assert.equal(meta.get('og:image:type'), 'image/png');
  assert.equal(meta.get('og:image:width'), '1200');
  assert.equal(meta.get('og:image:height'), '630');
  assert.equal(meta.get('og:image:alt'), SOCIAL_IMAGE_ALT);
  assert.equal(meta.get('twitter:card'), 'summary_large_image');
  assert.equal(meta.get('twitter:image'), `${SITE_ORIGIN}/og.png`);
  assert.equal(meta.get('twitter:image:alt'), SOCIAL_IMAGE_ALT);

  for (const url of [canonical, meta.get('og:url'), meta.get('og:image'), meta.get('twitter:image')]) {
    assert.equal(new URL(url).origin, SITE_ORIGIN);
    assert.doesNotMatch(url, /localhost|127\.0\.0\.1|\.e2b\.app|preview/i);
  }
  assert.doesNotMatch(html, /%(?:SITE_URL|STRUCTURED_DATA|NOSCRIPT_CONTENT|HOMEPAGE_TITLE|META_DESCRIPTION|CREATOR_DISPLAY_NAME)%/);
});

test('JSON-LD connects Intake to its creator and matches the visible FAQ', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const script = html.match(/<script id="intake-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)?.[1];
  assert.ok(script, 'structured data must be emitted in the built HTML');
  const data = JSON.parse(script);
  assert.equal(data['@context'], 'https://schema.org');
  const graph = data['@graph'];
  const software = graph.find(entity => entity['@type'] === 'SoftwareApplication');
  const creator = graph.find(entity => entity['@type'] === 'Person');
  const faq = graph.find(entity => entity['@type'] === 'FAQPage');
  assert.ok(software);
  assert.ok(creator);
  assert.ok(faq);

  assert.equal(software.name, 'Intake');
  assert.equal(software.url, `${SITE_ORIGIN}/`);
  assert.equal(software.creator['@id'], creator['@id']);
  assert.equal(software.author['@id'], creator['@id']);
  assert.equal(creator.name, CREATOR_NAME);
  assert.equal(creator.alternateName, 'Emerald');
  assert.deepEqual(creator.sameAs, [
    'https://x.com/Dev_emeraldX',
    'https://www.tiktok.com/@emerald_dev1',
    'https://www.instagram.com/emerald_dev1/',
    'https://www.linkedin.com/in/emerald_dev/',
    'https://github.com/Emerald-dev0',
  ]);

  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(fallback, 'the built HTML must retain a crawlable no-script content fallback');
  assert.match(fallback, /Designed by <a href="https:\/\/github\.com\/Emerald-dev0">Emerald<\/a>/);
  assert.ok(faq.mainEntity.length > 0);
  for (const question of faq.mainEntity) {
    assert.equal(question['@type'], 'Question');
    assert.equal(question.acceptedAnswer['@type'], 'Answer');
    assert.ok(fallback.includes(`<h3>${escapeHtml(question.name)}</h3>`), `missing visible FAQ question: ${question.name}`);
    assert.ok(fallback.includes(`<p>${escapeHtml(question.acceptedAnswer.text)}</p>`), `missing visible FAQ answer: ${question.name}`);
  }

  const graphText = JSON.stringify(graph);
  assert.doesNotMatch(graphText, /localhost|127\.0\.0\.1|\.e2b\.app|preview/i);
  assert.doesNotMatch(graphText, /aggregateRating|reviewCount|ratingValue|offers/i);
});

test('robots, sitemap and private document expose only intended public indexable routes', async () => {
  const robots = await readFile('dist/robots.txt', 'utf8');
  const sitemap = await readFile('dist/sitemap.xml', 'utf8');
  const privateHtml = await readFile('dist/private.html', 'utf8');

  assert.match(robots, /^User-agent: \*/m);
  assert.match(robots, /^Allow: \/$/m);
  for (const path of ['/app', '/admin', '/auth', '/api', '/private.html', '/capture.html', '/og.html']) {
    assert.ok(robots.split(/\r?\n/).includes(`Disallow: ${path}`), `missing robots exclusion for ${path}`);
  }
  assert.ok(robots.split(/\r?\n/).includes(`Sitemap: ${SITE_ORIGIN}/sitemap.xml`));
  const locations = [...sitemap.matchAll(/<loc>([^<]+)<\/loc>/g)].map(([, location]) => location);
  assert.deepEqual(locations, [`${SITE_ORIGIN}/`, `${SITE_ORIGIN}/pricing`]);
  assert.match(privateHtml, /<meta name="robots" content="noindex, nofollow"\s*\/>/);
});
