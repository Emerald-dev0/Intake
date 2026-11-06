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
  safeReturnTo,
  unionScopes,
} from './oauth';
import { isProviderConfigured, missingProviderEnv, providerDefinition, supportedProviders, type ProviderDefinition } from './registry';
import type { ConnectionRecord, ConnectionStore } from './store';

const TRANSACTION_TTL_MS = 10 * 60 * 1000;
const ACCESS_SKEW_MS = 60_000;
/** 90 days: comfortably above Typeform's 7-day access token, low enough to reject a forged or
    misread `expires_in` that would otherwise pin a token as valid for years. */
const MAX_ACCESS_LIFETIME_SECONDS = 90 * 24 * 60 * 60;
const FALLBACK_ACCESS_LIFETIME_SECONDS = 300;
const RATE_WINDOW_MS = 10 * 60 * 1000;
const RATE_LIMIT = 8;
const MSA_TENANT = '9188040d-6c67-4c5b-b112-36a304b66dad';

/**
 * The optional permissions a signed-in user may add to an existing grant.
 *
 * Each entry is a named capability rather than a bare scope, so the route asks for "response
 * reading" without knowing the scope string, and a future capability can be added without touching
 * the OAuth flow. The scope strings stay in one place, and adding one here is the only way a new
 * optional permission can be requested.
 *
 * The responses scope must stay equal to FORMS_RESPONSES_READONLY_SCOPE in
 * server/forms/providers/google/adapter.ts; a test checks both directions so the default connect
 * set can never silently grow.
 */
const OPTIONAL_SCOPE_SETS = {
  responses: ['https://www.googleapis.com/auth/forms.responses.readonly'],
} as const;

export type OptionalCapability = keyof typeof OPTIONAL_SCOPE_SETS;

/** Every scope that may be added to an existing grant. Nothing outside this set is ever requested. */
const ALLOWED_OPTIONAL_SCOPES: ReadonlySet<string> = new Set(
  Object.values(OPTIONAL_SCOPE_SETS).flat() as string[],
);

/** The scopes one capability is made of, or null when the capability is not one Intake knows. */
export function scopesForCapability(capability: unknown): string[] | null {
  if (typeof capability !== 'string') return null;
  const set = OPTIONAL_SCOPE_SETS[capability as OptionalCapability];
  return set ? [...set] : null;
}

/** Every optional capability Intake can ask for, and the scopes each one is made of. */
export function optionalCapabilities(): Record<string, string[]> {
  return Object.fromEntries(
    (Object.keys(OPTIONAL_SCOPE_SETS) as OptionalCapability[]).map(capability => [capability, [...OPTIONAL_SCOPE_SETS[capability]]]),
  );
}

/** Every optional capability a set of granted scopes satisfies. */
export function capabilitiesForScopes(scopes: string[]): string[] {
  return (Object.keys(OPTIONAL_SCOPE_SETS) as OptionalCapability[]).filter(capability =>
    OPTIONAL_SCOPE_SETS[capability].every(scope => hasScope(scopes, scope)),
  );
}

/** The one scope the responses capability adds. Exported so the route cannot invent its own. */
export const RESPONSES_READONLY_SCOPE = OPTIONAL_SCOPE_SETS.responses[0];

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
  /**
   * Optional lifecycle hook for transactional email. Best-effort: a delivery failure must never
   * change the outcome of a connection or a disconnection.
   */
  onConnectionChange?: (event: { type: 'connected' | 'disconnected'; userId: string; provider: ProviderId; accountLabel: string | null }) => void;
}

export interface ProviderService {
  list(userId: string): Promise<PublicProvider[]>;
  start(userId: string, provider: ProviderId, extraScopes?: string[], returnTo?: string | null): Promise<{ ok: true; url: string } | { ok: false; result: ResultCode }>;
  complete(userId: string, provider: ProviderId, query: CallbackQuery): Promise<{ result: ResultCode; revocation?: RevocationOutcome; returnTo?: string | null }>;
  disconnect(userId: string, provider: ProviderId): Promise<{ result: ResultCode; revocation: RevocationOutcome }>;
  getAuthorizedConnection(userId: string, provider: string): Promise<AuthorizedConnection>;
  /** A provider API refused a token Intake believed was valid. The grant is unusable until the user reconnects. */
  reportAuthorizationRejected(userId: string, provider: string): Promise<void>;
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

/** Server-only. Form operations call this and must not send the result to the browser. */
export function getProviderConnection(userId: string, provider: string): Promise<AuthorizedConnection> {
  if (!active) return Promise.reject(new Error('Provider service is not initialized'));
  return active.getAuthorizedConnection(userId, provider);
}

/** Server-only. Call when a provider API rejects the access token that getProviderConnection returned. */
export function reportProviderAuthorizationRejected(userId: string, provider: string): Promise<void> {
  if (!active) return Promise.reject(new Error('Provider service is not initialized'));
  return active.reportAuthorizationRejected(userId, provider);
}

export function createProviderService(deps: ProviderDeps): ProviderService {
  const now = deps.now ?? (() => new Date());
  const allow = deps.rateLimit ?? createRateLimit();
  // Coalesce concurrent reads for one user/provider in this process so rotating refresh tokens are not
  // submitted twice. PostgreSQL remains the source of truth across instances; see PRODUCTION.md.
  const authorizationReads = new Map<string, Promise<AuthorizedConnection>>();

  return {
    list: userId => listProviders(deps, userId, now()),
    start(userId, provider, extraScopes = [], returnTo = null) {
      return startAuthorization(deps, userId, provider, now(), allow, extraScopes, returnTo);
    },
    complete(userId, provider, query) {
      return completeAuthorization(deps, userId, provider, query, now());
    },
    disconnect(userId, provider) {
      return disconnectProvider(deps, userId, provider, now());
    },
    getAuthorizedConnection(userId, provider) {
      const key = `${userId}\u0000${provider}`;
      const activeRead = authorizationReads.get(key);
      if (activeRead) return activeRead;
      const pending = readAuthorizedConnection(deps, userId, provider, now());
      authorizationReads.set(key, pending);
      void pending.then(
        () => { if (authorizationReads.get(key) === pending) authorizationReads.delete(key); },
        () => { if (authorizationReads.get(key) === pending) authorizationReads.delete(key); },
      );
      return pending;
    },
    async reportAuthorizationRejected(userId, provider) {
      if (provider !== 'google' && provider !== 'microsoft' && provider !== 'typeform') return;
      await deps.store.markNeedsReauthorization(userId, provider, 'reauthorization_required', now());
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
    // What this connection may actually do, in plain words. The browser never has to know a scope
    // string to know whether response reading is allowed.
    capabilities: capabilitiesForScopes(scopes),
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

function accessExpiresAt(at: Date, expiresIn: number | null): Date {
  // Reject nonsensical provider lifetimes instead of creating an invalid Date or trusting an
  // unbounded one forever. The ceiling has to clear the longest lifetime we actually meet: Typeform
  // issues one-week access tokens (604800), so a 24-hour cap silently stamped every Typeform
  // connection as expiring in five minutes and refreshed it on nearly every request — burning its
  // 2 req/s budget and rotating the refresh token far more often than the week requires.
  const seconds = expiresIn !== null && Number.isSafeInteger(expiresIn) && expiresIn > 0 && expiresIn <= MAX_ACCESS_LIFETIME_SECONDS
    ? expiresIn
    : FALLBACK_ACCESS_LIFETIME_SECONDS;
  return new Date(at.getTime() + seconds * 1000);
}

async function listProviders(deps: ProviderDeps, userId: string, at: Date): Promise<PublicProvider[]> {
  const records = await deps.store.listConnections(userId);
  return supportedProviders(deps.env).map(definition => {
    const record = records.find(item => item.provider === definition.id && item.userId === userId) ?? null;
    return toPublicProvider(definition, isProviderConfigured(definition, deps.env), record, at, deps.env);
  });
}

async function startAuthorization(deps: ProviderDeps, userId: string, provider: ProviderId, at: Date, allow: (userId: string, now: number) => boolean, extraScopes: string[] = [], returnTo: string | null = null): Promise<{ ok: true; url: string } | { ok: false; result: ResultCode }> {
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
  // Incremental authorization: extra scopes merge into the existing grant
  // (include_granted_scopes), so enabling response summaries never disturbs
  // the forms.body grant. Only allowlisted optional scopes are accepted.
  const requestedScopes = [
    ...definition.scopes,
    ...extraScopes.filter(scope => ALLOWED_OPTIONAL_SCOPES.has(scope)),
  ];
  await deps.store.createTransaction({
    id: randomUUID(),
    userId,
    provider,
    stateHash: hashSecret(state),
    codeVerifierCiphertext: deps.cipher.encrypt(verifier, credentialAad(userId, provider, 'verifier')),
    nonceHash: hashSecret(nonce),
    redirectUri: callback,
    requestedScopes,
    returnTo: safeReturnTo(returnTo),
    expiresAt: new Date(at.getTime() + TRANSACTION_TTL_MS),
  }, at);
  const url = buildAuthorizationUrl({
    endpoint: definition.authorizationEndpoint,
    clientId,
    redirectUri: callback,
    scopes: requestedScopes,
    state,
    nonce: definition.oidcNonce ? nonce : undefined,
    codeChallenge: definition.pkce ? challenge : undefined,
    extraParams: definition.extraAuthParams,
  });
  if (url.includes('client_secret') || url.includes(verifier)) return { ok: false, result: 'exchange_failed' };
  return { ok: true, url };
}

async function completeAuthorization(deps: ProviderDeps, userId: string, provider: ProviderId, query: CallbackQuery, at: Date): Promise<{ result: ResultCode; revocation?: RevocationOutcome; returnTo?: string | null }> {
  const definition = providerDefinition(provider, deps.env);
  const classified = classifyCallbackError(query);
  // Provider error callbacks are still OAuth callbacks: cancellation/denial is trusted only after
  // the exact single-use state is consumed for this signed-in user and provider.
  if (!query.state || query.state.length > 128) return { result: 'invalid_callback' };
  const consumed = await deps.store.consumeTransaction(hashSecret(query.state), userId, provider, at);
  if (!consumed.ok) return { result: consumed.reason };
  // Where this person is sent when the authorization finishes, if they asked to be sent somewhere.
  const returnTo = consumed.transaction.returnTo ?? null;
  const origin = publicOrigin(deps.env.BETTER_AUTH_URL);
  const expectedRedirect = origin ? redirectUri(origin, provider) : '';
  if (!origin || consumed.transaction.redirectUri !== expectedRedirect) return { result: 'invalid_callback', returnTo };
  if (classified) return { result: classified, returnTo };
  if (!query.code || query.code.length > 2048) return { result: 'invalid_callback', returnTo };
  if (definition.configurationError || !isProviderConfigured(definition, deps.env)) return { result: 'not_configured', returnTo };
  let verifier: string;
  try {
    verifier = deps.cipher.decrypt(consumed.transaction.codeVerifierCiphertext, credentialAad(userId, provider, 'verifier'));
  } catch (error) {
    logSafe('Provider verifier decrypt failed', error);
    return { result: 'invalid_state', returnTo };
  }
  let tokenJson: unknown;
  try {
    const response = await deps.http.postForm(definition.tokenEndpoint, authorizationCodeBody({
      code: query.code,
      clientId: deps.env[definition.clientIdEnv]!.trim(),
      clientSecret: deps.env[definition.clientSecretEnv]!.trim(),
      redirectUri: expectedRedirect,
      codeVerifier: definition.pkce ? verifier : undefined,
    }));
    tokenJson = response.json;
    if (response.status < 200 || response.status >= 300) {
      const code = readTokenResponse(tokenJson);
      const providerError = code && 'error' in code ? code.error : undefined;
      // Typeform reports failures as { code, description }, not { error }, so without this the log
      // said only "rejected" and hid the one detail that makes the failure diagnosable.
      logSafe('Provider token exchange rejected', undefined, providerTokenFailure(tokenJson) ?? providerError);
      if (providerError === 'invalid_grant') return { result: 'expired_code', returnTo };
      if (providerError === 'invalid_client') return { result: 'not_configured', returnTo };
      return { result: 'exchange_failed', returnTo };
    }
  } catch (error) {
    logSafe('Provider token endpoint unavailable', error);
    return { result: 'provider_unavailable', returnTo };
  }
  const token = readTokenResponse(tokenJson);
  if (!token || 'error' in token) {
    logSafe('Provider token exchange rejected', undefined, providerTokenFailure(tokenJson) ?? (token && 'error' in token ? token.error : undefined));
    if (token && 'error' in token && token.error === 'invalid_grant') return { result: 'expired_code', returnTo };
    return { result: 'exchange_failed', returnTo };
  }
  const identity = await identifyAccount(deps, definition, token, consumed.transaction.nonceHash, at);
  if ('result' in identity) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    return { result: identity.result, returnTo };
  }
  const granted = grantedScopes(token.scope);
  // What Google actually granted is the only thing that counts. With include_granted_scopes set,
  // that is the union of everything this person granted before and what they granted now. If the
  // token response carries no scope at all, fall back to what this authorization asked for.
  const requested = consumed.transaction.requestedScopes.length
    ? consumed.transaction.requestedScopes
    : [...definition.scopes];
  const authorized = granted.length ? granted : requested;
  // The grant that already exists, when it belongs to the same provider account. An incremental
  // authorization adds to a grant; it never takes one away.
  const stored = await deps.store.getConnection(userId, provider);
  const previous = stored && stored.externalAccountId === identity.accountId ? stored : null;
  const scopes = unionScopes(previous?.scopes ?? [], authorized);
  // The permission Intake needs has to be somewhere in the grant it now holds — which may be
  // what it held already, and which is why this is checked against the whole grant and not
  // against the newest answer alone.
  if (definition.requiredScopes.some(scope => !hasScope(scopes, scope))) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    return { result: 'insufficient_permissions', returnTo };
  }
  // Google does not always return a refresh token. One that is already stored stays stored: only a
  // new refresh token may replace it, and nothing may remove it.
  const refreshTokenCiphertext = token.refreshToken
    ? deps.cipher.encrypt(token.refreshToken, credentialAad(userId, provider, 'refresh'))
    : previous?.refreshTokenCiphertext ?? null;
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
      scopes,
      accessTokenCiphertext: deps.cipher.encrypt(token.accessToken, credentialAad(userId, provider, 'access')),
      accessTokenExpiresAt: accessExpiresAt(at, token.expiresIn),
      refreshTokenCiphertext,
      lastAuthorizedAt: at,
      lastRefreshedAt: null,
    });
  } catch (error) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    throw error;
  }
  if (!saved.ok) {
    await revokeTokens(deps, definition, token.accessToken, token.refreshToken);
    return { result: 'connection_conflict', returnTo };
  }
  await deps.store.deleteTransactions(userId, provider);
  notifyConnectionChange(deps, 'connected', userId, provider, identity.email ?? identity.label);
  return { result: 'connected', returnTo };
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
  if (definition.identity.type === 'typeform-userinfo') {
    try {
      const response = await deps.http.getJson(definition.identity.url, { authorization: `Bearer ${token.accessToken}` });
      if (response.status < 200 || response.status >= 300) return { result: 'exchange_failed' };
      const identity = typeformIdentity(response.json);
      return identity ?? { result: 'exchange_failed' };
    } catch (error) {
      logSafe('Typeform account lookup failed', error);
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

function typeformIdentity(json: unknown): { accountId: string; email: string | null; label: string | null } | null {
  if (!json || typeof json !== 'object') return null;
  // Typeform's documented GET /me response is { alias, email, language }; some accounts also
  // return account_id. Requiring a field the API does not guarantee made a successful token
  // exchange look like exchange_failed, so accept any stable identifier Typeform actually sends.
  const row = json as { id?: unknown; account_id?: unknown; user_id?: unknown; email?: unknown; name?: unknown; alias?: unknown };
  const accountId = [row.account_id, row.id, row.user_id, row.email, row.alias]
    .find(value => typeof value === 'string' && value.trim().length > 0 && value.length <= 255) as string | undefined;
  if (!accountId) return null;
  return {
    accountId: accountId.trim(),
    email: cleanEmail(typeof row.email === 'string' ? row.email : null),
    label: cleanLabel(typeof row.name === 'string' ? row.name : typeof row.alias === 'string' ? row.alias : null),
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
  const label = record.externalAccountEmail ?? record.externalAccountLabel;
  let revocation: RevocationOutcome = !definition || definition.revocation.type === 'unsupported' ? 'unsupported' : 'failed';
  if (definition?.revocation.type === 'google') {
    const access = decryptField(deps, record.accessTokenCiphertext, userId, provider, 'access');
    const refresh = decryptField(deps, record.refreshTokenCiphertext, userId, provider, 'refresh');
    revocation = access || refresh ? await revokeTokens(deps, definition, access, refresh) : 'failed';
  }
  await deps.store.deleteConnection(userId, provider);
  await deps.store.deleteTransactions(userId, provider);
  notifyConnectionChange(deps, 'disconnected', userId, provider, label);
  void at;
  return { result: 'disconnected', revocation };
}

/** Never throws: email is a notification, not part of the authorization outcome. */
function notifyConnectionChange(
  deps: ProviderDeps,
  type: 'connected' | 'disconnected',
  userId: string,
  provider: ProviderId,
  accountLabel: string | null,
): void {
  if (!deps.onConnectionChange) return;
  try {
    deps.onConnectionChange({ type, userId, provider, accountLabel });
  } catch (error) {
    logSafe('Provider connection notification failed', error, provider);
  }
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
  if (providerId !== 'google' && providerId !== 'microsoft' && providerId !== 'typeform') return { ok: false, provider: null, reason: 'unsupported' };
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
      accessTokenExpiresAt: accessExpiresAt(at, token.expiresIn),
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
      accessTokenExpiresAt: accessExpiresAt(at, token.expiresIn).toISOString(),
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

/** Provider token errors use either { error } or { code, description }; keep whichever is present. */
function providerTokenFailure(json: unknown): string | undefined {
  if (!json || typeof json !== 'object') return undefined;
  const row = json as { code?: unknown; description?: unknown; error?: unknown; error_description?: unknown };
  const code = typeof row.code === 'string' ? row.code : typeof row.error === 'string' ? row.error : '';
  const description = typeof row.description === 'string' ? row.description : typeof row.error_description === 'string' ? row.error_description : '';
  const detail = [code, description].filter(Boolean).join(': ');
  return detail ? detail.replace(/[\u0000-\u001f]/g, ' ').slice(0, 240) : undefined;
}

export function isMissingTable(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && (error as { code?: string }).code === '42P01';
}

export function storageResult(error: unknown): ResultCode {
  logSafe('Provider storage error', error);
  return isMissingTable(error) ? 'storage_unavailable' : 'storage_failed';
}
