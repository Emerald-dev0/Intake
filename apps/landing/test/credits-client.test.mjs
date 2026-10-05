import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  billingStatusLabel, creditSummary, insufficientCreditsMessage, isInsufficientCredits, parseCreditCostGuide, parseCredits, parseOperationCost, resetInterval, resetLabel,
} from '../src/lib/credits.ts';

const balance = (overrides = {}) => {
  const plan = overrides.plan ?? 'free';
  const defaults = plan === 'pro'
    ? { plan, subscriptionStatus: 'active', availableCredits: 520, dailyRemaining: 20, dailyLimit: 20, monthlyRemaining: 500, monthlyLimit: 500 }
    : { plan, subscriptionStatus: 'none', availableCredits: 12, dailyRemaining: 12, dailyLimit: 20, monthlyRemaining: 0, monthlyLimit: 0 };
  const merged = { ...defaults, nextDailyReset: '2026-10-04T00:00:00.000Z', nextMonthlyReset: '2026-11-01T00:00:00.000Z', ...overrides };
  if (!Object.hasOwn(overrides, 'availableCredits')) merged.availableCredits = merged.dailyRemaining + merged.monthlyRemaining;
  return merged;
};
const guide = {
  formCreate: { min: 2, max: 5, standard: 2, complexMin: 3 },
  formEdit: { min: 1, max: 5, singleChange: 1, majorMin: 3 },
};
const NOW = new Date('2026-10-03T09:00:00Z');

test('only a complete server balance is accepted; anything else renders as unavailable', () => {
  assert.deepEqual(parseCredits({ credits: balance() }), balance());
  assert.deepEqual(parseCredits(balance()), balance(), 'an unwrapped body is accepted too');
  const rejected = [
    null, undefined, 'no', [], {}, { credits: {} },
    { credits: balance({ plan: 'enterprise' }) },
    { credits: balance({ dailyRemaining: 1.5 }) },
    { credits: balance({ dailyRemaining: -1 }) },
    { credits: balance({ monthlyRemaining: '3' }) },
    { credits: balance({ subscriptionStatus: 'trialing' }) },
    { credits: balance({ availableCredits: 999 }) },
    { credits: balance({ nextDailyReset: 'not-a-date' }) },
    { credits: { ...balance(), dailyRemaining: undefined } },
    { credits: balance({ plan: 'free', monthlyLimit: 3, monthlyRemaining: 0 }) },
  ];
  for (const value of rejected) assert.equal(parseCredits(value), null, `should reject ${JSON.stringify(value)}`);
  assert.deepEqual(Object.keys(parseCredits(balance())).sort(), [
    'availableCredits', 'dailyLimit', 'dailyRemaining', 'monthlyLimit', 'monthlyRemaining',
    'nextDailyReset', 'nextMonthlyReset', 'plan', 'subscriptionStatus',
  ]);
  assert.equal(isInsufficientCredits('insufficient_credits'), true);
  assert.equal(isInsufficientCredits('model_unavailable'), false);
  assert.equal(isInsufficientCredits(undefined), false);
});

test('server-generated credit guides and operation receipts are strictly parsed', () => {
  assert.deepEqual(parseCreditCostGuide({ costGuide: guide }), guide);
  assert.deepEqual(parseCreditCostGuide(guide), guide);
  assert.equal(parseCreditCostGuide({ formCreate: { min: 1, max: 99 }, formEdit: guide.formEdit }), null);
  assert.equal(parseCreditCostGuide({ ...guide, formEdit: { ...guide.formEdit, majorMin: 0 } }), null);
  assert.deepEqual(parseOperationCost({ operationCost: { credits: 2, status: 'charged' } }), { credits: 2, status: 'charged' });
  assert.deepEqual(parseOperationCost({ operationCost: { credits: 2, status: 'already_charged' } }), { credits: 2, status: 'already_charged' });
  assert.deepEqual(parseOperationCost({ operationCost: { credits: 0, status: 'not_charged' } }), { credits: 0, status: 'not_charged' });
  for (const value of [{ credits: 0, status: 'charged' }, { credits: 2, status: 'not_charged' }, { credits: 1, status: 'free' }]) {
    assert.equal(parseOperationCost(value), null);
  }
});

test('reset wording is derived from the server instant, and never counts down below zero', () => {
  assert.equal(resetLabel('2026-10-03T09:30:00.000Z', NOW), 'resets in under an hour');
  assert.equal(resetInterval('2026-10-03T09:30:00.000Z', NOW), 'in under an hour');
  assert.equal(resetLabel('2026-10-03T10:00:00.000Z', NOW), 'resets in 1 hour');
  assert.equal(resetLabel('2026-10-03T14:00:00.000Z', NOW), 'resets in 5 hours');
  assert.equal(resetLabel('2026-10-04T09:00:00.000Z', NOW), 'resets in 1 day');
  assert.equal(resetLabel('2026-10-06T09:00:00.000Z', NOW), 'resets in 3 days');
  assert.equal(resetLabel('2026-10-01T00:00:00.000Z', NOW), 'resets in under an hour');
  assert.equal(resetLabel('not-a-date', NOW), 'resets soon');
});

test('subscription status labels reflect server state rather than assuming a missing billing record', () => {
  assert.equal(billingStatusLabel('active'), 'Active');
  assert.equal(billingStatusLabel('past_due'), 'Past due');
  assert.equal(billingStatusLabel('canceled'), 'Canceled');
  assert.equal(billingStatusLabel('none'), 'Not connected');
});

test('the summary names each available bucket and its allowance', () => {
  assert.equal(creditSummary(balance()), '12 of 20 credits left today');
  assert.equal(creditSummary(balance({ dailyRemaining: 1 })), '1 of 20 credits left today');
  assert.equal(creditSummary(balance({ plan: 'pro' })), '20 of 20 daily · 500 of 500 monthly');
});

test('out-of-credits copy explains the state, both reset times and that nothing happened', () => {
  const free = insufficientCreditsMessage(balance({ dailyRemaining: 0, availableCredits: 0, nextDailyReset: '2026-10-03T14:00:00.000Z' }), NOW);
  assert.match(free, /used today's 20 free credits/);
  assert.match(free, /Daily credits reset in 5 hours/);
  assert.match(free, /Pro adds a 500-credit monthly reserve/);
  assert.match(free, /Nothing was created or changed/);
  assert.doesNotMatch(free, /not available|not implemented|coming soon/i, 'the workspace never apologises about the product');
  const pro = insufficientCreditsMessage(balance({ plan: 'pro', dailyRemaining: 0, monthlyRemaining: 0, availableCredits: 0, nextDailyReset: '2026-10-03T14:00:00.000Z' }), NOW);
  assert.match(pro, /20 daily credits and the 500-credit Pro monthly reserve/);
  assert.match(pro, /Daily credits reset in 5 hours/);
  assert.match(pro, /monthly credits reset in 28 days/);
  assert.match(insufficientCreditsMessage(null), /reset every day at 00:00 UTC/);
});
