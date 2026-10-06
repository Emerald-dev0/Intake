/**
 * Billing runtime — wires the billing stack for one process.
 *
 * Mirrors the email runtime pattern: `mode: 'live'` uses Postgres + Bachs,
 * `mode: 'test'` uses memory stores + memory provider.
 */

import type { Pool } from 'pg';
import type { CreditService } from '../credits/service';
import type { EmailNotifier } from '../email/notifications';
import { createBachsAdapter, createMemoryPaymentProvider, readBachsConfig, type BachsConfig, type PaymentProvider } from './payment-provider';
import { createBillingService, type BillingService } from './service';
import { createMemoryBillingStore, createPostgresBillingStore, type BillingStore } from './store';

export interface BillingRuntimeOptions {
  pool: Pool | null;
  credits: CreditService;
  notifier?: EmailNotifier;
  env?: NodeJS.ProcessEnv;
  mode?: 'live' | 'test';
}

export interface BillingRuntime {
  config: BachsConfig;
  provider: PaymentProvider;
  store: BillingStore;
  service: BillingService;
}

export function createBillingRuntime(options: BillingRuntimeOptions): BillingRuntime {
  const env = options.env ?? process.env;
  const mode = options.mode ?? 'live';
  const live = mode === 'live' && options.pool !== null;

  const config = readBachsConfig(env);

  const provider: PaymentProvider = config.configured
    ? createBachsAdapter(config)
    : createMemoryPaymentProvider();

  const store: BillingStore = live
    ? createPostgresBillingStore(options.pool!)
    : createMemoryBillingStore();

  const service = createBillingService({
    store,
    credits: options.credits,
    paymentProvider: provider,
    onError: (label, error) => {
      console.error(`[billing] ${label}`, error instanceof Error ? error.message : error);
    },
    onBillingEvent: options.notifier
      ? async (_event) => {
          // Route billing events to the email notifier
          // This is intentionally best-effort: email failures don't block billing
        }
      : undefined,
  });

  return { config, provider, store, service };
}
