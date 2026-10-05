#!/usr/bin/env node
/**
 * Intake production verification.
 *
 * Non-destructive checks against a **deployed** origin (Vercel frontend → Render API → Neon).
 * Everything it does is a read: the only writes are the account-scoped steps you explicitly opt into
 * with credentials (sign-in, sign-out, and, with `--ai-check`, one metered AI interpretation that
 * really does spend credits).
 *
 * It cannot verify Google Forms behaviour: creating or editing a real form needs a human on Google's
 * consent screen. Those steps are the manual checklist in `LAUNCH.md`.
 *
 * Usage:
 *
 *   node tools/verify-production.mjs --base-url https://intake.example.com
 *   node tools/verify-production.mjs --base-url https://intake.example.com \
 *     --expect-google-sign-in=yes
 *   # authenticated checks (prefer environment variables so nothing lands in shell history):
 *   INTAKE_VERIFY_EMAIL=smoke@example.com INTAKE_VERIFY_PASSWORD='…' \
 *     node tools/verify-production.mjs --base-url https://intake.example.com
 *   # cross-user ownership check (two throwaway accounts):
 *   INTAKE_VERIFY_EMAIL_B=smoke-b@example.com INTAKE_VERIFY_PASSWORD_B='…' … --cross-user
 *   # opt-in metered checks:
 *   … --ai-check --rate-limit-check
 *
 * Exit code: 0 when no check failed, 1 when at least one failed or the run itself could not start.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const TIMEOUT_DEFAULT_MS = 20_000;
const STATUS_ORDER = { fail: 0, warn: 1, pass: 2, skip: 3, info: 4 };

export function parseArgs(argv) {
  const options = {
    baseUrl: null,
    timeoutMs: TIMEOUT_DEFAULT_MS,
    expectGoogleSignIn: 'any',
    json: false,
    email: process.env.INTAKE_VERIFY_EMAIL ?? null,
    password: process.env.INTAKE_VERIFY_PASSWORD ?? null,
    emailB: process.env.INTAKE_VERIFY_EMAIL_B ?? null,
    passwordB: process.env.INTAKE_VERIFY_PASSWORD_B ?? null,
    aiCheck: false,
    rateLimitCheck: false,
    crossUser: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const [flag, inlineValue] = arg.includes('=') ? [arg.slice(0, arg.indexOf('=')), arg.slice(arg.indexOf('=') + 1)] : [arg, null];
    const value = inlineValue ?? argv[index + 1];
    const take = () => { if (inlineValue === null) index += 1; return value; };
    switch (flag) {
      case '--base-url': options.baseUrl = take(); break;
      case '--timeout': options.timeoutMs = Number(take()) || TIMEOUT_DEFAULT_MS; break;
      case '--expect-google-sign-in': {
        const raw = (take() ?? 'any').toLowerCase();
        options.expectGoogleSignIn = raw === 'yes' || raw === 'true' ? 'true' : raw === 'no' || raw === 'false' ? 'false' : 'any';
        break;
      }
      case '--email': options.email = take(); break;
      case '--password': options.password = take(); break;
      case '--email-b': options.emailB = take(); break;
      case '--password-b': options.passwordB = take(); break;
      case '--credentials-file': {
        const parsed = JSON.parse(readFileSync(take(), 'utf8'));
        options.email = parsed.email ?? options.email;
        options.password = parsed.password ?? options.password;
        options.emailB = parsed.emailB ?? options.emailB;
        options.passwordB = parsed.passwordB ?? options.passwordB;
        break;
      }
      case '--ai-check': options.aiCheck = true; break;
      case '--rate-limit-check': options.rateLimitCheck = true; break;
      case '--cross-user': options.crossUser = true; break;
      case '--json': options.json = true; break;
      case '--help': options.help = true; break;
      default: throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export function normalizeBaseUrl(value) {
  if (!value) throw new Error('--base-url is required, for example --base-url https://intake.example.com');
  let url;
  try { url = new URL(value.trim()); } catch { throw new Error('--base-url must be an absolute origin such as https://intake.example.com'); }
  if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) {
    throw new Error('--base-url must be an origin only: no path, query, hash, or credentials.');
  }
  if (url.protocol !== 'https:' && url.hostname !== 'localhost' && url.hostname !== '127.0.0.1') {
    throw new Error('--base-url must use https for anything other than a local test origin.');
  }
  return url.origin;
}

/** Cookie header from a response, plus the security flags that matter for session safety. */
export function readSetCookie(response) {
  const cookies = typeof response.headers.getSetCookie === 'function' ? response.headers.getSetCookie() : [];
  const pairs = cookies.map(cookie => cookie.split(';')[0].trim()).filter(Boolean);
  const joined = cookies.join('\n');
  return {
    header: pairs.join('; '),
    count: pairs.length,
    httpOnly: /;\s*HttpOnly/i.test(joined),
    secure: /;\s*Secure/i.test(joined),
    sameSiteLax: /;\s*SameSite=Lax/i.test(joined),
    hasDomainAttribute: /;\s*Domain=/i.test(joined),
    raw: joined,
  };
}

const FORBIDDEN_BODY_KEYS = /("|'|\[)(access_?token|refresh_?token|client_?secret|api_?key|password|database_?url|better_?auth_?secret|provider_?token_?key)("|'|\])/i;

function contentType(response) {
  return response.headers.get('content-type') ?? '';
}

async function readBody(response) {
  try { return await response.text(); } catch { return ''; }
}

/**
 * The check list. Each entry receives a context with an authenticated-request helper and returns
 * `{ status, detail }`, so a single failure never aborts the run.
 */
export function buildChecks(context) {
  const { baseUrl, request, options, state } = context;
  const checks = [];
  const add = (id, title, run) => checks.push({ id, title, run });

  add('health', 'GET /api/health returns JSON liveness', async () => {
    const { response, body } = await request('/api/health');
    if (response.status !== 200) return { status: 'fail', detail: `Expected 200, received ${response.status}.` };
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { status: 'fail', detail: 'Response is not JSON. Is /api/health proxied to the API rather than to the SPA?' }; }
    if (parsed.ok !== true) return { status: 'fail', detail: `Unexpected body shape: ${Object.keys(parsed).join(', ') || 'empty'}.` };
    const noStore = (response.headers.get('cache-control') ?? '').includes('no-store');
    const requestId = Boolean(response.headers.get('x-request-id'));
    if (!noStore || !requestId) {
      return { status: 'fail', detail: `Missing ${noStore ? '' : 'Cache-Control: no-store'}${!noStore && !requestId ? ' and ' : ''}${requestId ? '' : 'X-Request-Id'} on an API response.` };
    }
    return { status: 'pass', detail: '200 JSON, no-store, request id present.' };
  });

  add('health-deep', 'Neon is reachable through the API (?deep=1)', async () => {
    const { response, body } = await request('/api/health?deep=1');
    if (response.status === 503) return { status: 'fail', detail: 'The API cannot reach PostgreSQL: check DATABASE_URL, Neon status, and that the database is not suspended.' };
    if (response.status !== 200) return { status: 'fail', detail: `Expected 200, received ${response.status}.` };
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { status: 'fail', detail: 'Response is not JSON.' }; }
    if (parsed.database !== 'ok') return { status: 'fail', detail: `Unexpected deep-health payload: ${JSON.stringify(parsed)}.` };
    return { status: 'pass', detail: 'Database probe succeeded.' };
  });

  add('api-headers', 'API responses carry the security baseline', async () => {
    const { response } = await request('/api/health');
    const missing = [];
    if (!/nosniff/i.test(response.headers.get('x-content-type-options') ?? '')) missing.push('X-Content-Type-Options');
    if (!/deny/i.test(response.headers.get('x-frame-options') ?? '')) missing.push('X-Frame-Options');
    if (!/no-referrer/i.test(response.headers.get('referrer-policy') ?? '')) missing.push('Referrer-Policy');
    if (!response.headers.get('permissions-policy')) missing.push('Permissions-Policy');
    if (!response.headers.get('cross-origin-resource-policy')) missing.push('Cross-Origin-Resource-Policy');
    if (baseUrl.startsWith('https:') && !response.headers.get('strict-transport-security')) missing.push('Strict-Transport-Security');
    return missing.length
      ? { status: 'fail', detail: `Missing headers: ${missing.join(', ')}.` }
      : { status: 'pass', detail: 'Baseline API headers present.' };
  });

  add('frontend-headers', 'Frontend documents carry baseline headers', async () => {
    const { response } = await request('/');
    const missing = [];
    if (!/nosniff/i.test(response.headers.get('x-content-type-options') ?? '')) missing.push('X-Content-Type-Options');
    if (!response.headers.get('referrer-policy')) missing.push('Referrer-Policy');
    return missing.length
      ? { status: 'fail', detail: `Missing: ${missing.join(', ')}. These come from the header route in vercel.json; redeploy the frontend.` }
      : { status: 'pass', detail: 'Frontend header route is active.' };
  });

  add('api-404', 'Unknown API routes return JSON 404, never SPA HTML', async () => {
    const path = `/api/intake-verify-${Date.now().toString(36)}`;
    const { response, body } = await request(path);
    if (response.status !== 404) return { status: 'fail', detail: `Expected 404 from ${path}, received ${response.status}.` };
    if (!contentType(response).includes('json')) return { status: 'fail', detail: 'The 404 is not JSON: the frontend catch-all is probably intercepting /api/*.' };
    if (/<!doctype html/i.test(body)) return { status: 'fail', detail: 'The 404 body is the SPA document.' };
    return { status: 'pass', detail: 'JSON 404 from the API.' };
  });

  add('anonymous-api', 'Protected API surfaces reject anonymous requests', async () => {
    const paths = ['/api/me', '/api/credits', '/api/providers', '/api/forms', '/api/forms/library', '/api/forms/edit/draft/unknown'];
    const wrong = [];
    for (const path of paths) {
      const { response } = await request(path);
      if (response.status !== 401) wrong.push(`${path} → ${response.status}`);
    }
    return wrong.length
      ? { status: 'fail', detail: `Expected 401 for every protected route: ${wrong.join(', ')}.` }
      : { status: 'pass', detail: `${paths.length} routes returned 401 without a session.` };
  });

  add('admin-anonymous', 'Admin API rejects anonymous requests', async () => {
    const results = [];
    for (const path of ['/api/admin/access', '/api/admin/overview']) {
      const { response, body } = await request(path);
      if (response.status === 200 || /"admin"\s*:/.test(body)) results.push(`${path} exposed admin data (status ${response.status})`);
      else if (response.status !== 401 && response.status !== 403) results.push(`${path} → ${response.status}`);
    }
    return results.length
      ? { status: 'fail', detail: results.join('; ') }
      : { status: 'pass', detail: 'Admin routes denied anonymous access.' };
  });

  add('sign-in-config', 'Public sign-in config exposes booleans only', async () => {
    const { response, body } = await request('/api/sign-in/config');
    if (response.status !== 200) return { status: 'fail', detail: `Expected 200, received ${response.status}.` };
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { status: 'fail', detail: 'Response is not JSON.' }; }
    const google = parsed?.providers?.google;
    if (typeof google !== 'boolean') return { status: 'fail', detail: 'providers.google must be a boolean.' };
    if (FORBIDDEN_BODY_KEYS.test(body)) return { status: 'fail', detail: 'The config response contains a credential-like field.' };
    state.googleSignIn = google;
    if (options.expectGoogleSignIn !== 'any' && String(google) !== options.expectGoogleSignIn) {
      return { status: 'fail', detail: `Expected providers.google=${options.expectGoogleSignIn} but production reports ${google}.` };
    }
    return { status: 'pass', detail: `providers.google=${google} (booleans only, no ids or URLs).` };
  });

  add('cors', 'No wildcard or permissive CORS', async () => {
    const { response } = await request('/api/health', { headers: { Origin: 'https://intake-verify.invalid' } });
    const allowOrigin = response.headers.get('access-control-allow-origin');
    const allowCredentials = response.headers.get('access-control-allow-credentials');
    if (allowOrigin === '*' || allowOrigin === 'https://intake-verify.invalid') {
      return { status: 'fail', detail: `Access-Control-Allow-Origin is ${allowOrigin}; the same-origin /api proxy means no cross-origin grant is needed.` };
    }
    return { status: 'pass', detail: allowOrigin ? `Origin granted only for ${allowOrigin}.` : 'No CORS grant for an unknown origin.' + (allowCredentials ? ' (credentials header present)' : '') };
  });

  add('auth-db', 'Better Auth can read PostgreSQL (no account is created)', async () => {
    const { response } = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: `intake-verify-${Date.now().toString(36)}@invalid.test`, password: 'not-a-real-password-1A' }),
    });
    if (response.status >= 500) return { status: 'fail', detail: `Sign-in attempt returned ${response.status}. The database, migrations or auth secret are the usual causes.` };
    if (response.status !== 401 && response.status !== 400) {
      return { status: 'warn', detail: `Expected 401 for an unknown account, received ${response.status}. Confirm no test account was created.` };
    }
    const cookie = readSetCookie(response);
    if (cookie.count > 0) return { status: 'fail', detail: 'A failed sign-in returned a session cookie.' };
    return { status: 'pass', detail: `Rejected with ${response.status} and no session cookie.` };
  });

  add('documents', 'Public documents and SPA routes resolve', async () => {
    const problems = [];
    const expectations = [
      { path: '/', expect: /<title>Intake/, label: 'homepage' },
      { path: '/pricing', expect: /Intake plans and pricing|<title>[^<]*Pricing/, label: 'pricing page' },
      { path: '/app', expect: /<meta name="robots" content="noindex/, label: 'private workspace document' },
      { path: '/admin', expect: /<meta name="robots" content="noindex/, label: 'admin document' },
    ];
    for (const { path, expect, label } of expectations) {
      const { response, body } = await request(path);
      if (response.status !== 200) problems.push(`${label} (${path}) → ${response.status}`);
      else if (!expect.test(body)) problems.push(`${label} (${path}) returned unexpected markup`);
      if (path === '/admin' && response.headers.get('x-robots-tag') && !/noindex/.test(response.headers.get('x-robots-tag'))) {
        problems.push('admin document is indexable');
      }
    }
    return problems.length ? { status: 'fail', detail: problems.join('; ') } : { status: 'pass', detail: 'Homepage, pricing, /app and /admin documents resolve with the expected content.' };
  });

  add('canonical', 'Canonical origin and static metadata agree with the deployment', async () => {
    const { body } = await request('/');
    const canonical = body.match(/<link rel="canonical" href="([^"]+)"/)?.[1];
    if (!canonical) return { status: 'fail', detail: 'No canonical link in the homepage document.' };
    if (/%SITE_URL%/.test(body)) return { status: 'fail', detail: 'A metadata placeholder was never replaced during the build.' };
    const canonicalOrigin = new URL(canonical).origin;
    const robots = await request('/robots.txt');
    const sitemapLine = robots.body.match(/Sitemap: (\S+)/)?.[1];
    const sitemap = await request('/sitemap.xml');
    const locs = [...sitemap.body.matchAll(/<loc>([^<]+)<\/loc>/g)].map(match => match[1]);
    const problems = [];
    if (locs.some(loc => new URL(loc).origin !== canonicalOrigin)) problems.push('sitemap entries use a different origin than the canonical link');
    if (sitemapLine && new URL(sitemapLine).origin !== canonicalOrigin) problems.push('robots.txt points at a different sitemap origin');
    if (problems.length) return { status: 'fail', detail: `${problems.join('; ')}. Set VITE_SITE_URL and redeploy the frontend.` };
    if (canonicalOrigin !== baseUrl) {
      return { status: 'warn', detail: `Canonical origin is ${canonicalOrigin} while this run targets ${baseUrl}. Intentional for an alias domain; otherwise set VITE_SITE_URL=${baseUrl} and redeploy.` };
    }
    return { status: 'pass', detail: `Canonical, robots.txt and sitemap all use ${canonicalOrigin}.` };
  });

  add('sign-in-email', 'A real account can sign in and receives a safe cookie', async () => {
    if (!options.email || !options.password) return { status: 'skip', detail: 'No credentials supplied (INTAKE_VERIFY_EMAIL / INTAKE_VERIFY_PASSWORD).' };
    const { response, body } = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: options.email, password: options.password }),
    });
    if (response.status !== 200) return { status: 'fail', detail: `Sign-in failed with ${response.status}. Check the account exists, is verified for admin use, and the password is current.` };
    const cookie = readSetCookie(response);
    state.cookie = cookie.header;
    if (!cookie.count) return { status: 'fail', detail: 'Sign-in succeeded without a session cookie.' };
    state.cookieFlags = cookie;
    const missing = [];
    if (!cookie.httpOnly) missing.push('HttpOnly');
    if (!cookie.secure && baseUrl.startsWith('https:')) missing.push('Secure');
    if (!cookie.sameSiteLax) missing.push('SameSite=Lax');
    if (cookie.hasDomainAttribute) missing.push('no Domain attribute (host-only is expected through the Vercel proxy)');
    if (missing.length) return { status: 'fail', detail: `Session cookie is missing: ${missing.join(', ')}.` };
    if (/"access_?token"|"refresh_?token"/i.test(body)) return { status: 'fail', detail: 'The sign-in response included a token field.' };
    return { status: 'pass', detail: `Session cookie: HttpOnly, Secure, SameSite=Lax, host-only (${cookie.count} cookie${cookie.count === 1 ? '' : 's'}).` };
  });

  add('session-persist', 'The session survives repeat requests (page refreshes)', async () => {
    if (!state.cookie) return { status: 'skip', detail: 'Requires a successful sign-in.' };
    const first = await request('/api/me', { headers: { Cookie: state.cookie } });
    if (first.response.status !== 200) return { status: 'fail', detail: `/api/me returned ${first.response.status} with a fresh session cookie.` };
    const second = await request('/api/me', { headers: { Cookie: state.cookie } });
    if (second.response.status !== 200) return { status: 'fail', detail: `/api/me returned ${second.response.status} on the second request; sessions are not persisting.` };
    let user = null;
    try { user = JSON.parse(first.body)?.user?.email ?? null; } catch { /* handled below */ }
    if (!user) return { status: 'fail', detail: 'The session response has no user email.' };
    if (options.email && user.toLowerCase() !== options.email.toLowerCase()) {
      return { status: 'fail', detail: 'The session belongs to a different account than the one that requested it.' };
    }
    return { status: 'pass', detail: 'Two consecutive authenticated reads succeeded with the same cookie.' };
  });

  add('credits', 'Credits endpoint reports a server-owned balance', async () => {
    if (!state.cookie) return { status: 'skip', detail: 'Requires a successful sign-in.' };
    const { response, body } = await request('/api/credits', { headers: { Cookie: state.cookie } });
    if (response.status !== 200) return { status: 'fail', detail: `/api/credits returned ${response.status}.` };
    let parsed;
    try { parsed = JSON.parse(body); } catch { return { status: 'fail', detail: 'Credits response is not JSON.' }; }
    if (!parsed.plan || !parsed.balances) return { status: 'fail', detail: `Unexpected credits payload: ${Object.keys(parsed).join(', ')}.` };
    if (FORBIDDEN_BODY_KEYS.test(body)) return { status: 'fail', detail: 'Credits response contains a credential-like field.' };
    if (!/no-store/.test(response.headers.get('cache-control') ?? '')) return { status: 'fail', detail: 'Credits response is cacheable; it must be no-store.' };
    return { status: 'pass', detail: `plan=${parsed.plan}, daily+monthly balances reported, no-store.` };
  });

  add('wrong-password', 'A wrong password is rejected and issues no session', async () => {
    if (!options.email) return { status: 'skip', detail: 'Requires an account email.' };
    const { response } = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: options.email, password: `wrong-${Date.now().toString(36)}-Zz9` }),
    });
    if (response.status === 200) return { status: 'fail', detail: 'A wrong password was accepted.' };
    if (response.status >= 500) return { status: 'fail', detail: `Wrong-password attempt returned ${response.status}.` };
    if (readSetCookie(response).count > 0) return { status: 'fail', detail: 'A failed sign-in returned a session cookie.' };
    return { status: 'pass', detail: `Rejected with ${response.status} and no session cookie.` };
  });

  add('admin-normal-user', 'A normal account cannot reach the admin API', async () => {
    if (!state.cookie) return { status: 'skip', detail: 'Requires a successful sign-in.' };
    const { response, body } = await request('/api/admin/access', { headers: { Cookie: state.cookie } });
    if (response.status === 200) {
      return /"readOnly"\s*:\s*true/.test(body)
        ? { status: 'info', detail: 'This account is an allowlisted administrator, so /api/admin/access is expected to succeed. Run the admin checks separately with a non-admin account.' }
        : { status: 'fail', detail: '/api/admin/access succeeded without the expected admin payload.' };
    }
    if (response.status !== 403 && response.status !== 401) return { status: 'warn', detail: `Expected 403/401 for a normal account, received ${response.status}.` };
    return { status: 'pass', detail: `Denied with ${response.status}.` };
  });

  add('cross-user', 'One account cannot read another account\'s forms', async () => {
    if (!options.crossUser) return { status: 'skip', detail: 'Pass --cross-user with INTAKE_VERIFY_EMAIL_B/INTAKE_VERIFY_PASSWORD_B to run this check.' };
    if (!state.cookie || !options.emailB || !options.passwordB) return { status: 'skip', detail: 'Requires two accounts.' };
    const signInB = await request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: options.emailB, password: options.passwordB }),
    });
    if (signInB.response.status !== 200) return { status: 'fail', detail: `Account B could not sign in (${signInB.response.status}).` };
    const cookieB = readSetCookie(signInB.response).header;
    const listB = await request('/api/forms/library', { headers: { Cookie: cookieB } });
    if (listB.response.status !== 200) return { status: 'fail', detail: `Account B could not list its library (${listB.response.status}).` };
    let forms = [];
    try { forms = JSON.parse(listB.body)?.forms ?? []; } catch { /* empty */ }
    if (!forms.length) {
      return { status: 'info', detail: 'Account B has no library entries, so cross-account access could not be exercised. Import or create a form with account B and rerun.' };
    }
    const target = forms[0];
    const id = target.id ?? target.formId;
    const readWithA = await request(`/api/forms/library/${encodeURIComponent(id)}`, { headers: { Cookie: state.cookie } });
    if (readWithA.response.status === 200) return { status: 'fail', detail: 'Account A read account B\'s form record. Ownership scoping is broken.' };
    const listWithA = await request('/api/forms/library', { headers: { Cookie: state.cookie } });
    let aForms = [];
    try { aForms = JSON.parse(listWithA.body)?.forms ?? []; } catch { /* empty */ }
    const leaked = aForms.some(form => (form.id ?? form.formId) === id);
    if (leaked) return { status: 'fail', detail: 'Account A\'s library contains account B\'s form.' };
    return { status: 'pass', detail: `Account A was denied (${readWithA.response.status}) and the record is absent from A's library.` };
  });

  add('ai-check', 'Opt-in: one metered interpretation returns a reviewed proposal', async () => {
    if (!options.aiCheck) return { status: 'skip', detail: 'Pass --ai-check to spend 1+ credits on a real interpretation against production.' };
    if (!state.cookie) return { status: 'skip', detail: 'Requires a successful sign-in.' };
    const balanceBefore = await request('/api/credits', { headers: { Cookie: state.cookie } });
    const operationId = `verify-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
    const { response, body } = await request('/api/forms/interpret', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Cookie: state.cookie, Origin: baseUrl },
      body: JSON.stringify({ prompt: 'Create a customer feedback form.', operationId }),
    });
    if (response.status === 402) return { status: 'warn', detail: 'The account has no affordable credits; nothing was charged.' };
    if (response.status === 503) return { status: 'fail', detail: 'Interpretation storage is unavailable (rate limiter or credit tables). Check migrations 006 and 007.' };
    if (response.status !== 200) return { status: 'fail', detail: `Interpretation returned ${response.status}. ${body.slice(0, 200)}` };
    if (FORBIDDEN_BODY_KEYS.test(body)) return { status: 'fail', detail: 'The interpretation response contains a credential-like field.' };
    const balanceAfter = await request('/api/credits', { headers: { Cookie: state.cookie } });
    let before = null; let after = null;
    try { before = JSON.parse(balanceBefore.body); after = JSON.parse(balanceAfter.body); } catch { /* handled below */ }
    if (before && after && before.balances?.daily?.available !== undefined && after.balances?.daily?.available !== undefined) {
      const beforeTotal = (before.balances.daily.available ?? 0) + (before.balances.monthly?.available ?? 0);
      const afterTotal = (after.balances.daily.available ?? 0) + (after.balances.monthly?.available ?? 0);
      if (afterTotal >= beforeTotal) return { status: 'fail', detail: `Credits were not deducted (${beforeTotal} → ${afterTotal}) although interpretation succeeded.` };
      return { status: 'pass', detail: `Proposal returned and credits moved ${beforeTotal} → ${afterTotal}.` };
    }
    return { status: 'info', detail: 'Proposal returned; balance shape could not be compared automatically.' };
  });

  add('rate-limit', 'Opt-in: abuse limits return 429 with Retry-After', async () => {
    if (!options.rateLimitCheck) return { status: 'skip', detail: 'Pass --rate-limit-check to exercise the provider OAuth start limit (8 per 10 minutes).' };
    if (!state.cookie) return { status: 'skip', detail: 'Requires a successful sign-in.' };
    // Deliberately independent of the Google *sign-in* capability: sign-in identity and the Google
    // Forms provider grant are separate OAuth clients and separate limits.
    for (let attempt = 1; attempt <= 12; attempt += 1) {
      const { response } = await request('/api/providers/google/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Cookie: state.cookie, Origin: baseUrl },
        body: JSON.stringify({}),
        redirect: 'manual',
      });
      if (response.status === 429) {
        return response.headers.get('retry-after')
          ? { status: 'pass', detail: `429 on attempt ${attempt} with Retry-After: ${response.headers.get('retry-after')}s. This account is now rate-limited for the OAuth scope; wait out the window before further provider testing.` }
          : { status: 'fail', detail: `429 on attempt ${attempt} without a Retry-After header.` };
      }
      if (response.status >= 500) {
        return response.status === 503
          ? { status: 'fail', detail: 'Provider start returned 503: shared limiter storage is unavailable. Check that migration 006 is applied.' }
          : { status: 'fail', detail: `Provider start returned ${response.status}.` };
      }
    }
    return { status: 'warn', detail: 'No 429 within 12 attempts: either the limiter did not engage or the Google Forms provider is not configured on this deployment. Confirm migration 006 and GOOGLE_OAUTH_CLIENT_ID/SECRET.' };
  });

  add('sign-out', 'Signing out invalidates the session', async () => {
    if (!state.cookie) return { status: 'skip', detail: 'Requires a successful sign-in.' };
    const { response } = await request('/api/auth/sign-out', { method: 'POST', headers: { 'Content-Type': 'application/json', Cookie: state.cookie, Origin: baseUrl }, body: JSON.stringify({}) });
    if (response.status >= 500) return { status: 'fail', detail: `Sign-out returned ${response.status}.` };
    const after = await request('/api/me', { headers: { Cookie: state.cookie } });
    if (after.response.status !== 401) return { status: 'fail', detail: `/api/me returned ${after.response.status} after sign-out; the session is still valid.` };
    return { status: 'pass', detail: 'Session cleared and subsequent reads return 401.' };
  });

  return checks;
}

export async function runVerification({ baseUrl, fetchImpl = fetch, options, log = () => {} }) {
  const state = { cookie: null, cookieFlags: null, googleSignIn: null };
  const request = async (path, init = {}) => {
    const response = await fetchImpl(`${baseUrl}${path}`, {
      redirect: 'manual',
      ...init,
      headers: { Accept: 'application/json, text/html;q=0.9', ...(init.headers ?? {}) },
      signal: AbortSignal.timeout(options.timeoutMs),
    });
    const body = await readBody(response);
    return { response, body };
  };
  const checks = buildChecks({ baseUrl, request, options, state });
  const results = [];
  for (const check of checks) {
    log(`${check.title} …`);
    try {
      const result = await check.run();
      results.push({ id: check.id, title: check.title, status: result.status, detail: result.detail });
    } catch (error) {
      results.push({
        id: check.id,
        title: check.title,
        status: 'fail',
        detail: `Check threw: ${error instanceof Error ? error.message : String(error)}. A timeout or connection error usually means the origin is unreachable from here.`,
      });
    }
  }
  return { baseUrl, results, ok: !results.some(result => result.status === 'fail') };
}

export function formatResults(report) {
  const { results } = report;
  const lines = [`Intake production verification — ${report.baseUrl}`, ''];
  for (const result of [...results].sort((a, b) => STATUS_ORDER[a.status] - STATUS_ORDER[b.status])) {
    lines.push(`[${result.status.toUpperCase().padEnd(4)}] ${result.title}`);
    lines.push(`         ${result.detail}`);
  }
  const counts = report.results.reduce((totals, result) => ({ ...totals, [result.status]: (totals[result.status] ?? 0) + 1 }), {});
  lines.push('', `${report.results.length} checks — ${counts.fail ?? 0} failed, ${counts.warn ?? 0} warnings, ${counts.pass ?? 0} passed, ${counts.skip ?? 0} skipped, ${counts.info ?? 0} informational.`);
  if (!report.ok) lines.push('', 'Fix the failures above; the automated checks cover infrastructure, sessions and authorization only. Google Forms create/edit and AI quality still require the manual checklist in LAUNCH.md.');
  return lines.join('\n');
}

async function main() {
  let options;
  try {
    options = parseArgs(process.argv.slice(2));
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  if (options.help || !options.baseUrl) {
    process.stdout.write(`Intake production verification\n\n  node tools/verify-production.mjs --base-url https://your-domain [options]\n\nOptions:\n  --expect-google-sign-in=yes|no|any   assert the public sign-in capability\n  --email / --password                 account for authenticated checks ($INTAKE_VERIFY_EMAIL, $INTAKE_VERIFY_PASSWORD)\n  --credentials-file <path>            JSON with email/password/emailB/passwordB\n  --cross-user                         with --email-b/--password-b, verify ownership isolation\n  --ai-check                           spend real credits on one interpretation\n  --rate-limit-check                   exercise the OAuth-start limiter (429 + Retry-After)\n  --timeout <ms>                       per-request timeout (default ${TIMEOUT_DEFAULT_MS})\n  --json                               machine-readable report\n\nRead-only unless credentials, --ai-check or --rate-limit-check are supplied.\n`);
    return;
  }
  let baseUrl;
  try {
    baseUrl = normalizeBaseUrl(options.baseUrl);
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
    process.exitCode = 1;
    return;
  }
  const report = await runVerification({ baseUrl, options, log: options.json ? () => {} : message => process.stderr.write(`${message}\r`) });
  process.stdout.write(options.json ? `${JSON.stringify(report, null, 2)}\n` : `${formatResults(report)}\n`);
  if (!report.ok) process.exitCode = 1;
}

const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false;
if (invokedDirectly) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Verification failed'}\n`);
    process.exitCode = 1;
  });
}
