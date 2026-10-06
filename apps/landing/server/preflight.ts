/**
 * Configuration preflight for a deployed (or about-to-be-deployed) API service.
 *
 * Purpose: answer "is this environment actually complete and safe?" **before** Render starts
 * serving traffic, without ever printing a credential. It is intentionally read-only and performs
 * no network calls unless `--db` is passed, in which case it runs read-only queries.
 *
 * Usage (from `apps/landing`):
 *
 *   npm run preflight                # validate process environment (+ .env when present)
 *   npm run preflight -- --db        # additionally verify PostgreSQL connectivity and migrations
 *   npm run preflight -- --json      # machine-readable output for CI or a deploy script
 *
 * Exit code is 0 when nothing failed, 1 when at least one check has status `fail`. Warnings never
 * fail the command; they mark decisions an operator still has to make.
 */
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { readCoreServerConfig } from './config';
import { isProviderConfigured, supportedProviders } from './providers/registry';
import { aiProviderLabel } from './ai/registry';
import { readGoogleSignInConfig } from './sign-in/google';
import { isTestCredential, readEmailConfig } from './email/config';

export type PreflightStatus = 'pass' | 'warn' | 'fail' | 'info';

export interface PreflightCheck {
  name: string;
  status: PreflightStatus;
  detail: string;
}

const MINIMUM_NODE = [22, 12, 0] as const;
const PREVIEW_HOST = /(?:^|\.)e2b\.app$|-git-|^localhost$|^127\.0\.0\.1$|\.vercel\.app$/i;
const PUBLIC_SECRET_KEY = /^VITE_(?:.*(?:SECRET|TOKEN|KEY|PASSWORD|DATABASE|AUTH|CREDENTIAL|DSN).*)$/i;

/** Keys whose accidental `VITE_` prefix would ship a server secret to every browser. */
export function leakedPublicSecretKeys(env: NodeJS.ProcessEnv): string[] {
  return Object.keys(env).filter(key => PUBLIC_SECRET_KEY.test(key) && Boolean(env[key]?.trim()));
}

function allowlistedAdminCount(raw: string | undefined): number {
  return (raw ?? '').split(',').map(value => value.trim()).filter(value => /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value)).length;
}

function nodeTooOld(): boolean {
  const [major = 0, minor = 0, patch = 0] = process.versions.node.split('.').map(Number);
  const [minMajor, minMinor, minPatch] = MINIMUM_NODE;
  if (major !== minMajor) return major < minMajor;
  if (minor !== minMinor) return minor < minMinor;
  return patch < minPatch;
}

/**
 * Pure environment assessment. Exported so tests can assert both the findings and the guarantee that
 * no credential value ever appears in the output.
 */
export function runPreflight(env: NodeJS.ProcessEnv = process.env): PreflightCheck[] {
  const checks: PreflightCheck[] = [];
  const add = (name: string, status: PreflightStatus, detail: string): void => { checks.push({ name, status, detail }); };

  add('node', nodeTooOld() ? 'fail' : 'pass', nodeTooOld()
    ? `Node ${process.versions.node} is older than the required 22.12.0.`
    : `Node ${process.versions.node}.`);

  add('NODE_ENV', env.NODE_ENV === 'production' ? 'pass' : 'warn', env.NODE_ENV === 'production'
    ? 'production; production-only validation is enforced.'
    : `"${env.NODE_ENV ?? 'unset'}"; the API is not running with production validation. Use NODE_ENV=production on Render.`);

  // The core validator covers DATABASE_URL TLS, BETTER_AUTH_SECRET strength, BETTER_AUTH_URL
  // exactness/HTTPS, PORT and API_TRUST_PROXY_HOPS bounds. It never echoes values.
  let core: ReturnType<typeof readCoreServerConfig> | null = null;
  try {
    core = readCoreServerConfig(env);
    add('core configuration', 'pass', 'DATABASE_URL, BETTER_AUTH_SECRET, BETTER_AUTH_URL, PORT and API_TRUST_PROXY_HOPS are present and valid.');
  } catch (error) {
    add('core configuration', 'fail', error instanceof Error ? error.message : 'Core configuration is invalid.');
  }

  if (core) {
    add('forwarded addresses', core.trustProxyHops === 0 ? 'warn' : 'info', core.trustProxyHops === 0
      ? 'API_TRUST_PROXY_HOPS=0: forwarded client addresses are ignored. Per-IP limiting is grouped behind the proxy; keep 0 until the Render/Vercel chain is verified in a real request.'
      : `API_TRUST_PROXY_HOPS=${core.trustProxyHops}. Confirm this equals the real number of trusted proxy hops; trusting too many allows address spoofing.`);
    if (PREVIEW_HOST.test(new URL(core.publicOrigin).hostname)) {
      add('BETTER_AUTH_URL', 'warn', 'The auth origin looks like a preview or loopback host. Trusted origins, cookies and OAuth callbacks should point at the real production origin.');
    }
  }

  const leaked = leakedPublicSecretKeys(env);
  add('browser-exposed secrets', leaked.length ? 'fail' : 'pass', leaked.length
    // Names only: the variable name is the finding; the value must never be printed.
    ? `These variables look like server secrets but are exposed to browser bundles: ${leaked.join(', ')}. Remove the VITE_ prefix and set them on the API service only.`
    : 'No VITE_-prefixed variable looks like a credential.');

  add('PROVIDER_TOKEN_KEY', env.PROVIDER_TOKEN_KEY?.trim() ? 'pass' : 'warn', env.PROVIDER_TOKEN_KEY?.trim()
    ? 'Dedicated provider-token encryption key is set; rotating BETTER_AUTH_SECRET will not invalidate stored connections.'
    : 'Not set: provider tokens are encrypted with a key derived from BETTER_AUTH_SECRET, so rotating that secret requires users to reconnect Google.');

  const providerSetup = supportedProviders(env)
    .map(provider => `${provider.name} ${isProviderConfigured(provider, env) ? 'configured' : 'not configured'}`)
    .join('; ');
  const googleConfigured = supportedProviders(env).some(provider => provider.id === 'google' && isProviderConfigured(provider, env));
  add('provider connections', googleConfigured ? 'pass' : 'warn', googleConfigured
    ? providerSetup
    : `${providerSetup}. Google Forms connection/creation is unavailable until GOOGLE_OAUTH_CLIENT_ID and GOOGLE_OAUTH_CLIENT_SECRET are set and the Forms API is enabled in that Google Cloud project.`);

  let googleSignIn = false;
  try {
    googleSignIn = readGoogleSignInConfig(env) !== null;
    add('Google sign-in', googleSignIn ? 'pass' : 'warn', googleSignIn
      ? 'Configured (identity only). Confirm the redirect URI is exactly ${BETTER_AUTH_URL}/api/auth/callback/google on that client.'
      : 'Not configured: the Google sign-in button is hidden and email/password remains available. Set both GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to enable it.');
  } catch (error) {
    add('Google sign-in', 'fail', error instanceof Error ? error.message : 'GOOGLE_CLIENT_ID/GOOGLE_CLIENT_SECRET are invalid.');
  }

  try {
    const label = aiProviderLabel(env);
    add('AI provider', label.startsWith('not configured') ? 'fail' : 'pass', label.startsWith('not configured')
      ? `${label}. Interpretation returns model_not_configured and never charges a user, but the product cannot create or edit forms.`
      : `${label}. Confirm GROQ_API_KEY is set on the API service only.`);
  } catch (error) {
    add('AI provider', 'fail', error instanceof Error ? error.message : 'AI provider configuration is invalid.');
  }

  const admins = allowlistedAdminCount(env.ADMIN_EMAILS);
  add('ADMIN_EMAILS', admins === 0 ? 'warn' : 'pass', admins === 0
    ? 'No valid address in ADMIN_EMAILS: /admin and /api/admin/* deny everyone. That is a safe default, not a usable console.'
    : `${admins} allowlisted address${admins === 1 ? '' : 'es'}. Each must exist in the database with emailVerified=true; this checkout sends no verification email.`);

  const microsoftConfigured = Boolean(env.MICROSOFT_OAUTH_CLIENT_ID?.trim());
  add('Microsoft', 'info', microsoftConfigured
    ? 'Microsoft credentials are present, but Microsoft Forms creation/editing is not implemented. Intake must not claim it works.'
    : 'Not configured; Microsoft Forms creation is unsupported.');

  add('payments', 'info', 'No payment provider is integrated: plans change only through a deliberate server-side database operation. Checkout UI stays display-only.');

  // Email is real infrastructure now, so it gets a real check. Names only: never a key or a secret.
  try {
    const email = readEmailConfig(env);
    if (email.provider === 'none') {
      add('email', 'warn', 'EMAIL_PROVIDER=none: no transactional email is delivered. Verification, password reset, welcome and security email are all inert.');
    } else if (!email.configured) {
      add('email', 'fail', 'Transactional email is not usable: set CALDER_API_KEY and either CALDER_FROM_EMAIL or CALDER_SENDER_ID. Verification, password reset and security notices cannot be delivered without them.');
    } else if (isTestCredential(email)) {
      add('email', 'warn', `Calder is configured with a TEST key: nothing reaches a real inbox. Deliveries are simulated, so this is correct for staging and wrong for production.`);
    } else {
      add('email', 'pass', `Calder is configured (${email.baseUrl}, sender ${email.fromEmail || email.senderId || 'sender id'}). Confirm the sending domain's SPF, DKIM and DMARC records and that CALDER_WEBHOOK_SECRET matches the registered endpoint.`);
    }
    add('email webhooks', email.webhookSecret ? 'pass' : 'warn', email.webhookSecret
      ? 'CALDER_WEBHOOK_SECRET is set: delivery, bounce and complaint events are verified before they change state.'
      : 'No CALDER_WEBHOOK_SECRET: Calder webhooks are rejected. Delivery, bounce and complaint state will never update, so suppressions cannot be maintained automatically.');
    if (email.provider === 'memory') {
      add('email provider', 'fail', 'EMAIL_PROVIDER=memory records email in process memory only. It is a test transport and must never be set in a deployed environment.');
    }
  } catch (error) {
    add('email', 'fail', error instanceof Error ? error.message : 'Email configuration is invalid.');
  }

  return checks;
}

export function preflightFailed(checks: readonly PreflightCheck[]): boolean {
  return checks.some(check => check.status === 'fail');
}

const MARK: Record<PreflightStatus, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL', info: 'INFO' };

export function formatPreflight(checks: readonly PreflightCheck[]): string {
  const lines = checks.map(check => `[${MARK[check.status]}] ${check.name}: ${check.detail}`);
  const failures = checks.filter(check => check.status === 'fail').length;
  const warnings = checks.filter(check => check.status === 'warn').length;
  lines.push('', `${checks.length} checks: ${failures} failed, ${warnings} warning${warnings === 1 ? '' : 's'}.`);
  return lines.join('\n');
}

const EXPECTED_TABLES = [
  '"user"', 'session', 'account', 'verification',
  'provider_connection', 'form', 'form_draft', 'form_edit_draft',
  'api_rate_limit', 'user_entitlement', 'credit_ledger', 'ai_operation',
  'email_delivery', 'email_suppression', 'email_webhook_event', 'user_sign_in_marker',
];

/** Read-only database verification. Never prints the connection string or row contents. */
export async function checkDatabase(env: NodeJS.ProcessEnv = process.env): Promise<PreflightCheck[]> {
  const checks: PreflightCheck[] = [];
  const connectionString = env.DATABASE_URL?.trim();
  if (!connectionString) return [{ name: 'database', status: 'fail', detail: 'DATABASE_URL is not set; cannot run --db checks.' }];
  const { Pool } = await import('pg');
  const pool = new Pool({ connectionString, max: 1, connectionTimeoutMillis: 10_000 });
  try {
    const started = Date.now();
    await pool.query('SELECT 1');
    checks.push({ name: 'database connectivity', status: 'pass', detail: `Connected in ${Date.now() - started} ms.` });

    const tables = await pool.query<{ present: string | null; migrations: string | null }>(
      `SELECT to_regclass('public."user"')::text AS present, to_regclass('public.intake_schema_migration')::text AS migrations`,
    );
    const missing: string[] = [];
    for (const table of EXPECTED_TABLES) {
      const result = await pool.query<{ present: string | null }>(`SELECT to_regclass($1)::text AS present`, [`public.${table}`]);
      if (!result.rows[0]?.present) missing.push(table);
    }
    checks.push(missing.length
      ? { name: 'schema', status: 'fail', detail: `Missing tables: ${missing.join(', ')}. Run npm run db:migrate (Better Auth) and then npm run db:migrate:intake.` }
      : { name: 'schema', status: 'pass', detail: `All ${EXPECTED_TABLES.length} expected tables exist.` });

    if (tables.rows[0]?.migrations) {
      const applied = await pool.query<{ id: string }>('SELECT id FROM intake_schema_migration ORDER BY id');
      checks.push({ name: 'intake migrations', status: applied.rowCount ? 'pass' : 'fail', detail: applied.rowCount
        ? `${applied.rowCount} applied: ${applied.rows.map(row => row.id).join(', ')}.`
        : 'The migration table exists but no migration is recorded. Run npm run db:migrate:intake.' });
    } else {
      checks.push({ name: 'intake migrations', status: 'fail', detail: 'intake_schema_migration is missing. Run npm run db:migrate, then npm run db:migrate:intake.' });
    }
  } catch (error) {
    checks.push({ name: 'database', status: 'fail', detail: error instanceof Error ? `Database check failed: ${error.message.replace(/postgres(?:ql)?:\/\/\S+/gi, 'postgresql://[redacted]')}` : 'Database check failed.' });
  } finally {
    await pool.end().catch(() => undefined);
  }
  return checks;
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const wantsJson = argv.includes('--json');
  const wantsDatabase = argv.includes('--db');
  const checks = runPreflight();
  if (wantsDatabase) checks.push(...await checkDatabase());
  if (wantsJson) {
    process.stdout.write(`${JSON.stringify({ ok: !preflightFailed(checks), checks }, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatPreflight(checks)}\n`);
  }
  if (preflightFailed(checks)) process.exitCode = 1;
}

/** True when this file is the process entry point (`npm run preflight`), false when imported. */
const invokedDirectly = process.argv[1] ? import.meta.url === pathToFileURL(resolve(process.argv[1])).href : false;
if (invokedDirectly) {
  main().catch(error => {
    process.stderr.write(`${error instanceof Error ? error.message : 'Preflight failed'}\n`);
    process.exitCode = 1;
  });
}
