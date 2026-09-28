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
    assert.equal((await get('/api/health')).status, 200);
    assert.equal((await get('/api/providers')).status, 404); // PR 03 is absent from this checkout.
    assert.match((await get('/api/providers')).headers.get('content-type'), /json/);
    assert.equal((await get('/api/me')).status, 503);
    // A failed Better Auth request must not terminate the entire server process.
    assert.equal((await get('/api/auth/ok')).status, 500);
    assert.equal((await get('/api/health')).status, 200);
    assert.equal((await get('/unknown')).status, 404);
  } finally {
    child.kill('SIGTERM');
  }
});
