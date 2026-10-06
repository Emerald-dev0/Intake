import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { PLAN_CATALOG, proPriceComparison } from '../src/lib/plans.ts';
import { createMemoryCreditStore, allocate, affordable, validOperationKey } from '../server/credits/ledger.ts';
import { createCreditService, CreditError } from '../server/credits/service.ts';
import {
  dailyPeriodKey, monthlyPeriodKey, nextDailyReset, nextMonthlyReset, PLANS, toPublicBalance,
} from '../server/credits/entitlements.ts';
import { costForFormCreation, costForFormEdit, creationComplexity, editComplexity } from '../server/credits/pricing.ts';

const DAY_1 = new Date('2026-10-03T09:00:00Z');
const DAY_1_LATE = new Date('2026-10-03T23:59:59Z');
const DAY_2 = new Date('2026-10-04T00:00:01Z');
const NEXT_MONTH = new Date('2026-11-01T00:00:01Z');

function boot(now = () => DAY_1) {
  const store = createMemoryCreditStore();
  const credits = createCreditService({ store, now });
  return { store, credits };
}

const key = suffix => `op-key-${suffix}`;

test('the launch plan definitions and public price metadata come from one catalogue', () => {
  assert.deepEqual({ free: PLANS.free.dailyCredits, freeMonthly: PLANS.free.monthlyCredits }, { free: PLAN_CATALOG.free.dailyCredits, freeMonthly: PLAN_CATALOG.free.monthlyCredits });
  assert.deepEqual({ pro: PLANS.pro.dailyCredits, proMonthly: PLANS.pro.monthlyCredits }, { pro: PLAN_CATALOG.pro.dailyCredits, proMonthly: PLAN_CATALOG.pro.monthlyCredits });
  assert.equal(PLAN_CATALOG.free.prices, null);
  assert.deepEqual(PLAN_CATALOG.pro.prices, { month: 799, year: 6900 });
  assert.deepEqual(proPriceComparison(), {
    monthlyCents: 799, annualCents: 6900, monthlyEquivalentCents: 575,
    monthlyBilledAnnualTotalCents: 9588, annualSavingsCents: 2688, annualSavingsPercent: 28.0,
  });
});

test('a free account is granted 10 daily credits, which reset rather than roll over', async () => {
  const { store, credits } = boot();
  assert.deepEqual(await credits.balance('user-a'), {
    plan: 'free', subscriptionStatus: 'none', availableCredits: 10,
    dailyRemaining: 10, dailyLimit: 10, monthlyRemaining: 0, monthlyLimit: 0,
    nextDailyReset: nextDailyReset(DAY_1).toISOString(), nextMonthlyReset: nextMonthlyReset({ currentPeriodEnd: null }, DAY_1).toISOString(),
  });
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('a1'), cost: 2 });
  assert.equal((await credits.balance('user-a')).dailyRemaining, 8);
  // Nothing rolls over: the next UTC day starts from a fresh 10, not from 8 + 20.
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('a2'), cost: 5, now: DAY_1_LATE });
  assert.equal((await credits.balance('user-a', DAY_1_LATE)).dailyRemaining, 3);
  assert.equal((await credits.balance('user-a', DAY_2)).dailyRemaining, 10);
  // The new day has exactly one grant row; the previous day's ledger is untouched.
  const ledger = await store.ledger('user-a');
  assert.deepEqual(ledger.filter(entry => entry.entryType === 'daily_grant').map(entry => entry.periodKey), ['2026-10-03', '2026-10-04']);
  assert.equal(dailyPeriodKey(DAY_2), '2026-10-04');
});

test('Pro adds a 1000-credit monthly reserve per period, and daily credits are spent first', async () => {
  const { store, credits } = boot();
  await credits.setPlan('user-a', { plan: 'pro', subscriptionStatus: 'active' });
  const start = await credits.balance('user-a');
  assert.deepEqual({ plan: start.plan, daily: start.dailyRemaining, monthly: start.monthlyRemaining }, { plan: 'pro', daily: 10, monthly: 1000 });

  // 10 daily credits cover the first 10 credits of cost; the 11th comes from the monthly reserve.
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('pro1'), cost: 20 });
  const afterDaily = await credits.balance('user-a');
  assert.deepEqual({ daily: afterDaily.dailyRemaining, monthly: afterDaily.monthlyRemaining }, { daily: 0, monthly: 990 });
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('pro2'), cost: 3 });
  const afterOverflow = await credits.balance('user-a');
  assert.deepEqual({ daily: afterOverflow.dailyRemaining, monthly: afterOverflow.monthlyRemaining }, { daily: 0, monthly: 987 });
  const consumption = (await store.ledger('user-a')).filter(entry => entry.entryType === 'ai_consumption');
  assert.deepEqual(consumption.map(entry => [entry.bucket, entry.credits]), [['daily', -10], ['monthly', -10], ['monthly', -3]]);

  // A new day restores the daily allowance; the monthly reserve does not roll over either.
  assert.deepEqual({ daily: (await credits.balance('user-a', DAY_2)).dailyRemaining, monthly: (await credits.balance('user-a', DAY_2)).monthlyRemaining }, { daily: 10, monthly: 987 });
  const nextMonth = await credits.balance('user-a', NEXT_MONTH);
  assert.deepEqual({ daily: nextMonth.dailyRemaining, monthly: nextMonth.monthlyRemaining }, { daily: 10, monthly: 1000 }, 'the new period grants a fresh reserve, not the old balance');
  assert.equal(monthlyPeriodKey({ currentPeriodStart: null }, NEXT_MONTH), '2026-11');
  assert.equal((await store.ledger('user-a')).filter(entry => entry.entryType === 'subscription_grant').length, 2);
});

test('a billing period from the future payment system defines the monthly bucket', async () => {
  const { credits, store } = boot();
  const periodStart = new Date('2026-10-15T00:00:00Z');
  const periodEnd = new Date('2026-11-15T00:00:00Z');
  await credits.setPlan('user-1', { plan: 'pro', subscriptionStatus: 'active', periodStart, periodEnd });
  const balance = await credits.balance('user-1');
  assert.equal(balance.monthlyRemaining, 1000);
  assert.equal(balance.nextMonthlyReset, periodEnd.toISOString());
  await credits.charge({ userId: 'user-1', operationType: 'form_create', operationKey: key('billing'), cost: 22 });
  assert.deepEqual({ daily: (await credits.balance('user-1')).dailyRemaining, monthly: (await credits.balance('user-1')).monthlyRemaining }, { daily: 0, monthly: 988 });
  // Time passing inside the same billing period never grants a second reserve.
  assert.equal((await credits.balance('user-1', new Date('2026-11-10T00:00:00Z'))).monthlyRemaining, 988);
  assert.equal((await store.ledger('user-1')).filter(entry => entry.entryType === 'subscription_grant').length, 1);
  // Only the future billing system advancing the period grants the next reserve; the old 498 never rolls over.
  await credits.setPlan('user-1', { plan: 'pro', subscriptionStatus: 'active', periodStart: periodEnd, periodEnd: new Date('2026-12-15T00:00:00Z') });
  const nextPeriod = await credits.balance('user-1', new Date('2026-11-20T00:00:00Z'));
  assert.equal(nextPeriod.monthlyRemaining, 1000);
  assert.equal((await store.ledger('user-1')).filter(entry => entry.entryType === 'subscription_grant').length, 2);
  // Downgrading to Free removes the reserve without deleting history.
  await credits.setPlan('user-1', { plan: 'free', subscriptionStatus: 'canceled', periodStart: null, periodEnd: null });
  const downgraded = await credits.balance('user-1', new Date('2026-11-20T00:00:00Z'));
  assert.deepEqual({ plan: downgraded.plan, daily: downgraded.dailyRemaining, monthly: downgraded.monthlyRemaining }, { plan: 'free', daily: 20, monthly: 0 });
});

test('credit costs are deterministic, server-side, and match the published 1–5 range', () => {
  // Creation: 2 credits is the normal case, rising with size and conditional logic.
  assert.equal(costForFormCreation({ questionCount: 6, conditionalCount: 0 }), 2);
  assert.equal(costForFormCreation({ questionCount: 8, conditionalCount: 0 }), 2);
  assert.equal(costForFormCreation({ questionCount: 9, conditionalCount: 0 }), 3);
  assert.equal(costForFormCreation({ questionCount: 5, conditionalCount: 1 }), 2);
  assert.equal(costForFormCreation({ questionCount: 6, conditionalCount: 1 }), 3);
  assert.equal(costForFormCreation({ questionCount: 14, conditionalCount: 1 }), 4);
  assert.equal(costForFormCreation({ questionCount: 40, conditionalCount: 5 }), 5);
  assert.equal(costForFormCreation({ questionCount: 0, conditionalCount: 0 }), 2);
  // Editing: one focused change is 1 credit; batches and restructuring cost more.
  assert.equal(costForFormEdit({ operationCount: 1, structuralCount: 0, touchedQuestions: 1 }), 1);
  assert.equal(costForFormEdit({ operationCount: 1, structuralCount: 1, touchedQuestions: 0 }), 1, 'adding or removing one question is a simple edit');
  assert.equal(costForFormEdit({ operationCount: 2, structuralCount: 0, touchedQuestions: 2 }), 2);
  assert.equal(costForFormEdit({ operationCount: 3, structuralCount: 2, touchedQuestions: 3 }), 3);
  assert.equal(costForFormEdit({ operationCount: 5, structuralCount: 0, touchedQuestions: 4 }), 3);
  assert.equal(costForFormEdit({ operationCount: 8, structuralCount: 2, touchedQuestions: 4 }), 4);
  assert.equal(costForFormEdit({ operationCount: 8, structuralCount: 2, touchedQuestions: 6 }), 5);
  assert.equal(costForFormEdit({ operationCount: 30, structuralCount: 0, touchedQuestions: 30 }), 5);
  // Adapters read the validated objects, not model prose.
  assert.deepEqual(creationComplexity({ questions: [{ visibility: { when: { question: 'a', equals: 'Yes' } } }, {}, {}] }), { questionCount: 3, conditionalCount: 1 });
  assert.deepEqual(editComplexity({ operations: [{ type: 'update_question', questionId: 'q1' }, { type: 'add_question' }, { type: 'delete_question', questionId: 'q2' }] }), { operationCount: 3, structuralCount: 2, touchedQuestions: 2 });
});

test('a failed or zero-cost operation never moves the balance, and insufficient credits are explicit', async () => {
  const { credits, store } = boot();
  const ledgerBefore = (await store.ledger('user-a')).length;
  await credits.charge({ userId: 'user-a', operationType: 'form_edit', operationKey: key('one'), cost: 1 });
  const after = await credits.balance('user-a');
  assert.equal(after.dailyRemaining, 19);
  assert.equal((await store.ledger('user-a')).length, ledgerBefore + 2, 'one grant row and one consumption row');

  // Spend the rest, then ask for more than exists.
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('rest'), cost: 19 });
  assert.equal((await credits.balance('user-a')).dailyRemaining, 0);
  await assert.rejects(
    credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('over'), cost: 1 }),
    error => error instanceof CreditError && error.code === 'insufficient_credits',
  );
  assert.equal((await credits.balance('user-a')).dailyRemaining, 0, 'a rejected charge cannot leave a partial deduction');
  assert.equal((await store.ledger('user-a')).some(entry => entry.operationKey === key('over')), false, 'no ledger row for a refused operation');

  await assert.rejects(credits.assertCanAfford('user-a', 1), error => error instanceof CreditError && error.code === 'insufficient_credits');
  await credits.assertCanAfford('user-b', 1);
});

test('the same operation key can never be charged twice', async () => {
  const { credits, store } = boot();
  const first = await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('dup'), cost: 3 });
  assert.equal(first.status, 'charged');
  for (let attempt = 0; attempt < 3; attempt++) {
    const replay = await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('dup'), cost: 3 });
    assert.equal(replay.status, 'already_charged');
    assert.equal(replay.cost, 3, 'the original price is reported, not a second charge');
  }
  assert.equal((await credits.balance('user-a')).dailyRemaining, 17);
  const consumption = (await store.ledger('user-a')).filter(entry => entry.entryType === 'ai_consumption');
  assert.equal(consumption.length, 1);
  // A different operation key is a different operation.
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('dup2'), cost: 3 });
  assert.equal((await credits.balance('user-a')).dailyRemaining, 14);
});

test('concurrent consumption cannot overspend, go negative, or double-charge one operation', async () => {
  const { credits, store } = boot();
  // 20 credits, ten simultaneous 3-credit operations: only six can succeed.
  const attempts = Array.from({ length: 10 }, (_, index) =>
    credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key(`race-${index}`), cost: 3 }).then(
      () => 'charged', error => error.code));
  const results = await Promise.all(attempts);
  assert.equal(results.filter(result => result === 'charged').length, 6);
  assert.equal(results.filter(result => result === 'insufficient_credits').length, 4);
  const balance = await credits.balance('user-a');
  assert.deepEqual({ daily: balance.dailyRemaining, monthly: balance.monthlyRemaining }, { daily: 2, monthly: 0 });
  assert.equal((await store.ledger('user-a')).filter(entry => entry.entryType === 'ai_consumption').reduce((sum, entry) => sum + entry.credits, 0), -8);

  // The same key fired concurrently is charged once.
  const { credits: second } = boot();
  const racing = await Promise.all(Array.from({ length: 5 }, () =>
    second.charge({ userId: 'user-b', operationType: 'form_edit', operationKey: key('same'), cost: 2 })));
  assert.equal(racing.filter(result => result.status === 'charged').length, 1);
  assert.equal(racing.filter(result => result.status === 'already_charged').length, 4);
  assert.equal((await second.balance('user-b')).dailyRemaining, 8);
});

test('grants are idempotent across concurrent balance reads', async () => {
  const { store, credits } = boot();
  await Promise.all(Array.from({ length: 8 }, () => credits.balance('user-a')));
  const entitlement = await store.getEntitlement('user-a');
  await Promise.all(Array.from({ length: 8 }, () => store.ensureGrants(entitlement, DAY_1)));
  const grants = (await store.ledger('user-a')).filter(entry => entry.entryType === 'daily_grant');
  assert.equal(grants.length, 1, 'exactly one daily grant per user per UTC day');
  assert.equal((await credits.balance('user-a')).dailyRemaining, 10);
  assert.equal(validOperationKey(key('ok12345')), true);
  for (const invalid of ['short', 'x'.repeat(65), 'has space', 'sym$bol!!', '']) assert.equal(validOperationKey(invalid), false, invalid);
});

test('the public balance exposes no tokens, ids, or internal economics', async () => {
  const { credits } = boot();
  await credits.setPlan('user-a', { plan: 'pro', subscriptionStatus: 'active' });
  await credits.charge({ userId: 'user-a', operationType: 'form_create', operationKey: key('public'), cost: 2 });
  const balance = await credits.balance('user-a');
  assert.deepEqual(Object.keys(balance).sort(), ['availableCredits', 'dailyLimit', 'dailyRemaining', 'monthlyLimit', 'monthlyRemaining', 'nextDailyReset', 'nextMonthlyReset', 'plan', 'subscriptionStatus']);
  assert.equal(JSON.stringify(balance).includes('user-a'), false);
  assert.equal(/token|cost|ledger|credit_cost/i.test(JSON.stringify(balance)), false);
  const projected = toPublicBalance({ userId: 'user-a', plan: 'free', subscriptionStatus: 'none', currentPeriodStart: null, currentPeriodEnd: null }, { daily: -5, monthly: 0 }, DAY_1);
  assert.equal(projected.dailyRemaining, 0, 'a negative internal value can never be exposed');
});

test('allocation helpers follow the documented daily-then-monthly order', () => {
  assert.deepEqual(allocate(3, { daily: 5, monthly: 10, subscription: 0, purchased: 0, promotion: 0 }), { daily: 3, monthly: 0, subscription: 0, purchased: 0, promotion: 0 });
  assert.deepEqual(allocate(3, { daily: 1, monthly: 10, subscription: 0, purchased: 0, promotion: 0 }), { daily: 1, monthly: 2, subscription: 0, purchased: 0, promotion: 0 });
  assert.deepEqual(allocate(3, { daily: 0, monthly: 3, subscription: 0, purchased: 0, promotion: 0 }), { daily: 0, monthly: 3, subscription: 0, purchased: 0, promotion: 0 });
  assert.equal(affordable(3, { daily: 1, monthly: 2 }), true);
  assert.equal(affordable(3, { daily: 1, monthly: 1 }), false);
});

test('the credit migration is additive, idempotent, and stores no credentials or model text', async () => {
  const { readFile, readdir } = await import('node:fs/promises');
  const files = (await readdir(new URL('../db/migrations/', import.meta.url))).filter(name => name.endsWith('.sql')).sort();
  assert.equal(files.at(-6), '007_ai_credits.sql', 'credits are the entitlement and operation schema migration');
  assert.equal(files.at(-5), '007_ai_operations.sql', 'the superseded migration id remains as a no-op for history compatibility');
  assert.equal(files.at(-4), '008_ai_operation_compat.sql', 'legacy operation metadata is preserved and mapped');
  assert.equal(files.at(-3), '009_admin_indexes.sql', 'admin adds query indexes after schema compatibility');
  assert.equal(files.at(-2), '010_email.sql', 'transactional email is the tenth, additive migration');
  assert.equal(files.at(-1), '011_billing.sql', 'billing tables are the eleventh, additive migration');
  const text = await readFile(new URL('../db/migrations/007_ai_credits.sql', import.meta.url), 'utf8');
  const sql = text.replace(/--.*$/gm, '');
  assert.match(sql, /CREATE TABLE IF NOT EXISTS user_entitlement \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS credit_ledger \(/);
  assert.match(sql, /CREATE TABLE IF NOT EXISTS ai_operation \(/);
  assert.match(sql, /plan text NOT NULL DEFAULT 'free' CHECK \(plan IN \('free', 'pro'\)\)/);
  assert.match(sql, /entry_type IN \('daily_grant', 'monthly_grant', 'ai_consumption', 'manual_adjustment', 'expiration'\)/);
  assert.match(sql, /bucket text CHECK \(bucket IS NULL OR bucket IN \('daily', 'monthly'\)\)/);
  assert.match(sql, /CHECK \(bucket IS NOT NULL\)/, 'every stored row belongs to a bucket');
  assert.match(sql, /credits integer NOT NULL CHECK \(credits <> 0\)/, 'a ledger row always moves at least one credit');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_grant_unique/, 'one grant per period');
  assert.match(sql, /CREATE UNIQUE INDEX IF NOT EXISTS credit_ledger_operation_unique[\s\S]*WHERE entry_type = 'ai_consumption'/, 'one charge per operation and bucket');
  assert.match(sql, /UNIQUE \(user_id, operation_key\)/, 'one usage row per operation key');
  assert.match(sql, /REFERENCES "user"\(id\) ON DELETE CASCADE/, 'credits are owned and cascade with the account');
  assert.doesNotMatch(sql, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im, 'the migration never deletes or rewrites rows');
  assert.match(sql, /RENAME TO ai_operation_legacy_phase12/, 'an incompatible historical table is archived, never dropped');
  assert.doesNotMatch(sql, /prompt|completion|message|content|token_count|api_key|credential/i, 'no prompt text, model output or credentials are stored');
  for (const statement of sql.match(/CREATE (TABLE|INDEX)[^;]*/g) ?? []) assert.match(statement, /IF NOT EXISTS/);
});

test('legacy AI-operation migration history is retained and its metadata is safely reconciled', async () => {
  const legacy = await readFile(new URL('../db/migrations/007_ai_operations.sql', import.meta.url), 'utf8');
  assert.match(legacy, /^SELECT 1;/m, 'fresh installs record the historical id without recreating the obsolete table');
  assert.doesNotMatch(legacy, /CREATE TABLE|CREATE INDEX|DROP TABLE/i);

  const compatibility = (await readFile(new URL('../db/migrations/008_ai_operation_compat.sql', import.meta.url), 'utf8')).replace(/--.*$/gm, '');
  assert.match(compatibility, /RENAME TO ai_operation_legacy_phase12/);
  assert.match(compatibility, /INSERT INTO ai_operation[\s\S]*FROM source/);
  assert.match(compatibility, /operation = 'form_edit_interpretation'/);
  assert.match(compatibility, /route = '\/api\/forms\/revise'/);
  assert.match(compatibility, /'legacy_' \|\| md5/);
  assert.match(compatibility, /credit_cost[\s\S]*0,/);
  assert.match(compatibility, /ON CONFLICT \(user_id, operation_key\) DO NOTHING/);
  assert.doesNotMatch(compatibility, /^\s*(DROP|TRUNCATE|DELETE|UPDATE)\b/im, 'historical telemetry is preserved');
  assert.doesNotMatch(compatibility, /prompt|request_body|password|access_token|refresh_token|ciphertext|api_key|client_secret/i);
});
