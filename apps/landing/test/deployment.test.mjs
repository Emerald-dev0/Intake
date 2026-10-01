import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { preview } from 'vite';
import { createServer } from 'node:http';

test('deployment routes reserve API before the generic SPA fallback', async () => {
  const config = JSON.parse(await readFile('vercel.json', 'utf8'));
  assert.equal(config.outputDirectory, 'dist');
  assert.deepEqual(config.routes[0].env, ['BACKEND_URL']);
  assert.equal(config.routes[0].dest, '${BACKEND_URL}/api/$1');
  const api = new RegExp(`^${config.routes[0].src}`);
  const frontend = new RegExp(`^${config.rewrites[0].source}$`);
  for (const route of ['/api', '/api/providers', '/api/auth/get-session', '/api/providers/google/callback']) {
    assert.ok(api.test(route));
    assert.ok(!frontend.test(route));
  }
  for (const route of ['/', '/auth/sign-up', '/app/connections', '/app/forms']) assert.ok(frontend.test(route));
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
    for (const path of ['/', '/auth/sign-in', '/auth/sign-up', '/app', '/app/connections', '/app/account']) {
      for (let attempt = 0; attempt < 2; attempt++) {
        const res = await fetch(base + path);
        assert.equal(res.status, 200);
        assert.match(await res.text(), /<div id="root"><\/div>/);
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
    for (const secretBoundary of ['api.openai.com', 'OPENAI_API_KEY', 'forms.googleapis.com', 'GOOGLE_OAUTH_CLIENT_SECRET']) {
      assert.equal(body.includes(secretBoundary), false, `${asset} bundled ${secretBoundary}`);
    }
  }
});
