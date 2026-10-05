import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFile, rm } from 'node:fs/promises';
import { DEFAULT_SITE_URL, describeSiteUrlProblem, isNonPublicHost, normalizeSiteUrl } from '../src/lib/site-url.ts';

test('one origin is validated, not guessed: only an exact https origin is accepted', () => {
  assert.equal(normalizeSiteUrl(undefined), DEFAULT_SITE_URL, 'an unconfigured build falls back to the documented default');
  assert.equal(normalizeSiteUrl(''), DEFAULT_SITE_URL);
  assert.equal(normalizeSiteUrl('   '), DEFAULT_SITE_URL);
  assert.equal(normalizeSiteUrl('https://intake.example.com'), 'https://intake.example.com');
  assert.equal(normalizeSiteUrl('https://intake.example.com/'), 'https://intake.example.com', 'a trailing slash is normalised, not preserved');
  assert.equal(normalizeSiteUrl('https://intake-six-blue.vercel.app'), 'https://intake-six-blue.vercel.app', 'the default *.vercel.app host stays valid');

  for (const invalid of [
    'intake.example.com',
    'https://intake.example.com/app',
    'https://intake.example.com/?a=1',
    'https://intake.example.com/#x',
    'https://user:pass@intake.example.com',
    'http://intake.example.com',
    'https://INTAKE.example.com',
  ]) {
    assert.throws(() => normalizeSiteUrl(invalid), /VITE_SITE_URL/, `${invalid} must be rejected`);
  }

  // Error messages name the variable but never echo the value: build logs must not leak configuration.
  try {
    normalizeSiteUrl('https://secret-value.example.com/app');
    assert.fail('expected a rejection');
  } catch (error) {
    assert.match(error.message, /VITE_SITE_URL/);
    assert.doesNotMatch(error.message, /secret-value/);
  }

  assert.equal(describeSiteUrlProblem(undefined), null);
  assert.match(describeSiteUrlProblem('http://insecure.example.com'), /VITE_SITE_URL/);
  assert.equal(isNonPublicHost('http://localhost:5173'), true);
  assert.equal(isNonPublicHost('https://example.com'), true);
  assert.equal(isNonPublicHost('https://intake.example.com'), false);
});

test('VITE_SITE_URL drives the built canonical, Open Graph, robots and sitemap; a bad value fails the build', async () => {
  const outDir = 'dist-site-url-test';
  try {
    execFileSync('./node_modules/.bin/vite', ['build', '--outDir', outDir, '--emptyOutDir', '--logLevel', 'error'], {
      env: { ...process.env, VITE_SITE_URL: 'https://intake.example.test' },
      stdio: 'pipe',
    });
    const [home, pricing, robots, sitemap] = await Promise.all([
      readFile(`${outDir}/index.html`, 'utf8'),
      readFile(`${outDir}/pricing.html`, 'utf8'),
      readFile(`${outDir}/robots.txt`, 'utf8'),
      readFile(`${outDir}/sitemap.xml`, 'utf8'),
    ]);
    assert.match(home, /<link rel="canonical" href="https:\/\/intake\.example\.test\/" \/>/);
    assert.match(home, /<meta property="og:url" content="https:\/\/intake\.example\.test\/" \/>/);
    assert.match(home, /<meta property="og:image" content="https:\/\/intake\.example\.test\/og\.png" \/>/);
    assert.match(pricing, /<link rel="canonical" href="https:\/\/intake\.example\.test\/pricing" \/>/);
    assert.ok(robots.split(/\r?\n/).includes('Sitemap: https://intake.example.test/sitemap.xml'));
    assert.ok(sitemap.includes('<loc>https://intake.example.test/</loc>'));
    assert.ok(sitemap.includes('<loc>https://intake.example.test/pricing</loc>'));
    for (const document of [home, pricing, robots, sitemap]) {
      assert.doesNotMatch(document, /intake-six-blue\.vercel\.app/, 'the configured origin replaces the default everywhere');
      assert.doesNotMatch(document, /%SITE_URL%/);
    }
  } finally {
    await rm(outDir, { recursive: true, force: true });
  }
});

test('a malformed VITE_SITE_URL fails the build instead of shipping wrong metadata', () => {
  assert.throws(() => execFileSync('./node_modules/.bin/vite', ['build', '--outDir', 'dist-site-url-bad', '--logLevel', 'error'], {
    env: { ...process.env, VITE_SITE_URL: 'https://intake.example.test/app' },
    stdio: 'pipe',
  }));
});

test('the default build keeps the documented origin, so an unconfigured deployment is still honest', async () => {
  const [robots, sitemap] = await Promise.all([
    readFile('dist/robots.txt', 'utf8'),
    readFile('dist/sitemap.xml', 'utf8'),
  ]);
  assert.ok(robots.split(/\r?\n/).includes(`Sitemap: ${DEFAULT_SITE_URL}/sitemap.xml`));
  assert.ok(sitemap.includes(`<loc>${DEFAULT_SITE_URL}/</loc>`));
});
