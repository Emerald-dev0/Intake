import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { randomBytes } from 'node:crypto';
import { readFile } from 'node:fs/promises';

test('the Node 22 production entry starts without Playwright or Chromium and serves the existing social card', async () => {
  const probe = createServer();
  await new Promise(resolve => probe.listen(0, '127.0.0.1', resolve));
  const port = probe.address().port;
  await new Promise(resolve => probe.close(resolve));
  const child = spawn('./node_modules/.bin/tsx', ['server/index.ts'], {
    env: {
      ...process.env, NODE_ENV: 'production', PORT: String(port),
      DATABASE_URL: 'postgresql://invalid:invalid@127.0.0.1:1/intake?sslmode=require&connect_timeout=1',
      BETTER_AUTH_SECRET: randomBytes(32).toString('base64'), BETTER_AUTH_URL: 'https://intake.calder.click',
      CALDER_API_KEY: '', CALDER_FROM_EMAIL: '', CALDER_SENDER_ID: '', GROQ_API_KEY: '',
      GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '', GOOGLE_OAUTH_CLIENT_ID: '', GOOGLE_OAUTH_CLIENT_SECRET: '',
    }, stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  const capture = chunk => { output += chunk; };
  child.stdout.on('data', capture);
  child.stderr.on('data', capture);
  try {
    await new Promise((resolve, reject) => {
      const timer = setTimeout(() => { cleanup(); reject(Error(`Production startup timed out: ${output}`)); }, 15_000);
      const check = () => { if (output.includes(`Intake listening on ${port}`)) { cleanup(); resolve(); } };
      const exited = () => { cleanup(); reject(Error(`Production entry exited: ${output}`)); };
      const cleanup = () => { clearTimeout(timer); child.stdout.off('data', check); child.off('exit', exited); };
      child.stdout.on('data', check);
      child.once('exit', exited);
      check();
    });
    assert.doesNotMatch(output, /ERR_MODULE_NOT_FOUND|Cannot find package 'playwright'/);
    const base = `http://127.0.0.1:${port}`;
    assert.equal((await fetch(`${base}/api/health`)).status, 200);
    for (const query of ['', '?path=/waitlist', '?path=https://attacker.invalid']) {
      const response = await fetch(`${base}/api/og${query}`);
      assert.equal(response.status, 200);
      assert.match(response.headers.get('content-type'), /image\/png/);
      const image = Buffer.from(await response.arrayBuffer());
      assert.deepEqual(image, await readFile('public/og.png'));
    }
    assert.equal((await fetch(`${base}/waitlist`)).status, 404, 'frontend pages belong to Vercel');
    const failure = await fetch(`${base}/api/waitlist`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: 'smoke@example.com' }),
    });
    assert.equal(failure.status, 503, 'missing storage fails closed, not fake joined');
    assert.doesNotMatch(await failure.text(), /postgresql|invalid:invalid|joined/);
  } finally {
    child.kill('SIGTERM');
  }
});
