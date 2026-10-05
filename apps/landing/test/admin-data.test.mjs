import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPostgresAdminStore } from '../server/admin/postgres-store.ts';
import { rangeBounds } from '../server/admin/ranges.ts';

function fakePool(handler) {
  const calls = [];
  return {
    calls,
    async query(sql, params = []) {
      calls.push({ sql: String(sql), params });
      return handler(String(sql), params, calls.length - 1);
    },
  };
}

function regclassPool({ forms = true, providers = true, ai = true, migration = true } = {}, handler = () => ({ rows: [], rowCount: 0 })) {
  return fakePool((sql, params, index) => {
    if (sql.includes('to_regclass($1)')) {
      const table = params[0].replace('public.', '');
      const flags = { form: forms, provider_connection: providers, ai_operation: ai, intake_schema_migration: migration, api_rate_limit: true };
      return { rows: [{ present: flags[table] === true }], rowCount: 1 };
    }
    return handler(sql, params, index);
  });
}

const baseBounds = rangeBounds('7d', new Date('2026-10-03T14:15:00.000Z'));

test('admin authorization identity is re-read with the Better Auth email-verification bit', async () => {
  const pool = fakePool(async (sql, params) => {
    assert.match(sql, /SELECT id, name, email, "emailVerified" FROM "user"/);
    assert.deepEqual(params, ['admin-user-id']);
    return { rows: [{ id: 'admin-user-id', name: 'Owner', email: 'owner@example.test', emailVerified: true }], rowCount: 1 };
  });
  const identity = await createPostgresAdminStore(pool).getIdentity('admin-user-id');
  assert.deepEqual(identity, { id: 'admin-user-id', name: 'Owner', email: 'owner@example.test', emailVerified: true });
});

test('UTC range calculations distinguish calendar today/week/month and rolling 7/30 day windows', () => {
  const now = new Date('2026-10-03T14:15:00.000Z');
  const today = rangeBounds('today', now);
  assert.equal(today.from.toISOString(), '2026-10-03T00:00:00.000Z');
  assert.equal(today.to.toISOString(), now.toISOString());
  assert.equal(today.weekStart.toISOString(), '2026-09-28T00:00:00.000Z');
  assert.equal(today.monthStart.toISOString(), '2026-10-01T00:00:00.000Z');
  assert.equal(rangeBounds('7d', now).from.toISOString(), '2026-09-26T14:15:00.000Z');
  assert.equal(rangeBounds('30d', now).from.toISOString(), '2026-09-03T14:15:00.000Z');
});

test('overview aggregates real table counts and leaves plans, credits, cost explicitly unavailable', async () => {
  const trackingDate = new Date('2026-10-02T10:00:00Z');
  const pool = regclassPool({}, sql => {
    if (sql.includes('SELECT applied_at FROM intake_schema_migration')) return { rows: [{ applied_at: trackingDate }], rowCount: 1 };
    if (sql.includes('(SELECT COUNT(*) FROM "user")')) return { rows: [{ total_users: '17', new_today: '2', new_this_week: '6', new_this_month: '10', active_sessions_in_range: '5' }], rowCount: 1 };
    if (sql.includes('AS total_records')) return { rows: [{ total_records: '9', created_records: '7', incomplete_records: '2', created_in_range: '4', incomplete_in_range: '1', updated_records_in_range: '3' }], rowCount: 1 };
    if (sql.includes('FROM ai_operation') && sql.includes('AS operations')) return { rows: [{ operations: '11', succeeded: '9', failed: '2', input_tokens: '1200', output_tokens: '700', credits_consumed: '18' }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const data = await createPostgresAdminStore(pool).getOverview(baseBounds);
  assert.equal(data.users.total, 17);
  assert.equal(data.users.newToday, 2);
  assert.equal(data.users.newThisWeek, 6);
  assert.equal(data.users.newThisMonth, 10);
  assert.equal(data.users.activeSessionsInRange, 5);
  assert.equal(data.forms.totalRecords, 9);
  assert.equal(data.forms.createdInRange, 4);
  assert.equal(data.forms.incompleteInRange, 1);
  assert.equal(data.forms.editCountAvailable, false);
  assert.equal(data.ai.operations, 11);
  assert.equal(data.ai.succeeded, 9);
  assert.equal(data.ai.failed, 2);
  assert.equal(data.ai.totalTokens, 1900);
  assert.equal(data.ai.trackingSince.toISOString(), trackingDate.toISOString());
  assert.equal(data.ai.estimatedCostUsd, null);
  assert.equal(data.ai.creditsConsumed, 18);
  assert.equal(data.plans.available, false);
  assert.equal(data.plans.free, null);
  assert.equal(data.credits.available, false);
  assert.equal(data.credits.consumed, null);
  assert.equal(data.timezone, 'UTC');
  const sessionQuery = pool.calls.find(call => call.sql.includes('(SELECT COUNT(DISTINCT s."userId")'));
  assert.equal(sessionQuery.params[4].toISOString(), baseBounds.from.toISOString());
  assert.equal(sessionQuery.params[1].toISOString(), baseBounds.to.toISOString());
});

test('AI operations are paginated, filter-bound and read the logical-operation credit schema', async () => {
  const pool = regclassPool({}, sql => {
    if (sql.includes('SELECT applied_at FROM intake_schema_migration')) return { rows: [{ applied_at: new Date('2026-10-01T00:00:00Z') }], rowCount: 1 };
    if (sql.includes('AS operations') && sql.includes('SUM(a.input_tokens)')) return { rows: [{ operations: '3', succeeded: '2', failed: '1', input_tokens: '350', output_tokens: '160', credits_consumed: '5' }], rowCount: 1 };
    if (sql.includes('FROM ai_operation a JOIN "user"')) return { rows: [{
      id: 'op-1', operation_key: 'operation-key-01', user_id: 'u1', user_name: 'Ada', user_email: 'ada@example.test',
      operation_type: 'form_create', provider: 'groq', model: 'openai/gpt-oss-120b',
      outcome: 'succeeded', error_category: null, latency_ms: '845', input_tokens: '120', output_tokens: '55', credit_cost: '2',
      created_at: new Date('2026-10-03T12:00:00Z'),
    }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const result = await createPostgresAdminStore(pool).listAi({
    page: 2, limit: 10, offset: 10, bounds: baseBounds,
    operation: 'form_create', status: 'succeeded', model: 'openai/gpt-oss-120b', userId: 'u1',
  });
  assert.equal(result.available, true);
  assert.equal(result.summary.operations, 3);
  assert.equal(result.summary.totalTokens, 510);
  assert.equal(result.summary.creditsConsumed, 5);
  assert.equal(result.items.length, 1);
  assert.equal(result.items[0].operationKey, 'operation-key-01');
  assert.equal(result.items[0].inputTokens, 120);
  assert.equal(result.items[0].outputTokens, 55);
  assert.equal(result.items[0].creditsConsumed, 2);
  assert.equal(result.items[0].estimatedCostUsd, null);
  assert.equal(result.page, 2);
  const aggregate = pool.calls.find(call => call.sql.includes('SUM(a.input_tokens)'));
  assert.deepEqual(aggregate.params, [baseBounds.from, baseBounds.to, 'form_create', 'succeeded', 'openai/gpt-oss-120b', 'u1']);
  const listing = pool.calls.find(call => call.sql.includes('FROM ai_operation a JOIN "user"'));
  assert.equal(listing.params.at(-2), 10);
  assert.equal(listing.params.at(-1), 10);
  assert.match(listing.sql, /operation_key/);
  assert.match(listing.sql, /outcome/);
  assert.doesNotMatch(listing.sql, /prompt|ciphertext|access_token|refresh_token|password|secret/i);
});

test('AI page reports an unavailable source rather than a false zero before its migration', async () => {
  const pool = regclassPool({ ai: false }, () => ({ rows: [], rowCount: 0 }));
  const result = await createPostgresAdminStore(pool).listAi({ page: 1, limit: 25, offset: 0, bounds: baseBounds, operation: null, status: null, model: '', userId: '' });
  assert.equal(result.available, false);
  assert.equal(result.summary, null);
  assert.equal(result.total, 0);
  assert.match(result.reason, /migration 007/);
});

test('user search uses prefix filters, bound parameters, pagination, and a safe projection', async () => {
  const pool = regclassPool({}, sql => {
    if (sql.includes('SELECT COUNT(*) AS total FROM "user" u')) return { rows: [{ total: '42' }], rowCount: 1 };
    if (sql.includes('FROM "user" u') && sql.includes('LIMIT $3 OFFSET $4')) return { rows: [{
      id: 'u-1', name: 'Ada Lovelace', email: 'ada@example.test', created_at: new Date('2026-10-01T00:00:00Z'),
      last_session_update: null, forms_count: '4', archived_forms_count: '1', ai_operations: '2', ai_operations_failed: '1',
      ai_input_tokens: '200', ai_output_tokens: '90', provider_connections: [{ provider: 'google', status: 'connected', lastAuthorizedAt: null, updatedAt: '2026-10-02T00:00:00Z' }],
    }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const result = await createPostgresAdminStore(pool).listUsers({ page: 2, limit: 25, offset: 25, search: 'Ada%_' });
  assert.equal(result.total, 42);
  assert.equal(result.items[0].formsCount, 4);
  assert.equal(result.items[0].aiOperationsFailed, 1);
  assert.equal(result.items[0].providers[0].status, 'connected');
  assert.equal(result.items[0].plan, null);
  const countQuery = pool.calls.find(call => call.sql.includes('SELECT COUNT(*) AS total FROM "user" u'));
  assert.deepEqual(countQuery.params, ['ada!%!_%', 'Ada!%!_%']);
  const listing = pool.calls.find(call => call.sql.includes('LIMIT $3 OFFSET $4'));
  assert.deepEqual(listing.params.slice(-2), [25, 25]);
  assert.match(listing.sql, /LEFT JOIN LATERAL/);
  assert.doesNotMatch(listing.sql, /password|accessToken|refreshToken|access_token|refresh_token|ciphertext|token\b/i);
  assert.doesNotMatch(JSON.stringify(result), /password|accessToken|refreshToken|ciphertext|credentialSecret/i);
});

test('user detail reads only authentication provider identifiers and excludes secrets', async () => {
  const pool = regclassPool({}, sql => {
    if (sql.includes('SELECT applied_at FROM intake_schema_migration')) return { rows: [{ applied_at: new Date('2026-10-01T00:00:00Z') }], rowCount: 1 };
    if (sql.includes('FROM "user" u WHERE u.id')) return { rows: [{
      id: 'u-1', name: 'Ada', email: 'ada@example.test', created_at: new Date('2026-10-01T00:00:00Z'), last_session_update: null,
      authentication_methods: ['credential'],
      forms_data: { total: 2, created: 1, incomplete: 1, archived: 0, updatedRecords: 1 },
      provider_data: [{ provider: 'google', status: 'connected', lastAuthorizedAt: null, updatedAt: '2026-10-02T00:00:00Z' }],
      ai_data: { operations: 2, succeeded: 1, failed: 1, inputTokens: 20, outputTokens: 10 },
    }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const detail = await createPostgresAdminStore(pool).getUserDetail('u-1');
  assert.equal(detail.authenticationMethods[0], 'credential');
  assert.equal(detail.ai.totalTokens, 30);
  assert.equal(detail.forms.incomplete, 1);
  assert.equal(detail.providers.connections[0].provider, 'google');
  assert.equal(detail.credits.available, false);
  assert.equal(detail.plan, null);
  const sql = pool.calls.find(call => call.sql.includes('FROM "user" u WHERE u.id')).sql;
  assert.match(sql, /a\."providerId"/);
  assert.doesNotMatch(sql, /password|accessToken|refreshToken|access_token|refresh_token|ciphertext|session\.token|idToken/i);
  assert.doesNotMatch(JSON.stringify(detail), /passwordHash|accessToken|refreshToken|ciphertext|idToken|secret/i);
});

test('form and activity admin projections omit user-authored titles and form contents', async () => {
  const pool = regclassPool({}, sql => {
    if (sql.includes('SELECT COUNT(*) AS total FROM form f')) return { rows: [{ total: '1' }], rowCount: 1 };
    if (sql.includes('SELECT f.id, f.user_id')) return { rows: [{
      id: 'form-record-1', user_id: 'user-1', owner_name: 'Ada', owner_email: 'ada@example.test',
      provider: 'google', provider_form_id: 'opaque-google-id', title: 'Sensitive form title',
      status: 'created', created_at: new Date(), updated_at: new Date(), last_synced_at: null, archived_at: null,
      specification: { request: 'Sensitive request content' }, description: 'Private description',
    }], rowCount: 1 };
    if (sql.includes('SELECT COUNT(*) AS total FROM filtered')) return { rows: [{ total: '0' }], rowCount: 1 };
    if (sql.includes('FROM filtered ORDER BY timestamp')) return { rows: [], rowCount: 0 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const store = createPostgresAdminStore(pool);
  const forms = await store.listForms({ page: 1, limit: 25, offset: 0, query: 'ada', userId: '', provider: null, status: null, archived: 'all' });
  assert.equal(forms.items[0].providerFormId, 'opaque-google-id');
  assert.equal('title' in forms.items[0], false);
  assert.doesNotMatch(JSON.stringify(forms), /Sensitive form title|Sensitive request content|Private description/);
  const formQueries = pool.calls.filter(call => call.sql.includes('FROM form f'));
  assert.ok(formQueries.length >= 2);
  assert.ok(formQueries.every(call => !/f\.title|specification|description|edit_url|responder_url|external_account_id/i.test(call.sql)));
  assert.ok(formQueries.some(call => /lower\(u\.email\)/.test(call.sql)));

  const activity = await store.listActivity({ page: 1, limit: 25, offset: 0, bounds: baseBounds, type: '', userId: '' });
  assert.deepEqual(activity.items, []);
  const activityQueries = pool.calls.filter(call => call.sql.includes('WITH events AS'));
  assert.equal(activityQueries.length, 2);
  assert.ok(activityQueries.every(call => !/f\.title|specification|description\s*\|\|/i.test(call.sql)));
});

test('provider and system summaries distinguish configured state from a real health probe', async () => {
  const env = { GROQ_API_KEY: 'server-only-test-key', GOOGLE_OAUTH_CLIENT_ID: 'id', GOOGLE_OAUTH_CLIENT_SECRET: 'secret', GROQ_MODEL: 'current-model' };
  const pool = regclassPool({}, sql => {
    if (sql.includes('SELECT provider, status, COUNT(*) AS connections')) return { rows: [
      { provider: 'google', status: 'connected', connections: '3' },
      { provider: 'google', status: 'reauthorization_required', connections: '1' },
    ], rowCount: 2 };
    if (sql.includes('AS last_success')) return { rows: [{ last_success: new Date(), failures: '2' }], rowCount: 1 };
    if (sql.includes('SELECT 1 AS ready')) return { rows: [{ ready: 1 }], rowCount: 1 };
    if (sql.includes('SELECT id, applied_at FROM intake_schema_migration')) return { rows: [
      { id: '007_ai_credits.sql', applied_at: new Date('2026-10-02T00:00:00Z') },
      { id: '006_production_hardening.sql', applied_at: new Date('2026-10-01T00:00:00Z') },
    ], rowCount: 2 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const store = createPostgresAdminStore(pool, env);
  const providers = await store.getProviders();
  assert.equal(providers.google.configured, true);
  assert.equal(providers.google.connected, 3);
  assert.equal(providers.google.reauthorizationRequired, 1);
  assert.equal(providers.google.connectivity, 'not_probed');
  assert.equal(providers.ai.provider, 'groq');
  assert.equal(providers.ai.connectivity, 'recent_success');
  assert.equal(providers.ai.model, 'current-model');
  delete env.GROQ_MODEL;
  assert.equal((await store.getProviders()).ai.model, 'openai/gpt-oss-120b');
  env.GROQ_MODEL = 'current-model';
  assert.equal(JSON.stringify(providers).includes('server-only-test-key'), false);
  const system = await store.getSystem();
  assert.equal(system.backend.status, 'healthy');
  assert.equal(system.database.status, 'healthy');
  assert.equal(system.aiProvider.status, 'configured');
  assert.equal(system.aiProvider.model, 'current-model');
  assert.equal(system.googleIntegration.status, 'configured');
  assert.ok(system.migrations.pending.includes('001_provider_connections.sql'));
  assert.ok(system.migrations.pending.includes('005_form_library.sql'));
  assert.equal(system.migrations.latestAppliedAt.toISOString(), '2026-10-02T00:00:00.000Z');

  const oldSuccess = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const stalePool = regclassPool({}, sql => {
    if (sql.includes('SELECT provider, status, COUNT(*) AS connections')) return { rows: [], rowCount: 0 };
    if (sql.includes('AS last_success')) return { rows: [{ last_success: oldSuccess, failures: '0' }], rowCount: 1 };
    throw new Error(`Unexpected query: ${sql}`);
  });
  const staleProviders = await createPostgresAdminStore(stalePool, env).getProviders();
  assert.equal(staleProviders.ai.connectivity, 'configured_unverified');
  assert.equal(staleProviders.ai.lastSuccessAt.toISOString(), oldSuccess.toISOString());
});

test('system health does not report every migration pending when the database cannot be reached', async () => {
  const pool = fakePool(async sql => {
    if (sql.includes('SELECT 1 AS ready')) throw new Error('database unavailable');
    throw new Error(`Unexpected query after failed readiness: ${sql}`);
  });
  const system = await createPostgresAdminStore(pool).getSystem();
  assert.equal(system.database.status, 'unavailable');
  assert.equal(system.rateLimiting.status, 'unknown');
  assert.equal(system.migrations.trackingAvailable, false);
  assert.equal(system.migrations.applied, null);
  assert.equal(system.migrations.pending, null);
  assert.equal(pool.calls.length, 1);
});

test('system health leaves migrations unverified when the migration tracking table is missing', async () => {
  const pool = regclassPool({ migration: false }, sql => {
    if (sql.includes('SELECT 1 AS ready')) return { rows: [{ ready: 1 }], rowCount: 1 };
    throw new Error(`Unexpected query without migration tracking: ${sql}`);
  });
  const system = await createPostgresAdminStore(pool).getSystem();
  assert.equal(system.database.status, 'healthy');
  assert.equal(system.migrations.trackingAvailable, false);
  assert.equal(system.migrations.applied, null);
  assert.equal(system.migrations.pending, null);
});

test('admin indexes target the shared AI-credit operation schema without creating a duplicate table', async () => {
  const sql = (await readFile(new URL('../db/migrations/009_admin_indexes.sql', import.meta.url), 'utf8')).replace(/--.*$/gm, '');
  assert.doesNotMatch(sql, /CREATE TABLE|ALTER TABLE|DROP TABLE/i);
  assert.match(sql, /ai_operation_created_at_idx/);
  assert.match(sql, /ai_operation_operation_created_idx/);
  assert.match(sql, /ai_operation_outcome_created_idx/);
  assert.match(sql, /session_updated_at_idx/);
  assert.match(sql, /session_user_updated_idx/);
  assert.match(sql, /form_updated_at_idx/);
  assert.match(sql, /provider_connection_authorized_idx/);
  assert.match(sql, /user_email_prefix_idx/);
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im);
  const creditSchema = (await readFile(new URL('../db/migrations/007_ai_credits.sql', import.meta.url), 'utf8')).replace(/--.*$/gm, '');
  assert.match(creditSchema, /operation_key text NOT NULL/);
  assert.match(creditSchema, /outcome text NOT NULL CHECK \(outcome IN \('succeeded', 'failed', 'no_result'\)\)/);
  assert.match(creditSchema, /credit_cost integer NOT NULL/);
  assert.doesNotMatch(creditSchema, /prompt|request_body|password|access_token|refresh_token|ciphertext|api_key|client_secret/i);
});
