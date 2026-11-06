/**
 * The thing that makes syncing automatic.
 *
 * This deployment has no queue and no cron: the web process is the only process. So the scheduler
 * is a timer in that process, and every piece of state it needs lives in Postgres, not in memory:
 *
 *   - `form_sheet_sync.next_sync_at` says what is due, so a restart (or a deploy, or a missed tick)
 *     simply finds the work still waiting instead of losing it;
 *   - `claimDue` takes a lease with `FOR UPDATE SKIP LOCKED`, so two instances — during a rolling
 *     deploy, or if the service is ever scaled past one — cannot run the same form twice;
 *   - the lease expires, so a process that dies mid-run releases its forms within minutes.
 *
 * That is why the timer is not the scheduler. The timer is only a nudge; the database is the queue.
 */

import { randomUUID } from 'node:crypto';
import type { SheetsSyncDeps } from './sync';
import { runSync } from './sync';
import type { SheetSyncRecord, SheetsSyncStore } from './store';
import { DEFAULT_LEASE_MS } from './store';

export interface SheetsWorkerOptions {
  store: SheetsSyncStore;
  deps: SheetsSyncDeps;
  /** How often the queue is checked. Each check costs one query when nothing is due. */
  tickMs?: number;
  /** How many forms one tick will run, and how many at once. */
  batchSize?: number;
  concurrency?: number;
  onError?: (label: string) => void;
}

export function createSheetsWorker(options: SheetsWorkerOptions) {
  const tickMs = Math.max(5_000, options.tickMs ?? 20_000);
  const batchSize = Math.max(1, Math.min(20, options.batchSize ?? 5));
  const concurrency = Math.max(1, Math.min(5, options.concurrency ?? 2));
  const report = options.onError ?? (() => undefined);

  let active: Promise<unknown> | null = null;
  let timer: ReturnType<typeof setInterval> | null = null;
  let stopped = false;

  async function runOnce(): Promise<{ claimed: number; written: number }> {
    const runId = `run_${randomUUID().replace(/-/g, '')}`;
    const due: SheetSyncRecord[] = await options.store.claimDue(runId, batchSize, DEFAULT_LEASE_MS);
    let written = 0;
    for (let index = 0; index < due.length; index += concurrency) {
      const slice = due.slice(index, index + concurrency);
      const results = await Promise.all(slice.map(sync => runSync(sync, runId, options.deps).catch(() => null)));
      for (const result of results) written += result?.written ?? 0;
    }
    return { claimed: due.length, written };
  }

  function flush(): Promise<unknown> {
    if (stopped) return Promise.resolve();
    if (active) return active;
    active = runOnce()
      .catch(() => { report('Sheet sync tick failed'); })
      .finally(() => { active = null; });
    return active;
  }

  function start(): void {
    if (timer || stopped) return;
    void flush();
    timer = setInterval(() => { void flush(); }, tickMs);
    // A background timer must never be the reason the process stays alive on shutdown.
    timer.unref?.();
  }

  async function stop(): Promise<void> {
    stopped = true;
    if (timer) clearInterval(timer);
    timer = null;
    await active;
  }

  return { start, stop, flush, runOnce };
}
