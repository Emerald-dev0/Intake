import type { Pool } from 'pg';
import type {
  AdminActivityItem, AdminActivityResult, AdminAiResult, AdminCreditsResult, AdminErrorItem,
  AdminErrorsResult, AdminFormsResult, AdminFormItem, AdminOperation, AdminOperationStatus,
  AdminStore, AiOperationItem, AiSummary, OverviewData, PageRequest, PageResult, ProviderSummary,
  RangeBounds, SystemStatus, UserDetail, UserProviderStatus, UserSummary,
} from './contracts';
import { pageResult } from './ranges';
import { DEFAULT_GROQ_MODEL } from '../forms/interpretation/provider-config';

const AI_UNAVAILABLE = 'AI operation history becomes available after migration 007_ai_operations.sql is applied.';
const CREDITS_UNAVAILABLE = 'No credit ledger or credit-balance entitlement store exists in this checkout.';
const PLANS_UNAVAILABLE = 'No plan, subscription, or entitlement store exists in this checkout.';
const REQUIRED_MIGRATIONS = [
  '001_provider_connections.sql',
  '002_forms.sql',
  '003_form_drafts.sql',
  '004_form_edit_drafts.sql',
  '005_form_library.sql',
  '006_production_hardening.sql',
  '007_ai_operations.sql',
] as const;

type Queryable = Pick<Pool, 'query'>;
type DbRow = Record<string, unknown>;

function count(value: unknown): number {
  const result = typeof value === 'number' ? value : Number(value ?? 0);
  return Number.isSafeInteger(result) && result >= 0 ? result : 0;
}

function nullableCount(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  return count(value);
}

function date(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const parsed = value instanceof Date ? value : new Date(String(value));
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function string(value: unknown, fallback = ''): string {
  return typeof value === 'string' ? value : fallback;
}

function jsonArray<T>(value: unknown): T[] {
  if (Array.isArray(value)) return value as T[];
  if (typeof value === 'string') {
    try {
      const parsed = JSON.parse(value) as unknown;
      return Array.isArray(parsed) ? parsed as T[] : [];
    } catch { return []; }
  }
  return [];
}

function escapeLike(value: string): string {
  return value.replace(/[!%_]/g, character => `!${character}`);
}

function sumTokens(input: number | null, output: number | null): number | null {
  return input === null || output === null ? null : input + output;
}

function completePage<T>(items: T[], total: number, input: PageRequest): PageResult<T> {
  return pageResult(items, total, input.page, input.limit);
}

async function tableExists(pool: Queryable, table: string): Promise<boolean> {
  const result = await pool.query<{ present: boolean }>('SELECT to_regclass($1) IS NOT NULL AS present', [`public.${table}`]);
  return result.rows[0]?.present === true;
}

async function migrationDate(pool: Queryable, migrationId = '007_ai_operations.sql'): Promise<Date | null> {
  if (!await tableExists(pool, 'intake_schema_migration')) return null;
  const result = await pool.query<{ applied_at: Date }>('SELECT applied_at FROM intake_schema_migration WHERE id = $1 LIMIT 1', [migrationId]);
  return date(result.rows[0]?.applied_at);
}

function aiSummary(row: DbRow): AiSummary {
  const inputTokens = nullableCount(row.input_tokens);
  const outputTokens = nullableCount(row.output_tokens);
  return {
    operations: count(row.operations),
    succeeded: count(row.succeeded),
    failed: count(row.failed),
    inputTokens,
    outputTokens,
    totalTokens: sumTokens(inputTokens, outputTokens),
    creditsConsumed: null,
    estimatedCostUsd: null,
  };
}

async function aggregateAi(pool: Queryable, from: Date, to: Date, userId?: string): Promise<AiSummary> {
  const params: unknown[] = [from, to];
  const userCondition = userId ? ' AND user_id = $3' : '';
  if (userId) params.push(userId);
  const result = await pool.query<DbRow>(
    `SELECT COUNT(*) AS operations,
       COUNT(*) FILTER (WHERE status = 'succeeded') AS succeeded,
       COUNT(*) FILTER (WHERE status = 'failed') AS failed,
       SUM(input_tokens) AS input_tokens,
       SUM(output_tokens) AS output_tokens
     FROM ai_operation
     WHERE started_at >= $1 AND started_at < $2${userCondition}`,
    params,
  );
  return aiSummary(result.rows[0] ?? {});
}

function providerConfigured(provider: 'google' | 'microsoft', env: NodeJS.ProcessEnv): boolean {
  if (provider === 'google') return Boolean(env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim());
  return Boolean(env.MICROSOFT_OAUTH_CLIENT_ID?.trim() && env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim());
}

function oauthStatus(result: DbRow[], provider: 'google' | 'microsoft', available: boolean) {
  const countStatus = (status: string) => count(result.find(row => row.provider === provider && row.status === status)?.connections);
  return {
    configured: providerConfigured(provider, process.env),
    activeConnections: available ? countStatus('connected') : null,
    connected: available ? countStatus('connected') : null,
    expired: available ? countStatus('expired') : null,
    reauthorizationRequired: available ? countStatus('reauthorization_required') : null,
    connectivity: 'not_probed' as const,
    recentFailuresAvailable: false as const,
  };
}

function providerConfig(provider: 'google' | 'microsoft', env: NodeJS.ProcessEnv) {
  return provider === 'google'
    ? Boolean(env.GOOGLE_OAUTH_CLIENT_ID?.trim() && env.GOOGLE_OAUTH_CLIENT_SECRET?.trim())
    : Boolean(env.MICROSOFT_OAUTH_CLIENT_ID?.trim() && env.MICROSOFT_OAUTH_CLIENT_SECRET?.trim());
}

const formAvailabilityReason = 'Form records are unavailable until the Intake form migrations are applied.';
const providerAvailabilityReason = 'Provider connection records are unavailable until migration 001_provider_connections.sql is applied.';

export function createPostgresAdminStore(pool: Pool, env: NodeJS.ProcessEnv = process.env): AdminStore {
  return {
    async getIdentity(userId) {
      const result = await pool.query<DbRow>(
        `SELECT id, name, email, "emailVerified" FROM "user" WHERE id = $1 LIMIT 1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) return null;
      return {
        id: string(row.id),
        name: string(row.name),
        email: string(row.email),
        emailVerified: row.emailVerified === true,
      };
    },

    async getOverview(bounds: RangeBounds): Promise<OverviewData> {
      const [hasForms, hasAi] = await Promise.all([
        tableExists(pool, 'form'),
        tableExists(pool, 'ai_operation'),
      ]);
      const trackingSince = hasAi ? await migrationDate(pool) : null;
      const usersResult = await pool.query<DbRow>(
        `SELECT
           (SELECT COUNT(*) FROM "user") AS total_users,
           (SELECT COUNT(*) FROM "user" WHERE "createdAt" >= $1 AND "createdAt" < $2) AS new_today,
           (SELECT COUNT(*) FROM "user" WHERE "createdAt" >= $3 AND "createdAt" < $2) AS new_this_week,
           (SELECT COUNT(*) FROM "user" WHERE "createdAt" >= $4 AND "createdAt" < $2) AS new_this_month,
           (SELECT COUNT(DISTINCT s."userId") FROM "session" s
             WHERE s."updatedAt" >= $5 AND s."updatedAt" < $2 AND s."expiresAt" > $2) AS active_sessions_in_range`,
        [bounds.todayStart, bounds.to, bounds.weekStart, bounds.monthStart, bounds.from],
      );
      const userRow = usersResult.rows[0] ?? {};
      const formPromise = hasForms
        ? pool.query<DbRow>(
          `SELECT COUNT(*) AS total_records,
             COUNT(*) FILTER (WHERE status = 'created') AS created_records,
             COUNT(*) FILTER (WHERE status = 'incomplete') AS incomplete_records,
             COUNT(*) FILTER (WHERE created_at >= $1 AND created_at < $2) AS created_in_range,
             COUNT(*) FILTER (WHERE status = 'incomplete' AND created_at >= $1 AND created_at < $2) AS incomplete_in_range,
             COUNT(*) FILTER (WHERE updated_at > created_at AND updated_at >= $1 AND updated_at < $2) AS updated_records_in_range
           FROM form`,
          [bounds.from, bounds.to],
        )
        : Promise.resolve(null);
      const aiPromise = hasAi ? aggregateAi(pool, bounds.from, bounds.to) : Promise.resolve(null);
      const [formResult, ai] = await Promise.all([formPromise, aiPromise]);
      const formRow = formResult?.rows[0] ?? {};
      return {
        generatedAt: bounds.to,
        range: bounds.range,
        from: bounds.from,
        to: bounds.to,
        timezone: 'UTC',
        users: {
          total: count(userRow.total_users),
          newToday: count(userRow.new_today),
          newThisWeek: count(userRow.new_this_week),
          newThisMonth: count(userRow.new_this_month),
          activeSessionsInRange: count(userRow.active_sessions_in_range),
          activeDefinition: 'unexpired sessions updated during the selected UTC range',
        },
        plans: { available: false, reason: PLANS_UNAVAILABLE, free: null, pro: null, proPercentage: null },
        forms: {
          available: hasForms,
          reason: hasForms ? null : formAvailabilityReason,
          totalRecords: hasForms ? count(formRow.total_records) : null,
          createdRecords: hasForms ? count(formRow.created_records) : null,
          incompleteRecords: hasForms ? count(formRow.incomplete_records) : null,
          createdInRange: hasForms ? count(formRow.created_in_range) : null,
          incompleteInRange: hasForms ? count(formRow.incomplete_in_range) : null,
          updatedRecordsInRange: hasForms ? count(formRow.updated_records_in_range) : null,
          editCountAvailable: false,
        },
        ai: {
          available: hasAi,
          reason: hasAi ? null : AI_UNAVAILABLE,
          trackingSince,
          operations: ai?.operations ?? null,
          succeeded: ai?.succeeded ?? null,
          failed: ai?.failed ?? null,
          inputTokens: ai?.inputTokens ?? null,
          outputTokens: ai?.outputTokens ?? null,
          totalTokens: ai?.totalTokens ?? null,
          creditsConsumed: null,
          estimatedCostUsd: null,
        },
        credits: { available: false, reason: CREDITS_UNAVAILABLE, dailyGranted: null, monthlyGranted: null, consumed: null },
      };
    },

    async listUsers(input) {
      const [hasForms, hasProviders, hasAi] = await Promise.all([
        tableExists(pool, 'form'),
        tableExists(pool, 'provider_connection'),
        tableExists(pool, 'ai_operation'),
      ]);
      const where = input.search
        ? `WHERE lower(u.email) LIKE $1 ESCAPE '!' OR lower(u.name) LIKE $1 ESCAPE '!' OR u.id LIKE $2 ESCAPE '!'`
        : '';
      const escaped = escapeLike(input.search.toLowerCase());
      const countParams: unknown[] = input.search ? [`${escaped}%`, `${escapeLike(input.search)}%`] : [];
      const totalResult = await pool.query<DbRow>(`SELECT COUNT(*) AS total FROM "user" u ${where}`, countParams);
      const listParams: unknown[] = [...countParams, input.limit, input.offset];
      const limitPosition = countParams.length + 1;
      const offsetPosition = countParams.length + 2;
      const formJoin = hasForms
        ? `LEFT JOIN LATERAL (
             SELECT COUNT(*) AS forms_count,
               COUNT(*) FILTER (WHERE archived_at IS NOT NULL) AS archived_forms_count
             FROM form f WHERE f.user_id = u.id
           ) fc ON TRUE`
        : `LEFT JOIN LATERAL (SELECT NULL::bigint AS forms_count, NULL::bigint AS archived_forms_count) fc ON TRUE`;
      const providerExpr = hasProviders
        ? `COALESCE((SELECT json_agg(json_build_object(
             'provider', pc.provider, 'status', pc.status,
             'lastAuthorizedAt', pc.last_authorized_at, 'updatedAt', pc.updated_at
           ) ORDER BY pc.provider)
           FROM provider_connection pc WHERE pc.user_id = u.id), '[]'::json) AS provider_connections`
        : `'[]'::json AS provider_connections`;
      const aiJoin = hasAi
        ? `LEFT JOIN LATERAL (
             SELECT COUNT(*) AS ai_operations,
               COUNT(*) FILTER (WHERE status = 'failed') AS ai_operations_failed,
               SUM(input_tokens) AS ai_input_tokens,
               SUM(output_tokens) AS ai_output_tokens
             FROM ai_operation a WHERE a.user_id = u.id
           ) ac ON TRUE`
        : `LEFT JOIN LATERAL (SELECT NULL::bigint AS ai_operations, NULL::bigint AS ai_operations_failed,
             NULL::numeric AS ai_input_tokens, NULL::numeric AS ai_output_tokens) ac ON TRUE`;
      const result = await pool.query<DbRow>(
        `SELECT u.id, u.name, u.email, u."createdAt" AS created_at,
           ss.last_session_update, fc.forms_count, fc.archived_forms_count,
           ac.ai_operations, ac.ai_operations_failed, ac.ai_input_tokens, ac.ai_output_tokens,
           ${providerExpr}
         FROM "user" u
         LEFT JOIN LATERAL (
           SELECT MAX(s."updatedAt") AS last_session_update FROM "session" s WHERE s."userId" = u.id
         ) ss ON TRUE
         ${formJoin}
         ${aiJoin}
         ${where}
         ORDER BY u."createdAt" DESC, u.id DESC
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        listParams,
      );
      const total = count(totalResult.rows[0]?.total);
      const items: UserSummary[] = result.rows.map(row => {
        const inputTokens = nullableCount(row.ai_input_tokens);
        const outputTokens = nullableCount(row.ai_output_tokens);
        const providerRows = jsonArray<Record<string, unknown>>(row.provider_connections);
        return {
          id: string(row.id),
          name: string(row.name),
          email: string(row.email),
          createdAt: date(row.created_at) ?? new Date(0),
          lastSessionUpdate: date(row.last_session_update),
          plan: null,
          subscriptionState: null,
          dailyCredits: null,
          monthlyCredits: null,
          formsCount: nullableCount(row.forms_count),
          archivedFormsCount: nullableCount(row.archived_forms_count),
          aiOperations: nullableCount(row.ai_operations),
          aiOperationsFailed: nullableCount(row.ai_operations_failed),
          aiInputTokens: inputTokens,
          aiOutputTokens: outputTokens,
          aiAvailable: hasAi,
          providersAvailable: hasProviders,
          providers: providerRows.map(provider => ({
            provider: provider.provider as UserProviderStatus['provider'],
            status: provider.status as UserProviderStatus['status'],
            lastAuthorizedAt: date(provider.lastAuthorizedAt),
            updatedAt: date(provider.updatedAt) ?? new Date(0),
          })),
        };
      });
      return completePage(items, total, input);
    },

    async getUserDetail(userId): Promise<UserDetail | null> {
      const [hasForms, hasProviders, hasAi] = await Promise.all([
        tableExists(pool, 'form'),
        tableExists(pool, 'provider_connection'),
        tableExists(pool, 'ai_operation'),
      ]);
      const formsSelect = hasForms
        ? `(SELECT json_build_object(
             'total', COUNT(*),
             'created', COUNT(*) FILTER (WHERE status = 'created'),
             'incomplete', COUNT(*) FILTER (WHERE status = 'incomplete'),
             'archived', COUNT(*) FILTER (WHERE archived_at IS NOT NULL),
             'updatedRecords', COUNT(*) FILTER (WHERE updated_at > created_at)
           ) FROM form f WHERE f.user_id = u.id) AS forms_data`
        : `NULL::json AS forms_data`;
      const providersSelect = hasProviders
        ? `COALESCE((SELECT json_agg(json_build_object(
             'provider', provider, 'status', status, 'lastAuthorizedAt', last_authorized_at, 'updatedAt', updated_at
           ) ORDER BY provider) FROM provider_connection pc WHERE pc.user_id = u.id), '[]'::json) AS provider_data`
        : `'[]'::json AS provider_data`;
      const aiSelect = hasAi
        ? `(SELECT json_build_object(
             'operations', COUNT(*),
             'succeeded', COUNT(*) FILTER (WHERE status = 'succeeded'),
             'failed', COUNT(*) FILTER (WHERE status = 'failed'),
             'inputTokens', SUM(input_tokens),
             'outputTokens', SUM(output_tokens)
           ) FROM ai_operation a WHERE a.user_id = u.id) AS ai_data`
        : `NULL::json AS ai_data`;
      const result = await pool.query<DbRow>(
        `SELECT u.id, u.name, u.email, u."createdAt" AS created_at,
           (SELECT MAX(s."updatedAt") FROM "session" s WHERE s."userId" = u.id) AS last_session_update,
           COALESCE((SELECT array_agg(DISTINCT a."providerId" ORDER BY a."providerId")
             FROM account a WHERE a."userId" = u.id), ARRAY[]::text[]) AS authentication_methods,
           ${formsSelect}, ${providersSelect}, ${aiSelect}
         FROM "user" u WHERE u.id = $1 LIMIT 1`,
        [userId],
      );
      const row = result.rows[0];
      if (!row) return null;
      const forms = row.forms_data && typeof row.forms_data === 'object' ? row.forms_data as DbRow : null;
      const ai = row.ai_data && typeof row.ai_data === 'object' ? row.ai_data as DbRow : null;
      const providerRows = jsonArray<Record<string, unknown>>(row.provider_data);
      const inputTokens = nullableCount(ai?.inputTokens);
      const outputTokens = nullableCount(ai?.outputTokens);
      const trackingSince = hasAi ? await migrationDate(pool) : null;
      const authMethods = Array.isArray(row.authentication_methods)
        ? row.authentication_methods.filter((method): method is string => typeof method === 'string')
        : [];
      return {
        id: string(row.id),
        name: string(row.name),
        email: string(row.email),
        createdAt: date(row.created_at) ?? new Date(0),
        lastSessionUpdate: date(row.last_session_update),
        authenticationMethods: authMethods,
        plan: null,
        entitlement: null,
        planAvailable: false,
        planUnavailableReason: PLANS_UNAVAILABLE,
        credits: {
          available: false,
          reason: CREDITS_UNAVAILABLE,
          dailyBalance: null,
          monthlyBalance: null,
          recentEvents: [],
        },
        ai: {
          available: hasAi,
          reason: hasAi ? null : AI_UNAVAILABLE,
          operations: hasAi ? count(ai?.operations) : null,
          succeeded: hasAi ? count(ai?.succeeded) : null,
          failed: hasAi ? count(ai?.failed) : null,
          inputTokens,
          outputTokens,
          totalTokens: sumTokens(inputTokens, outputTokens),
          trackingSince,
          estimatedCostUsd: null,
          creditsConsumed: null,
        },
        forms: {
          available: hasForms,
          reason: hasForms ? null : formAvailabilityReason,
          total: forms ? count(forms.total) : null,
          created: forms ? count(forms.created) : null,
          incomplete: forms ? count(forms.incomplete) : null,
          archived: forms ? count(forms.archived) : null,
          updatedRecords: forms ? count(forms.updatedRecords) : null,
        },
        providers: {
          available: hasProviders,
          reason: hasProviders ? null : providerAvailabilityReason,
          connections: providerRows.map(provider => ({
            provider: provider.provider as UserProviderStatus['provider'],
            status: provider.status as UserProviderStatus['status'],
            lastAuthorizedAt: date(provider.lastAuthorizedAt),
            updatedAt: date(provider.updatedAt) ?? new Date(0),
          })),
        },
      };
    },

    async listAi(input): Promise<AdminAiResult> {
      const [hasAi, trackingSince] = await Promise.all([
        tableExists(pool, 'ai_operation'),
        migrationDate(pool),
      ]);
      if (!hasAi) {
        return {
          available: false, reason: AI_UNAVAILABLE, trackingSince: null,
          summary: null, ...completePage([], 0, input),
        };
      }
      const clauses = ['a.started_at >= $1', 'a.started_at < $2'];
      const params: unknown[] = [input.bounds.from, input.bounds.to];
      const add = (clause: string, value: unknown) => {
        params.push(value);
        clauses.push(clause.replace('?', `$${params.length}`));
      };
      if (input.operation) add('a.operation = ?', input.operation);
      if (input.status) add('a.status = ?', input.status);
      if (input.model) add('a.model = ?', input.model);
      if (input.userId) add('a.user_id = ?', input.userId);
      const where = clauses.join(' AND ');
      const aggregate = await pool.query<DbRow>(
        `SELECT COUNT(*) AS operations,
           COUNT(*) FILTER (WHERE a.status = 'succeeded') AS succeeded,
           COUNT(*) FILTER (WHERE a.status = 'failed') AS failed,
           SUM(a.input_tokens) AS input_tokens,
           SUM(a.output_tokens) AS output_tokens
         FROM ai_operation a WHERE ${where}`,
        params,
      );
      const listParams = [...params, input.limit, input.offset];
      const limitPosition = params.length + 1;
      const offsetPosition = params.length + 2;
      const listing = await pool.query<DbRow>(
        `SELECT a.id, a.request_id, a.user_id, u.name AS user_name, u.email AS user_email,
           a.route, a.operation, a.provider, a.model, a.status, a.failure_code,
           a.latency_ms, a.input_tokens, a.output_tokens, a.started_at
         FROM ai_operation a JOIN "user" u ON u.id = a.user_id
         WHERE ${where}
         ORDER BY a.started_at DESC, a.id DESC
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        listParams,
      );
      const summary = aiSummary(aggregate.rows[0] ?? {});
      const total = summary.operations;
      const items: AiOperationItem[] = listing.rows.map(row => ({
        id: string(row.id),
        requestId: string(row.request_id),
        userId: string(row.user_id),
        userName: string(row.user_name),
        userEmail: string(row.user_email),
        route: string(row.route),
        operation: row.operation as AdminOperation,
        provider: 'groq',
        model: string(row.model),
        status: row.status as AdminOperationStatus,
        failureCode: row.failure_code === null ? null : string(row.failure_code),
        latencyMs: count(row.latency_ms),
        inputTokens: nullableCount(row.input_tokens),
        outputTokens: nullableCount(row.output_tokens),
        creditsConsumed: null,
        estimatedCostUsd: null,
        timestamp: date(row.started_at) ?? new Date(0),
      }));
      return {
        available: true,
        reason: null,
        trackingSince,
        summary,
        ...completePage(items, total, input),
      };
    },

    getCredits(): AdminCreditsResult {
      return { available: false, reason: CREDITS_UNAVAILABLE, summary: null, items: [] };
    },

    async listForms(input): Promise<AdminFormsResult> {
      if (!await tableExists(pool, 'form')) return {
        ...completePage([], 0, input), available: false, reason: formAvailabilityReason,
      };
      const clauses: string[] = [];
      const params: unknown[] = [];
      const add = (clause: string, value: unknown) => {
        params.push(value);
        clauses.push(clause.replace('?', `$${params.length}`));
      };
      if (input.query) {
        const pattern = `${escapeLike(input.query.toLowerCase())}%`;
        const idPattern = `${escapeLike(input.query)}%`;
        params.push(pattern, idPattern);
        const p1 = params.length - 1;
        const p2 = params.length;
        // Do not search or return user-supplied form titles/content in the admin API.
        clauses.push(`(lower(u.email) LIKE $${p1} ESCAPE '!' OR lower(u.name) LIKE $${p1} ESCAPE '!' OR f.provider_form_id LIKE $${p2} ESCAPE '!' OR f.id LIKE $${p2} ESCAPE '!')`);
      }
      if (input.userId) add('f.user_id = ?', input.userId);
      if (input.provider) add('f.provider = ?', input.provider);
      if (input.status) add('f.status = ?', input.status);
      if (input.archived === 'active') clauses.push('f.archived_at IS NULL');
      if (input.archived === 'archived') clauses.push('f.archived_at IS NOT NULL');
      const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
      const totalResult = await pool.query<DbRow>(
        `SELECT COUNT(*) AS total FROM form f JOIN "user" u ON u.id = f.user_id ${where}`,
        params,
      );
      const listParams = [...params, input.limit, input.offset];
      const limitPosition = params.length + 1;
      const offsetPosition = params.length + 2;
      const result = await pool.query<DbRow>(
        `SELECT f.id, f.user_id, u.name AS owner_name, u.email AS owner_email,
           f.provider, f.provider_form_id, f.status, f.created_at, f.updated_at,
           f.last_synced_at, f.archived_at
         FROM form f JOIN "user" u ON u.id = f.user_id
         ${where}
         ORDER BY f.created_at DESC, f.id DESC
         LIMIT $${limitPosition} OFFSET $${offsetPosition}`,
        listParams,
      );
      const items = result.rows.map(row => ({
        id: string(row.id),
        ownerId: string(row.user_id),
        ownerName: string(row.owner_name),
        ownerEmail: string(row.owner_email),
        provider: row.provider as AdminFormItem['provider'],
        providerFormId: string(row.provider_form_id),
        status: row.status as AdminFormItem['status'],
        createdAt: date(row.created_at) ?? new Date(0),
        updatedAt: date(row.updated_at) ?? new Date(0),
        lastSyncedAt: date(row.last_synced_at),
        archivedAt: date(row.archived_at),
      }));
      return {
        ...completePage(items, count(totalResult.rows[0]?.total), input),
        available: true,
        reason: null,
      };
    },

    async getProviders(): Promise<ProviderSummary> {
      const hasConnections = await tableExists(pool, 'provider_connection');
      const hasAi = await tableExists(pool, 'ai_operation');
      const rows = hasConnections
        ? (await pool.query<DbRow>(
          `SELECT provider, status, COUNT(*) AS connections
           FROM provider_connection GROUP BY provider, status`,
        )).rows
        : [];
      const now = new Date();
      const aiActivity = hasAi
        ? (await pool.query<DbRow>(
          `SELECT MAX(started_at) FILTER (WHERE status = 'succeeded') AS last_success,
             COUNT(*) FILTER (WHERE status = 'failed' AND started_at >= $1) AS failures
           FROM ai_operation`,
          [new Date(now.getTime() - 24 * 60 * 60 * 1000)],
        )).rows[0] ?? {}
        : {};
      const lastSuccessAt = date(aiActivity.last_success);
      const aiConfigured = Boolean(env.GROQ_API_KEY?.trim());
      const model = env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
      const recentSuccess = lastSuccessAt !== null && lastSuccessAt.getTime() <= now.getTime() &&
        lastSuccessAt.getTime() >= now.getTime() - 24 * 60 * 60 * 1000;
      const connectivity = !aiConfigured
        ? 'not_configured'
        : !hasAi
          ? 'unknown'
          : recentSuccess
            ? 'recent_success'
            : 'configured_unverified';
      return {
        generatedAt: now,
        connectionsAvailable: hasConnections,
        connectionsUnavailableReason: hasConnections ? null : providerAvailabilityReason,
        google: { ...oauthStatus(rows, 'google', hasConnections), configured: providerConfig('google', env) },
        microsoft: { ...oauthStatus(rows, 'microsoft', hasConnections), configured: providerConfig('microsoft', env) },
        ai: {
          provider: 'groq',
          configured: aiConfigured,
          model,
          connectivity,
          lastSuccessAt,
          failuresIn24Hours: hasAi ? count(aiActivity.failures) : null,
          usageAvailable: hasAi,
        },
      };
    },

    async getSystem(): Promise<SystemStatus> {
      const generatedAt = new Date();
      let databaseAvailable = false;
      try {
        await pool.query('SELECT 1 AS ready');
        databaseAvailable = true;
      } catch {
        databaseAvailable = false;
      }
      let hasRateLimiter = false;
      let hasMigrationTable = false;
      let applied: string[] | null = null;
      let pending: string[] | null = null;
      let latestAppliedAt: Date | null = null;
      if (databaseAvailable) {
        [hasRateLimiter, hasMigrationTable] = await Promise.all([
          tableExists(pool, 'api_rate_limit'),
          tableExists(pool, 'intake_schema_migration'),
        ]);
        if (hasMigrationTable) {
          const result = await pool.query<DbRow>(
            `SELECT id, applied_at FROM intake_schema_migration ORDER BY applied_at DESC`,
          );
          applied = result.rows.map(row => string(row.id));
          latestAppliedAt = date(result.rows[0]?.applied_at);
          const appliedSet = new Set(applied);
          pending = REQUIRED_MIGRATIONS.filter(migration => !appliedSet.has(migration));
        }
      }
      const aiConfigured = Boolean(env.GROQ_API_KEY?.trim());
      const googleConfigured = providerConfigured('google', env);
      return {
        generatedAt,
        backend: { status: 'healthy', evidence: 'This response was served by the Intake API process.' },
        database: {
          status: databaseAvailable ? 'healthy' : 'unavailable',
          evidence: databaseAvailable ? 'A live SELECT 1 completed successfully.' : 'The API could not complete a database readiness query.',
        },
        aiProvider: {
          status: aiConfigured ? 'configured' : 'not_configured',
          evidence: aiConfigured ? 'A Groq API key is configured; this is not a live provider health probe.' : 'GROQ_API_KEY is not configured.',
          model: env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL,
        },
        googleIntegration: {
          status: googleConfigured ? 'configured' : 'not_configured',
          evidence: googleConfigured ? 'Google OAuth client credentials are configured; Google API reachability is not probed.' : 'Google OAuth client credentials are not fully configured.',
        },
        rateLimiting: {
          status: !databaseAvailable ? 'unknown' : hasRateLimiter ? 'ready' : 'not_ready',
          evidence: !databaseAvailable
            ? 'The database is unavailable; shared rate-limit storage could not be checked.'
            : hasRateLimiter ? 'The shared PostgreSQL rate-limit table is present.' : 'The shared api_rate_limit table is missing.',
        },
        migrations: { trackingAvailable: hasMigrationTable, applied, pending, latestAppliedAt, required: [...REQUIRED_MIGRATIONS] },
      };
    },

    async listActivity(input): Promise<AdminActivityResult> {
      const [hasForms, hasProviders, hasAi] = await Promise.all([
        tableExists(pool, 'form'), tableExists(pool, 'provider_connection'), tableExists(pool, 'ai_operation'),
      ]);
      const selects = [
        `SELECT 'signup:' || u.id AS id, 'user.signup'::text AS type, 'info'::text AS severity,
           u."createdAt" AS timestamp, u.id AS user_id, u.name AS user_name, u.email AS user_email,
           'New Intake account created'::text AS description, NULL::text AS request_id, NULL::text AS provider
         FROM "user" u WHERE u."createdAt" >= $1 AND u."createdAt" < $2`,
      ];
      if (hasForms) {
        selects.push(
          `SELECT 'form:' || f.id AS id,
             CASE WHEN f.status = 'incomplete' THEN 'form.incomplete' ELSE 'form.created' END AS type,
             CASE WHEN f.status = 'incomplete' THEN 'warning' ELSE 'info' END AS severity,
             f.created_at AS timestamp, u.id AS user_id, u.name AS user_name, u.email AS user_email,
             CASE WHEN f.status = 'incomplete' THEN 'Form creation left an incomplete record'
               ELSE 'Form record created' END AS description,
             f.request_id AS request_id, f.provider AS provider
           FROM form f JOIN "user" u ON u.id = f.user_id
           WHERE f.created_at >= $1 AND f.created_at < $2`,
        );
        selects.push(
          `SELECT 'form-updated:' || f.id AS id, 'form.record_updated'::text AS type,
             'info'::text AS severity, f.updated_at AS timestamp, u.id AS user_id,
             u.name AS user_name, u.email AS user_email,
             'Form record metadata updated' AS description,
             f.request_id AS request_id, f.provider AS provider
           FROM form f JOIN "user" u ON u.id = f.user_id
           WHERE f.updated_at > f.created_at AND f.updated_at >= $1 AND f.updated_at < $2`,
        );
      }
      if (hasProviders) {
        selects.push(
          `SELECT 'provider-auth:' || pc.id AS id, 'provider.connected'::text AS type, 'info'::text AS severity,
             pc.last_authorized_at AS timestamp, u.id AS user_id, u.name AS user_name, u.email AS user_email,
             pc.provider || ' connection authorized' AS description, NULL::text AS request_id, pc.provider AS provider
           FROM provider_connection pc JOIN "user" u ON u.id = pc.user_id
           WHERE pc.last_authorized_at >= $1 AND pc.last_authorized_at < $2`,
        );
        selects.push(
          `SELECT 'provider-reauth:' || pc.id AS id, 'provider.reauthorization_required'::text AS type,
             'warning'::text AS severity, pc.updated_at AS timestamp, u.id AS user_id, u.name AS user_name,
             u.email AS user_email, pc.provider || ' requires reauthorization' AS description,
             NULL::text AS request_id, pc.provider AS provider
           FROM provider_connection pc JOIN "user" u ON u.id = pc.user_id
           WHERE pc.status = 'reauthorization_required' AND pc.updated_at >= $1 AND pc.updated_at < $2`,
        );
      }
      if (hasAi) selects.push(
        `SELECT 'ai:' || a.id AS id,
           CASE WHEN a.status = 'failed' THEN 'ai.operation.failed' ELSE 'ai.operation.succeeded' END AS type,
           CASE WHEN a.status = 'failed' THEN 'error' ELSE 'info' END AS severity,
           a.started_at AS timestamp, u.id AS user_id, u.name AS user_name, u.email AS user_email,
           CASE WHEN a.status = 'failed' THEN 'AI ' || a.operation || ' failed (' || a.failure_code || ')'
             ELSE 'AI ' || a.operation || ' completed' END AS description,
           a.request_id AS request_id, a.provider AS provider
         FROM ai_operation a JOIN "user" u ON u.id = a.user_id
         WHERE a.started_at >= $1 AND a.started_at < $2`,
      );
      const base = `WITH events AS (${selects.join(' UNION ALL ')}), filtered AS (
        SELECT * FROM events WHERE ($3 = '' OR type = $3) AND ($4 = '' OR user_id = $4)
      )`;
      const [totalResult, result] = await Promise.all([
        pool.query<DbRow>(`${base} SELECT COUNT(*) AS total FROM filtered`, [input.bounds.from, input.bounds.to, input.type, input.userId]),
        pool.query<DbRow>(
          `${base} SELECT id, type, severity, timestamp, user_id, user_name, user_email, description, request_id, provider
           FROM filtered ORDER BY timestamp DESC, id DESC LIMIT $5 OFFSET $6`,
          [input.bounds.from, input.bounds.to, input.type, input.userId, input.limit, input.offset],
        ),
      ]);
      const items: AdminActivityItem[] = result.rows.map(row => ({
        id: string(row.id), type: string(row.type), severity: row.severity as AdminActivityItem['severity'],
        timestamp: date(row.timestamp) ?? new Date(0), userId: row.user_id === null ? null : string(row.user_id),
        userName: row.user_name === null ? null : string(row.user_name),
        userEmail: row.user_email === null ? null : string(row.user_email),
        description: string(row.description), requestId: row.request_id === null ? null : string(row.request_id),
        provider: row.provider === null ? null : string(row.provider),
      }));
      return {
        ...completePage(items, count(totalResult.rows[0]?.total), input),
        sources: { users: true, forms: hasForms, providers: hasProviders, ai: hasAi, credits: false },
      };
    },

    async listErrors(input): Promise<AdminErrorsResult> {
      const [hasForms, hasAi] = await Promise.all([tableExists(pool, 'form'), tableExists(pool, 'ai_operation')]);
      const selects: string[] = [];
      if (hasAi) selects.push(
        `SELECT 'ai-error:' || a.id AS id, a.started_at AS timestamp, u.id AS user_id,
           u.name AS user_name, u.email AS user_email, a.route, a.operation,
           a.failure_code AS category, 'error'::text AS severity,
           a.request_id, a.provider,
           'AI request failed (' || a.failure_code || ')' AS description
         FROM ai_operation a JOIN "user" u ON u.id = a.user_id
         WHERE a.status = 'failed' AND a.started_at >= $1 AND a.started_at < $2`,
      );
      if (hasForms) selects.push(
        `SELECT 'incomplete-form:' || f.id AS id, f.created_at AS timestamp, u.id AS user_id,
           u.name AS user_name, u.email AS user_email, '/api/forms/confirm'::text AS route,
           'form.create'::text AS operation, ('incomplete_' || f.failure_stage)::text AS category,
           'warning'::text AS severity, f.request_id, f.provider,
           'Form creation left an incomplete form record'::text AS description
         FROM form f JOIN "user" u ON u.id = f.user_id
         WHERE f.status = 'incomplete' AND f.created_at >= $1 AND f.created_at < $2`,
      );
      if (!selects.length) {
        return {
          ...completePage([], 0, input),
          sources: { aiFailures: false, incompleteForms: false, providerFailures: false, genericApiErrors: false },
          resolutionTrackingAvailable: false,
        };
      }
      const base = `WITH failures AS (${selects.join(' UNION ALL ')}), filtered AS (
        SELECT * FROM failures WHERE ($3 = '' OR user_id = $3)
      )`;
      const [totalResult, result] = await Promise.all([
        pool.query<DbRow>(`${base} SELECT COUNT(*) AS total FROM filtered`, [input.bounds.from, input.bounds.to, input.userId]),
        pool.query<DbRow>(
          `${base} SELECT * FROM filtered ORDER BY timestamp DESC, id DESC LIMIT $4 OFFSET $5`,
          [input.bounds.from, input.bounds.to, input.userId, input.limit, input.offset],
        ),
      ]);
      const items: AdminErrorItem[] = result.rows.map(row => ({
        id: string(row.id), type: 'system.error', severity: row.severity as AdminErrorItem['severity'],
        timestamp: date(row.timestamp) ?? new Date(0), userId: string(row.user_id), userName: string(row.user_name),
        userEmail: string(row.user_email), description: string(row.description), requestId: string(row.request_id),
        provider: string(row.provider), route: string(row.route), operation: string(row.operation),
        category: string(row.category), resolutionState: 'unknown',
      }));
      return {
        ...completePage(items, count(totalResult.rows[0]?.total), input),
        sources: { aiFailures: hasAi, incompleteForms: hasForms, providerFailures: false, genericApiErrors: false },
        resolutionTrackingAvailable: false,
      };
    },
  };
}
