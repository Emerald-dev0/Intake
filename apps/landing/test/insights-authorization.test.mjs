/**
 * Who may see a form's response insights, and what someone is told when they may not.
 *
 * The insights screen is the only place Intake reads respondent answers, so the gate around it is
 * the whole point: the plan has to allow it, the form has to belong to the caller, and the Google
 * grant has to include the optional responses permission. Each missing piece has to produce its own
 * plain code, because the workspace turns that code into the matching next step — upgrade, allow
 * the permission, or reconnect.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import express from 'express';
import { createInsightsRouter } from '../server/forms/insights/routes.ts';

const RESPONSES_SCOPE = 'https://www.googleapis.com/auth/forms.responses.readonly';
const FORMS_SCOPE = 'https://www.googleapis.com/auth/forms.body';

const FORM = {
  id: 'form-1',
  provider: 'google',
  providerFormId: 'google-form-1',
  title: 'Feedback',
  status: 'created',
  failureStage: null,
  editUrl: null,
  responderUrl: null,
  createdAt: '2026-09-01T10:00:00.000Z',
  description: null,
  source: 'created',
  lastSyncedAt: null,
  archivedAt: null,
  updatedAt: '2026-09-01T10:00:00.000Z',
};

function connection(overrides = {}) {
  return {
    ok: true,
    provider: 'google',
    userId: 'user-a',
    externalAccountId: 'google-sub',
    externalAccountEmail: 'ada@gmail.com',
    scopes: ['openid', 'email', FORMS_SCOPE],
    accessToken: 'ACCESS_TOKEN',
    accessTokenExpiresAt: '2026-09-01T11:00:00.000Z',
    ...overrides,
  };
}

async function boot(options = {}) {
  const calls = { listResponses: 0, getForm: 0 };
  const deps = {
    getSession: async () => (options.signedIn === false ? null : { id: 'user-a', email: 'a@intake.test', name: 'Ada' }),
    getForm: async (userId, id) => {
      if (options.foreignForm) return { ok: false };
      return id === FORM.id ? { ok: true, form: FORM } : { ok: false };
    },
    entitlement: async () => options.entitlement ?? { plan: 'pro', subscriptionStatus: 'active' },
    getConnection: async () => options.connection ?? connection(),
    googleClient: {
      async getForm() {
        calls.getForm += 1;
        return {
          items: [
            { kind: 'question', questionId: 'q1', title: 'How was it?', questionType: 'RADIO', options: [{ value: 'Good' }, { value: 'Bad' }] },
          ],
        };
      },
      async listResponses() {
        calls.listResponses += 1;
        return {
          answers: [{ q1: ['Good'] }, { q1: ['Bad'] }, { q1: ['Good'] }],
          nextPageToken: null,
        };
      },
    },
  };
  const app = express();
  app.use('/api/forms', createInsightsRouter(deps));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return {
    base: `http://127.0.0.1:${server.address().port}`,
    calls,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

test('a signed-in person without the responses permission is told which permission is missing', async () => {
  const world = await boot();
  try {
    const response = await fetch(`${world.base}/api/forms/${FORM.id}/insights`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 403);
    const body = await response.json();
    assert.equal(body.code, 'responses_scope_required');
    assert.equal(world.calls.listResponses, 0, 'nothing is read from Google without the permission');
  } finally { await world.close(); }
});

test('a person with the responses permission gets their summaries', async () => {
  const world = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE, RESPONSES_SCOPE] }) });
  try {
    const response = await fetch(`${world.base}/api/forms/${FORM.id}/insights`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.equal(body.status, 'ready');
    assert.equal(body.insights.totalResponses, 3);
    assert.equal(body.insights.questions[0].title, 'How was it?');
    assert.equal(body.insights.questions[0].answered, 3);
    assert.equal(world.calls.listResponses, 1);
  } finally { await world.close(); }
});

test('a person who is not on Pro is told to upgrade, not to authorize anything', async () => {
  const world = await boot({ entitlement: { plan: 'free', subscriptionStatus: 'none' } });
  try {
    const response = await fetch(`${world.base}/api/forms/${FORM.id}/insights`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'pro_required');
    assert.equal(world.calls.listResponses, 0);
  } finally { await world.close(); }
});

test('a missing or unusable connection is told to reconnect, not to authorize anything', async () => {
  const missing = await boot({ connection: { ok: false, provider: 'google', reason: 'not_connected' } });
  try {
    const response = await fetch(`${missing.base}/api/forms/${FORM.id}/insights`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 403);
    assert.equal((await response.json()).code, 'reauthorization_required');
  } finally { await missing.close(); }
});

test('a form that is not the caller’s own is refused without saying why', async () => {
  const world = await boot({ connection: connection({ scopes: ['openid', 'email', FORMS_SCOPE, RESPONSES_SCOPE] }), foreignForm: true });
  try {
    const response = await fetch(`${world.base}/api/forms/${FORM.id}/insights`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 404);
    assert.equal((await response.json()).code, undefined, 'the refusal carries no code that would explain itself');
    assert.equal(world.calls.listResponses, 0);
  } finally { await world.close(); }
});

test('a signed-out person is sent to sign in', async () => {
  const world = await boot({ signedIn: false });
  try {
    const response = await fetch(`${world.base}/api/forms/${FORM.id}/insights`, { headers: { accept: 'application/json' } });
    assert.equal(response.status, 401);
    assert.equal(world.calls.listResponses, 0);
  } finally { await world.close(); }
});
