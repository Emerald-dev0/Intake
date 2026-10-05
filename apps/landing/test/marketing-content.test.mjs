import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('the homepage fallback keeps its product promise, one H1, pricing, and crawlable workflows', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1];
  assert.ok(fallback, 'the built homepage must retain its no-script content');

  const headings = [...fallback.matchAll(/<h1\b[^>]*>([\s\S]*?)<\/h1>/g)];
  assert.equal(headings.length, 1, 'the fallback should contain one meaningful H1');
  assert.equal(headings[0][1], 'Tell Intake what you need. It builds the form for you.');
  assert.match(fallback, /Not another form builder\./);
  assert.match(fallback, /How Intake works/);
  assert.match(fallback, /Describe what you need/);
  assert.match(fallback, /Review the proposal/);
  assert.match(fallback, /Confirm before applying/);
  assert.match(fallback, /Free · \$0/);
  assert.match(fallback, /20 daily AI credits/);
  assert.match(fallback, /Pro · \$6\.99 per month or \$59\.99 per year/);
  assert.match(fallback, /500 monthly credits/);
  assert.match(fallback, /Checkout and self-service plan changes are not available yet/);
  assert.match(fallback, /Built by <a href="https:\/\/github\.com\/Emerald-dev0">Oluwadare Daniel — Emerald<\/a>/);
});

test('marketing CSS retains responsive layouts, visible focus, and reduced-motion support', async () => {
  const [marketing, base] = await Promise.all([
    readFile('src/styles/marketing.css', 'utf8'),
    readFile('src/styles/base.css', 'utf8'),
  ]);
  assert.match(marketing, /@media \(max-width: 960px\)/);
  assert.match(marketing, /@media \(max-width: 780px\)/);
  assert.match(marketing, /@media \(max-width: 560px\)/);
  assert.match(marketing, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(marketing, /\.marketing-page :focus-visible/);
  assert.match(base, /:focus-visible\s*\{\s*outline:/);
  assert.match(base, /\.skip-link:focus/);
});
