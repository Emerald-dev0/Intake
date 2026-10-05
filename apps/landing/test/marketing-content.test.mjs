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
  assert.match(fallback, /See what Intake understood/);
  assert.match(fallback, /Change anything you like/);
  assert.match(fallback, /Confirm, and it is real/);
  assert.match(fallback, /Free · \$0/);
  assert.match(fallback, /20 credits every day/);
  assert.match(fallback, /Pro · \$6\.99 per month or \$59\.99 per year/);
  assert.match(fallback, /500 a month/);
  assert.match(fallback, /Designed by <a href="https:\/\/github\.com\/Emerald-dev0">Emerald<\/a>/);
});

test('the built homepage carries no unfinished-work or vendor wording', async () => {
  const html = await readFile('dist/index.html', 'utf8');
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';
  // Phrases that must not appear anywhere in the public document, including metadata.
  for (const phrase of [/not available yet/i, /coming soon/i, /not implemented/i, /display-only/i, /illustrative/i, /AI-powered/i, /AI credits/i, /AI-assisted/i, /natural[- ]language/i, /control layer/i, /priority processing/i]) {
    assert.doesNotMatch(html, phrase, `the public homepage must not say: ${phrase}`);
  }
  // The crawlable fallback is body copy, so it must not carry a personal name either. The creator is
  // still credited through the author metadata and structured data.
  for (const phrase of [/Oluwadare/, /Built by/]) {
    assert.doesNotMatch(fallback, phrase, `the public homepage must not say: ${phrase}`);
  }
});

test('marketing CSS retains responsive layouts, motion, visible focus, and reduced-motion support', async () => {
  const [marketing, base] = await Promise.all([
    readFile('src/styles/marketing.css', 'utf8'),
    readFile('src/styles/base.css', 'utf8'),
  ]);
  assert.match(marketing, /@media \(max-width: 960px\)/);
  assert.match(marketing, /@media \(max-width: 780px\)/);
  assert.match(marketing, /@media \(max-width: 560px\)/);
  assert.match(marketing, /@media \(max-width: 1100px\)/);
  assert.match(marketing, /@media \(max-width: 400px\)/);
  assert.match(marketing, /@media \(prefers-reduced-motion: reduce\)/);
  assert.match(marketing, /\.marketing-page :focus-visible/);
  assert.match(base, /:focus-visible\s*\{\s*outline:/);
  assert.match(base, /\.skip-link:focus/);
  // Rounded, non-generic geometry and the entrance animations the page relies on.
  assert.match(marketing, /--mk-r-lg: 26px/);
  assert.match(marketing, /--mk-pill: 999px/);
  assert.match(marketing, /@keyframes mk-fade-up/);
  assert.match(marketing, /@keyframes mk-marquee-scroll/);
  assert.match(marketing, /\.mk-reveal\.is-in/);
  assert.match(marketing, /grid-template-rows: 0fr/);
});
