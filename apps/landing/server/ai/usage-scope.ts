import { AsyncLocalStorage } from 'node:async_hooks';
import type { AiFailureCode, AiProviderId } from './provider';

/**
 * One model call, as observed by the transport. Recorded whether the call succeeded or failed so
 * usage accounting and failure reporting share a single source of truth.
 */
export interface ModelCallRecord {
  provider: AiProviderId | 'none';
  model: string;
  schemaName: string;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  ok: boolean;
  errorCategory: AiFailureCode | null;
}

export interface ModelCallCollector {
  calls: ModelCallRecord[];
}

const storage = new AsyncLocalStorage<ModelCallCollector>();

/**
 * Bind a collector to one logical AI operation.
 *
 * A single user action ("add a phone number") can require several model calls — interpretation, a
 * structured-output correction, a revision. The scope gives the operation runner all of those calls
 * so it can record one usage row and charge one credit price, while the provider transport stays
 * unaware of users, credits and routes.
 */
export function runWithModelCallCollector<T>(collector: ModelCallCollector, run: () => Promise<T>): Promise<T> {
  return storage.run(collector, run);
}

/** Never throws: usage capture must not be able to fail an otherwise valid user operation. */
export function recordModelCall(record: ModelCallRecord): void {
  try {
    storage.getStore()?.calls.push(record);
  } catch {
    /* an observation failure is not a product failure */
  }
}

export function newModelCallCollector(): ModelCallCollector {
  return { calls: [] };
}

/** Sum of the calls in one operation. Token counts stay internal; users see AI credits. */
export function summarizeModelCalls(calls: readonly ModelCallRecord[]): {
  provider: AiProviderId | 'none' | null;
  model: string | null;
  inputTokens: number | null;
  outputTokens: number | null;
  totalTokens: number | null;
  latencyMs: number;
  failed: boolean;
  errorCategory: AiFailureCode | null;
} {
  const last = calls[calls.length - 1];
  const sum = (pick: (call: ModelCallRecord) => number | null): number | null => {
    let total = 0;
    let seen = false;
    for (const call of calls) {
      const value = pick(call);
      if (typeof value === 'number') {
        total += value;
        seen = true;
      }
    }
    return seen ? total : null;
  };
  return {
    provider: last?.provider ?? null,
    model: last?.model ?? null,
    inputTokens: sum(call => call.inputTokens),
    outputTokens: sum(call => call.outputTokens),
    totalTokens: sum(call => call.totalTokens),
    latencyMs: calls.reduce((total, call) => total + call.latencyMs, 0),
    failed: calls.some(call => !call.ok),
    errorCategory: calls.find(call => !call.ok)?.errorCategory ?? null,
  };
}
