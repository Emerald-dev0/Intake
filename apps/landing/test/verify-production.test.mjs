import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { formatResults, normalizeBaseUrl, parseArgs, readSetCookie, runVerification } from '../tools/verify-production.mjs';

/**
 * A local origin that emulates a *correct* deployment closely enough to exercise every automated
 * check. Mutating one behaviour at a time proves the checks actually fail when production is wrong —
 * a check that cannot fail would be worse than no check.
 */
function deployment({ defects = {} } = {}) {
  const state = { sessions: new Set(), signInAttempts: 0, connectAttempts: 0 };
  const server = createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1');
    const origin = `http://127.0.0.1:${server.address().port}`;
    const baseHeaders = {
      'Cache-Control': 'no-store',
      'X-Request-Id': 'req_local',
      'Referrer-Policy': 'no-referrer',
      'X-Content-Type-Options': 'nosniff',
      'X-Frame-Options': 'DENY',
      'Permissions-Policy': 'camera=()',
      'Cross-Origin-Resource-Policy': 'same-origin',
    };
    if (defects.wildcardCors) res.setHeader('Access-Control-Allow-Origin', '*');
    const json = (code, body, headers = {}) => {
      for (const [key, value] of Object.entries({ ...(defects.noApiHeaders ? {} : baseHeaders), ...headers })) res.setHeader(key, value);
      res.writeHead(code, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(body));
    };
    const html = (code, body, headers = {}) => {
      for (const [key, value] of Object.entries({ ...(defects.noFrontendHeaders ? {} : baseHeaders), ...headers })) res.setHeader(key, value);
      res.writeHead(code, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(body);
    };
    const cookie = req.headers.cookie ?? '';
    const signedIn = [...state.sessions].some(session => cookie.includes(session));

    if (url.pathname === '/api/health') {
      if (url.searchParams.get('deep') === '1') {
        return defects.databaseDown ? json(503, { ok: false, database: 'unavailable' }) : json(200, { ok: true, database: 'ok', latencyMs: 4 });
      }
      return json(200, { ok: true });
    }
    if (url.pathname.startsWith('/api/')) {
      if (url.pathname === '/api/sign-in/config') return json(200, { providers: { google: defects.googleSignIn ?? false } });
      if (url.pathname === '/api/auth/sign-in/email' && req.method === 'POST') {
        state.signInAttempts += 1;
        let body = '';
        req.on('data', chunk => { body += chunk; });
        req.on('end', () => {
          const parsed = JSON.parse(body || '{}');
          if (parsed.email === 'smoke@example.test' && parsed.password === 'correct-horse-1A') {
            const session = `session-${state.signInAttempts}`;
            state.sessions.add(session);
            return json(200, { user: { email: parsed.email } }, { 'Set-Cookie': `${session}=token; Path=/; HttpOnly; Secure; SameSite=Lax` });
          }
          return json(401, { message: 'Invalid email or password' });
        });
        return undefined;
      }
      if (url.pathname === '/api/auth/sign-out' && req.method === 'POST') {
        for (const session of [...state.sessions]) if (cookie.includes(session)) state.sessions.delete(session);
        return json(200, { success: true });
      }
      if (url.pathname === '/api/providers/google/connect' && req.method === 'POST') {
        if (!signedIn) return json(401, { error: 'Not authenticated' });
        state.connectAttempts += 1;
        if (state.connectAttempts > 8) return json(429, { error: 'Too many requests' }, { 'Retry-After': '431' });
        res.writeHead(302, { Location: 'https://accounts.google.com/o/oauth2/v2/auth' });
        return res.end();
      }
      if (url.pathname === '/api/admin/access' || url.pathname === '/api/admin/overview') {
        return signedIn ? json(403, { error: 'Forbidden' }) : json(401, { error: 'Not authenticated' });
      }
      if (signedIn && url.pathname === '/api/me') return json(200, { user: { email: 'smoke@example.test' } });
      if (signedIn && url.pathname === '/api/credits') return json(200, { plan: 'free', balances: { daily: { available: 12, limit: 20 }, monthly: { available: 0, limit: 0 } } });
      if (defects.publicProtectedRoute) return json(200, { forms: [] });
      const protectedRoutes = ['/api/me', '/api/credits', '/api/providers', '/api/forms', '/api/forms/library', '/api/forms/edit/draft/unknown'];
      if (protectedRoutes.includes(url.pathname)) return json(401, { error: 'Not authenticated' });
      return json(404, { error: 'API route not found' });
    }
    if (url.pathname === '/robots.txt') {
      res.writeHead(200, { 'Content-Type': 'text/plain' });
      return res.end(`User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`);
    }
    if (url.pathname === '/sitemap.xml') {
      res.writeHead(200, { 'Content-Type': 'application/xml' });
      return res.end(`<urlset><url><loc>${origin}/</loc></url><url><loc>${origin}/pricing</loc></url></urlset>`);
    }
    if (url.pathname === '/pricing') return html(200, `<title>Intake plans and pricing</title><link rel="canonical" href="${origin}/pricing" />`);
    if (url.pathname === '/app' || url.pathname === '/admin') {
      return html(200, '<meta name="robots" content="noindex, nofollow" />', { 'X-Robots-Tag': 'noindex, nofollow' });
    }
    if (url.pathname === '/') {
      return html(200, `<title>Intake — Google Forms, built from a sentence</title><link rel="canonical" href="${origin}/" />`);
    }
    res.writeHead(404, { 'Content-Type': 'text/html' });
    return res.end('<!doctype html><title>404</title>');
  });
  return { server, state };
}

async function withDeployment(options, run) {
  const { server, state } = deployment(options);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}`;
  try {
    return await run({ baseUrl, state });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
}

const options = (overrides = {}) => ({ timeoutMs: 5_000, expectGoogleSignIn: 'any', json: false, email: null, password: null, emailB: null, passwordB: null, aiCheck: false, rateLimitCheck: false, crossUser: false, ...overrides });

test('a healthy anonymous deployment passes every check', async () => {
  await withDeployment({}, async ({ baseUrl }) => {
    const report = await runVerification({ baseUrl, options: options() });
    const failed = report.results.filter(result => result.status === 'fail');
    assert.deepEqual(failed, [], formatResults(report));
    assert.equal(report.ok, true);
    const ids = new Set(report.results.map(result => result.id));
    for (const id of ['health', 'health-deep', 'api-404', 'anonymous-api', 'admin-anonymous', 'sign-in-config', 'cors', 'auth-db', 'documents', 'canonical']) {
      assert.ok(ids.has(id), `${id} must run by default`);
    }
    for (const id of ['sign-in-email', 'ai-check', 'cross-user', 'rate-limit']) {
      assert.equal(report.results.find(result => result.id === id).status, 'skip', `${id} must not run without opt-in`);
    }
  });
});

test('a health check that cannot fail is not a health check: real defects are detected', async () => {
  const defects = {
    databaseDown: true,
    noApiHeaders: true,
    noFrontendHeaders: true,
    wildcardCors: true,
    publicProtectedRoute: true,
    googleSignIn: true,
  };
  await withDeployment({ defects }, async ({ baseUrl }) => {
    const report = await runVerification({ baseUrl, options: options({ expectGoogleSignIn: 'false' }) });
    assert.equal(report.ok, false);
    const failed = new Set(report.results.filter(result => result.status === 'fail').map(result => result.id));
    for (const id of ['health-deep', 'api-headers', 'frontend-headers', 'cors', 'anonymous-api', 'sign-in-config']) {
      assert.ok(failed.has(id), `${id} must fail for this deployment`);
    }
    const forbiddenShapes = report.results.filter(result => result.id === 'anonymous-api')[0];
    assert.match(forbiddenShapes.detail, /\/api\/me → 200/);
    assert.doesNotMatch(formatResults(report), /Access-Control-Allow-Origin: \*/i);
  });
});

test('authenticated checks verify the session cookie, credits, admin denial and sign-out', async () => {
  await withDeployment({}, async ({ baseUrl }) => {
    const report = await runVerification({ baseUrl, options: options({ email: 'smoke@example.test', password: 'correct-horse-1A' }) });
    const byId = Object.fromEntries(report.results.map(result => [result.id, result]));
    assert.equal(byId['sign-in-email'].status, 'pass', byId['sign-in-email'].detail);
    assert.match(byId['sign-in-email'].detail, /HttpOnly, Secure, SameSite=Lax, host-only/);
    assert.equal(byId['session-persist'].status, 'pass');
    assert.equal(byId.credits.status, 'pass');
    assert.equal(byId['admin-normal-user'].status, 'pass');
    assert.equal(byId['wrong-password'].status, 'pass');
    assert.equal(byId['sign-out'].status, 'pass');
    assert.equal(report.ok, true, formatResults(report));
  });
});

test('a wrong password is not mistaken for a valid session, and the report never prints a cookie', async () => {
  await withDeployment({}, async ({ baseUrl }) => {
    const report = await runVerification({ baseUrl, options: options({ email: 'smoke@example.test', password: 'wrong-password' }) });
    const byId = Object.fromEntries(report.results.map(result => [result.id, result]));
    assert.equal(byId['sign-in-email'].status, 'fail');
    assert.equal(report.ok, false);
    assert.doesNotMatch(formatResults(report), /session-\d+=token/, 'cookie values stay out of the report');
  });
});

test('the rate-limit check reports 429 and Retry-After without failing a healthy limiter', async () => {
  await withDeployment({ defects: { googleSignIn: true } }, async ({ baseUrl }) => {
    const report = await runVerification({ baseUrl, options: options({ email: 'smoke@example.test', password: 'correct-horse-1A', rateLimitCheck: true }) });
    const rateLimit = report.results.find(result => result.id === 'rate-limit');
    assert.equal(rateLimit.status, 'pass', rateLimit.detail);
    assert.match(rateLimit.detail, /Retry-After/);
  });
});

test('argument parsing and cookie inspection stay strict', async () => {
  assert.equal(normalizeBaseUrl('https://intake.example.com/'), 'https://intake.example.com');
  assert.equal(normalizeBaseUrl('http://127.0.0.1:4173'), 'http://127.0.0.1:4173');
  for (const invalid of ['intake.example.com', 'https://intake.example.com/app', 'http://intake.example.com']) {
    assert.throws(() => normalizeBaseUrl(invalid), /--base-url/);
  }
  assert.throws(() => parseArgs(['--nope']), /Unknown argument/);
  assert.equal(parseArgs(['--base-url', 'https://x.test', '--expect-google-sign-in=yes']).expectGoogleSignIn, 'true');
  assert.equal(parseArgs(['--expect-google-sign-in', 'no']).expectGoogleSignIn, 'false');
  assert.equal(parseArgs(['--expect-google-sign-in', 'maybe']).expectGoogleSignIn, 'any');
  assert.equal(parseArgs(['--ai-check', '--cross-user']).aiCheck, true);

  const response = new Response(null, { headers: { 'Set-Cookie': 'a=1; Path=/; HttpOnly; Secure; SameSite=Lax' } });
  const cookie = readSetCookie(response);
  assert.equal(cookie.header, 'a=1');
  assert.equal(cookie.httpOnly && cookie.secure && cookie.sameSiteLax, true);
  assert.equal(cookie.hasDomainAttribute, false);
});
