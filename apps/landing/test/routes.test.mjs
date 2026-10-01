import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';

async function unusedPort() {
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  await new Promise(resolve => server.close(resolve));
  return port;
}

test('Render is API-only and fails closed when Neon is unavailable', async () => {
  const port = await unusedPort();
  const child = spawn('./node_modules/.bin/tsx', ['server/index.ts'], {
    env: {
      ...process.env,
      PORT: String(port),
      DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/intake?connect_timeout=1',
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64'),
      BETTER_AUTH_URL: `http://localhost:${port}`,
      OPENAI_API_KEY: '', // prove an absent model credential cannot bypass session checks
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { output += chunk; });
  try {
    let timer;
    await Promise.race([
      new Promise((resolve, reject) => {
        const poll = setInterval(() => {
          if (output.includes(`Intake listening on ${port}`)) { clearInterval(poll); resolve(); }
          if (child.exitCode !== null) { clearInterval(poll); reject(new Error(`Server exited: ${output}`)); }
        }, 50);
        child.once('exit', () => clearInterval(poll));
      }),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error(`Server did not start: ${output}`)), 15000); }),
    ]);
    clearTimeout(timer);
    const get = route => fetch(`http://127.0.0.1:${port}${route}`, { redirect: 'manual' });
    for (const route of ['/', '/auth/sign-in', '/auth/sign-up', '/app', '/app/connections', '/app/account']) {
      assert.equal((await get(route)).status, 404, `${route} belongs to Vercel, not Render`);
    }
    const health = await get('/api/health');
    assert.equal(health.status, 200);
    assert.equal(health.headers.get('cache-control'), 'no-store');
    assert.equal(health.headers.get('x-content-type-options'), 'nosniff');
    assert.equal(health.headers.get('x-frame-options'), 'DENY');
    assert.match(health.headers.get('x-request-id'), /^req_/);
    assert.equal((await get('/api/me')).status, 503);
    const providers = await get('/api/providers');
    assert.equal(providers.status, 503);
    assert.equal((await providers.text()).includes('access_token'), false);
    // Form creation authenticates before it reads a body or touches a provider, so with no session store it fails closed.
    const forms = await get('/api/forms');
    assert.equal(forms.status, 503);
    const formsBody = await forms.json();
    assert.equal(formsBody.code, 'storage_unavailable');
    assert.match(formsBody.requestId, /^req_/);
    assert.equal(forms.headers.get('x-request-id'), formsBody.requestId);
    const create = await fetch(`http://127.0.0.1:${port}/api/forms`, {
      method: 'POST',
      headers: { origin: `http://localhost:${port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', specification: { title: 'T', questions: [{ id: 'q', type: 'short_text', title: 'Q' }] } }),
      redirect: 'manual',
    });
    assert.equal(create.status, 503);
    const createText = await create.text();
    assert.equal(createText.includes('access_token'), false);
    assert.equal(createText.includes('forms.googleapis.com'), false, 'no provider was contacted');
    const interpret = await fetch(`http://127.0.0.1:${port}/api/forms/interpret`, {
      method: 'POST',
      headers: { origin: `http://localhost:${port}`, 'content-type': 'application/json' },
      body: JSON.stringify({ provider: 'google', request: 'Register a participant' }),
    });
    assert.equal(interpret.status, 503, 'session lookup fails closed before model access');
    assert.equal((await interpret.json()).code, 'storage_unavailable');
    assert.match(output, /Form creation: google enabled, microsoft pending/);
    assert.match(output, /Form interpretation: not configured/);
    const connect = await fetch(`http://127.0.0.1:${port}/api/providers/google/connect`, { method: 'POST', redirect: 'manual' });
    assert.equal(connect.status, 503);
    assert.equal(connect.headers.get('location'), null);
    const callback = await get('/api/providers/google/callback?code=super-secret-code&state=abc');
    assert.equal(callback.status, 503);
    assert.equal((await callback.text()).includes('super-secret-code'), false);
    const oversizedAuth = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'a@example.test', password: 'x'.repeat(70_000) }),
    });
    assert.equal(oversizedAuth.status, 413);
    const invalidAuth = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: '{',
    });
    assert.equal(invalidAuth.status, 400);
    const unsupportedAuth = await fetch(`http://127.0.0.1:${port}/api/auth/sign-in/email`, {
      method: 'POST', headers: { 'content-type': 'text/plain' }, body: 'credentials',
    });
    assert.equal(unsupportedAuth.status, 415);
    // Failed Better Auth and parser requests must not terminate the entire server process.
    assert.equal((await get('/api/auth/ok')).status, 500);
    assert.equal((await get('/api/health')).status, 200);
    assert.equal((await get('/unknown')).status, 404);
  } finally {
    child.kill('SIGTERM');
  }
});
