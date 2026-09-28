import { randomUUID } from 'node:crypto';
import type { ProviderId, PublicProvider, ResultCode, RevocationOutcome } from '../../src/lib/connections';
import { credentialAad, type TokenCipher } from './crypto';
import type { ProviderHttp } from './http';
import { TokenVerificationError, verifyRs256Jwt } from './jwt';
import {
  authorizationCodeBody,
  buildAuthorizationUrl,
  classifyCallbackError,
  createOpaque,
  createPkce,
  grantedScopes,
  hasScope,
  hashSecret,
  logSafe,
  publicOrigin,
  readTokenResponse,
  redirectUri,
  refreshTokenBody,
} from './oauth';
import { isProviderConfigured, missingProviderEnv, providerDefinition, supportedProviders, type ProviderDefinition } from './registry';
import type { ConnectionRecord, ConnectionStore } from './store';

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const ACCESS_SKEW_MS = 60_000;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 8;
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

export interface SessionUser {
  id: string;
  email: string;
  name: string;
}

export interface ProviderDeps {
  store: ConnectionStore;
  http: ProviderHttp;
  cipher: TokenCipher;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
  rateLimit?: (userId: string, now: number) => boolean;
}

export interface ProviderService {
  list(userId: string): Promise<PublicProvider[]>;
  start(userId: string, provider: ProviderId): Promise<{ ok: true; url: string } | { ok: false; result: ResultCode }>;
  complete(userId: string, provider: ProviderId, query: CallbackQuery): Promise<{ result: ResultCode; revocation?: RevocationOutcome }>;
  disconnect(userId: string, provider: ProviderId): Promise<{ result: ResultCode; revocation: RevocationOutcome }>;
  getAuthorizedConnection(userId: string, provider: string): Promise<AuthorizedConnection>;
}

export interface CallbackQuery {
  code?: string;
  state?: string;
  error?: string;
  error_subcode?: string;
  error_description?: string;
}

export type AuthorizedConnection =
  | {
      ok: true;
      provider: ProviderId;
      userId: string;
      externalAccountId: string;
      externalAccountEmail: string | null;
      scopes: string[];
      accessToken: string;
      accessTokenExpiresAt: string;
    }
  | {
      ok: false;
      provider: ProviderId | null;
      reason: 'unsupported' | 'not_configured' | 'not_connected' | 'expired' | 'reauthorization_required' | 'provider_unavailable' | 'storage_unavailable';
    };

let active: ProviderService | null = null;

export function useProviderService(service: ProviderService): void {
  active = service;
}

/** Server-only. Future form operations should call this and must not send the result to the browser. */
export function getProviderConnection(userId: string, provider: string): Promise<AuthorizedConnection> {
  if (!active) return Promise.reject(new Error('Provider service is not initialized'));
  return active.getAuthorizedConnection(userId, provider);
}

export function createProviderService(deps: ProviderDeps): ProviderService {
  const now = deps.now ?? (() => new Date());
  const allow = deps.rateLimit ?? createRateLimit();

  return {
    list: userId => listProviders(deps, userId, now()),
    start(userId, provider) {
      return startAuthorization(deps, userId, provider, now(), allow);
    },
    complete(userId, provider, query) {
      return completeAuthorization(deps, userId, provider, query, now());
    },
    disconnect(userId, provider) {
      return disconnectProvider(deps, userId, provider, now());
    },
    getAuthorizedConnection(userId, provider) {
      return readAuthorizedConnection(deps, userId, provider, now());
    },
  };
}

function createRateLimit(): (userId: string, now: number) => boolean {
  const hits = new Map<string, number[]>();
  return (userId, at) => {
    const recent = (hits.get(userId) ?? []).filter(time => at - time < RATE_WINDOW_MS);
    if (recent.length >= RATE_LIMIT) {
      hits.set(userId, recent);
      return false;
    }
    recent.push(at);
    hits.set(userId, recent);
    return true;
  };
}

export function toPublicProvider(definition: ProviderDefinition, configured: boolean, record: ConnectionRecord | null, at: Date, env: NodeJS.ProcessEnv): PublicProvider {
  const status = record ? effectiveStatus(record, at) : 'not_connected';
  const scopes = record?.scopes ?? [];
  return {
    id: definition.id,
    name: definition.name,
    accountName: definition.accountName,
    description: definition.configurationError ? `${definition.description} ${definition.configurationError}` : definition.description,
    configured,
    setupEnv: configured ? [] : missingProviderEnv(definition, env),
    status,
    accountEmail: record ? cleanEmail(record.externalAccountEmail) : null,
    accountLabel: record ? cleanLabel(record.externalAccountLabel) : null,
    scopes,
    scopeLabels: scopes.map(scope => definition.scopeLabels[scope] || scope),
    connectedAt: record?.lastAuthorizedAt?.toISOString() ?? null,
    canRefresh: !!record?.refreshTokenCiphertext && status !== 'reauthorization_required',
    revocation: definition.revocation.type === 'google' ? 'supported' : 'unsupported',
    formsApi: definition.formsApi,
    formsNote: definition.formsNote,
    permissionLinks: definition.permissionLinks,
  };
}

function effectiveStatus(record: ConnectionRecord, at: Date): PublicProvider['status'] {
  if (record.status === 'reauthorization_required') return 'reauthorization_required';
  if (record.status === 'expired') return 'expired';
  if (!accessUsable(record.accessTokenExpiresAt, at) && !record.refreshTokenCiphertext) return 'expired';
  return 'connected';
}

function accessUsable(expiresAt: Date | null, at: Date): boolean {
  return !!expiresAt && expiresAt.getTime() - at.getTime() > ACCESS_SKEW_MS;
}

async function listProviders(deps: ProviderDeps, userId: string, at: Date): Promise<PublicProvider[]> {
  const records = await deps.store.listConnections(userId);
  return supportedProviders(deps.env).map(definition => {
    const record = records.find(item => item.provider === definition.id && item.userId === userId) ?? null;
    return toPublicProvider(definition, isProviderConfigured(definition, deps.env), record, at, deps.env);
  });
}

async function startAuthorization(deps: ProviderDeps, userId: string, provider: ProviderId, at: Date, allow: (userId: string, now: number) => boolean): Promise<{ ok: true; url: string } | { ok: false; result: ResultCode }> {
  const definition = providerDefinition(provider, deps.env);
  if (definition.configurationError) return { ok: false, result: 'not_configured' };
  const origin = publicOrigin(deps.env.BETTER_AUTH_URL);
  const clientId = deps.env[definition.clientIdEnv]?.trim();
  const clientSecret = deps.env[definition.clientSecretEnv]?.trim();
  if (!origin || !clientId || !clientSecret || !isProviderConfigured(definition, deps.env)) return { ok: false, result: 'not_configured' };
  if (!allow(userId, at.getTime())) return { ok: false, result: 'rate_limited' };
  const { verifier, challenge } = createPkce();
  const state = createOpaque();
  const nonce = createOpaque();
  const callback = redirectUri(origin, provider);
  await deps.store.createTransaction({
    id: randomUUID(),
    userId,
    provider,
    stateHash: hashSecret(state),
    codeVerifierCiphertext: deps.cipher.encrypt(verifier, credentialAad(userId, provider, 'verifier')),
    nonceHash: hashSecret(nonce),
    redirectUri: callback,
    expiresAt: new Date(at.getTime() + TRANSACTION_TTL_MS),
  }, at);
  const url = buildAuthorizationUrl({
    endpoint: definition.authorizationEndpoint,
    clientId,
    redirectUri: callback,
    scopes: definition.scopes,
    state,
    nonce,
    codeChallenge: challenge,
    extraParams: definition.extraAuthParams,
  });
  if (url.includes('client_secret') || url.includes(verifier)) return { ok: false, result: 'exchange_failed' };
  return { ok: true, url };
}

async function completeAuthorization(deps: ProviderDeps, userId: string, provider: ProviderId, query: CallbackQuery, at: Date): Promise<{ result: ResultCode; revocation?: RevocationOutcome }> {
  const definition = providerDefinition(provider, deps.env);
  if (definition.configurationError) return { result: 'not_configured' };
  const classified = classifyCallbackError(query);
  if (classified) {
    if (query.state && query.state.length <= 128) {
      await deps.store.consumeTransaction(hashSecret(query.state), userId, provider, at).catch(error => {
        logSafe('Provider transaction consume failed', error);
      });
    }
    return { result: classified };
  }
  if (!query.code || !query.state || query.code.length > 2048 || query.state.length > 128) return { result: 'invalid_callback' };
  const consumed = await deps.store.consumeTransaction(hashSecret(query.state), userId, provider, at);
  if (!consumed.ok) return { result: consumed.reason };
  const origin = publicOrigin(deps.env.BETTER_AUTH_URL);
  const expectedRedirect = origin ? redirectUri(origin, provider) : '';
  if (!origin || consumed.transaction.redirectUri !== expectedRedirect) return { result: 'invalid_callback' };
  if (!isProviderConfigured(definition, deps.env)) return { result: 'not_configured' };
  let verifier: string;
  try {
    verifier = deps.cipher.decrypt(consumed.transaction.codeVerifierCiphertext, credentialAad(userId, provider, 'verifier'));
  } catch (error) {
    logSafe('Provider verifier decrypt failed', error);
    return { result: 'invalid_state' };
  }
  let tokenJson: unknown;
  try {
    const response = await deps.http.postForm(definition.tokenEndpoint, authorizationCodeBody({
      code: query.code,
      clientId: deps.env[definition.clientIdEnv]!.trim(),
      clientSecret: deps.env[definition.clientSecretEnv]!.trim(),
      redirectUri: expectedRedirect,
      codeVerifier: verifier,
    }));
    tokenJson = response.json;
    if (response.status < 200 || response.status >= 300) {
      const code = readTokenResponse(tokenJson);
      const providerError = code && 'error' in code ? code.error : undefined;
      logSafe('Provider token exchange rejected', undefined, providerError);
      if (providerError === 'invalid_grant') return { result: 'expired_code' };
      if (providerError === 'invalid_client') return { result: 'not_configured' };
      return { result: 'exchange_failed' };
    }
  } catch (error) {
    logSafe('Provider token endpoint unavailable', error);
    return { result: 'provider_unavailable' };
  }
  const token = readTokenResponse(tokenJson);
  if (!token || 'error' in token) {
    logSafe('Provider token exchange rejected', undefined, token && 'error' in token ? token.error : undefined);
    if (token && 'error' in token && token.error === 'invalid_grant') return { result: 'expired_code' };
    return { result: 'exchange_failed' };
  }
  const identity = await identifyAccount(deps, definition, token, consumed.transaction.nonceHash, at);
  if ('result' in identity) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    return { result: identity.result };
  }
  const scopes = grantedScopes(token.scope);
  if (definition.requiredScopes.some(scope => !hasScope(scopes, scope))) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    return { result: 'insufficient_permissions' };
  }
  let saved: Awaited<ReturnType<ConnectionStore['saveConnection']>>;
  try {
    saved = await deps.store.saveConnection({
      id: randomUUID(),
      userId,
      provider,
      status: 'connected',
      externalAccountId: identity.accountId,
      externalAccountEmail: identity.email,
      externalAccountLabel: identity.label,
      scopes: scopes.length ? scopes : definition.scopes,
      accessTokenCiphertext: deps.cipher.encrypt(token.accessToken, credentialAad(userId, provider, 'access')),
      accessTokenExpiresAt: new Date(at.getTime() + (token.expiresIn ?? 300) * 1000),
      refreshTokenCiphertext: token.refreshToken ? deps.cipher.encrypt(token.refreshToken, credentialAad(userId, provider, 'refresh')) : null,
      lastAuthorizedAt: at,
      lastRefreshedAt: null,
    });
  } catch (error) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    throw error;
  }
  if (!saved.ok) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    return { result: 'connection_conflict' };
  }
  await deps.store.deleteTransactions(userId, provider);
  return { result: 'connected' };
}

async function identifyAccount(deps: ProviderDeps, definition: ProviderDefinition, token: { accessToken: string; idToken: string | null }, nonceHash: string, at: Date): Promise<{ accountId: string; email: string | null; label: string | null } | { result: ResultCode }> {
  if (definition.identity.type === 'google-userinfo') {
    try {
      const response = await deps.http.getJson(definition.identity.url, { authorization: `Bearer ${token.accessToken}` });
      if (response.status < 200 || response.status >= 300) return { result: 'exchange_failed' };
      const identity = googleIdentity(response.json);
      return identity ?? { result: 'exchange_failed' };
    } catch (error) {
      logSafe('Google account lookup failed', error);
      return { result: 'provider_unavailable' };
    }
  }
  if (!token.idToken) return { result: 'exchange_failed' };
  try {
    const jwks = await deps.http.getJson(definition.identity.jwksUrl);
    if (jwks.status < 200 || jwks.status >= 300) return { result: 'provider_unavailable' };
    const claims = verifyRs256Jwt(token.idToken, jwks.json, {
      audience: deps.env[definition.clientIdEnv]!.trim(),
      nonceHash,
      now: Math.floor(at.getTime() / 1000),
      issuer: claims => microsoftIssuerOk(claims, definition.identity.type === 'microsoft-id-token' ? definition.identity.tenant : 'common'),
    });
    const identity = microsoftIdentity(claims);
    return identity ?? { result: 'exchange_failed' };
  } catch (error) {
    if (error instanceof TokenVerificationError) {
      logSafe('Microsoft id token rejected', undefined, error.reason);
      return { result: 'exchange_failed' };
    }
    logSafe('Microsoft identity lookup failed', error);
    return { result: 'provider_unavailable' };
  }
}

function microsoftIssuerOk(claims: Record<string, unknown>, tenant: string): boolean {
  const tid = claims.tid;
  const iss = claims.iss;
  if (typeof tid !== 'string' || typeof iss !== 'string') return false;
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(tid)) return false;
  if (iss !== `https://login.microsoftonline.com/${tid}/v2.0`) return false;
  if (tenant === 'consumers' && tid.toLowerCase() !== MSA_TENANT) return false;
  if (tenant !== 'common' && tenant !== 'organizations' && tenant !== 'consumers' && tenant !== tid.toLowerCase()) return false;
  return true;
}

function googleIdentity(json: unknown): { accountId: string; email: string | null; label: string | null } | null {
  if (!json || typeof json !== 'object') return null;
  const row = json as { sub?: unknown; email?: unknown; email_verified?: unknown; name?: unknown };
  if (typeof row.sub !== 'string' || !row.sub || row.sub.length > 255) return null;
  return {
    accountId: row.sub,
    email: row.email_verified === true ? cleanEmail(typeof row.email === 'string' ? row.email : null) : null,
    label: cleanLabel(typeof row.name === 'string' ? row.name : null),
  };
}

function microsoftIdentity(claims: Record<string, unknown>): { accountId: string; email: string | null; label: string | null } | null {
  const tid = claims.tid;
  const oid = typeof claims.oid === 'string' ? claims.oid : typeof claims.sub === 'string' ? claims.sub : '';
  if (typeof tid !== 'string' || !oid || oid.length > 128) return null;
  const emailClaim = typeof claims.email === 'string' ? claims.email : typeof claims.preferred_username === 'string' ? claims.preferred_username : null;
  return {
    accountId: `${tid}:${oid}`,
    email: cleanEmail(emailClaim),
    label: cleanLabel(typeof claims.name === 'string' ? claims.name : null),
  };
}

async function disconnectProvider(deps: ProviderDeps, userId: string, provider: ProviderId, at: Date): Promise<{ result: ResultCode; revocation: RevocationOutcome }> {
  const definition = providerDefinition(provider, deps.env);
  const record = await deps.store.getConnection(userId, provider);
  if (!record || record.userId !== userId) return { result: 'disconnected', revocation: 'not_attempted' };
  let revocation: RevocationOutcome = !definition || definition.revocation.type === 'unsupported' ? 'unsupported' : 'failed';
  if (definition?.revocation.type === 'google') {
    const access = decryptField(deps, record.accessTokenCiphertext, userId, provider, 'access');
    const refresh = decryptField(deps, record.refreshTokenCiphertext, userId, provider, 'refresh');
    revocation = access || refresh ? await revokeTokens(deps, definition, access, refresh) : 'failed';
  }
  await deps.store.deleteConnection(userId, provider);
  await deps.store.deleteTransactions(userId, provider);
  void at;
  return { result: 'disconnected', revocation };
}

async function revokeTokens(deps: ProviderDeps, definition: ProviderDefinition, access: string | null, refresh: string | null): Promise<RevocationOutcome> {
  if (definition.revocation.type !== 'google') return 'unsupported';
  const token = refresh || access;
  if (!token) return 'failed';
  try {
    const response = await deps.http.postForm(definition.revocation.url, new URLSearchParams({ token }));
    return response.status === 200 ? 'revoked' : 'failed';
  } catch (error) {
    logSafe('Provider revocation failed', error);
    return 'failed';
  }
}

function decryptField(deps: ProviderDeps, payload: string | null, userId: string, provider: ProviderId, field: 'access' | 'refresh'): string | null {
  if (!payload) return null;
  try {
    return deps.cipher.decrypt(payload, credentialAad(userId, provider, field));
  } catch (error) {
    logSafe('Provider credential decrypt failed', error);
    return null;
  }
}

async function readAuthorizedConnection(deps: ProviderDeps, userId: string, providerId: string, at: Date): Promise<AuthorizedConnection> {
  if (providerId !== 'google' && providerId !== 'microsoft') return { ok: false, provider: null, reason: 'unsupported' };
  const definition = providerDefinition(providerId, deps.env);
  if (definition.configurationError) return { ok: false, provider: providerId, reason: 'not_configured' };
  const record = await deps.store.getConnection(userId, providerId);
  if (!record || record.userId !== userId) return { ok: false, provider: providerId, reason: 'not_connected' };
  if (record.status === 'reauthorization_required') return { ok: false, provider: providerId, reason: 'reauthorization_required' };
  if (record.status === 'expired' || (!accessUsable(record.accessTokenExpiresAt, at) && !record.refreshTokenCiphertext)) {
    if (record.status !== 'expired') await deps.store.markNeedsReauthorization(userId, providerId, 'expired', at);
    return { ok: false, provider: providerId, reason: 'expired' };
  }
  if (!accessUsable(record.accessTokenExpiresAt, at)) {
    return refreshAuthorizedConnection(deps, definition, record, at);
  }
  const accessToken = decryptField(deps, record.accessTokenCiphertext, userId, providerId, 'access');
  if (!accessToken) {
    await deps.store.markNeedsReauthorization(userId, providerId, 'reauthorization_required', at);
    return { ok: false, provider: providerId, reason: 'reauthorization_required' };
  }
  return {
    ok: true,
    provider: providerId,
    userId,
    externalAccountId: record.externalAccountId,
    externalAccountEmail: cleanEmail(record.externalAccountEmail),
    scopes: record.scopes,
    accessToken,
    accessTokenExpiresAt: record.accessTokenExpiresAt!.toISOString(),
  };
}

async function refreshAuthorizedConnection(deps: ProviderDeps, definition: ProviderDefinition, record: ConnectionRecord, at: Date): Promise<AuthorizedConnection> {
  const refreshToken = decryptField(deps, record.refreshTokenCiphertext, record.userId, definition.id, 'refresh');
  if (!refreshToken) {
    await deps.store.markNeedsReauthorization(record.userId, definition.id, 'reauthorization_required', at);
    return { ok: false, provider: definition.id, reason: 'reauthorization_required' };
  }
  if (!isProviderConfigured(definition, deps.env)) return { ok: false, provider: definition.id, reason: 'not_configured' };
  let json: unknown;
  try {
    const response = await deps.http.postForm(definition.tokenEndpoint, refreshTokenBody({
      refreshToken,
      clientId: deps.env[definition.clientIdEnv]!.trim(),
      clientSecret: deps.env[definition.clientSecretEnv]!.trim(),
      scopes: definition.sendScopesOnRefresh ? definition.scopes : undefined,
    }));
    json = response.json;
    const token = readTokenResponse(json);
    if (response.status < 200 || response.status >= 300 || !token || 'error' in token) {
      const providerError = token && 'error' in token ? token.error : undefined;
      logSafe('Provider refresh rejected', undefined, providerError);
      if (providerError === 'invalid_client') return { ok: false, provider: definition.id, reason: 'not_configured' };
      if (providerError === 'invalid_grant') {
        await deps.store.markNeedsReauthorization(record.userId, definition.id, 'reauthorization_required', at);
        return { ok: false, provider: definition.id, reason: 'reauthorization_required' };
      }
      return { ok: false, provider: definition.id, reason: 'provider_unavailable' };
    }
    const scopes = grantedScopes(token.scope);
    const nextScopes = scopes.length ? scopes : record.scopes;
    if (definition.requiredScopes.some(scope => !hasScope(nextScopes, scope))) {
      await deps.store.markNeedsReauthorization(record.userId, definition.id, 'reauthorization_required', at);
      return { ok: false, provider: definition.id, reason: 'reauthorization_required' };
    }
    const saved = await deps.store.saveConnection({
      id: record.id,
      userId: record.userId,
      provider: definition.id,
      status: 'connected',
      externalAccountId: record.externalAccountId,
      externalAccountEmail: record.externalAccountEmail,
      externalAccountLabel: record.externalAccountLabel,
      scopes: nextScopes,
      accessTokenCiphertext: deps.cipher.encrypt(token.accessToken, credentialAad(record.userId, definition.id, 'access')),
      accessTokenExpiresAt: new Date(at.getTime() + (token.expiresIn ?? 300) * 1000),
      refreshTokenCiphertext: deps.cipher.encrypt(token.refreshToken ?? refreshToken, credentialAad(record.userId, definition.id, 'refresh')),
      lastAuthorizedAt: record.lastAuthorizedAt ?? at,
      lastRefreshedAt: at,
    });
    if (!saved.ok) return { ok: false, provider: definition.id, reason: 'reauthorization_required' };
    return {
      ok: true,
      provider: definition.id,
      userId: record.userId,
      externalAccountId: record.externalAccountId,
      externalAccountEmail: cleanEmail(record.externalAccountEmail),
      scopes: nextScopes,
      accessToken: token.accessToken,
      accessTokenExpiresAt: new Date(at.getTime() + (token.expiresIn ?? 300) * 1000).toISOString(),
    };
  } catch (error) {
    logSafe('Provider refresh unavailable', error);
    return { ok: false, provider: definition.id, reason: 'provider_unavailable' };
  }
}

export function cleanEmail(value: string | null | undefined): string | null {
  if (!value) return null;
  const email = value.trim();
  if (email.length > 320 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return null;
  return email;
}

export function cleanLabel(value: string | null | undefined): string | null {
  if (!value) return null;
  const label = value.replace(/[\u0000-\u001f]/g, '').trim();
  if (!label) return null;
  return label.slice(0, 120);
}

export function isMissingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '42P01';
}

export function storageResult(error: unknown): ResultCode {
  logSafe('Provider storage error', error);
  return isMissingTable(error) ? 'storage_unavailable' : 'storage_failed';
}
