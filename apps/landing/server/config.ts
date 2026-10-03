const PLACEHOLDER = /^(?:change[-_ ]?me|placeholder(?:[-_ ].*)?|example(?:[-_ ].*)?|todo(?:[-_ ].*)?|your(?:[-_ <].*)?|x{3,})$/i;

/** Shared credential hygiene check: operators must not ship obvious placeholder secrets. */
export function isPlaceholderValue(value: string): boolean {
  return PLACEHOLDER.test(value);
}

export interface CoreServerConfig {
  databaseUrl: string;
  authSecret: string;
  publicOrigin: string;
  port: number;
  trustProxyHops: number;
  production: boolean;
}

function required(env: NodeJS.ProcessEnv, name: string): string {
  const value = env[name]?.trim();
  if (!value) throw new Error(`${name} is required. See .env.example.`);
  return value;
}

function exactOrigin(value: string, production: boolean): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('BETTER_AUTH_URL must be an exact http(s) origin with no path, query, hash, or credentials.'); }
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || (url.pathname !== '/' && url.pathname !== '')) {
    throw new Error('BETTER_AUTH_URL must be an exact http(s) origin with no path, query, hash, or credentials.');
  }
  if (production && url.protocol !== 'https:') throw new Error('BETTER_AUTH_URL must use HTTPS when NODE_ENV=production.');
  return url.origin;
}

function databaseUrl(value: string, production: boolean): string {
  let url: URL;
  try { url = new URL(value); }
  catch { throw new Error('DATABASE_URL must be a valid PostgreSQL connection URL.'); }
  if (url.protocol !== 'postgresql:' && url.protocol !== 'postgres:') throw new Error('DATABASE_URL must use postgresql:// or postgres://.');
  if (!url.hostname || !url.pathname || url.pathname === '/') throw new Error('DATABASE_URL must include a database host and name.');
  if (production) {
    const sslMode = url.searchParams.get('sslmode')?.toLowerCase();
    if (!sslMode || !['require', 'verify-ca', 'verify-full'].includes(sslMode)) {
      throw new Error('DATABASE_URL must require TLS in production (use sslmode=require, verify-ca, or verify-full).');
    }
  }
  return value;
}

function integerSetting(value: string | undefined, fallback: number, name: string, min: number, max: number): number {
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < min || number > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return number;
}

/** Validate security-critical configuration before constructing auth, ciphers, or listeners. */
export function readCoreServerConfig(env: NodeJS.ProcessEnv = process.env): CoreServerConfig {
  const production = env.NODE_ENV === 'production';
  const rawSecret = required(env, 'BETTER_AUTH_SECRET');
  if (rawSecret.length < 32 || PLACEHOLDER.test(rawSecret)) throw new Error('BETTER_AUTH_SECRET must be a non-placeholder value of at least 32 characters.');
  const rawDatabase = required(env, 'DATABASE_URL');
  const rawOrigin = required(env, 'BETTER_AUTH_URL');
  return {
    databaseUrl: databaseUrl(rawDatabase, production),
    authSecret: rawSecret,
    publicOrigin: exactOrigin(rawOrigin, production),
    port: integerSetting(env.PORT, 3001, 'PORT', 1, 65_535),
    // Forwarded addresses are trusted only when operators explicitly define the known proxy depth.
    trustProxyHops: integerSetting(env.API_TRUST_PROXY_HOPS, 0, 'API_TRUST_PROXY_HOPS', 0, 4),
    production,
  };
}
