import type { Pool, PoolClient } from 'pg';
import {
  applyPlanBuckets, BUCKET_PRIORITY, dailyPeriodKey, grantCredits, monthlyPeriodKey, periodKeyFor,
  type CreditBucket, type Entitlement, type PlanId, type SubscriptionStatus,
} from './entitlements';

/**
 * The credit ledger is the source of truth. Nothing else may write a balance directly.
 *
 * Two properties matter more than speed:
 *
 * 1. **Atomicity.** `consume` runs inside one transaction that locks the user's entitlement row, so
 *    two concurrent requests cannot both spend the same credits, and a balance can never go negative.
 * 2. **Idempotency.** A logical operation has an operation key. Unique indexes on the ledger make a
 *    replayed key impossible to charge twice, even across processes and browser retries.
 */

export type GrantEntryType = 'daily_grant' | 'monthly_grant';
export const LEDGER_ENTRY_TYPES = ['daily_grant', 'monthly_grant', 'ai_consumption', 'manual_adjustment', 'expiration'] as const;
export type LedgerEntryType = (typeof LEDGER_ENTRY_TYPES)[number];

export interface ConsumptionBreakdown {
  daily: number;
  monthly: number;
}

export interface UsageRecord {
  userId: string;
  operationKey: string;
  operationType: string;
  provider: string;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number | null;
  outcome: 'succeeded' | 'failed' | 'no_result';
  errorCategory: string | null;
  creditCost: number;
  /** Stable id for the audit row. Ignored on replay so the first attempt keeps its identity. */
  operationId: string;
}

export type ConsumeResult =
  | { status: 'charged'; cost: number; breakdown: ConsumptionBreakdown; balances: Record<CreditBucket, number>; entitlement: Entitlement; replay: false }
  | { status: 'already_charged'; cost: number; breakdown: ConsumptionBreakdown; balances: Record<CreditBucket, number>; entitlement: Entitlement; replay: true }
  | { status: 'insufficient_credits'; cost: number; breakdown: ConsumptionBreakdown; balances: Record<CreditBucket, number>; entitlement: Entitlement; replay: false };

export interface ChargeRequest {
  userId: string;
  operationKey: string;
  operationType: string;
  cost: number;
  now: Date;
}

export interface CreditStore {
  /** Creates the entitlement lazily so a first-time user needs no provisioning step. */
  ensureEntitlement(userId: string): Promise<Entitlement>;
  getEntitlement(userId: string): Promise<Entitlement>;
  /** Future billing/admin hook: set plan and billing period without touching credits. */
  setPlan(userId: string, input: { plan: PlanId; subscriptionStatus: SubscriptionStatus; periodStart: Date | null; periodEnd: Date | null }): Promise<Entitlement>;
  /** Grants the current daily (and, for an active Pro plan, monthly) allowance. Idempotent per period. */
  ensureGrants(entitlement: Entitlement, now: Date): Promise<void>;
  balances(entitlement: Entitlement, now: Date): Promise<Record<CreditBucket, number>>;
  consume(request: ChargeRequest): Promise<ConsumeResult>;
  recordUsage(record: UsageRecord): Promise<void>;
  /** Audit view used by tests and the future admin dashboard. */
  ledger(userId: string): Promise<{ entryType: LedgerEntryType; bucket: CreditBucket | null; credits: number; periodKey: string; operationKey: string | null; operationType: string | null }[]>;
  /** Recorded AI operations for one user, newest last. Never exposed over HTTP in this phase. */
  usage(userId: string): Promise<UsageRecord[]>;
}

function emptyBuckets(): Record<CreditBucket, number> {
  return { daily: 0, monthly: 0 };
}

function requireCost(cost: number): number {
  if (!Number.isSafeInteger(cost) || cost < 1 || cost > 100) throw new Error('Invalid credit cost');
  return cost;
}

export function validOperationKey(key: string): boolean {
  return /^[A-Za-z0-9_-]{8,64}$/.test(key);
}

/** Splits a charge across buckets in the documented order: daily first, then the monthly reserve. */
export function allocate(cost: number, balances: Record<CreditBucket, number>): ConsumptionBreakdown {
  let remaining = cost;
  const breakdown: ConsumptionBreakdown = { daily: 0, monthly: 0 };
  for (const bucket of BUCKET_PRIORITY) {
    const take = Math.min(remaining, Math.max(0, balances[bucket]));
    breakdown[bucket] = take;
    remaining -= take;
    if (remaining === 0) break;
  }
  return breakdown;
}

export function affordable(cost: number, balances: Record<CreditBucket, number>): boolean {
  return balances.daily + balances.monthly >= cost;
}

/**
 * PostgreSQL implementation. One transaction, one row lock, one set of unique indexes.
 *
 * The entitlement row is the per-user mutex: `FOR UPDATE` serializes concurrent consumers of the same
 * user without locking the whole ledger, and the ledger inserts happen before the transaction commits.
 */
export function createPostgresCreditStore(pool: Pool): CreditStore {
  const loadEntitlement = async (client: PoolClient | Pool, userId: string): Promise<Entitlement> => {
    const row = await client.query<{ plan: string; subscription_status: string; current_period_start: Date | null; current_period_end: Date | null }>(
      'SELECT plan, subscription_status, current_period_start, current_period_end FROM user_entitlement WHERE user_id = $1', [userId]);
    const found = row.rows[0];
    return {
      userId,
      plan: (found?.plan as PlanId) ?? 'free',
      subscriptionStatus: (found?.subscription_status as SubscriptionStatus) ?? 'none',
      currentPeriodStart: found?.current_period_start ?? null,
      currentPeriodEnd: found?.current_period_end ?? null,
    };
  };

  const insertGrant = async (executor: PoolClient | Pool, userId: string, bucket: CreditBucket, entryType: GrantEntryType, credits: number, periodKey: string, now: Date): Promise<void> => {
    if (credits <= 0) return;
    await executor.query(
      `INSERT INTO credit_ledger (user_id, entry_type, bucket, credits, period_key, note, created_at)
       VALUES ($1, $2, $3, $4, $5, 'automatic allowance', $6)
       ON CONFLICT (user_id, entry_type, period_key) DO NOTHING`,
      [userId, entryType, bucket, credits, periodKey, now]);
  };

  const sumBucket = async (executor: PoolClient | Pool, userId: string, bucket: CreditBucket, periodKey: string): Promise<number> => {
    const row = await executor.query<{ total: string | null }>(
      `SELECT COALESCE(SUM(credits), 0)::text AS total FROM credit_ledger
       WHERE user_id = $1 AND bucket = $2 AND period_key = $3`, [userId, bucket, periodKey]);
    return Number(row.rows[0]?.total ?? 0);
  };

  const ensureGrants = async (executor: PoolClient | Pool, entitlement: Entitlement, now: Date): Promise<void> => {
    await insertGrant(executor, entitlement.userId, 'daily', 'daily_grant', grantCredits(entitlement.plan, 'daily'), dailyPeriodKey(now), now);
    if (entitlement.plan === 'pro') {
      await insertGrant(executor, entitlement.userId, 'monthly', 'monthly_grant', grantCredits(entitlement.plan, 'monthly'), monthlyPeriodKey(entitlement, now), now);
    }
  };

  const bucketBalances = async (executor: PoolClient | Pool, entitlement: Entitlement, now: Date): Promise<Record<CreditBucket, number>> => {
    const buckets = emptyBuckets();
    for (const bucket of BUCKET_PRIORITY) buckets[bucket] = await sumBucket(executor, entitlement.userId, bucket, periodKeyFor(bucket, entitlement, now));
    // A plan that grants no monthly reserve has no spendable monthly balance, however much history exists.
    return applyPlanBuckets(entitlement.plan, buckets);
  };

  return {
    async ensureEntitlement(userId) {
      await pool.query('INSERT INTO user_entitlement (user_id, plan, subscription_status) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING', [userId, 'free', 'none']);
      return loadEntitlement(pool, userId);
    },
    async getEntitlement(userId) {
      return loadEntitlement(pool, userId);
    },
    async setPlan(userId, input) {
      await pool.query(
        `INSERT INTO user_entitlement (user_id, plan, subscription_status, current_period_start, current_period_end, updated_at)
         VALUES ($1, $2, $3, $4, $5, now())
         ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, subscription_status = EXCLUDED.subscription_status,
           current_period_start = EXCLUDED.current_period_start, current_period_end = EXCLUDED.current_period_end, updated_at = now()`,
        [userId, input.plan, input.subscriptionStatus, input.periodStart, input.periodEnd]);
      return loadEntitlement(pool, userId);
    },
    async ensureGrants(entitlement, now) {
      await ensureGrants(pool, entitlement, now);
    },
    async balances(entitlement, now) {
      return bucketBalances(pool, entitlement, now);
    },
    async consume(request) {
      const cost = requireCost(request.cost);
      if (!validOperationKey(request.operationKey)) throw new Error('Invalid operation key');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query('INSERT INTO user_entitlement (user_id, plan, subscription_status) VALUES ($1, $2, $3) ON CONFLICT (user_id) DO NOTHING', [request.userId, 'free', 'none']);
        // Per-user mutex: the entitlement row, not the ledger, is locked.
        await client.query('SELECT user_id FROM user_entitlement WHERE user_id = $1 FOR UPDATE', [request.userId]);
        const entitlement = await loadEntitlement(client, request.userId);
        await ensureGrants(client, entitlement, request.now);

        const existing = await client.query<{ bucket: CreditBucket; credits: number }>(
          `SELECT bucket, credits FROM credit_ledger
           WHERE user_id = $1 AND entry_type = 'ai_consumption' AND operation_key = $2`, [request.userId, request.operationKey]);
        const balances = await bucketBalances(client, entitlement, request.now);
        if (existing.rowCount) {
          const breakdown = emptyBuckets();
          for (const row of existing.rows) breakdown[row.bucket] += Math.abs(Number(row.credits));
          await client.query('COMMIT');
          return { status: 'already_charged', cost: breakdown.daily + breakdown.monthly, breakdown, balances, entitlement, replay: true };
        }
        if (!affordable(cost, balances)) {
          await client.query('COMMIT');
          return { status: 'insufficient_credits', cost, breakdown: emptyBuckets(), balances, entitlement, replay: false };
        }
        const breakdown = allocate(cost, balances);
        for (const bucket of BUCKET_PRIORITY) {
          if (breakdown[bucket] === 0) continue;
          await client.query(
            `INSERT INTO credit_ledger (user_id, entry_type, bucket, credits, period_key, operation_key, operation_type, note, created_at)
             VALUES ($1, 'ai_consumption', $2, $3, $4, $5, $6, $7, $8)`,
            [request.userId, bucket, -breakdown[bucket], periodKeyFor(bucket, entitlement, request.now), request.operationKey, request.operationType, `ai_consumption:${request.operationType}`, request.now]);
        }
        const after = await bucketBalances(client, entitlement, request.now);
        await client.query('COMMIT');
        return { status: 'charged', cost, breakdown, balances: after, entitlement, replay: false };
      } catch (error) {
        await client.query('ROLLBACK').catch(() => undefined);
        throw error;
      } finally {
        client.release();
      }
    },
    async recordUsage(record) {
      await pool.query(
        `INSERT INTO ai_operation (id, user_id, operation_key, operation_type, provider, model, input_tokens, output_tokens, total_tokens, latency_ms, outcome, error_category, credit_cost, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, now())
         ON CONFLICT (user_id, operation_key) DO UPDATE SET
           provider = EXCLUDED.provider, model = EXCLUDED.model,
           input_tokens = EXCLUDED.input_tokens, output_tokens = EXCLUDED.output_tokens, total_tokens = EXCLUDED.total_tokens,
           latency_ms = EXCLUDED.latency_ms, outcome = EXCLUDED.outcome, error_category = EXCLUDED.error_category,
           credit_cost = EXCLUDED.credit_cost`,
        [record.operationId, record.userId, record.operationKey, record.operationType, record.provider, record.model,
          record.inputTokens, record.outputTokens, record.totalTokens, record.latencyMs, record.outcome, record.errorCategory, record.creditCost]);
    },
    async ledger(userId) {
      const rows = await pool.query<{ entry_type: LedgerEntryType; bucket: CreditBucket | null; credits: number; period_key: string; operation_key: string | null; operation_type: string | null }>(
        `SELECT entry_type, bucket, credits, period_key, operation_key, operation_type FROM credit_ledger
         WHERE user_id = $1 ORDER BY id ASC`, [userId]);
      return rows.rows.map(row => ({
        entryType: row.entry_type, bucket: row.bucket, credits: Number(row.credits),
        periodKey: row.period_key, operationKey: row.operation_key, operationType: row.operation_type,
      }));
    },
    async usage(userId) {
      const rows = await pool.query<{
        id: string; operation_key: string; operation_type: string; provider: string; model: string | null;
        input_tokens: number | null; output_tokens: number | null; total_tokens: number | null; latency_ms: number | null;
        outcome: 'succeeded' | 'failed' | 'no_result'; error_category: string | null; credit_cost: number;
      }>(
        `SELECT id, operation_key, operation_type, provider, model, input_tokens, output_tokens, total_tokens,
                latency_ms, outcome, error_category, credit_cost
         FROM ai_operation WHERE user_id = $1 ORDER BY created_at ASC`, [userId]);
      return rows.rows.map(row => ({
        userId, operationKey: row.operation_key, operationType: row.operation_type, provider: row.provider, model: row.model,
        inputTokens: row.input_tokens === null ? null : Number(row.input_tokens),
        outputTokens: row.output_tokens === null ? null : Number(row.output_tokens),
        totalTokens: row.total_tokens === null ? null : Number(row.total_tokens),
        latencyMs: row.latency_ms === null ? null : Number(row.latency_ms),
        outcome: row.outcome, errorCategory: row.error_category, creditCost: Number(row.credit_cost), operationId: row.id,
      }));
    },
  };
}

interface MemoryLedgerRow {
  userId: string;
  entryType: LedgerEntryType;
  bucket: CreditBucket | null;
  credits: number;
  periodKey: string;
  operationKey: string | null;
  operationType: string | null;
}

interface MemoryUsageRow extends UsageRecord {}

/**
 * In-memory double with the same observable semantics, including per-user serialization: `consume`
 * calls for one user are chained, so concurrency tests exercise the real ordering rules rather than a
 * toy implementation.
 */
export function createMemoryCreditStore(): CreditStore {
  const entitlements = new Map<string, Entitlement>();
  const rows: MemoryLedgerRow[] = [];
  const usage: MemoryUsageRow[] = [];
  const queues = new Map<string, Promise<unknown>>();

  /** Serializes work per user, the same guarantee `SELECT ... FOR UPDATE` provides in PostgreSQL. */
  function serialized<T>(userId: string, work: () => T): Promise<T> {
    const previous = queues.get(userId) ?? Promise.resolve();
    const next = previous.then(work);
    queues.set(userId, next.then(() => undefined, () => undefined));
    return next;
  }

  const entitlementFor = (userId: string): Entitlement => {
    const found = entitlements.get(userId);
    return found ? { ...found } : { userId, plan: 'free', subscriptionStatus: 'none', currentPeriodStart: null, currentPeriodEnd: null };
  };

  const total = (userId: string, bucket: CreditBucket, periodKey: string): number =>
    rows.reduce((sum, row) => (row.userId === userId && row.bucket === bucket && row.periodKey === periodKey ? sum + row.credits : sum), 0);

  const balancesFor = (entitlement: Entitlement, now: Date): Record<CreditBucket, number> =>
    applyPlanBuckets(entitlement.plan, {
      daily: total(entitlement.userId, 'daily', dailyPeriodKey(now)),
      monthly: total(entitlement.userId, 'monthly', monthlyPeriodKey(entitlement, now)),
    });

  const granted = (entitlement: Entitlement, now: Date): void => {
    for (const bucket of BUCKET_PRIORITY) {
      if (bucket === 'monthly' && entitlement.plan !== 'pro') continue;
      const credits = grantCredits(entitlement.plan, bucket);
      if (credits <= 0) continue;
      const entryType: GrantEntryType = bucket === 'daily' ? 'daily_grant' : 'monthly_grant';
      const periodKey = periodKeyFor(bucket, entitlement, now);
      if (rows.some(row => row.userId === entitlement.userId && row.entryType === entryType && row.periodKey === periodKey)) continue;
      rows.push({ userId: entitlement.userId, entryType, bucket, credits, periodKey, operationKey: null, operationType: null });
    }
  };

  const write = (userId: string, input: { plan: PlanId; subscriptionStatus: SubscriptionStatus; periodStart: Date | null; periodEnd: Date | null }): Entitlement => {
    const entitlement: Entitlement = { userId, plan: input.plan, subscriptionStatus: input.subscriptionStatus, currentPeriodStart: input.periodStart, currentPeriodEnd: input.periodEnd };
    entitlements.set(userId, entitlement);
    return { ...entitlement };
  };

  return {
    async ensureEntitlement(userId) {
      return serialized(userId, () => {
        if (!entitlements.has(userId)) write(userId, { plan: 'free', subscriptionStatus: 'none', periodStart: null, periodEnd: null });
        return entitlementFor(userId);
      });
    },
    async getEntitlement(userId) {
      return entitlementFor(userId);
    },
    async setPlan(userId, input) {
      return serialized(userId, () => write(userId, input));
    },
    async ensureGrants(entitlement, now) {
      await serialized(entitlement.userId, () => granted(entitlement, now));
    },
    async balances(entitlement, now) {
      granted(entitlement, now);
      return balancesFor(entitlement, now);
    },
    async consume(request) {
      const cost = requireCost(request.cost);
      if (!validOperationKey(request.operationKey)) throw new Error('Invalid operation key');
      return serialized(request.userId, () => {
        if (!entitlements.has(request.userId)) write(request.userId, { plan: 'free', subscriptionStatus: 'none', periodStart: null, periodEnd: null });
        const entitlement = entitlementFor(request.userId);
        granted(entitlement, request.now);
        const existing = rows.filter(row => row.userId === request.userId && row.entryType === 'ai_consumption' && row.operationKey === request.operationKey);
        const balances = balancesFor(entitlement, request.now);
        if (existing.length) {
          const breakdown = emptyBuckets();
          for (const row of existing) if (row.bucket) breakdown[row.bucket] += Math.abs(row.credits);
          return { status: 'already_charged' as const, cost: breakdown.daily + breakdown.monthly, breakdown, balances, entitlement, replay: true as const };
        }
        if (!affordable(cost, balances)) {
          return { status: 'insufficient_credits' as const, cost, breakdown: emptyBuckets(), balances, entitlement, replay: false as const };
        }
        const breakdown = allocate(cost, balances);
        for (const bucket of BUCKET_PRIORITY) {
          if (breakdown[bucket] === 0) continue;
          rows.push({ userId: request.userId, entryType: 'ai_consumption', bucket, credits: -breakdown[bucket], periodKey: periodKeyFor(bucket, entitlement, request.now), operationKey: request.operationKey, operationType: request.operationType });
        }
        return { status: 'charged' as const, cost, breakdown, balances: balancesFor(entitlement, request.now), entitlement, replay: false as const };
      });
    },
    async recordUsage(record) {
      const existing = usage.find(row => row.userId === record.userId && row.operationKey === record.operationKey);
      if (existing) Object.assign(existing, record);
      else usage.push({ ...record });
    },
    async ledger(userId) {
      return rows.filter(row => row.userId === userId).map(({ entryType, bucket, credits, periodKey, operationKey, operationType }) => ({ entryType, bucket, credits, periodKey, operationKey, operationType }));
    },
    async usage(userId) {
      return usage.filter(row => row.userId === userId).map(row => ({ ...row }));
    },
  };
}
