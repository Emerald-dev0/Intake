import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import express from 'express';
import { readGoogleSignInConfig, googleSocialProviders, publicSignInConfig, ACCOUNT_LINKING_POLICY } from '../server/sign-in/google.ts';
import { createSignInRouter } from '../server/sign-in/routes.ts';
import { isProviderConfigured, providerDefinition } from '../server/providers/registry.ts';

const SIGN_IN_ENV = { GOOGLE_CLIENT_ID: 'signin-client.apps.googleusercontent.com', GOOGLE_CLIENT_SECRET: 'signin-secret-value' };
const FORMS_ENV = { GOOGLE_OAUTH_CLIENT_ID: 'forms-client.apps.googleusercontent.com', GOOGLE_OAUTH_CLIENT_SECRET: 'forms-secret-value' };

test('google sign-in is unconfigured, half configured, or fully configured — never faked', () => {
  assert.equal(readGoogleSignInConfig({}), null);
  assert.equal(readGoogleSignInConfig({ GOOGLE_CLIENT_ID: '', GOOGLE_CLIENT_SECRET: '   ' }), null);
  assert.equal(googleSocialProviders({}), undefined);
  // A half-configured provider is an operator error, not a silently disabled button.
  assert.throws(() => readGoogleSignInConfig({ GOOGLE_CLIENT_ID: SIGN_IN_ENV.GOOGLE_CLIENT_ID }), /both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
  assert.throws(() => readGoogleSignInConfig({ GOOGLE_CLIENT_SECRET: SIGN_IN_ENV.GOOGLE_CLIENT_SECRET }), /both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET/);
  // Placeholders and copies never become a live provider.
  assert.throws(() => readGoogleSignInConfig({ GOOGLE_CLIENT_ID: 'YOUR_GOOGLE_CLIENT_ID', GOOGLE_CLIENT_SECRET: 'placeholder-secret' }), /placeholder/);
  assert.throws(() => readGoogleSignInConfig({ GOOGLE_CLIENT_ID: 'same', GOOGLE_CLIENT_SECRET: 'same' }), /not a copy of the client id/);
  assert.deepEqual(readGoogleSignInConfig(SIGN_IN_ENV), { clientId: SIGN_IN_ENV.GOOGLE_CLIENT_ID, clientSecret: SIGN_IN_ENV.GOOGLE_CLIENT_SECRET });
  assert.deepEqual(googleSocialProviders(SIGN_IN_ENV), { google: { clientId: SIGN_IN_ENV.GOOGLE_CLIENT_ID, clientSecret: SIGN_IN_ENV.GOOGLE_CLIENT_SECRET } });
});

test('sign-in credentials and Google Forms credentials never cross', () => {
  // A server with only Forms credentials has Google sign-in disabled, and vice versa.
  assert.equal(readGoogleSignInConfig(FORMS_ENV), null);
  assert.deepEqual(publicSignInConfig(FORMS_ENV), { providers: { google: false } });
  assert.deepEqual(publicSignInConfig(SIGN_IN_ENV), { providers: { google: true } });
  assert.deepEqual(publicSignInConfig({ ...SIGN_IN_ENV, ...FORMS_ENV }), { providers: { google: true } });
  // The Forms provider definition still reads its own variables and its own callback.
  const formsProvider = providerDefinition('google', FORMS_ENV);
  assert.equal(formsProvider.clientIdEnv, 'GOOGLE_OAUTH_CLIENT_ID');
  assert.equal(formsProvider.clientSecretEnv, 'GOOGLE_OAUTH_CLIENT_SECRET');
  assert.equal(isProviderConfigured(formsProvider, SIGN_IN_ENV), false, 'sign-in credentials must not configure the Forms connection');
  // A provider fragment can never carry Forms scope: identity only.
  const fragment = googleSocialProviders(SIGN_IN_ENV);
  assert.deepEqual(Object.keys(fragment.google).sort(), ['clientId', 'clientSecret']);
  assert.equal(JSON.stringify(fragment).includes('forms.body'), false);
});

test('account linking never silently merges an unverified password account', () => {
  assert.equal(ACCOUNT_LINKING_POLICY.enabled, true);
  assert.deepEqual(ACCOUNT_LINKING_POLICY.trustedProviders, ['google']);
  assert.equal(ACCOUNT_LINKING_POLICY.trustedProviders.includes('email-password'), false);
  assert.equal(ACCOUNT_LINKING_POLICY.allowDifferentEmails, false);
  assert.equal(ACCOUNT_LINKING_POLICY.requireLocalEmailVerified, true);
});

test('Better Auth is wired for Google sign-in only when credentials exist, and keeps hardened session settings', async () => {
  const origin = 'https://intake.example.test';
  const previous = { ...process.env };
  process.env.BETTER_AUTH_SECRET = 'test-secret-value-that-is-at-least-32-characters';
  process.env.BETTER_AUTH_URL = origin;
  process.env.DATABASE_URL = 'postgresql://user:pass@127.0.0.1:5432/intake';
  process.env.NODE_ENV = 'test';
  Object.assign(process.env, SIGN_IN_ENV, FORMS_ENV);
  delete process.env.MICROSOFT_OAUTH_CLIENT_ID;
  delete process.env.MICROSOFT_OAUTH_CLIENT_SECRET;
  try {
    const { auth, googleSignInEnabled } = await import('../server/auth.ts');
    assert.equal(googleSignInEnabled, true);
    const options = auth.options;
    assert.equal(options.socialProviders.google.clientId, SIGN_IN_ENV.GOOGLE_CLIENT_ID, 'social sign-in must not read GOOGLE_OAUTH_CLIENT_ID');
    assert.equal(options.socialProviders.google.clientSecret, SIGN_IN_ENV.GOOGLE_CLIENT_SECRET);
    assert.equal(options.socialProviders.google.scope, undefined, 'Google sign-in must not request extra scopes');
    assert.deepEqual(options.account.accountLinking, ACCOUNT_LINKING_POLICY);
    assert.deepEqual(options.trustedOrigins, [origin], 'trusted origins stay restricted to the configured origin');
    assert.equal(options.emailAndPassword.enabled, true, 'email/password keeps working');
    assert.equal(options.rateLimit.enabled, true);
    assert.equal(options.baseURL, origin);
    // The Google Forms connection stays separately configured.
    assert.equal(isProviderConfigured(providerDefinition('google', process.env), process.env), true);
  } finally {
    process.env = previous;
  }
});

test('a server without Google sign-in credentials registers no social provider at all', async () => {
  const origin = 'https://intake.example.test';
  const script = `import { auth, googleSignInEnabled } from './server/auth.ts';
console.log(JSON.stringify({ googleSignInEnabled, socialProviders: auth.options.socialProviders ?? null }));`;
  const child = spawn('./node_modules/.bin/tsx', ['--eval', script], {
    env: {
      ...process.env,
      NODE_ENV: 'test',
      DATABASE_URL: 'postgresql://user:pass@127.0.0.1:5432/intake',
      BETTER_AUTH_SECRET: 'test-secret-value-that-is-at-least-32-characters',
      BETTER_AUTH_URL: origin,
      GOOGLE_CLIENT_ID: '',
      GOOGLE_CLIENT_SECRET: '',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let output = '';
  let errors = '';
  child.stdout.on('data', chunk => { output += chunk; });
  child.stderr.on('data', chunk => { errors += chunk; });
  const code = await new Promise(resolve => child.once('exit', resolve));
  assert.equal(code, 0, errors || output);
  const parsed = JSON.parse(output.trim().split('\n').pop());
  assert.equal(parsed.googleSignInEnabled, false);
  assert.ok(!parsed.socialProviders || Object.keys(parsed.socialProviders).length === 0, 'no provider may be advertised without credentials');
});

test('the public sign-in config endpoint exposes booleans and nothing else', async () => {
  const app = express();
  app.use('/api/sign-in', createSignInRouter({ env: { ...SIGN_IN_ENV, GOOGLE_OAUTH_CLIENT_ID: FORMS_ENV.GOOGLE_OAUTH_CLIENT_ID } }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  try {
    const response = await fetch(`http://127.0.0.1:${server.address().port}/api/sign-in/config`);
    const body = await response.json();
    assert.equal(response.status, 200);
    assert.deepEqual(body, { providers: { google: true } });
    assert.equal(response.headers.get('cache-control'), 'no-store');
    const raw = JSON.stringify(body);
    for (const secret of [...Object.values(SIGN_IN_ENV), ...Object.values(FORMS_ENV), 'redirect', 'scope', 'client_id']) {
      assert.equal(raw.includes(secret), false, `sign-in config leaked ${secret}`);
    }
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

test('the browser auth client keeps the session in cookies and never stores tokens', async () => {
  const client = await readFile('src/lib/auth.ts', 'utf8');
  assert.equal(/localStorage|sessionStorage|document\.cookie/.test(client), false, 'no browser token storage may be introduced');
  assert.match(client, /basePath: '\/api\/auth'/);
  const page = await readFile('src/app/pages/AuthPage.tsx', 'utf8');
  assert.match(page, /signIn\.social\(\{ provider: 'google', callbackURL: '\/app'/);
  assert.equal(/[A-Za-z0-9_-]{3,}\.apps\.googleusercontent\.com/.test(page), false, 'no client id may reach the browser bundle');
  // OAuth errors are mapped to plain language; raw codes are never rendered.
  assert.match(page, /account_not_linked/);
  assert.equal(/error_description/.test(page), false, 'raw provider error text must not be rendered');
});
