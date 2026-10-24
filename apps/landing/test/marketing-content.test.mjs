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
  assert.match(fallback, /Pro · opens later/);
  assert.match(fallback, /not on sale yet/);
  assert.match(fallback, /1000 monthly credits/);
  assert.match(fallback, /Designed by <a href="https:\/\/emerald\.pxxl\.click">Emerald<\/a>/);
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

test('the reveal system has named entrances, an exit, and is neutralised for reduced motion', async () => {
  const [marketing, motion] = await Promise.all([
    readFile('src/styles/marketing.css', 'utf8'),
    readFile('src/marketing/motion.ts', 'utf8'),
  ]);

  // Four entrances, so the page has a vocabulary rather than one move repeated everywhere.
  for (const variant of ['rise', 'fade', 'wipe', 'scale']) {
    assert.match(marketing, new RegExp(`\\.mk-reveal--${variant}\\b`), `${variant} entrance exists`);
  }
  assert.match(marketing, /\.mk-reveal\.is-in\b/);
  assert.match(marketing, /\.mk-reveal\.is-out\b/, 'blocks settle once they have been read past');

  // The exit must never take an interactive element with it: everything that carries `is-out` is
  // opt-in in the component, and the reduced-motion block has to restore full opacity.
  const reduced = marketing.slice(marketing.indexOf('@media (prefers-reduced-motion: reduce)'));
  assert.match(reduced, /\.mk-reveal\.is-out[\s\S]{0,200}opacity:\s*1/);
  assert.match(reduced, /clip-path:\s*none/);

  assert.match(motion, /export function useViewState/);
  assert.match(motion, /'before' \| 'in' \| 'after'/);
  // The observer decides the exit from which side of the viewport the element left.
  assert.match(motion, /leavingUpwards/);
});

test('the public documents name both creation targets and carry their marks', async () => {
  const [html, llms] = await Promise.all([
    readFile('dist/index.html', 'utf8'),
    readFile('dist/llms.txt', 'utf8'),
  ]);
  const fallback = html.match(/<noscript>([\s\S]*?)<\/noscript>/)?.[1] ?? '';

  // Metadata: a crawler that never runs JavaScript still learns there are two targets.
  assert.match(html, /<title>[^<]*Google Forms and Typeform[^<]*<\/title>/);
  assert.match(html, /<meta property="og:title" content="[^"]*Google Forms and Typeform[^"]*"/);
  assert.match(html, /<meta name="description" content="[^"]*Google Forms or Typeform[^"]*"/);
  const structured = JSON.parse(html.match(/<script id="intake-structured-data" type="application\/ld\+json">([\s\S]*?)<\/script>/)[1]);
  const app = structured['@graph'].find(node => node['@type'] === 'SoftwareApplication');
  assert.match(app.name, /Google Forms and Typeform/);
  assert.ok(app.featureList.some(item => /Typeform/.test(item)), 'the feature list mentions Typeform');

  // The no-script document shows the two marks with their real colours, not a text-only claim.
  assert.match(fallback, /<svg role="img" aria-label="Google Forms"[^>]*fill="#7248B9"/);
  assert.match(fallback, /<svg role="img" aria-label="Typeform"[^>]*fill="#262627"/);
  assert.match(fallback, /Google Forms · create and edit/);
  assert.match(fallback, /Typeform · create and import/);

  // llms.txt states the split honestly: creation in both, in-place editing in Google only.
  assert.match(llms, /Google Forms and Typeform/);
  assert.match(llms, /Typeform creation and import are supported, Typeform editing is not yet/);
  assert.match(llms, /accounts:read, forms:read, forms:write, offline/);
});

test('the provider marks are the providers’ own geometry, in their own colours', async () => {
  const [logos, css] = await Promise.all([
    readFile('src/components/ProviderLogos.tsx', 'utf8'),
    readFile('src/styles/marketing.css', 'utf8'),
  ]);
  assert.match(logos, /GOOGLE_FORMS_BRAND = '#7248B9'/, 'Google Forms brand purple, not an arbitrary colour');
  assert.match(logos, /TYPEFORM_BRAND = '#262627'/, 'Typeform brand black');
  assert.match(logos, /Simple Icons/, 'the source and its licence are recorded next to the geometry');
  // The strip sits on paper so the brand colours keep their contrast on the dark page.
  assert.match(css, /\.mk-provider \{[\s\S]{0,200}background: var\(--mk-paper\)/);
});
