import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  creditSummary, insufficientCreditsMessage, isInsufficientCredits, parseCredits, resetInterval, resetLabel,
} from '../src/lib/credits.ts';

const balance = overrides => ({
  plan: 'free', dailyRemaining: 12, monthlyRemaining: 0,
  nextDailyReset: '2026-10-04T00:00:00.000Z', nextMonthlyReset: '2026-11-01T00:00:00.000Z', ...overrides,
});
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
    { credits: balance({ nextDailyReset: 'not-a-date' }) },
    { credits: { ...balance(), dailyRemaining: undefined } },
  ];
  for (const value of rejected) assert.equal(parseCredits(value), null, `should reject ${JSON.stringify(value)}`);
  // Never leak or invent internals the server did not send.
  assert.deepEqual(Object.keys(parseCredits(balance())).sort(),
    ['dailyRemaining', 'monthlyRemaining', 'nextDailyReset', 'nextMonthlyReset', 'plan']);
  assert.equal(isInsufficientCredits('insufficient_credits'), true);
  assert.equal(isInsufficientCredits('model_unavailable'), false);
  assert.equal(isInsufficientCredits(undefined), false);
});

test('reset wording is derived from the server instant, and never counts down below zero', () => {
  assert.equal(resetLabel('2026-10-03T09:30:00.000Z', NOW), 'resets in under an hour');
  assert.equal(resetInterval('2026-10-03T09:30:00.000Z', NOW), 'in under an hour');
  assert.equal(resetLabel('2026-10-03T10:00:00.000Z', NOW), 'resets in 1 hour');
  assert.equal(resetLabel('2026-10-03T14:00:00.000Z', NOW), 'resets in 5 hours');
  assert.equal(resetLabel('2026-10-04T09:00:00.000Z', NOW), 'resets in 1 day');
  assert.equal(resetLabel('2026-10-06T09:00:00.000Z', NOW), 'resets in 3 days');
  // A stale or skewed instant is clamped rather than shown as a negative countdown.
  assert.equal(resetLabel('2026-10-01T00:00:00.000Z', NOW), 'resets in under an hour');
  assert.equal(resetLabel('not-a-date', NOW), 'resets soon');
});

test('the summary names the bucket that actually pays for the next operation', () => {
  assert.equal(creditSummary(balance()), '12 AI credits remaining today');
  assert.equal(creditSummary(balance({ dailyRemaining: 1 })), '1 AI credit remaining today');
  assert.equal(creditSummary(balance({ plan: 'pro', dailyRemaining: 20, monthlyRemaining: 500 })),
    '20 daily credits · 500 monthly credits');
});

test('out-of-credits copy explains the state, the reset and that nothing happened', () => {
  const free = insufficientCreditsMessage(balance({ dailyRemaining: 0, monthlyRemaining: 0, nextDailyReset: '2026-10-03T14:00:00.000Z' }), NOW);
  assert.match(free, /used today's free AI credits/);
  assert.match(free, /Daily credits reset in 5 hours/);
  assert.match(free, /monthly reserve/);
  assert.match(free, /Nothing was created or changed/);
  const pro = insufficientCreditsMessage(balance({ plan: 'pro', dailyRemaining: 0, monthlyRemaining: 0, nextDailyReset: '2026-10-03T14:00:00.000Z' }), NOW);
  assert.match(pro, /daily allowance and the monthly reserve/);
  assert.match(pro, /Daily credits reset in 5 hours/);
  // An unreadable balance is honest rather than specific.
  assert.match(insufficientCreditsMessage(null), /reset every day at 00:00 UTC/);
});
