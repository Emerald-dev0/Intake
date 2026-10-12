import { test } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer } from 'node:http';
import {
  BILLING_SETTINGS_FIELDS,
  codeBillingSettings,
  createBillingSettingsService,
  createMemoryBillingSettingsStore,
  effectiveCreditPackDefinition,
  effectivePlanDefinition,
  parseBillingSettingsInput,
} from '../server/billing/settings.ts';
import { createAdminRouter } from '../server/admin/routes.ts';
import { readFile } from 'node:fs/promises';

const VALID = {
  freeDailyCredits: 20,
  proDailyCredits: 25,
  proMonthlyCents: 799,
  proAnnualCents: 6900,
  packStarterCents: 199,
  packStandardCents: 599,
  packPowerCents: 1299,
};

test('code defaults match the published launch catalogue', () => {
  assert.deepEqual(codeBillingSettings(), {
    freeDailyCredits: 20,
    proDailyCredits: 20,
    proMonthlyCents: 799,
    proAnnualCents: 6900,
    packStarterCents: 199,
    packStandardCents: 599,
    packPowerCents: 1299,
  });
  assert.deepEqual([...BILLING_SETTINGS_FIELDS], [
    'freeDailyCredits', 'proDailyCredits', 'proMonthlyCents', 'proAnnualCents',
    'packStarterCents', 'packStandardCents', 'packPowerCents',
  ]);
});

test('settings input requires every field as a whole number in range', () => {
  assert.deepEqual(parseBillingSettingsInput(VALID), { ok: true, values: VALID });
  for (const field of BILLING_SETTINGS_FIELDS) {
    const missing = { ...VALID };
    delete missing[field];
    const noPartial = parseBillingSettingsInput(missing);
    assert.equal(noPartial.ok, false, `${field} is required: partial updates are rejected`);
    assert.ok(noPartial.errors[field], `${field} names its own error`);
  }
  const bad = {
    ...VALID,
    freeDailyCredits: 0,
    proDailyCredits: 501,
    proMonthlyCents: -1,
    proAnnualCents: 100000,
    packStarterCents: 7.5,
    packStandardCents: '599',
    packPowerCents: null,
  };
  const rejected = parseBillingSettingsInput(bad);
  assert.equal(rejected.ok, false);
  assert.deepEqual(Object.keys(rejected.errors).sort(), [...BILLING_SETTINGS_FIELDS].sort());
  assert.equal(parseBillingSettingsInput(null).ok, false);
  assert.equal(parseBillingSettingsInput('settings').ok, false);
});

test('the settings service falls back to code defaults and applies validated saves', async () => {
  const service = createBillingSettingsService(createMemoryBillingSettingsStore());
  assert.equal(service.get().source, 'code');
  assert.equal(service.get().freeDailyCredits, 20);
  const saved = await service.update(VALID, 'owner@example.test');
  assert.equal(saved.ok, true);
  assert.equal(saved.settings.source, 'database');
  assert.equal(saved.settings.proDailyCredits, 25);
  assert.equal(saved.settings.updatedBy, 'owner@example.test');
  assert.equal(service.get().packPowerCents, 1299);
  const rejected = await service.update({ ...VALID, freeDailyCredits: 0 }, 'owner@example.test');
  assert.equal(rejected.ok, false);
  assert.equal(service.get().freeDailyCredits, 20, 'a rejected save never touches the stored values');
});

test('effective definitions default to the code catalogue without a saved row', () => {
  assert.equal(effectivePlanDefinition('free').dailyCredits, 20);
  assert.equal(effectivePlanDefinition('free').priceCents, 0);
  assert.equal(effectivePlanDefinition('pro_monthly').priceCents, 799);
  assert.equal(effectivePlanDefinition('pro_annual').priceCents, 6900);
  assert.equal(effectiveCreditPackDefinition('standard').priceCents, 599);
  assert.equal(effectiveCreditPackDefinition('standard').credits, 500, 'pack credit amounts are not editable');
});

test('the billing settings migration is additive, single-row, and range-checked', async () => {
  const text = await readFile(new URL('../db/migrations/012_billing_settings.sql', import.meta.url), 'utf8');
  const sql = text.replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS billing_settings \(/);
  assert.match(sql, /CHECK \(id = 1\)/, 'exactly one settings row can exist');
  assert.match(sql, /free_daily_credits BETWEEN 1 AND 500/);
  assert.match(sql, /pro_annual_cents BETWEEN 0 AND 99900/);
  assert.match(sql, /ON CONFLICT \(id\) DO NOTHING/, 'the defaults row is seeded, never duplicated');
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im, 'the migration never deletes or rewrites rows');
  assert.doesNotMatch(sql, /prompt|completion|api_key|credential|token/i, 'no secrets or model text are stored');
});

function fakePool(handler) {
  return { async query(sql, params = []) { return handler(String(sql), params); } };
}

test('the postgres settings store maps the single row both ways', async () => {
  const { createPostgresBillingSettingsStore } = await import('../server/billing/settings.ts');
  const seen = [];
  const pool = fakePool((sql, params) => {
    seen.push(sql);
    if (sql.startsWith('SELECT')) {
      return { rowCount: 0, rows: [] };
    }
    assert.match(sql, /ON CONFLICT \(id\) DO UPDATE SET/);
    assert.deepEqual(params.slice(0, 7), [20, 25, 799, 6900, 199, 599, 1299]);
    assert.equal(params[7], 'owner@example.test');
    return {
      rowCount: 1,
      rows: [{
        free_daily_credits: 20, pro_daily_credits: 25, pro_monthly_cents: 799, pro_annual_cents: 6900,
        pack_starter_cents: 199, pack_standard_cents: 599, pack_power_cents: 1299,
        updated_at: '2026-10-11T00:00:00.000Z', updated_by: 'owner@example.test',
      }],
    };
  });
  const store = createPostgresBillingSettingsStore(pool);
  assert.equal(await store.load(), null, 'a fresh database reports no saved row');
  const saved = await store.save({ ...VALID, proDailyCredits: 25 }, 'owner@example.test');
  assert.equal(saved.proDailyCredits, 25);
  assert.equal(saved.updatedBy, 'owner@example.test');
  assert.ok(seen.some(sql => sql.includes('FROM billing_settings WHERE id = 1')));
});

async function startSettingsApi() {
  const store = {
    async getIdentity(id) {
      if (id === 'owner-id') return { id, name: 'Owner', email: 'owner@example.com', emailVerified: true };
      if (id === 'regular-id') return { id, name: 'Regular', email: 'regular@example.com', emailVerified: true };
      return null;
    },
  };
  const settings = createBillingSettingsService(createMemoryBillingSettingsStore());
  const app = express();
  app.use('/api/admin', createAdminRouter({
    store,
    getSession: async req => {
      const cookie = req.headers.cookie ?? '';
      if (cookie.includes('sid=owner')) return { id: 'owner-id', email: 'owner@example.com', name: 'Owner' };
      if (cookie.includes('sid=regular')) return { id: 'regular-id', email: 'regular@example.com', name: 'Regular' };
      return null;
    },
    rateLimiter: { consume: async () => ({ allowed: true, retryAfterSeconds: 0 }) },
    env: { ADMIN_EMAILS: 'owner@example.com' },
    settings,
  }));
  const server = createServer(app);
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  return { base: `http://127.0.0.1:${server.address().port}`, close: () => new Promise(resolve => server.close(resolve)) };
}

test('admin settings read defaults, accept validated saves, and refuse everyone else', async () => {
  const api = await startSettingsApi();
  try {
    const anonymous = await fetch(`${api.base}/api/admin/billing/settings`);
    assert.equal(anonymous.status, 401);

    const outsider = await fetch(`${api.base}/api/admin/billing/settings`, { headers: { cookie: 'sid=regular' } });
    assert.equal(outsider.status, 403);

    const initial = await fetch(`${api.base}/api/admin/billing/settings`, { headers: { cookie: 'sid=owner' } });
    assert.equal(initial.status, 200);
    const defaults = await initial.json();
    assert.equal(defaults.source, 'code');
    assert.equal(defaults.freeDailyCredits, 20);

    const invalid = await fetch(`${api.base}/api/admin/billing/settings`, {
      method: 'PUT',
      headers: { cookie: 'sid=owner', 'content-type': 'application/json' },
      body: JSON.stringify({ ...VALID, freeDailyCredits: 0 }),
    });
    assert.equal(invalid.status, 400);
    const invalidBody = await invalid.json();
    assert.equal(invalidBody.error, 'invalid_settings');
    assert.ok(invalidBody.fieldErrors.freeDailyCredits);

    const forged = await fetch(`${api.base}/api/admin/billing/settings`, {
      method: 'PUT',
      headers: { cookie: 'sid=regular', 'content-type': 'application/json' },
      body: JSON.stringify(VALID),
    });
    assert.equal(forged.status, 403);

    const saved = await fetch(`${api.base}/api/admin/billing/settings`, {
      method: 'PUT',
      headers: { cookie: 'sid=owner', 'content-type': 'application/json' },
      body: JSON.stringify(VALID),
    });
    assert.equal(saved.status, 200);
    const body = await saved.json();
    assert.equal(body.source, 'database');
    assert.equal(body.proDailyCredits, 25);
    assert.equal(body.updatedBy, 'owner@example.com', 'the actor is the verified session email, never a body field');

    const reloaded = await (await fetch(`${api.base}/api/admin/billing/settings`, { headers: { cookie: 'sid=owner' } })).json();
    assert.equal(reloaded.proDailyCredits, 25, 'a saved row persists for later reads');
  } finally { await api.close(); }
});
