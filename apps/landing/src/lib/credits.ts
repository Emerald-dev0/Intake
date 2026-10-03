/**
 * Public AI-credit contract.
 *
 * The browser only ever learns what it can act on: the plan, what is left in each bucket, and when
 * each bucket resets. Token counts, prices and ledger rows stay server-side.
 */

export interface PublicCredits {
  plan: 'free' | 'pro';
  dailyRemaining: number;
  monthlyRemaining: number;
  nextDailyReset: string;
  nextMonthlyReset: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function count(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 1_000_000 ? value : null;
}

function instant(value: unknown): string | null {
  return typeof value === 'string' && value.length <= 40 && !Number.isNaN(Date.parse(value)) ? value : null;
}

/** Fail closed: an unreadable balance is never rendered as a number the user might trust. */
export function parseCredits(value: unknown): PublicCredits | null {
  const row = record(record(value)?.credits) ?? record(value);
  if (!row) return null;
  const plan = row.plan === 'pro' ? 'pro' : row.plan === 'free' ? 'free' : null;
  const daily = count(row.dailyRemaining);
  const monthly = count(row.monthlyRemaining);
  const nextDaily = instant(row.nextDailyReset);
  const nextMonthly = instant(row.nextMonthlyReset);
  if (!plan || daily === null || monthly === null || !nextDaily || !nextMonthly) return null;
  return { plan, dailyRemaining: daily, monthlyRemaining: monthly, nextDailyReset: nextDaily, nextMonthlyReset: nextMonthly };
}

export function creditSummary(credits: PublicCredits): string {
  if (credits.plan === 'pro') return `${credits.dailyRemaining} daily credits · ${credits.monthlyRemaining} monthly credits`;
  return `${credits.dailyRemaining} AI credit${credits.dailyRemaining === 1 ? '' : 's'} remaining today`;
}

/**
 * Human wording for the next reset, computed from the server's instant (never the browser clock).
 * The count is floored so Intake never promises credits later than they actually arrive.
 */
export function resetInterval(iso: string, now: Date = new Date()): string {
  const at = Date.parse(iso);
  if (Number.isNaN(at)) return 'soon';
  const hours = Math.max(0, Math.floor((at - now.getTime()) / 3_600_000));
  if (hours < 1) return 'in under an hour';
  if (hours < 24) return `in ${hours} hour${hours === 1 ? '' : 's'}`;
  const days = Math.floor(hours / 24);
  return `in ${days} day${days === 1 ? '' : 's'}`;
}

export function resetLabel(iso: string, now: Date = new Date()): string {
  return `resets ${resetInterval(iso, now)}`;
}

/** `insufficient_credits` is a product state, not an error the user caused. */
export function isInsufficientCredits(code: string | undefined): boolean {
  return code === 'insufficient_credits';
}

/**
 * What to say when an operation cannot be started because nothing is left. It names the state and,
 * when the balance is readable, when the next daily allowance arrives (the server's instant, never
 * the browser clock).
 */
export function insufficientCreditsMessage(credits: PublicCredits | null, now: Date = new Date()): string {
  if (!credits) {
    return 'You have used every AI credit available right now. Daily credits reset every day at 00:00 UTC. Nothing was created or changed.';
  }
  const reset = resetInterval(credits.nextDailyReset, now);
  return credits.plan === 'pro'
    ? `You have used all of your AI credits — the daily allowance and the monthly reserve. Daily credits reset ${reset}. Nothing was created or changed.`
    : `You have used today's free AI credits. Daily credits reset ${reset}; Pro adds a 500-credit monthly reserve. Nothing was created or changed.`;
}
