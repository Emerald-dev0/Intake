import { randomUUID } from 'node:crypto';
import {
  isProActive, toPublicBalance, type AiOperationType, type CreditBalance, type Entitlement, type PlanId, type SubscriptionStatus,
} from './entitlements';
import type { ChargeRequest, ConsumeResult, CreditStore, UsageRecord } from './ledger';

/**
 * The only place that charges a user. Everything server-owned lives behind this interface: the plan,
 * the price, the buckets, the reset convention and the idempotency key.
 *
 * A client can never submit a user id, a plan, a balance, a price or an operation type that this
 * service trusts: the route supplies the authenticated user, the server classifies the operation, and
 * the price comes from `pricing.ts`.
 */

/** Stable application error the browser can act on. */
export class CreditError extends Error {
  constructor(readonly code: 'insufficient_credits' | 'storage_unavailable', message: string) {
    super(message);
    this.name = 'CreditError';
  }
}

export interface ChargeOutcome {
  status: ConsumeResult['status'];
  cost: number;
  breakdown: { daily: number; monthly: number };
  balance: CreditBalance;
}

export interface CreditService {
  balance(userId: string, now?: Date): Promise<CreditBalance>;
  entitlement(userId: string): Promise<Entitlement>;
  /** Friendly up-front rejection that avoids paying for a model call the user cannot afford. */
  assertCanAfford(userId: string, minimumCost?: number, now?: Date): Promise<void>;
  /** Charges exactly one logical operation. Replaying the same operation key never charges twice. */
  charge(input: { userId: string; operationType: AiOperationType; operationKey: string; cost: number; now?: Date }): Promise<ChargeOutcome>;
  recordUsage(record: UsageRecord): Promise<void>;
  /** Future billing/admin hook. Not exposed over HTTP in this phase. */
  setPlan(userId: string, input: { plan: PlanId; subscriptionStatus: SubscriptionStatus; periodStart?: Date | null; periodEnd?: Date | null }): Promise<Entitlement>;
}

export interface CreditServiceOptions {
  store: CreditStore;
  now?: () => Date;
  newId?: () => string;
  onError?: (label: string, error: unknown) => void;
  /**
   * Optional lifecycle hook for transactional email, fired at most once per account per UTC day
   * when a charge leaves the balance at or below the low-credit threshold. Best-effort: a delivery
   * failure must never change a charge outcome, and this never blocks the calling request.
   */
  onLowBalance?: (input: { userId: string; remaining: number; nextDailyReset: Date | string }) => void;
}

/** 0 means "spent"; anything at or below 20% of the daily allowance earns one notice per day. */
export const LOW_CREDIT_FRACTION = 0.2;

const INSUFFICIENT = 'You do not have enough credits for this operation. Daily credits reset soon; Pro adds a monthly reserve.';

export function createCreditService(options: CreditServiceOptions): CreditService {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const report = options.onError ?? (() => undefined);

  async function settled<T>(work: () => Promise<T>): Promise<T> {
    try {
      return await work();
    } catch (error) {
      // Credit storage failing is never silently ignored: the operation is refused rather than
      // charged incorrectly or given away.
      report('Credit storage failed', error);
      throw new CreditError('storage_unavailable', 'Intake cannot check your credits right now. Nothing was charged and nothing was created. Try again shortly.');
    }
  }

  return {
    async balance(userId, at = now()) {
      const entitlement = await settled(() => options.store.ensureEntitlement(userId));
      await settled(() => options.store.ensureGrants(entitlement, at));
      const buckets = await settled(() => options.store.balances(entitlement, at));
      return toPublicBalance(entitlement, buckets, at);
    },
    async entitlement(userId) {
      return settled(() => options.store.ensureEntitlement(userId));
    },
    async assertCanAfford(userId, minimumCost = 1, at = now()) {
      const entitlement = await settled(() => options.store.ensureEntitlement(userId));
      await settled(() => options.store.ensureGrants(entitlement, at));
      const buckets = await settled(() => options.store.balances(entitlement, at));
      if (buckets.daily + buckets.monthly < minimumCost) throw new CreditError('insufficient_credits', INSUFFICIENT);
    },
    async charge(input) {
      if (!Number.isSafeInteger(input.cost) || input.cost < 1) throw new Error('Invalid credit cost');
      const request: ChargeRequest = { userId: input.userId, operationKey: input.operationKey, operationType: input.operationType, cost: input.cost, now: input.now ?? now() };
      const result = await settled(() => options.store.consume(request));
      if (result.status === 'insufficient_credits') throw new CreditError('insufficient_credits', INSUFFICIENT);
      const balance = toPublicBalance(result.entitlement, result.balances, request.now);
      // A notice, not a gate: the charge already happened. Idempotency lives in the notifier.
      if (options.onLowBalance && balance.availableCredits <= Math.max(1, Math.ceil(balance.dailyLimit * LOW_CREDIT_FRACTION))) {
        try {
          options.onLowBalance({ userId: input.userId, remaining: balance.availableCredits, nextDailyReset: balance.nextDailyReset });
        } catch (error) {
          report('Low-credit notification failed', error);
        }
      }
      return {
        status: result.status,
        cost: result.cost,
        breakdown: result.breakdown,
        balance,
      };
    },
    async recordUsage(record) {
      try {
        await options.store.recordUsage({ ...record, operationId: newId() });
      } catch (error) {
        // Usage accounting must not fail a request that already succeeded for the user.
        report('AI usage recording failed', error);
      }
    },
    async setPlan(userId, input) {
      return settled(() => options.store.setPlan(userId, {
        plan: input.plan,
        subscriptionStatus: input.subscriptionStatus,
        periodStart: input.periodStart ?? null,
        periodEnd: input.periodEnd ?? null,
      }));
    },
  };
}

export { isProActive };
