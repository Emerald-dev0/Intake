import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import type { ResultCode } from '../../src/lib/connections';

export function createPkce(): { verifier: string; challenge: string } {
  const verifier = randomBytes(32).toString('base64url');
  const challenge = createHash('sha256').update(verifier).digest('base64url');
  return { verifier, challenge };
}

export function createOpaque(): string {
  return randomBytes(32).toString('base64url');
}

export function hashSecret(value: string): string {
  return createHash('sha256').update(value).digest('base64url');
}

export function safeEqual(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

export function publicOrigin(value: string | undefined): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
    if (url.username || url.password || url.search || url.hash) return null;
    if (url.pathname !== '/' && url.pathname !== '') return null;
    return url.origin;
  } catch {
    return null;
  }
}

export function redirectUri(origin: string, provider: string): string {
  return `${origin}/api/providers/${provider}/callback`;
}

export function buildAuthorizationUrl(input: {
  endpoint: string;
  clientId: string;
  redirectUri: string;
  scopes: string[];
  state: string;
  nonce: string;
  codeChallenge: string;
  extraParams?: Record<string, string>;
}): string {
  const url = new URL(input.endpoint);
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', input.scopes.join(' '));
  url.searchParams.set('state', input.state);
  url.searchParams.set('nonce', input.nonce);
  url.searchParams.set('code_challenge', input.codeChallenge);
  url.searchParams.set('code_challenge_method', 'S256');
  for (const [key, value] of Object.entries(input.extraParams ?? {})) url.searchParams.set(key, value);
  return url.toString();
}

export function authorizationCodeBody(input: {
  code: string;
  clientId: string;
  clientSecret: string;
  redirectUri: string;
  codeVerifier: string;
}): URLSearchParams {
  return new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    client_id: input.clientId,
    client_secret: input.clientSecret,
    redirect_uri: input.redirectUri,
    code_verifier: input.codeVerifier,
  });
}

export function refreshTokenBody(input: {
  refreshToken: string;
  clientId: string;
  clientSecret: string;
  scopes?: string[];
}): URLSearchParams {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: input.refreshToken,
    client_id: input.clientId,
    client_secret: input.clientSecret,
  });
  if (input.scopes?.length) body.set('scope', input.scopes.join(' '));
  return body;
}

export function classifyCallbackError(query: { error?: string; error_subcode?: string; error_description?: string }): ResultCode | null {
  if (!query.error) return null;
  const sub = (query.error_subcode || '').toLowerCase();
  const description = (query.error_description || '').toLowerCase();
  if (query.error === 'access_denied' && (sub === 'cancel' || description.includes('cancel'))) return 'cancelled';
  if (query.error === 'access_denied') return 'denied';
  return 'denied';
}

export function providerErrorCode(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const error = (json as { error?: unknown }).error;
  return typeof error === 'string' && /^[a-z0-9_]{1,64}$/i.test(error) ? error : undefined;
}

export function readTokenResponse(json: unknown): {
  accessToken: string;
  refreshToken: string | null;
  expiresIn: number | null;
  scope: string | null;
  idToken: string | null;
} | { error: string } | null {
  if (!json || typeof json !== 'object') return null;
  const error = providerErrorCode(json);
  if (error) return { error };
  const row = json as { access_token?: unknown; refresh_token?: unknown; expires_in?: unknown; scope?: unknown; id_token?: unknown };
  if (typeof row.access_token !== 'string' || !row.access_token) return null;
  return {
    accessToken: row.access_token,
    refreshToken: typeof row.refresh_token === 'string' && row.refresh_token ? row.refresh_token : null,
    expiresIn: typeof row.expires_in === 'number' && Number.isFinite(row.expires_in) ? row.expires_in : null,
    scope: typeof row.scope === 'string' ? row.scope : null,
    idToken: typeof row.id_token === 'string' && row.id_token ? row.id_token : null,
  };
}

export function grantedScopes(scope: string | null): string[] {
  if (!scope) return [];
  return [...new Set(scope.split(/[\s,]+/).map(item => item.trim()).filter(Boolean))];
}

export function hasScope(granted: string[], required: string): boolean {
  return granted.some(scope => scope.toLowerCase() === required.toLowerCase());
}

const SECRET_QUERY = /((?:access_token|refresh_token|id_token|client_secret|code_verifier|code)=)[^&\s]+/gi;
const JWT = /eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g;
const DATABASE_URL = /postgres(?:ql)?:\/\/\S+/gi;

export function redact(value: string): string {
  return value.replace(SECRET_QUERY, '$1[redacted]').replace(JWT, '[redacted-jwt]').replace(DATABASE_URL, 'postgresql://[redacted]');
}

export function logSafe(label: string, error?: unknown, detail?: string): void {
  const message = error instanceof Error ? error.message : error ? String(error) : '';
  console.error(label, detail ? redact(detail) : '', message ? redact(message) : '');
}
