import { createTokenCipher, credentialAad } from '../../server/providers/crypto.ts';
import { createMemoryStore } from '../../server/providers/memory-store.ts';
import { createProviderService } from '../../server/providers/service.ts';
import { createMemoryFormStore } from '../../server/forms/memory-store.ts';
import { createFormEngine } from '../../server/forms/engine.ts';
import { createFormsProviders } from '../../server/forms/providers/index.ts';
import { FORMS_BODY_SCOPE, createGoogleFormsProvider } from '../../server/forms/providers/google/adapter.ts';
import { createGoogleFormsClient } from '../../server/forms/providers/google/client.ts';
import { createFakeGoogleForms } from './google-forms-fake.mjs';

export const AUTH_SECRET = 'test-secret-must-be-at-least-32-characters';
export const ORIGIN = 'http://localhost:5173';
export const SCOPES = ['openid', 'email', FORMS_BODY_SCOPE];
export const REFRESHED_TOKEN = 'REFRESHED_ACCESS_TOKEN_FOR_TESTS';
export const CLIENT_SECRET = 'test-google-client-secret';

export function providerEnv(overrides = {}) {
  return {
    BETTER_AUTH_URL: ORIGIN,
    BETTER_AUTH_SECRET: AUTH_SECRET,
    GOOGLE_OAUTH_CLIENT_ID: 'test-google-client-id',
    GOOGLE_OAUTH_CLIENT_SECRET: CLIENT_SECRET,
    MICROSOFT_OAUTH_CLIENT_ID: '11111111-1111-1111-1111-111111111111',
    MICROSOFT_OAUTH_CLIENT_SECRET: 'test-microsoft-client-secret',
    ...overrides,
  };
}

/**
 * The whole Google side of the system with nothing real in it: the real provider connection service
 * and its memory store (so decryption, user binding and token refresh are the production code), the
 * real adapter and HTTP client, and a stateful fake of the Forms API at the fetch boundary.
 */
export function createWorld(options = {}) {
  const env = options.env ?? providerEnv();
  const clock = { time: options.start ?? new Date('2026-09-29T09:00:00Z') };
  const now = () => new Date(clock.time);
  const cipher = createTokenCipher({ authSecret: AUTH_SECRET });
  const store = createMemoryStore();
  const fake = createFakeGoogleForms({ tokens: [], ...(options.fake ?? {}) });

  const refresh = { calls: [], mode: 'ok' };
  const http = {
    async postForm(url, body) {
      const params = new URLSearchParams(body.toString());
      refresh.calls.push({ url: String(url), grantType: params.get('grant_type'), refreshToken: params.get('refresh_token') });
      if (refresh.mode === 'invalid_grant') return { status: 400, json: { error: 'invalid_grant' } };
      if (refresh.mode === 'unavailable') return { status: 503, json: { error: 'temporarily_unavailable' } };
      fake.acceptToken(REFRESHED_TOKEN);
      return { status: 200, json: { access_token: REFRESHED_TOKEN, expires_in: 3600, token_type: 'Bearer', scope: SCOPES.join(' ') } };
    },
    async getJson() {
      throw new Error('the forms tests never call the identity endpoints');
    },
  };
  const service = createProviderService({ store, http, cipher, env, now });

  const lookups = [];
  const rejections = [];
  const google = {
    getConnection: (userId, provider) => {
      lookups.push([userId, provider]);
      return service.getAuthorizedConnection(userId, provider);
    },
    reportAuthorizationRejected: (userId, provider) => {
      rejections.push([userId, provider]);
      return service.reportAuthorizationRejected(userId, provider);
    },
    client: createGoogleFormsClient({ fetchImpl: fake.fetch, timeoutMs: options.timeoutMs }),
  };

  const logs = [];
  const log = (event, fields) => logs.push({ event, ...fields });

  /** Seed a Google connection the way the OAuth callback stores one: encrypted, bound to the user. */
  async function connect(userId, connection = {}) {
    const access = connection.access ?? `ACCESS_TOKEN_OF_${userId.toUpperCase()}`;
    const refreshToken = connection.refresh === undefined ? `REFRESH_TOKEN_OF_${userId.toUpperCase()}` : connection.refresh;
    fake.acceptToken(access);
    const expires = new Date(clock.time.getTime() + (connection.expiresInMs ?? 3_600_000));
    const saved = await store.saveConnection({
      id: `connection-${userId}`,
      userId,
      provider: 'google',
      status: connection.status ?? 'connected',
      externalAccountId: connection.externalAccountId ?? `google-account-of-${userId}`,
      externalAccountEmail: `${userId}@gmail.test`,
      externalAccountLabel: `${userId} on Google`,
      scopes: connection.scopes ?? SCOPES,
      accessTokenCiphertext: cipher.encrypt(access, credentialAad(userId, 'google', 'access')),
      accessTokenExpiresAt: expires,
      refreshTokenCiphertext: refreshToken ? cipher.encrypt(refreshToken, credentialAad(userId, 'google', 'refresh')) : null,
      lastAuthorizedAt: new Date(clock.time),
      lastRefreshedAt: null,
    });
    if (!saved.ok) throw new Error('could not seed the connection');
    return { access, refresh: refreshToken };
  }

  return {
    env,
    clock,
    now,
    cipher,
    store,
    fake,
    service,
    refresh,
    lookups,
    rejections,
    google,
    logs,
    log,
    connect,
    provider: createGoogleFormsProvider(google),
    providers: () => createFormsProviders({ env, google }),
    engine(extra = {}) {
      const formStore = extra.store ?? createMemoryFormStore();
      let counter = 0;
      const engine = createFormEngine({ providers: extra.providers ?? createFormsProviders({ env, google }), store: formStore, log, now, newId: () => `form-record-${++counter}`, ...(extra.limiter ? { limiter: extra.limiter } : {}) });
      return { engine, formStore };
    },
    eventNames: () => logs.map(entry => entry.event),
  };
}

export async function createGoogleForm(world, specification, userId = 'user-a') {
  return world.provider.createForm(userId, specification, { requestId: 'req_test', log: world.log });
}

/** Run a provider call that is expected to fail and return the structured error. */
export async function failureOf(promise) {
  try {
    await promise;
  } catch (error) {
    if (error && typeof error === 'object' && 'info' in error) return error;
    throw error;
  }
  throw new Error('expected the call to fail');
}

export const yesNo = (extra = {}) => ({ id: 'need', type: 'multiple_choice', title: 'Do you need accommodation?', options: ['Yes', 'No'], required: true, ...extra });
export const when = (question, equals) => ({ visibility: { when: { question, equals } } });
export const shortText = (id, extra = {}) => ({ id, type: 'short_text', title: `Question ${id}`, ...extra });
export const form = (questions, extra = {}) => ({ title: 'Registration', questions, ...extra });
