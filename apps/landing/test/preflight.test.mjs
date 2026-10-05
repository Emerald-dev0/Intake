import { test } from 'node:test';
import assert from 'node:assert/strict';
import { formatPreflight, leakedPublicSecretKeys, preflightFailed, runPreflight } from '../server/preflight.ts';

const SECRET = 'super-secret-value-that-must-never-appear';
const AUTH_SECRET = 'b'.repeat(48);

const completeProductionEnv = (overrides = {}) => ({
  NODE_ENV: 'production',
  DATABASE_URL: 'postgresql://intake:db-password@ep-example.neon.tech/intake?sslmode=require',
  BETTER_AUTH_SECRET: AUTH_SECRET,
  BETTER_AUTH_URL: 'https://intake.example.com',
  PROVIDER_TOKEN_KEY: 'c'.repeat(48),
  GOOGLE_CLIENT_ID: 'sign-in-client.apps.googleusercontent.com',
  GOOGLE_CLIENT_SECRET: 'sign-in-secret',
  GOOGLE_OAUTH_CLIENT_ID: 'forms-client.apps.googleusercontent.com',
  GOOGLE_OAUTH_CLIENT_SECRET: 'forms-secret',
  GROQ_API_KEY: SECRET,
  ADMIN_EMAILS: 'owner@example.com',
  API_TRUST_PROXY_HOPS: '0',
  ...overrides,
});

const statuses = checks => Object.fromEntries(checks.map(check => [check.name, check.status]));

test('a complete production environment passes every preflight check', () => {
  const checks = runPreflight(completeProductionEnv());
  assert.equal(preflightFailed(checks), false, formatPreflight(checks));
  const byName = statuses(checks);
  assert.equal(byName['core configuration'], 'pass');
  assert.equal(byName['AI provider'], 'pass');
  assert.equal(byName['provider connections'], 'pass');
  assert.equal(byName['Google sign-in'], 'pass');
  assert.equal(byName['ADMIN_EMAILS'], 'pass');
  assert.equal(byName['browser-exposed secrets'], 'pass');
});

test('an incomplete deployment reports actionable failures and warnings, never a credential value', () => {
  const checks = runPreflight({
    NODE_ENV: 'production',
    DATABASE_URL: 'postgresql://intake:db-password@ep-example.neon.tech/intake',
    BETTER_AUTH_SECRET: 'short',
    BETTER_AUTH_URL: 'http://intake.example.com',
    GROQ_API_KEY: '',
  });
  const byName = statuses(checks);
  assert.equal(byName['core configuration'], 'fail', 'TLS, secret strength and HTTPS are enforced before listening');
  assert.equal(byName['AI provider'], 'fail', 'without a model key interpretation cannot work');
  assert.equal(byName['provider connections'], 'warn');
  assert.equal(byName['ADMIN_EMAILS'], 'warn');
  assert.equal(preflightFailed(checks), true);

  const output = formatPreflight(checks);
  assert.doesNotMatch(output, /db-password/, 'the database password never reaches stdout');
  assert.doesNotMatch(output, /postgresql:\/\//, 'the connection string never reaches stdout');
});

test('a server secret accidentally prefixed with VITE_ is a hard failure, by name only', () => {
  const env = completeProductionEnv({ VITE_GROQ_API_KEY: SECRET, VITE_DATABASE_URL: 'postgresql://leak', VITE_SITE_URL: 'https://intake.example.com' });
  assert.deepEqual(leakedPublicSecretKeys(env).sort(), ['VITE_DATABASE_URL', 'VITE_GROQ_API_KEY']);
  const checks = runPreflight(env);
  assert.equal(statuses(checks)['browser-exposed secrets'], 'fail');
  const output = formatPreflight(checks);
  assert.match(output, /VITE_GROQ_API_KEY/, 'the operator is told which variable to fix');
  assert.doesNotMatch(output, /super-secret-value-that-must-never-appear/);
  assert.doesNotMatch(output, /postgresql:\/\/leak/);
  // A public build variable that is not a credential stays legitimate.
  assert.equal(leakedPublicSecretKeys({ VITE_SITE_URL: 'https://intake.example.com', VITE_WAITLIST_URL: 'https://x.test' }).length, 0);
});

test('half-configured Google sign-in fails loudly instead of offering a broken button', () => {
  const checks = runPreflight(completeProductionEnv({ GOOGLE_CLIENT_SECRET: '' }));
  assert.equal(statuses(checks)['Google sign-in'], 'fail');
});

test('a non-production environment is reported, and an unset NODE_ENV never grants production validation', () => {
  const development = runPreflight({ ...completeProductionEnv(), NODE_ENV: undefined });
  assert.equal(statuses(development).NODE_ENV, 'warn');
  assert.match(formatPreflight(development), /NODE_ENV/);
});

test('preview or loopback auth origins and unverified proxy depth are surfaced as operator decisions', () => {
  const preview = runPreflight(completeProductionEnv({ BETTER_AUTH_URL: 'https://intake-git-main.example.vercel.app', API_TRUST_PROXY_HOPS: '2' }));
  const output = formatPreflight(preview);
  assert.match(output, /preview or loopback/);
  assert.match(output, /API_TRUST_PROXY_HOPS=2/);
  assert.equal(preflightFailed(preview), false, 'these are warnings: the operator confirms the real chain');
});
