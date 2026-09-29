import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createFormsProviders } from '../server/forms/providers/index.ts';
import { FORMS_BODY_SCOPE, createGoogleFormsProvider } from '../server/forms/providers/google/adapter.ts';
import { createGoogleFormsClient, createdItemId, isFormId, GoogleFormsApiError } from '../server/forms/providers/google/client.ts';
import { providerDefinition } from '../server/providers/registry.ts';
import { useProviderService } from '../server/providers/service.ts';
import { CLIENT_SECRET, REFRESHED_TOKEN, createGoogleForm, createWorld, failureOf, form, providerEnv, shortText, when, yesNo } from './helpers/forms-harness.mjs';

const SIMPLE = form([shortText('name', { title: 'Full name', required: true }), { id: 'level', type: 'multiple_choice', title: 'Level', options: ['100', '200'] }], { title: 'Intake test', description: 'A short form.' });
const ROUTED = form([shortText('name'), yesNo(), shortText('nights', { title: 'Nights', ...when('need', 'Yes') }), shortText('contact', { title: 'Contact' })], { title: 'Routed' });

async function connectedWorld(options) {
  const world = createWorld(options);
  await world.connect('user-a');
  return world;
}

function assertNoSecrets(world, ...values) {
  const haystack = JSON.stringify([world.logs, ...values]);
  for (const secret of ['ACCESS_TOKEN_OF_USER-A', 'REFRESH_TOKEN_OF_USER-A', 'ACCESS_TOKEN_OF_USER-B', 'REFRESH_TOKEN_OF_USER-B', REFRESHED_TOKEN, CLIENT_SECRET, 'Bearer ']) {
    assert.equal(haystack.includes(secret), false, `a credential appeared where it must not: ${secret}`);
  }
}

// ---------------------------------------------------------------- the documented sequence

test('creates the form, adds everything with batchUpdate, then publishes: the documented Google sequence', async () => {
  const world = await connectedWorld();
  const created = await createGoogleForm(world, SIMPLE);
  const calls = world.fake.calls;

  assert.deepEqual(calls.map(call => call.operation), ['forms.create', 'forms.batchUpdate', 'forms.setPublishSettings']);
  for (const call of calls) {
    assert.equal(call.method, 'POST');
    assert.ok(call.url.startsWith('https://forms.googleapis.com/v1/forms'), call.url);
    assert.equal(call.authorization, 'Bearer ACCESS_TOKEN_OF_USER-A', 'the connected user\'s own token');
    assert.equal(call.contentType, 'application/json');
    assert.equal(call.redirect, 'error', 'a redirect can never carry the token elsewhere');
    assert.equal(call.hasSignal, true, 'every request has a timeout');
  }

  const [create, batch, publish] = calls;
  assert.equal(create.path, '/v1/forms');
  assert.deepEqual(create.query, { unpublished: 'true' }, 'a half-built form must never accept responses');
  assert.deepEqual(create.body, { info: { title: 'Intake test', documentTitle: 'Intake test' } }, 'forms.create copies only the title');

  assert.equal(batch.path, `/v1/forms/${created.providerFormId}:batchUpdate`);
  assert.deepEqual(batch.body.requests[0], { updateFormInfo: { info: { description: 'A short form.' }, updateMask: 'description' } });
  assert.equal(batch.body.requests.filter(request => request.createItem).length, 2);
  assert.equal(batch.body.requests[1].createItem.location.index, 0);

  assert.equal(publish.path, `/v1/forms/${created.providerFormId}:setPublishSettings`);
  assert.deepEqual(publish.body, { publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } } });
  assert.equal('updateMask' in publish.body, false);

  const google = world.fake.lastForm();
  assert.deepEqual(google.publishState, { isPublished: true, isAcceptingResponses: true });
  assert.equal(google.info.description, 'A short form.');
  assert.deepEqual(google.items.map(item => item.title), ['Full name', 'Level']);
  assertNoSecrets(world);
});

test('routed forms need one more batchUpdate, still before publishing', async () => {
  const world = await connectedWorld();
  await createGoogleForm(world, ROUTED);
  assert.deepEqual(world.fake.calls.map(call => call.operation), ['forms.create', 'forms.batchUpdate', 'forms.batchUpdate', 'forms.setPublishSettings']);
  const google = world.fake.lastForm();
  assert.equal(google.items.filter(item => item.questionItem).length, 4);
  assert.deepEqual(google.publishState, { isPublished: true, isAcceptingResponses: true });
});

// ---------------------------------------------------------------- response mapping

test('the result contains only what Intake needs, taken from Google\'s answers', async () => {
  const world = await connectedWorld();
  const created = await createGoogleForm(world, form([{ id: 'mail', type: 'email', title: 'Email' }], { title: 'Mapping' }));
  const google = world.fake.lastForm();
  assert.deepEqual(created, {
    provider: 'google',
    providerFormId: google.formId,
    title: 'Mapping',
    editUrl: `https://docs.google.com/forms/d/${google.formId}/edit`,
    responderUrl: google.responderUri,
    published: true,
    warnings: [created.warnings[0]],
    externalAccountId: 'google-account-of-user-a',
  });
  assert.equal(created.warnings[0].code, 'email_validation_unavailable');
  assert.deepEqual(Object.keys(created).sort(), ['editUrl', 'externalAccountId', 'provider', 'providerFormId', 'published', 'responderUrl', 'title', 'warnings']);
  assert.equal(JSON.stringify(created).includes('revisionId'), false, 'no raw Google fields');
});

test('a responder link is only used if it is an https Google Forms address', async () => {
  for (const responderUri of ['https://evil.example/forms/viewform', 'javascript:alert(1)', 'http://docs.google.com/forms/d/e/x/viewform', 'https://docs.google.com.evil.example/forms/d/e/x/viewform', '//docs.google.com/forms']) {
    const world = await connectedWorld({ fake: { responderUri: () => responderUri } });
    const created = await createGoogleForm(world, SIMPLE);
    assert.equal(created.responderUrl, undefined, `${responderUri} must not be passed on`);
    assert.match(created.editUrl, /^https:\/\/docs\.google\.com\/forms\/d\/[A-Za-z0-9_-]+\/edit$/, 'the edit link is built from the id, not taken from Google');
  }
});

test('an unusable create response stops the build: nothing is guessed and no further request is made', async () => {
  for (const body of [{ formId: '../../evil', responderUri: 'https://docs.google.com/x' }, { formId: 'a/b/c/d/e/f/g/h' }, { formId: 12345678 }, { responderUri: 'https://docs.google.com/x' }, {}]) {
    const world = await connectedWorld();
    world.fake.failOn('forms.create', { respond: { body } });
    const error = await failureOf(createGoogleForm(world, SIMPLE));
    assert.equal(error.info.code, 'provider_error');
    assert.equal(error.info.stage, 'create');
    assert.equal(error.info.outcome, 'unknown', 'Google said yes but gave no usable id, so a form may exist');
    assert.equal(error.info.partialForm, undefined);
    assert.equal(world.fake.calls.length, 1, 'no request is built from an id that failed the check');
  }
});

// ---------------------------------------------------------------- nothing is sent for an invalid form

test('an invalid specification makes zero provider requests and does not even read the connection', async () => {
  const world = await connectedWorld();
  for (const input of [
    { title: '', questions: [shortText('a')] },
    { title: 'T', questions: [] },
    { title: 'T', questions: [{ id: 'q', type: 'dropdown', title: 'Pick' }] },
    { title: 'T', questions: [{ id: 'q', type: 'signature', title: 'Sign' }] },
    { title: 'T', questions: [shortText('a'), shortText('a')] },
    { title: 'T', questions: [shortText('a', when('ghost', 'Yes'))] },
    null,
    'not an object',
  ]) {
    const error = await failureOf(world.provider.createForm('user-a', input));
    assert.equal(error.info.code, 'validation_failed');
    assert.equal(error.info.outcome, 'not_created');
    assert.ok(error.info.issues.length > 0);
  }
  assert.equal(world.fake.calls.length, 0);
  assert.equal(world.lookups.length, 0, 'no token was fetched or refreshed for a specification that can never be created');
});

test('a layout Google cannot express is refused before any request', async () => {
  const world = await connectedWorld();
  const error = await failureOf(world.provider.createForm('user-a', form([yesNo(), shortText('a', when('need', 'Yes')), shortText('b', when('need', 'No'))])));
  assert.equal(error.info.code, 'unsupported_by_provider');
  assert.equal(error.info.outcome, 'not_created');
  assert.ok(error.info.issues.some(issue => issue.code === 'google_condition_placement'));
  assert.equal(world.fake.calls.length, 0);
  assert.equal(world.lookups.length, 0);
});

// ---------------------------------------------------------------- the connection

test('without a Google connection nothing is created', async () => {
  const world = createWorld();
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_not_connected');
  assert.equal(error.info.stage, 'connection');
  assert.equal(error.info.outcome, 'not_created');
  assert.match(error.info.message, /Connect Google Forms/);
  assert.equal(world.fake.calls.length, 0);
});

test('an expired or revoked connection asks the user to reconnect', async () => {
  const cases = [
    { name: 'expired with no refresh token', connection: { expiresInMs: -5000, refresh: null } },
    { name: 'marked for reauthorization', connection: { status: 'reauthorization_required' } },
    { name: 'marked expired', connection: { status: 'expired' } },
    { name: 'granted without the forms scope', connection: { scopes: ['openid', 'email'] } },
  ];
  for (const { name, connection } of cases) {
    const world = createWorld();
    await world.connect('user-a', connection);
    const error = await failureOf(createGoogleForm(world, SIMPLE));
    assert.equal(error.info.code, 'provider_reauthorization_required', name);
    assert.equal(error.info.stage, 'connection', name);
    assert.match(error.info.message, /Reconnect Google/, name);
    assert.equal(world.fake.calls.length, 0, name);
  }
});

test('renewing a token on a server without Google configured says so and makes no request', async () => {
  // The connection service needs the OAuth client settings only to refresh, so this is where it shows.
  const world = createWorld({ env: providerEnv({ GOOGLE_OAUTH_CLIENT_ID: '' }) });
  await world.connect('user-a', { expiresInMs: -1000 });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_not_configured');
  assert.equal(world.fake.calls.length, 0);
});

test('a failure reading the connection is reported without leaking the reason', async () => {
  const world = await connectedWorld();
  const provider = createGoogleFormsProvider({ ...world.google, getConnection: async () => { throw new Error('connect ECONNREFUSED postgresql://user:hunter2@db.internal/intake'); } });
  const error = await failureOf(provider.createForm('user-a', SIMPLE, { requestId: 'req_x', log: world.log }));
  assert.equal(error.info.code, 'storage_unavailable');
  assert.equal(error.info.retryable, true);
  assert.equal(JSON.stringify(error.info).includes('hunter2'), false);
  assert.equal(world.fake.calls.length, 0);
});

test('a connection that belongs to someone else is refused even if the service returned it', async () => {
  const world = await connectedWorld();
  await world.connect('user-b');
  const stolen = await world.service.getAuthorizedConnection('user-b', 'google');
  const provider = createGoogleFormsProvider({ ...world.google, getConnection: async () => stolen });
  const error = await failureOf(provider.createForm('user-a', SIMPLE, { requestId: 'req_x', log: world.log }));
  assert.equal(error.info.code, 'internal_error');
  assert.equal(world.fake.calls.length, 0, 'user-b\'s token was never used on user-a\'s behalf');
});

test('each user creates forms with their own connection only', async () => {
  const world = await connectedWorld();
  await world.connect('user-b');
  const noConnection = await failureOf(createGoogleForm(world, SIMPLE, 'user-c'));
  assert.equal(noConnection.info.code, 'provider_not_connected', 'other users\' connections do not help user-c');
  assert.equal(world.fake.calls.length, 0);

  const a = await createGoogleForm(world, SIMPLE, 'user-a');
  const b = await createGoogleForm(world, SIMPLE, 'user-b');
  assert.equal(a.externalAccountId, 'google-account-of-user-a');
  assert.equal(b.externalAccountId, 'google-account-of-user-b');
  const tokens = world.fake.calls.map(call => call.authorization);
  assert.deepEqual(tokens.slice(0, 3), Array(3).fill('Bearer ACCESS_TOKEN_OF_USER-A'));
  assert.deepEqual(tokens.slice(3), Array(3).fill('Bearer ACCESS_TOKEN_OF_USER-B'));
  assert.deepEqual([...new Set(world.lookups.map(([user]) => user))].sort(), ['user-a', 'user-b', 'user-c']);
  assert.ok(world.lookups.every(([, provider]) => provider === 'google'));
});

// ---------------------------------------------------------------- token refresh through the real service

test('an expired access token is renewed by the existing connection service, once, and the new token is used', async () => {
  const world = createWorld();
  await world.connect('user-a', { expiresInMs: 10_000 });
  const created = await createGoogleForm(world, SIMPLE);

  assert.equal(world.refresh.calls.length, 1, 'exactly one refresh');
  assert.equal(world.refresh.calls[0].grantType, 'refresh_token');
  assert.equal(world.refresh.calls[0].refreshToken, 'REFRESH_TOKEN_OF_USER-A');
  assert.ok(world.fake.calls.length === 3 && world.fake.calls.every(call => call.authorization === `Bearer ${REFRESHED_TOKEN}`), 'Google only ever saw the refreshed token');
  assert.equal(created.published, true);

  await createGoogleForm(world, SIMPLE);
  assert.equal(world.refresh.calls.length, 1, 'the renewed token was stored, so no second refresh');
  assert.equal(world.fake.calls.at(-1).authorization, `Bearer ${REFRESHED_TOKEN}`);
  assertNoSecrets(world);
});

test('a refresh token that no longer works asks the user to reconnect and never reaches Google', async () => {
  const world = createWorld();
  await world.connect('user-a', { expiresInMs: -1000 });
  world.refresh.mode = 'invalid_grant';
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_reauthorization_required');
  assert.equal(error.info.outcome, 'not_created');
  assert.equal(world.fake.calls.length, 0);
  assert.equal((await world.store.getConnection('user-a', 'google')).status, 'reauthorization_required');
});

test('Google being unreachable during a refresh is a retryable, nothing-created failure', async () => {
  const world = createWorld();
  await world.connect('user-a', { expiresInMs: -1000 });
  world.refresh.mode = 'unavailable';
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_unavailable');
  assert.equal(error.info.retryable, true);
  assert.equal(error.info.outcome, 'not_created');
  assert.equal(world.fake.calls.length, 0);
});

// ---------------------------------------------------------------- Google failing at each step

test('Google rejecting forms.create: nothing exists', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.create', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'Invalid value at info.title' });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_rejected');
  assert.equal(error.info.stage, 'create');
  assert.equal(error.info.outcome, 'not_created');
  assert.equal(error.info.partialForm, undefined);
  assert.match(error.info.message, /Nothing was created/);
  assert.equal(world.fake.calls.length, 1);
  assert.equal(world.fake.forms.size, 0);
});

test('batchUpdate failing after forms.create leaves a form that is reported and never published', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.batchUpdate', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'Invalid requests[2].createItem' });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  const google = world.fake.lastForm();

  assert.equal(error.info.code, 'provider_rejected');
  assert.equal(error.info.stage, 'add_questions');
  assert.equal(error.info.outcome, 'partial');
  assert.equal(error.info.retryable, false, 'retrying would create a second form');
  assert.deepEqual(error.info.partialForm, { providerFormId: google.formId, editUrl: `https://docs.google.com/forms/d/${google.formId}/edit`, state: 'unpublished' });
  assert.match(error.info.message, /partly built form exists in your Google account and is not published/);
  assert.equal(error.info.detail, 'Invalid requests[2].createItem', 'Google\'s own explanation is passed on, sanitized');
  assert.equal(error.externalAccountId, 'google-account-of-user-a', 'server-side only, for ownership');
  assert.equal(JSON.stringify(error.info).includes('google-account-of-user-a'), false);

  assert.deepEqual(google.publishState, { isPublished: false, isAcceptingResponses: false }, 'a half-built form is not live');
  assert.equal(world.fake.callsTo('forms.setPublishSettings').length, 0, 'never published after a failure');
  assert.equal(world.fake.callsTo('forms.batchUpdate').length, 1, 'not retried: batchUpdate is not idempotent');
});

test('the routing step failing reports that the questions exist and only the logic is missing', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.batchUpdate', { status: 500, googleStatus: 'INTERNAL', message: 'Internal error' }, 1);
  const error = await failureOf(createGoogleForm(world, ROUTED));
  assert.equal(error.info.stage, 'configure_logic');
  assert.equal(error.info.outcome, 'partial');
  assert.equal(error.info.code, 'provider_error');
  assert.match(error.info.message, /questions were added, but Google did not accept the conditional logic/);
  const google = world.fake.lastForm();
  assert.equal(google.items.filter(item => item.questionItem).length, 4, 'all questions were created');
  assert.equal(JSON.stringify(google.items).includes('goTo'), false, 'and none of them routes');
  assert.equal(google.publishState.isPublished, false);
  assert.equal(world.fake.callsTo('forms.setPublishSettings').length, 0);
});

test('publish failing leaves a complete but unpublished form, with an accurate explanation', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.setPublishSettings', { status: 403, googleStatus: 'PERMISSION_DENIED', message: 'The caller does not have permission' });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  const google = world.fake.lastForm();
  assert.equal(error.info.stage, 'publish');
  assert.equal(error.info.code, 'provider_permission_denied');
  assert.equal(error.info.outcome, 'partial');
  assert.equal(error.info.partialForm.state, 'unpublished');
  assert.match(error.info.message, /built, but Google did not publish it/);
  assert.equal(google.items.length, 2, 'the content is complete');
  assert.equal(google.publishState.isPublished, false);
});

test('an unconfirmed publish (timeout) is reported as unconfirmed, not as unpublished', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.setPublishSettings', { timeout: true });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_unavailable');
  assert.equal(error.info.stage, 'publish');
  assert.equal(error.info.partialForm.state, 'publish_unconfirmed');
  assert.match(error.info.message, /did not confirm whether it published the form/);
});

test('a publish answer that says the form is not published is not treated as success', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.setPublishSettings', { respond: { body: { formId: 'x', publishSettings: { publishState: { isPublished: false, isAcceptingResponses: false } } } } });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_error');
  assert.equal(error.info.stage, 'publish');
  assert.equal(error.info.outcome, 'partial');
});

test('when Google does not confirm forms.create, the outcome is unknown and never retried', async () => {
  for (const failure of [{ timeout: true }, { network: true }, { status: 500, googleStatus: 'INTERNAL', message: 'oops' }, { applyThenDrop: true }]) {
    const world = await connectedWorld();
    world.fake.failOn('forms.create', failure);
    const error = await failureOf(createGoogleForm(world, SIMPLE));
    assert.equal(error.info.outcome, 'unknown', JSON.stringify(failure));
    assert.equal(error.info.retryable, false, 'retrying could create a duplicate');
    assert.equal(error.info.partialForm, undefined, 'there is no form id to point at');
    assert.match(error.info.message, /may or may not exist/);
    assert.equal(world.fake.callsTo('forms.create').length, 1);
    assert.equal(world.fake.calls.length, 1);
  }
});

test('Google error statuses become specific, human-readable, correctly classified failures', async () => {
  const cases = [
    { failure: { status: 429, googleStatus: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded', headers: { 'retry-after': '30' } }, code: 'provider_rate_limited', retryable: true, text: /limiting requests/ },
    { failure: { status: 403, googleStatus: 'PERMISSION_DENIED', reason: 'SERVICE_DISABLED', message: 'Google Forms API has not been used in project' }, code: 'provider_permission_denied', retryable: false, text: /not enabled for the Google Cloud project/ },
    { failure: { status: 403, googleStatus: 'PERMISSION_DENIED', reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT', message: 'Request had insufficient authentication scopes.' }, code: 'provider_reauthorization_required', retryable: false, text: /Reconnect Google/ },
    { failure: { status: 403, googleStatus: 'PERMISSION_DENIED', message: 'The caller does not have permission' }, code: 'provider_permission_denied', retryable: false, text: /restrict Google Forms/ },
    { failure: { status: 503, googleStatus: 'UNAVAILABLE', message: 'The service is currently unavailable.' }, code: 'provider_error', retryable: false, text: /temporary problem/ },
    { failure: { timeout: true }, code: 'provider_unavailable', retryable: false, text: /too long to answer/ },
    { failure: { network: true }, code: 'provider_unavailable', retryable: false, text: /could not be reached/ },
  ];
  for (const { failure, code, text } of cases) {
    const world = await connectedWorld();
    world.fake.failOn('forms.batchUpdate', failure);
    const error = await failureOf(createGoogleForm(world, SIMPLE));
    assert.equal(error.info.code, code, JSON.stringify(failure));
    assert.match(error.info.message, text);
    assert.equal(error.info.outcome, 'partial');
    assert.equal(error.info.retryable, false, 'a partly built form must not be retried blindly');
    assert.equal(world.fake.callsTo('forms.batchUpdate').length, 1, 'no automatic retry');
  }
  // Before anything exists, the same statuses are safe to retry.
  for (const failure of [{ status: 429, googleStatus: 'RESOURCE_EXHAUSTED', message: 'Quota exceeded' }]) {
    const world = await connectedWorld();
    world.fake.failOn('forms.create', failure);
    const error = await failureOf(createGoogleForm(world, SIMPLE));
    assert.equal(error.info.outcome, 'not_created');
    assert.equal(error.info.retryable, true);
  }
});

test('Google rejecting the token marks the connection for renewal, and the next attempt never reaches Google', async () => {
  const world = await connectedWorld();
  world.fake.revokeToken('ACCESS_TOKEN_OF_USER-A');
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(error.info.code, 'provider_reauthorization_required');
  assert.equal(error.info.outcome, 'not_created');
  assert.match(error.info.message, /Reconnect Google/);
  assert.deepEqual(world.rejections, [['user-a', 'google']]);
  assert.equal((await world.store.getConnection('user-a', 'google')).status, 'reauthorization_required');

  const before = world.fake.calls.length;
  const again = await failureOf(createGoogleForm(world, SIMPLE));
  assert.equal(again.info.code, 'provider_reauthorization_required');
  assert.equal(again.info.stage, 'connection');
  assert.equal(world.fake.calls.length, before, 'the service now refuses locally');
});

test('a failure while reporting a rejected token does not hide the real failure', async () => {
  const world = await connectedWorld();
  world.fake.revokeToken('ACCESS_TOKEN_OF_USER-A');
  const provider = createGoogleFormsProvider({ ...world.google, reportAuthorizationRejected: async () => { throw new Error('store down'); } });
  const error = await failureOf(provider.createForm('user-a', SIMPLE, { requestId: 'req_x', log: world.log }));
  assert.equal(error.info.code, 'provider_reauthorization_required');
});

test('error details from Google are sanitized before they reach a caller or a log', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.batchUpdate', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'bad  request\n\u0000 access_token=ACCESS_TOKEN_OF_USER-A refresh_token=REFRESH_TOKEN_OF_USER-A ' + 'x'.repeat(600) });
  const error = await failureOf(createGoogleForm(world, SIMPLE));
  assert.ok(error.info.detail.length <= 240);
  assert.equal(/[\u0000-\u001f]/.test(error.info.detail), false);
  assertNoSecrets(world, error.info);
  assert.match(error.info.detail, /\[redacted/);
});

test('unexpected errors inside the adapter become internal errors with no stack or message leaked', async () => {
  const world = await connectedWorld();
  const client = { createForm: async () => { throw new TypeError('secret internals: postgresql://user:pw@host/db'); }, batchUpdate: async () => ({ replies: [] }), setPublishSettings: async () => ({ isPublished: true, isAcceptingResponses: true }) };
  const provider = createGoogleFormsProvider({ ...world.google, client });
  const error = await failureOf(provider.createForm('user-a', SIMPLE, { requestId: 'req_x', log: world.log }));
  assert.equal(error.info.code, 'internal_error');
  assert.equal(JSON.stringify(error.info).includes('postgresql'), false);
  assert.equal(JSON.stringify(world.logs).includes('postgresql'), false);
});

// ---------------------------------------------------------------- logs

test('every provider request and every failure is logged with the request id and no secrets', async () => {
  const world = await connectedWorld();
  await createGoogleForm(world, ROUTED);
  const requests = world.logs.filter(entry => entry.event === 'form.create.provider_request');
  assert.deepEqual(requests.map(entry => [entry.operation, entry.stage]), [
    ['forms.create', 'create'],
    ['forms.batchUpdate', 'add_questions'],
    ['forms.batchUpdate', 'configure_logic'],
    ['forms.setPublishSettings', 'publish'],
  ]);
  assert.ok(requests.every(entry => entry.requestId === 'req_test' && entry.provider === 'google'));
  assert.equal(world.logs.some(entry => entry.event === 'form.create.provider_failed'), false);

  const failing = await connectedWorld();
  failing.fake.failOn('forms.batchUpdate', { status: 400, googleStatus: 'INVALID_ARGUMENT', message: 'Invalid value' });
  const error = await failureOf(createGoogleForm(failing, SIMPLE));
  const failed = failing.logs.find(entry => entry.event === 'form.create.provider_failed');
  assert.equal(failed.requestId, 'req_test');
  assert.equal(failed.stage, 'add_questions');
  assert.equal(failed.operation, 'forms.batchUpdate');
  assert.equal(failed.httpStatus, 400);
  assert.equal(failed.googleStatus, 'INVALID_ARGUMENT');
  assert.equal(failed.outcome, 'partial');
  assert.equal(failed.formId, error.info.partialForm.providerFormId);
  assertNoSecrets(failing, error.info);
  assertNoSecrets(world);
});

// ---------------------------------------------------------------- scope, providers, client

test('the scope the adapter requires is the one the connect flow requests', () => {
  assert.deepEqual(providerDefinition('google', providerEnv()).requiredScopes, [FORMS_BODY_SCOPE]);
  assert.ok(providerDefinition('google', providerEnv()).scopes.includes(FORMS_BODY_SCOPE));
});

test('Microsoft has a slot but no creation: it refuses explicitly and touches nothing', async () => {
  const world = await connectedWorld();
  const providers = world.providers();
  assert.equal(providers.microsoft.id, 'microsoft');
  assert.equal(providers.microsoft.capabilities.createForm, false);
  assert.match(providers.microsoft.capabilities.note, /Microsoft Forms creation is not available yet/);
  const error = await failureOf(providers.microsoft.createForm('user-a', SIMPLE));
  assert.equal(error.info.code, 'provider_not_supported');
  assert.equal(error.info.outcome, 'not_created');
  assert.equal(world.fake.calls.length, 0);
  assert.equal(world.lookups.length, 0);
  assert.equal(providers.google.capabilities.createForm, true);
});

test('form ids are checked before they can become part of a URL', () => {
  for (const good of ['1FAIpQLSfake', 'abcDEF123_-xyz', '1a2b3c4d5e6f7g8h9i0j']) assert.equal(isFormId(good), true, good);
  for (const bad of ['', 'short', '../../etc', 'a/b/c/d/e/f/g/h', 'form:batchUpdate', 'with space 12345', 'x'.repeat(300), null, undefined, 12345678, {}]) assert.equal(isFormId(bad), false, String(bad));
});

test('the client refuses a form id that fails the check without sending anything', async () => {
  const sent = [];
  const client = createGoogleFormsClient({ fetchImpl: async (...args) => { sent.push(args); return new Response('{}'); } });
  for (const id of ['../x', 'a/b', 'abc:def123456']) {
    await assert.rejects(client.batchUpdate('token', id, []), error => error instanceof GoogleFormsApiError && error.info.kind === 'malformed_response');
    await assert.rejects(client.setPublishSettings('token', id, { isPublished: true, isAcceptingResponses: true }), GoogleFormsApiError);
  }
  assert.equal(sent.length, 0);
});

test('the client only ever talks to forms.googleapis.com', async () => {
  const world = await connectedWorld();
  await createGoogleForm(world, ROUTED);
  for (const call of world.fake.calls) assert.equal(new URL(call.url).origin, 'https://forms.googleapis.com');
});

test('item ids are read from createItem replies only when they look like ids', () => {
  assert.equal(createdItemId({ createItem: { itemId: '0a1b2c3d' } }), '0a1b2c3d');
  for (const bad of [null, undefined, {}, { createItem: {} }, { createItem: { itemId: '' } }, { createItem: { itemId: 'has space' } }, { createItem: { itemId: 'x'.repeat(65) } }, { createItem: { itemId: 42 } }, 'string']) {
    assert.equal(createdItemId(bad), null);
  }
});

test('malformed section ids from Google stop the routing step with an accurate stage', async () => {
  const world = await connectedWorld();
  world.fake.failOn('forms.batchUpdate', { respond: { body: { replies: [] } } });
  const error = await failureOf(createGoogleForm(world, ROUTED));
  assert.equal(error.info.stage, 'configure_logic');
  assert.equal(error.info.code, 'provider_error');
  assert.equal(error.info.outcome, 'partial');
  assert.equal(world.fake.callsTo('forms.batchUpdate').length, 1, 'the second batch was never attempted with guessed ids');
});

test('with no dependencies given, the adapter goes through the active provider service exactly as the server wires it', async () => {
  const world = await connectedWorld();
  useProviderService(world.service); // what server/index.ts does at startup
  const provider = createGoogleFormsProvider({ client: world.google.client }); // no getConnection, no reportAuthorizationRejected

  const created = await provider.createForm('user-a', SIMPLE, { requestId: 'req_default', log: world.log });
  assert.equal(created.externalAccountId, 'google-account-of-user-a');
  assert.ok(world.fake.calls.length === 3 && world.fake.calls.every(call => call.authorization === 'Bearer ACCESS_TOKEN_OF_USER-A'));

  const nobody = await failureOf(provider.createForm('user-x', SIMPLE, { requestId: 'req_default', log: world.log }));
  assert.equal(nobody.info.code, 'provider_not_connected', 'the default lookup is the real connection service');

  world.fake.revokeToken('ACCESS_TOKEN_OF_USER-A');
  const rejected = await failureOf(provider.createForm('user-a', SIMPLE, { requestId: 'req_default', log: world.log }));
  assert.equal(rejected.info.code, 'provider_reauthorization_required');
  assert.equal((await world.store.getConnection('user-a', 'google')).status, 'reauthorization_required', 'and rejected tokens are reported through it');
});

test('the default client uses the global fetch, with the same hardening', async () => {
  const seen = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    seen.push({ url: String(url), init });
    return new Response(JSON.stringify({ formId: '1FAfakeFormIdabcdefghij', responderUri: 'https://docs.google.com/forms/d/e/x/viewform' }), { status: 200, headers: { 'content-type': 'application/json' } });
  };
  try {
    const client = createGoogleFormsClient();
    const result = await client.createForm('TOKEN_FOR_DEFAULT_CLIENT_TEST', { title: 'T', documentTitle: 'T', unpublished: true });
    assert.equal(result.formId, '1FAfakeFormIdabcdefghij');
    assert.equal(seen.length, 1);
    assert.equal(seen[0].url, 'https://forms.googleapis.com/v1/forms?unpublished=true');
    assert.equal(seen[0].init.redirect, 'error');
    assert.equal(seen[0].init.method, 'POST');
    assert.ok(seen[0].init.signal instanceof AbortSignal);
    assert.equal(seen[0].init.headers.authorization, 'Bearer TOKEN_FOR_DEFAULT_CLIENT_TEST');
  } finally {
    globalThis.fetch = original;
  }
});
