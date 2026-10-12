/**
 * Admin-editable billing settings with code-constant fallback.
 *
 * The code constants in `./plans` and `src/lib/plans` are the defaults that ship
 * with the product. An administrator can override daily allowances and prices at
 * runtime from the admin dashboard; overrides live in the `billing_settings`
 * table (migration 012) and take effect without a redeploy or restart.
 *
 * Reads are synchronous over a short-TTL in-memory cache so hot paths (credit
 * grants, checkout amounts, plan metadata) never block on the database. The
 * cache is refreshed on admin write and lazily when stale. When the database
 * is unavailable — tests, fresh checkouts, pre-migration states — every getter
 * falls back to the code constants, so behaviour is identical to defaults.
 *
 * Nothing here is a secret: allowances and prices are public display metadata.
 * Whether paid billing is actually open stays a code flag (`PAID_BILLING_ENABLED`)
 * on purpose — opening checkout is a launch decision, not a dashboard edit.
 */

import type { Pool } from 'pg';
import { CREDIT_PACKS, PLANS, type BillingPlanId, type CreditPackDefinition, type CreditPackId, type PlanDefinition } from './plans';

export interface BillingSettingsValues {
  freeDailyCredits: number;
  proDailyCredits: number;
  proMonthlyCents: number;
  proAnnualCents: number;
  packStarterCents: number;
  packStandardCents: number;
  packPowerCents: number;
}

export interface BillingSettings extends BillingSettingsValues {
  /** Where the values came from: an admin-saved row, or the code defaults. */
  source: 'code' | 'database';
  updatedAt: string | null;
  updatedBy: string | null;
}

export const BILLING_SETTINGS_FIELDS = [
  'freeDailyCredits',
  'proDailyCredits',
  'proMonthlyCents',
  'proAnnualCents',
  'packStarterCents',
  'packStandardCents',
  'packPowerCents',
] as const;

export type BillingSettingsField = (typeof BILLING_SETTINGS_FIELDS)[number];

/** Code defaults. The single source of truth when no admin override exists. */
export function codeBillingSettings(): BillingSettingsValues {
  return {
    freeDailyCredits: PLANS.free.dailyCredits,
    proDailyCredits: PLANS.pro_monthly.dailyCredits,
    proMonthlyCents: PLANS.pro_monthly.priceCents,
    proAnnualCents: PLANS.pro_annual.priceCents,
    packStarterCents: CREDIT_PACKS.starter.priceCents,
    packStandardCents: CREDIT_PACKS.standard.priceCents,
    packPowerCents: CREDIT_PACKS.power.priceCents,
  };
}

const DAILY_RANGE = { min: 1, max: 500 } as const;
const PRICE_RANGE = { min: 0, max: 99900 } as const;

function isInt(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

/**
 * Validate an admin-submitted settings object. Every field is required and must
 * be an integer in range — partial updates are rejected so the dashboard can
 * never leave the configuration half-written.
 */
export function parseBillingSettingsInput(input: unknown): { ok: true; values: BillingSettingsValues } | { ok: false; errors: Record<string, string> } {
  const errors: Record<string, string> = {};
  const values = {} as Record<BillingSettingsField, number>;
  const body = (input ?? {}) as Record<string, unknown>;
  const check = (field: BillingSettingsField, range: { min: number; max: number }, label: string) => {
    const value = body[field];
    if (!isInt(value) || value < range.min || value > range.max) {
      errors[field] = `${label} must be a whole number between ${range.min} and ${range.max}.`;
    } else {
      values[field] = value;
    }
  };
  check('freeDailyCredits', DAILY_RANGE, 'Free daily credits');
  check('proDailyCredits', DAILY_RANGE, 'Pro daily credits');
  check('proMonthlyCents', PRICE_RANGE, 'Pro monthly price (cents)');
  check('proAnnualCents', PRICE_RANGE, 'Pro annual price (cents)');
  check('packStarterCents', PRICE_RANGE, 'Starter pack price (cents)');
  check('packStandardCents', PRICE_RANGE, 'Standard pack price (cents)');
  check('packPowerCents', PRICE_RANGE, 'Power pack price (cents)');
  if (Object.keys(errors).length > 0) return { ok: false, errors };
  return { ok: true, values };
}

export interface BillingSettingsRow extends BillingSettingsValues {
  updatedAt: string | null;
  updatedBy: string | null;
}

export interface BillingSettingsStore {
  load(): Promise<BillingSettingsRow | null>;
  save(values: BillingSettingsValues, updatedBy: string | null): Promise<BillingSettingsRow>;
}

const SETTINGS_COLUMNS = 'free_daily_credits, pro_daily_credits, pro_monthly_cents, pro_annual_cents, pack_starter_cents, pack_standard_cents, pack_power_cents, updated_at, updated_by';

function mapRow(row: Record<string, unknown>): BillingSettingsRow {
  return {
    freeDailyCredits: Number(row.free_daily_credits),
    proDailyCredits: Number(row.pro_daily_credits),
    proMonthlyCents: Number(row.pro_monthly_cents),
    proAnnualCents: Number(row.pro_annual_cents),
    packStarterCents: Number(row.pack_starter_cents),
    packStandardCents: Number(row.pack_standard_cents),
    packPowerCents: Number(row.pack_power_cents),
    updatedAt: row.updated_at instanceof Date ? row.updated_at.toISOString() : (typeof row.updated_at === 'string' ? row.updated_at : null),
    updatedBy: typeof row.updated_by === 'string' ? row.updated_by : null,
  };
}

/** Postgres implementation. Reads/writes the single row (id = 1); never deletes. */
export function createPostgresBillingSettingsStore(pool: Pool): BillingSettingsStore {
  return {
    async load() {
      const result = await pool.query(`SELECT ${SETTINGS_COLUMNS} FROM billing_settings WHERE id = 1`);
      if (!result.rowCount) return null;
      return mapRow(result.rows[0] as Record<string, unknown>);
    },
    async save(values, updatedBy) {
      const result = await pool.query(
        `INSERT INTO billing_settings
           (id, free_daily_credits, pro_daily_credits, pro_monthly_cents, pro_annual_cents, pack_starter_cents, pack_standard_cents, pack_power_cents, updated_at, updated_by)
         VALUES (1, $1, $2, $3, $4, $5, $6, $7, now(), $8)
         ON CONFLICT (id) DO UPDATE SET
           free_daily_credits = EXCLUDED.free_daily_credits,
           pro_daily_credits = EXCLUDED.pro_daily_credits,
           pro_monthly_cents = EXCLUDED.pro_monthly_cents,
           pro_annual_cents = EXCLUDED.pro_annual_cents,
           pack_starter_cents = EXCLUDED.pack_starter_cents,
           pack_standard_cents = EXCLUDED.pack_standard_cents,
           pack_power_cents = EXCLUDED.pack_power_cents,
           updated_at = now(),
           updated_by = EXCLUDED.updated_by
         RETURNING ${SETTINGS_COLUMNS}`,
        [values.freeDailyCredits, values.proDailyCredits, values.proMonthlyCents, values.proAnnualCents, values.packStarterCents, values.packStandardCents, values.packPowerCents, updatedBy],
      );
      if (!result.rowCount) throw new Error('Billing settings could not be saved.');
      return mapRow(result.rows[0] as Record<string, unknown>);
    },
  };
}

/** In-memory implementation for tests. Mirrors Postgres upsert semantics. */
export function createMemoryBillingSettingsStore(seed: BillingSettingsValues | null = null): BillingSettingsStore {
  let row: BillingSettingsRow | null = seed
    ? { ...seed, updatedAt: new Date(0).toISOString(), updatedBy: 'seed' }
    : null;
  return {
    async load() {
      return row ? { ...row } : null;
    },
    async save(values, updatedBy) {
      row = { ...values, updatedAt: new Date().toISOString(), updatedBy };
      return { ...row };
    },
  };
}

const SETTINGS_TTL_MS = 30_000;

interface CacheState {
  values: BillingSettingsValues;
  source: 'code' | 'database';
  updatedAt: string | null;
  updatedBy: string | null;
  loadedAt: number;
}

/**
 * The effective-settings service. `get()` is synchronous and safe to call from
 * grant calculation, checkout pricing and plan metadata: it returns the cached
 * row, or the code defaults when nothing was ever loaded. `refresh()` pulls
 * from the database; `update()` validates, writes through, and refreshes the
 * cache so the dashboard sees its own change immediately.
 */
export function createBillingSettingsService(store: BillingSettingsStore | null) {
  const defaults = codeBillingSettings();
  let cache: CacheState = { values: defaults, source: 'code', updatedAt: null, updatedBy: null, loadedAt: 0 };

  function applyRow(row: BillingSettingsRow | null) {
    if (!row) {
      cache = { values: codeBillingSettings(), source: 'code', updatedAt: null, updatedBy: null, loadedAt: Date.now() };
      return;
    }
    cache = {
      values: {
        freeDailyCredits: row.freeDailyCredits,
        proDailyCredits: row.proDailyCredits,
        proMonthlyCents: row.proMonthlyCents,
        proAnnualCents: row.proAnnualCents,
        packStarterCents: row.packStarterCents,
        packStandardCents: row.packStandardCents,
        packPowerCents: row.packPowerCents,
      },
      source: 'database',
      updatedAt: row.updatedAt,
      updatedBy: row.updatedBy,
      loadedAt: Date.now(),
    };
  }

  return {
    get(): BillingSettings {
      if (store && Date.now() - cache.loadedAt > SETTINGS_TTL_MS) {
        void store.load().then(applyRow, () => {});
      }
    return { ...cache.values, source: cache.source, updatedAt: cache.updatedAt, updatedBy: cache.updatedBy };
    },
    async refresh(): Promise<BillingSettings> {
      if (!store) {
        cache = { values: codeBillingSettings(), source: 'code', updatedAt: null, updatedBy: null, loadedAt: Date.now() };
      } else {
        try {
          applyRow(await store.load());
        } catch {
          cache = { values: codeBillingSettings(), source: 'code', updatedAt: null, updatedBy: null, loadedAt: Date.now() };
        }
      }
      return this.get();
    },
    async update(input: unknown, updatedBy: string | null): Promise<{ ok: true; settings: BillingSettings } | { ok: false; errors: Record<string, string> }> {
      const parsed = parseBillingSettingsInput(input);
      if (!parsed.ok) return parsed;
      if (!store) return { ok: false, errors: { _store: 'Billing settings storage is unavailable.' } };
      const row = await store.save(parsed.values, updatedBy);
      applyRow(row);
      return { ok: true, settings: this.get() };
    },
  };
}

export type BillingSettingsService = ReturnType<typeof createBillingSettingsService>;

/** Process-wide service used by grant calculation and plan metadata. */
let boundStore: BillingSettingsStore | null = null;
const proxyStore: BillingSettingsStore = {
  load() {
    if (!boundStore) return Promise.resolve(null);
    return boundStore.load();
  },
  save(values, updatedBy) {
    if (!boundStore) return Promise.reject(new Error('Billing settings storage is not bound.'));
    return boundStore.save(values, updatedBy);
  },
};
export const billingSettings = createBillingSettingsService(proxyStore);

/**
 * Attach Postgres at server startup. Refreshes immediately so the first grant
 * after boot already honours admin overrides; safe to call once.
 */
export function bindBillingSettingsStore(store: BillingSettingsStore) {
  boundStore = store;
  void billingSettings.refresh();
}

/** Daily allowance for a plan id, honouring admin overrides. */
export function effectiveDailyCredits(plan: 'free' | 'pro'): number {
  const current = billingSettings.get();
  return plan === 'pro' ? current.proDailyCredits : current.freeDailyCredits;
}

/** Price in cents for a billing plan id, honouring admin overrides. */
export function effectivePlanPriceCents(plan: 'free' | 'pro_monthly' | 'pro_annual'): number {
  const current = billingSettings.get();
  if (plan === 'pro_monthly') return current.proMonthlyCents;
  if (plan === 'pro_annual') return current.proAnnualCents;
  return 0;
}

/** Price in cents for a credit pack id, honouring admin overrides. */
export function effectivePackPriceCents(pack: CreditPackId): number {
  const current = billingSettings.get();
  if (pack === 'starter') return current.packStarterCents;
  if (pack === 'standard') return current.packStandardCents;
  return current.packPowerCents;
}

/**
 * Plan and pack definitions with admin overrides applied. These are the single
 * funnels every server consumer must use for prices and daily allowances:
 * checkout amounts, the public /plans metadata, and admin display. The raw
 * `PLANS` / `CREDIT_PACKS` records stay as auditable code defaults.
 */
export function effectivePlanDefinition(plan: BillingPlanId): PlanDefinition {
  const base = PLANS[plan];
  if (plan === 'free') return { ...base, dailyCredits: billingSettings.get().freeDailyCredits };
  return {
    ...base,
    dailyCredits: billingSettings.get().proDailyCredits,
    priceCents: effectivePlanPriceCents(plan),
  };
}

export function effectiveCreditPackDefinition(pack: CreditPackId): CreditPackDefinition {
  return { ...CREDIT_PACKS[pack], priceCents: effectivePackPriceCents(pack) };
}

export function effectivePlans(): PlanDefinition[] {
  return (Object.keys(PLANS) as BillingPlanId[]).map(effectivePlanDefinition);
}

export function effectiveCreditPacks(): CreditPackDefinition[] {
  return (Object.keys(CREDIT_PACKS) as CreditPackId[]).map(effectiveCreditPackDefinition);
}
