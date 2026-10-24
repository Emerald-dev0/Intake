import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createTokenCipher, credentialAad } from '../server/providers/crypto.ts';
import { createMemoryStore } from '../server/providers/memory-store.ts';
import { createProviderService } from '../server/providers/service.ts';
import { createTypeformProvider, TYPEFORM_SCOPE } from '../server/forms/providers/typeform/adapter.ts';
import { createTypeformClient } from '../server/forms/providers/typeform/client.ts';
import { providerEnv, failureOf, form, shortText, when } from './helpers/forms-harness.mjs';

const AUTH_SECRET = 'test-secret-must-be-at-least-32-characters';
const SCOPES = ['forms:read', TYPEFORM_SCOPE];
const API_ORIGIN = 'https://api.typeform.com';

const SIMPLE = form([shortText('name', { title: 'Full name', required: true }), { id: 'level', type: 'multiple_choice', title: 'Level', options: ['100', '200'] }], { title: 'Intake Typeform', description: 'A short form.' });
const VISIBLE = form([{ id: 'need', type: 'multiple_choice', title: 'Need accommodation?', options: ['Yes', 'No'], required: true }, shortText('nights', { title: 'Nights', ...when('need', 'Yes') })], { title: 'Routed' });
const MISPLACED = form([{ id: 'need', type: 'multiple_choice', title: 'Need accommodation?', options: ['Yes', 'No'], required: true }, shortText('middle', { title: 'Something else' }), shortText('nights', { title: 'Nights', ...when('need', 'Yes') })], { title: 'Misplaced' });
const CHOICES = form([{ id: 'dept', type: 'dropdown', title: 'Department', options: ['Science', 'Arts'], required: true }, { id: 'skills', type: 'checkboxes', title: 'Skills', options: ['Design', 'Code'], required: false }], { title: 'Choices' });

/** A stateful stand-in for the Typeform Create/Responses API at the HTTP boundary. */
export function createFakeTypeform(options = {}) {
  const accepted = new Set(options.tokens ?? ['ACCESS_TOKEN_OF_USER-A']);
  const forms = new Map();
  const calls = [];
  const failures = [];
  let counter = 0;

  const json = (status, body) => new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
  const nextId = () => `tf${String(++counter).padStart(8, '0')}`;

  function failure(operation) {
    const index = failures.findIndex(item => item.operation === operation);
    if (index < 0) return null;
    const [spec] = failures.splice(index, 1);
    return spec;
  }

  async function fetchLike(input, init = {}) {
    const url = new URL(input);
    const headers = new Headers(init.headers);
    const body = init.body ? JSON.parse(init.body) : undefined;
    const method = init.method ?? 'GET';
    const path = url.pathname;
    const operation = path === '/forms' && method === 'POST' ? 'forms.create'
      : path === '/forms' && method === 'GET' ? 'forms.list'
      : path === '/me' ? 'me.get'
      : /^\/forms\/[^/]+$/.test(path) && method === 'GET' ? 'forms.get'
      : /^\/forms\/[^/]+$/.test(path) && (method === 'POST' || method === 'PUT') ? 'forms.update'
      : 'unknown';
    calls.push({
      operation, method, url: url.toString(), path,
      authorization: headers.get('authorization'),
      contentType: headers.get('content-type'),
      redirect: init.redirect,
      hasSignal: !!init.signal,
      body: body === undefined ? undefined : structuredClone(body),
    });
    if (url.origin !== API_ORIGIN) return json(404, { code: 'NOT_FOUND' });
    if (!accepted.has((headers.get('authorization') ?? '').replace(/^Bearer /, ''))) return json(401, { code: 'AUTHENTICATION_FAILED', description: 'invalid token' });

    const injected = failure(operation);
    if (injected?.network) throw new TypeError('fetch failed');
    if (injected?.timeout) throw Object.assign(new Error('timed out'), { name: 'TimeoutError' });
    if (injected?.respond) return json(injected.respond.status ?? 200, injected.respond.body);

    if (operation === 'forms.create') {
      if (typeof body?.title !== 'string' || !body.title) return json(400, { code: 'VALIDATION_ERROR', description: 'title is required' });
      const id = nextId();
      const record = {
        id, title: body.title, type: 'form',
        fields: structuredClone(body.fields ?? []),
        logic: structuredClone(body.logic ?? []),
        settings: structuredClone(body.settings ?? null),
        theme: structuredClone(body.theme ?? null),
        welcome_screens: structuredClone(body.welcome_screens ?? []),
        thankyou_screens: structuredClone(body.thankyou_screens ?? []),
        created_at: '2026-09-29T09:00:00Z',
        updated_at: '2026-09-29T09:00:00Z',
      };
      forms.set(id, record);
      return json(200, { id, title: body.title, _links: { display: `https://form.typeform.com/to/${id}`, edit: `https://admin.typeform.com/form/${id}/edit` } });
    }
    if (operation === 'forms.get') {
      const id = path.split('/').pop();
      const record = forms.get(id);
      if (!record) return json(404, { code: 'NOT_FOUND', description: 'form not found' });
      return json(200, { ...record, _links: { display: `https://form.typeform.com/to/${id}`, edit: `https://admin.typeform.com/form/${id}/edit` } });
    }
    if (operation === 'forms.update') {
      const id = path.split('/').pop();
      const record = forms.get(id);
      if (!record) return json(404, { code: 'NOT_FOUND', description: 'form not found' });
      // A full PUT: everything the caller omits is what Typeform would delete, so the fake applies
      // exactly what arrived instead of merging generously.
      Object.assign(record, {
        title: body?.title ?? record.title,
        fields: structuredClone(body?.fields ?? record.fields),
        settings: structuredClone(body?.settings ?? record.settings),
        logic: structuredClone(body?.logic ?? []),
        welcome_screens: structuredClone(body?.welcome_screens ?? record.welcome_screens ?? []),
        thankyou_screens: structuredClone(body?.thankyou_screens ?? record.thankyou_screens ?? []),
      });
      return json(200, { ...record, _links: { display: `https://form.typeform.com/to/${id}`, edit: `https://admin.typeform.com/form/${id}/edit` } });
    }
    if (operation === 'forms.list') return json(200, { items: [...forms.values()].map(f => ({ id: f.id, title: f.title })), page_count: 1, total_items: forms.size });
    if (operation === 'me.get') return json(200, { id: options.accountId ?? 'typeform-account-1', email: 'owner@example.test', name: 'Owner', account_type: 'personal', plan: 'basic' });
    return json(404, { code: 'NOT_FOUND' });
  }

  return {
    fetch: fetchLike,
    calls,
    forms,
    acceptToken: value => accepted.add(value),
    revokeToken: value => accepted.delete(value),
    failOn: (operation, spec) => failures.push({ operation, ...spec }),
    callsTo: operation => calls.filter(call => call.operation === operation),
    lastForm: () => [...forms.values()].at(-1),
  };
}

/** The whole Typeform side of the system with nothing real in it beyond the HTTP boundary. */
export function createTypeformWorld(options = {}) {
  const env = { ...providerEnv(), TYPEFORM_OAUTH_CLIENT_ID: 'test-typeform-client-id', TYPEFORM_OAUTH_CLIENT_SECRET: 'test-typeform-client-secret', ...(options.env ?? {}) };
  const clock = { time: options.start ?? new Date('2026-09-29T09:00:00Z') };
  const now = () => new Date(clock.time);
  const cipher = createTokenCipher({ authSecret: AUTH_SECRET });
  const store = createMemoryStore();
  const fake = createFakeTypeform({ tokens: [], ...(options.fake ?? {}) });

  const refresh = { calls: [], mode: 'ok' };
  const http = {
    async postForm(url, body) {
      const params = new URLSearchParams(body.toString());
      refresh.calls.push({ url: String(url), grantType: params.get('grant_type'), refreshToken: params.get('refresh_token') });
      if (refresh.mode === 'invalid_grant') return { status: 400, json: { error: 'invalid_grant' } };
      if (refresh.mode === 'unavailable') return { status: 503, json: { error: 'temporarily_unavailable' } };
      fake.acceptToken('REFRESHED_TYPEFORM_TOKEN');
      return { status: 200, json: { access_token: 'REFRESHED_TYPEFORM_TOKEN', expires_in: 3600, token_type: 'Bearer', scope: SCOPES.join(' ') } };
    },
    async getJson() {
      throw new Error('the typeform adapter tests never call identity endpoints through the service http');
    },
  };
  const service = createProviderService({ store, http, cipher, env, now });

  const lookups = [];
  const rejections = [];
  const deps = {
    getConnection: (userId, provider) => {
      lookups.push([userId, provider]);
      return service.getAuthorizedConnection(userId, provider);
    },
    reportAuthorizationRejected: (userId, provider) => {
      rejections.push([userId, provider]);
      return service.reportAuthorizationRejected(userId, provider);
    },
    client: createTypeformClient({ fetchImpl: fake.fetch, timeoutMs: options.timeoutMs }),
  };

  const logs = [];
  const log = (event, fields) => logs.push({ event, ...fields });

  async function connect(userId, connection = {}) {
    const access = connection.access ?? `ACCESS_TOKEN_OF_${userId.toUpperCase()}`;
    const refreshToken = connection.refresh === undefined ? `REFRESH_TOKEN_OF_${userId.toUpperCase()}` : connection.refresh;
    fake.acceptToken(access);
    const saved = await store.saveConnection({
      id: `connection-${userId}`,
      userId,
      provider: 'typeform',
      status: connection.status ?? 'connected',
      externalAccountId: connection.externalAccountId ?? `typeform-account-of-${userId}`,
      externalAccountEmail: `${userId}@example.test`,
      externalAccountLabel: `${userId} on Typeform`,
      scopes: connection.scopes ?? SCOPES,
      accessTokenCiphertext: cipher.encrypt(access, credentialAad(userId, 'typeform', 'access')),
      accessTokenExpiresAt: new Date(clock.time.getTime() + (connection.expiresInMs ?? 3_600_000)),
      refreshTokenCiphertext: refreshToken ? cipher.encrypt(refreshToken, credentialAad(userId, 'typeform', 'refresh')) : null,
      lastAuthorizedAt: new Date(clock.time),
      lastRefreshedAt: null,
    });
    if (!saved.ok) throw new Error('could not seed the connection');
    return { access, refresh: refreshToken };
  }

  return {
    env, clock, now, cipher, store, fake, service, refresh, lookups, rejections, logs, log, connect,
    provider: createTypeformProvider(deps),
  };
}

async function createTypeform(world, specification, userId = 'user-a') {
  return world.provider.createForm(userId, specification, { requestId: 'req_test', log: world.log });
}

function assertNoSecrets(world) {
  const haystack = JSON.stringify(world.logs);
  for (const secret of ['ACCESS_TOKEN_OF_USER-A', 'REFRESH_TOKEN_OF_USER-A', 'REFRESHED_TYPEFORM_TOKEN', 'test-typeform-client-secret', 'Bearer ']) {
    assert.equal(haystack.includes(secret), false, `a credential appeared in logs: ${secret}`);
  }
}

test('creates the whole Typeform in one request, then reports the created form', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  const created = await createTypeform(world, SIMPLE);
  const calls = world.fake.calls;

  assert.deepEqual(calls.map(call => call.operation), ['forms.create']);
  const [create] = calls;
  assert.equal(create.method, 'POST');
  assert.equal(create.url, `${API_ORIGIN}/forms`);
  assert.equal(create.authorization, 'Bearer ACCESS_TOKEN_OF_USER-A', 'the connected user\'s own token');
  assert.equal(create.contentType, 'application/json');
  assert.equal(create.redirect, 'error', 'a redirect can never carry the token elsewhere');
  assert.equal(create.hasSignal, true, 'every request has a timeout');

  assert.equal(create.body.title, 'Intake Typeform');
  assert.equal(create.body.fields.length, 2);
  assert.deepEqual(create.body.fields.map(field => field.type), ['short_text', 'multiple_choice']);
  assert.equal(create.body.settings.language, 'en');
  assert.equal(create.body.settings.is_public, true, 'settings use the API wire names');
  assert.equal('isPublic' in create.body.settings, false);
  assert.equal('showTypeformBranding' in create.body.settings, false);
  assert.equal('theme' in create.body, false, 'omitting the theme lets Typeform apply its default');
  assert.equal(create.body.welcome_screens[0].properties.show_button, true);
  assert.equal('showButton' in create.body.welcome_screens[0].properties, false);
  assert.equal(create.body.thankyou_screens[0].properties.show_button, false);
  assert.equal('buttonMode' in create.body.thankyou_screens[0].properties, false);
  assert.equal(create.body.fields[1].properties.allow_multiple_selection, false);
  assert.equal('allowMultiple' in create.body.fields[1].properties, false);
  assert.equal('email' in (create.body.fields[0].validations ?? {}), false);
  assert.equal(create.body.welcome_screens.length, 1);
  assert.equal(create.body.thankyou_screens.length, 1);

  const formRecord = world.fake.lastForm();
  assert.equal(created.provider, 'typeform');
  assert.equal(created.providerFormId, formRecord.id);
  assert.equal(created.title, 'Intake Typeform');
  assert.equal(created.published, true);
  assert.equal(created.responderUrl, `https://form.typeform.com/to/${formRecord.id}`);
  assert.equal(created.editUrl, `https://admin.typeform.com/form/${formRecord.id}/edit`);
  assert.equal(created.externalAccountId, 'typeform-account-of-user-a');
  assertNoSecrets(world);
});

test('visibility rules ride along as Typeform logic in the same create request', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  await createTypeform(world, VISIBLE);
  const [create] = world.fake.calls;
  assert.equal(create.body.logic.length, 1);
  assert.equal(create.body.logic[0].type, 'field');
  assert.equal(create.body.logic[0].ref, 'q_need');
  const [action] = create.body.logic[0].actions;
  assert.equal(action.action, 'jump');
  assert.equal(action.condition.op, 'is_not', 'every answer except the visible one skips the group');
  assert.deepEqual(action.condition.vars, [
    { type: 'field', value: 'q_need' },
    { type: 'choice', value: 'q_need_choice_0' },
  ]);
  assert.deepEqual(action.details.to, { type: 'thankyou', value: 'thankyou' }, 'the group is last, so the jump ends the form');
});

test('choice fields use the property names Typeform accepts', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  await createTypeform(world, CHOICES);
  const [create] = world.fake.calls;
  assert.equal('allow_multiple_selection' in create.body.fields[0].properties, false, 'dropdowns do not take a multi-select flag');
  assert.equal('ref' in create.body.fields[0].properties.choices[0], false, 'dropdown choices have no refs');
  assert.equal(create.body.fields[1].properties.allow_multiple_selection, true, 'checkboxes are a multi-select multiple choice');
  assert.equal(create.body.fields[1].properties.choices[0].ref, 'q_skills_choice_0');
});

test('visibility Typeform cannot express is refused before any request', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  const error = await failureOf(createTypeform(world, MISPLACED));
  assert.equal(error.info.code, 'unsupported_by_provider');
  assert.match(error.info.message, /Typeform/i);
  assert.equal(world.fake.calls.length, 0, 'nothing is sent when the layout cannot be represented');
});

test('an invalid specification fails validation before any request or connection read', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  const error = await failureOf(createTypeform(world, form([{ id: 'q', type: 'rating', title: 'Rate us' }])));
  assert.equal(error.info.code, 'validation_failed');
  assert.equal(world.fake.calls.length, 0, 'nothing is sent to Typeform for a form it cannot express');
  assert.equal(world.lookups.length, 0, 'the connection is not even read');
});

test('retrieveForm reads the form and maps it into the shared snapshot shape', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  const created = await createTypeform(world, SIMPLE);
  const retrieved = await world.provider.retrieveForm('user-a', created.providerFormId, { requestId: 'req_get', log: world.log });
  assert.equal(retrieved.current.providerFormId, created.providerFormId);
  assert.equal(retrieved.current.title, 'Intake Typeform');
  assert.equal(retrieved.current.items.length, 2);
  assert.equal(retrieved.current.items[0].title, 'Full name');
  assert.equal(retrieved.current.items[0].required, true);
  assert.equal(retrieved.externalAccountId, 'typeform-account-of-user-a');
  assert.equal(world.fake.callsTo('forms.get').length, 1);
});

test('retrieveForm rejects a malformed form id without contacting Typeform', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  const error = await failureOf(world.provider.retrieveForm('user-a', 'short', { requestId: 'req_bad', log: world.log }));
  assert.equal(error.info.code, 'invalid_request');
  assert.equal(error.info.outcome, 'not_created');
  assert.equal(world.fake.calls.length, 0);
});

test('a disconnected user is refused without any provider request', async () => {
  const world = createTypeformWorld();
  const error = await failureOf(createTypeform(world, SIMPLE));
  assert.equal(error.info.code, 'provider_not_connected');
  assert.equal(error.info.stage, 'connection');
  assert.equal(world.fake.calls.length, 0);
});

test('a revoked token is reported and mapped to reauthorization', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  world.fake.revokeToken('ACCESS_TOKEN_OF_USER-A');
  const error = await failureOf(createTypeform(world, SIMPLE));
  assert.equal(error.info.code, 'provider_reauthorization_required');
  assert.equal(error.info.outcome, 'not_created');
  assert.deepEqual(world.rejections, [['user-a', 'typeform']], 'the rejection is recorded so the connection is marked for reauth');
});

test('rate limiting is retryable and reported with the retry hint', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  world.fake.failOn('forms.create', { respond: { status: 429, body: { code: 'TOO_MANY_REQUESTS', description: 'slow down' } } });
  const error = await failureOf(createTypeform(world, SIMPLE));
  assert.equal(error.info.code, 'provider_rate_limited');
  assert.equal(error.info.retryable, true);
  assert.equal(error.info.outcome, 'not_created');
});

test('a 5xx during create is an unknown outcome: Typeform may have made the form', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  world.fake.failOn('forms.create', { respond: { status: 503, body: { code: 'INTERNAL_ERROR' } } });
  const error = await failureOf(createTypeform(world, SIMPLE));
  assert.equal(error.info.code, 'provider_error');
  assert.equal(error.info.outcome, 'unknown');
  assert.match(error.info.message, /may or may not exist/);
});

test('a timeout during create is an unknown outcome, so it is not offered as retryable', async () => {
  const world = createTypeformWorld();
  await world.connect('user-a');
  world.fake.failOn('forms.create', { timeout: true });
  const error = await failureOf(createTypeform(world, SIMPLE));
  assert.equal(error.info.code, 'provider_unavailable');
  assert.equal(error.info.outcome, 'unknown');
  assert.equal(error.info.retryable, false, 'a form may exist, so an automatic retry must not be encouraged');
});
