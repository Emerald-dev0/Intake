import { randomUUID } from 'node:crypto';
import type { AiOperationType } from '../credits/entitlements';
import { CreditError, type CreditService } from '../credits/service';
import { newModelCallCollector, runWithModelCallCollector, summarizeModelCalls, type ModelCallCollector } from './usage-scope';

/**
 * One logical AI operation, start to finish.
 *
 * A logical operation is what the *user* asked for ("add a phone number field"), not what Intake
 * happens to do internally. It may involve one model call, two, a validation pass and a
 * structured-output correction — the user is charged once, for the operation, and only when it
 * produced a usable draft or plan.
 *
 * Guarantees:
 * - An operation that never produced a usable result (provider failure, invalid output, clarification,
 *   unsupported request) costs nothing.
 * - A usable result is charged exactly once, even if the browser retries with the same operation key.
 * - A user who cannot afford the cheapest operation is told before a model call is paid for.
 * - Usage is recorded for failures and successes alike, with raw tokens kept internal.
 */

export type OperationOutcome<T> =
  /** The model produced a result Intake validated and can act on. This is what gets charged. */
  | { kind: 'usable'; value: T; cost: number }
  /** A legitimate non-result: clarification or an honest "unsupported". Nothing to charge. */
  | { kind: 'no_result'; value: T };

export interface OperationRun<T> {
  userId: string;
  operationType: AiOperationType;
  /** Client idempotency key, or a server-generated one when the client sent none. */
  operationKey: string;
  /** Performs the model call and the strict assessment. Throws on provider/validation failure. */
  execute: () => Promise<OperationOutcome<T>>;
  now?: Date;
}

export interface OperationCharge {
  status: 'not_charged' | 'charged' | 'already_charged';
  cost: number;
  balance: unknown;
}

export type OperationResult<T> =
  | { ok: true; value: T; charge: OperationCharge }
  | { ok: false; error: unknown };

export interface AiOperationRunner {
  run<T>(input: OperationRun<T>): Promise<OperationResult<T>>;
  /** A validated client idempotency key, or a fresh server-generated one. */
  operationKey(candidate: unknown): string;
}

export interface AiOperationRunnerOptions {
  credits: CreditService;
  now?: () => Date;
  newId?: () => string;
  log?: (event: string, fields: Record<string, unknown>) => void;
  /** Safe, non-fatal reporting for usage-recording problems. */
  onError?: (label: string, error: unknown) => void;
}

const OPERATION_KEY = /^[A-Za-z0-9_-]{8,64}$/;

/** Maps provider/validation failures to a stored category without inventing a new taxonomy. */
function errorCategory(error: unknown): string | null {
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && /^[a-z0-9_]{2,40}$/.test(code)) return code;
  return error instanceof Error ? 'internal_error' : null;
}

export function createAiOperationRunner(options: AiOperationRunnerOptions): AiOperationRunner {
  const now = options.now ?? (() => new Date());
  const newId = options.newId ?? randomUUID;
  const log = options.log ?? (() => undefined);
  const report = options.onError ?? (() => undefined);

  async function record(input: {
    userId: string;
    operationType: AiOperationType;
    operationKey: string;
    collector: ModelCallCollector;
    outcome: 'succeeded' | 'failed' | 'no_result';
    category: string | null;
    creditCost: number;
    durationMs: number;
  }): Promise<void> {
    const summary = summarizeModelCalls(input.collector.calls);
    try {
      await options.credits.recordUsage({
        userId: input.userId,
        operationKey: input.operationKey,
        operationType: input.operationType,
        provider: summary.provider ?? 'none',
        model: summary.model,
        inputTokens: summary.inputTokens,
        outputTokens: summary.outputTokens,
        totalTokens: summary.totalTokens,
        latencyMs: input.durationMs,
        outcome: input.outcome,
        // The operation's own failure code wins over an internal attempt that also failed.
        errorCategory: input.category ?? summary.errorCategory,
        creditCost: input.creditCost,
        operationId: newId(),
      });
    } catch (error) {
      // Accounting must never fail a request the user already succeeded at.
      report('AI usage recording failed', error);
    }
  }

  return {
    operationKey(candidate: unknown): string {
      return typeof candidate === 'string' && OPERATION_KEY.test(candidate) ? candidate : newId();
    },
    async run<T>(input: OperationRun<T>): Promise<OperationResult<T>> {
      const started = performance.now();
      const at = input.now ?? now();
      const collector = newModelCallCollector();
      const base = { userId: input.userId, operationType: input.operationType, operationKey: input.operationKey, collector };
      // The cheapest operation costs 1 credit. This check only avoids paying for a doomed model call;
      // the authoritative charge happens after a usable result exists.
      try {
        await options.credits.assertCanAfford(input.userId, 1, at);
      } catch (error) {
        return { ok: false, error };
      }
      let outcome: OperationOutcome<T>;
      try {
        outcome = await runWithModelCallCollector(collector, input.execute);
      } catch (error) {
        await record({ ...base, outcome: 'failed', category: errorCategory(error), creditCost: 0, durationMs: Math.round(performance.now() - started) });
        return { ok: false, error };
      }
      if (outcome.kind === 'no_result') {
        await record({ ...base, outcome: 'no_result', category: null, creditCost: 0, durationMs: Math.round(performance.now() - started) });
        return { ok: true, value: outcome.value, charge: { status: 'not_charged', cost: 0, balance: null } };
      }
      let charge;
      try {
        charge = await options.credits.charge({ userId: input.userId, operationType: input.operationType, operationKey: input.operationKey, cost: outcome.cost, now: at });
      } catch (error) {
        // No charge means no usable result reaches the user: the model work is discarded rather than
        // handing over a free operation.
        await record({ ...base, outcome: 'failed', category: error instanceof CreditError ? error.code : 'storage_unavailable', creditCost: 0, durationMs: Math.round(performance.now() - started) });
        return { ok: false, error };
      }
      await record({ ...base, outcome: 'succeeded', category: null, creditCost: charge.cost, durationMs: Math.round(performance.now() - started) });
      log('credits.charged', { userId: input.userId, operationType: input.operationType, cost: charge.cost, status: charge.status });
      // `charge` never leaves this function as 'insufficient_credits': the service throws instead.
      const status: OperationCharge['status'] = charge.status === 'already_charged' ? 'already_charged' : 'charged';
      return { ok: true, value: outcome.value, charge: { status, cost: charge.cost, balance: charge.balance } };
    },
  };
}
