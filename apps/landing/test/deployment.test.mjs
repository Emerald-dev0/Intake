import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { preview } from 'vite';
import { createServer } from 'node:http';

test('install-script approval is restricted to the pinned esbuild package version', async () => {
  const manifest = JSON.parse(await readFile('package.json', 'utf8'));
  const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
  assert.deepEqual(manifest.allowScripts, { 'esbuild@0.28.2': true });
  assert.equal(lock.packages['node_modules/esbuild'].version, '0.28.2');
  assert.equal(lock.packages['node_modules/esbuild'].hasInstallScript, true);
});

test('deployment routes reserve API before the generic SPA fallback', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.equal(config.outputDirectory, 'dist');
  assert.equal(config.rewrites, undefined, 'use the low-level route pipeline without mixing Vercel routing modes');
  assert.equal(config.headers, undefined, 'route-specific noindex headers belong on the private route');

  const apiRule = config.routes.find(rule => rule.src?.startsWith('/api'));
  const privateRule = config.routes.find(rule => rule.dest === '/private.html');
  const pricingRule = config.routes.find(rule => rule.dest === '/pricing.html');
  const filesystemRule = config.routes.find(rule => rule.handle === 'filesystem');
  const publicFallback = config.routes.find(rule => rule.dest === '/index.html');
  assert.ok(apiRule, 'API requests must proxy to the backend');
  assert.ok(privateRule, 'authenticated and account routes must use the noindex document');
  assert.ok(pricingRule, 'the public pricing route must serve its dedicated metadata document');
  assert.ok(filesystemRule, 'static assets, robots and sitemap must retain filesystem precedence');
  assert.ok(publicFallback, 'public frontend routes must use the indexable document');
  assert.deepEqual(apiRule.env, ['BACKEND_URL']);
  assert.equal(apiRule.dest, '${BACKEND_URL}/api/$1');
  assert.equal(apiRule.headers['Cache-Control'], 'no-store');
  assert.equal(privateRule.headers['X-Robots-Tag'], 'noindex, nofollow');
  assert.ok(config.routes.indexOf(apiRule) < config.routes.indexOf(privateRule));
  assert.ok(config.routes.indexOf(privateRule) < config.routes.indexOf(pricingRule));
  assert.ok(config.routes.indexOf(pricingRule) < config.routes.indexOf(filesystemRule));
  assert.ok(config.routes.indexOf(filesystemRule) < config.routes.indexOf(publicFallback));

  const api = new RegExp(`^${apiRule.src}`);
  const privatePage = new RegExp(`^${privateRule.src}$`);
  const publicPage = new RegExp(`^${publicFallback.src}$`);
  const pricingPage = new RegExp(`^${pricingRule.src}`);
  assert.ok(pricingPage.test('/pricing'));
  assert.ok(pricingPage.test('/pricing/'));
  for (const route of ['/api', '/api/providers', '/api/auth/get-session', '/api/providers/google/callback']) {
    assert.ok(api.test(route));
    assert.ok(!privatePage.test(route));
    assert.ok(!publicPage.test(route));
  }
  for (const route of ['/auth/sign-in', '/auth/sign-up', '/app', '/app/connections', '/app/forms', '/admin']) {
    assert.ok(privatePage.test(route), `${route} must use the private document`);
  }
  for (const route of ['/', '/about', '/faq', '/pricing']) assert.ok(publicPage.test(route), `${route} must use the public document`);
});

test('production Vite output serves direct and repeated document requests; API proxy preserves methods, queries and cookies', async () => {
  const backend = createServer((req, res) => {
    res.setHeader('Content-Type', 'application/json');
    res.setHeader('Set-Cookie', 'probe=value; Path=/; HttpOnly; SameSite=Lax');
    res.end(JSON.stringify({ path: req.url, method: req.method, cookie: req.headers.cookie }));
  });
  await new Promise(resolve => backend.listen(0, '127.0.0.1', resolve));
  const server = await preview({ preview: { port: 0, proxy: { '^/api(?:/|$)': { target: `http://127.0.0.1:${backend.address().port}` } } } });
  const base = `http://127.0.0.1:${server.httpServer.address().port}`;
  try {
    for (const path of ['/', '/pricing', '/auth/sign-in', '/auth/sign-up', '/app', '/app/connections', '/app/account', '/admin', '/admin/users/owner-id']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(base + path);
        assert.equal(res.status, 200);
        const html = await res.text();
        assert.match(html, /<div id="root"><\/div>/);
        if (path === '/pricing') {
          assert.ok(html.includes('<link rel="canonical" href="https://intake-six-blue.vercel.app/pricing" />'));
          assert.ok(html.includes('<title>Intake Pricing — Free and Pro Plans</title>'));
        }
        if (path.startsWith('/admin')) {
          // Vite preview serves the SPA fallback directly; production's Vercel route sends every
          // /admin path to this private document (asserted in the routing test above).
          const privateHtml = await readFile('dist/private.html', 'utf8');
          assert.match(privateHtml, /name="robots" content="noindex, nofollow"/);
          assert.doesNotMatch(privateHtml, /property="og:|rel="canonical"/);
        }
      }
    }
    for (const path of ['/api/providers', '/api/auth/get-session', '/api/providers/google/callback?code=test&state=test']) {
      const res = await fetch(base + path, { method: 'POST', headers: { cookie: 'probe=value' } });
      assert.deepEqual(await res.json(), { path, method: 'POST', cookie: 'probe=value' });
      assert.match(res.headers.get('set-cookie'), /HttpOnly; SameSite=Lax/);
    }
  } finally {
    await new Promise(resolve => server.httpServer.close(resolve));
    await new Promise(resolve => backend.close(resolve));
  }
});

test('browser module imports cannot cross the server boundary', async () => {
  async function scan(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = `${dir}/${entry.name}`;
      if (entry.isDirectory()) await scan(path);
      else if (/\.[jt]sx?$/.test(path)) {
        const source = await readFile(path, 'utf8');
        assert.doesNotMatch(source, /(?:from\s*|import\s*\(|require\s*\()\s*['"][^'"]*(?:server\/|node:|better-auth\/node|@neondatabase|\bpg['"])/, path);
        assert.doesNotMatch(source, /import\.meta\.env\.(?:DATABASE_URL|BETTER_AUTH_SECRET|PROVIDER_TOKEN_KEY)/, path);
      }
    }
  }
  await scan('src');
});

test('the production browser bundle contains no model client, model key name or Google Forms API client', async () => {
  const assets = (await readdir('dist/assets')).filter(file => file.endsWith('.js'));
  assert.ok(assets.length > 0, 'build the frontend before this test');
  for (const asset of assets) {
    const body = await readFile(`dist/assets/${asset}`, 'utf8');
    // Better Auth's public client bundle itself contains the literal name BETTER_AUTH_SECRET
    // in a generic environment getter; a name is not the secret value. Test our new boundary.
    for (const secretBoundary of ['api.openai.com', 'OPENAI_API_KEY', 'api.groq.com', 'GROQ_API_KEY', 'GOOGLE_CLIENT_SECRET', 'forms.googleapis.com', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
      assert.equal(body.includes(secretBoundary), false, `${asset} bundled ${secretBoundary}`);
    }
  }
});
