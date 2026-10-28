/**
 * Asks the provider what happened to mail it accepted but never finished reporting on.
 *
 *   npm run email:reconcile           # show and apply
 *   npm run email:reconcile -- --dry  # show only
 *
 * Run it after a provider incident, or on a schedule if webhooks are not configured. Safe to run at
 * any time: it only moves rows that are still open, and it never overwrites a settled delivery.
 */
import 'dotenv/config';
import { createEmailRuntime } from '../server/email/runtime';
import { reconcileDeliveries } from '../server/email/reconcile';
import type { StatusFailure } from '../server/email/providers/calder';
import { pool } from '../server/auth';

const dry = process.argv.includes('--dry');

/**
 * "Provider silent 54" is a true statement and a useless one: a revoked key, another project's id and
 * a deleted message are the same null. Record why, so the advice can be specific.
 */
const failures: StatusFailure[] = [];
const runtime = createEmailRuntime({
  pool,
  secret: process.env.BETTER_AUTH_SECRET ?? '',
  mode: 'live',
  onStatusFailure: failure => failures.push(failure),
});

if (!runtime.emails.configured) {
  console.error('\n  ✗ Email is not configured, so there is nothing to reconcile.\n');
  await pool.end();
  process.exit(1);
}

const result = await reconcileDeliveries({
  query: async (sql, params) => pool.query(sql, params as unknown[]) as never,
  status: providerMessageId => runtime.emails.status(providerMessageId),
}, 200);

console.log(`\n  checked ${result.checked} · updated ${result.updated} · unchanged ${result.unchanged} · unknown ${result.unknown} · provider silent ${result.unreachable}`);
for (const change of result.changes) {
  console.log(`    ${change.emailType.padEnd(30)} ${change.from} → ${change.to}`);
}
if (dry && result.updated > 0) {
  console.log('\n  Note: --dry is accepted for symmetry, but reconciliation only reads provider state and');
  console.log('  writes what the provider said. There is nothing to undo.\n');
}
if (result.unreachable > 0) {
  console.log('\n  ! The provider could not answer for some messages. Those rows stay open rather than');
  console.log('    being guessed at. Why, by count:');
  const grouped = new Map<string, number>();
  for (const failure of failures) {
    const key = failure.httpStatus ? `${failure.reason} (HTTP ${failure.httpStatus})` : failure.reason;
    grouped.set(key, (grouped.get(key) ?? 0) + 1);
  }
  for (const [reason, count] of [...grouped].sort((a, b) => b[1] - a[1])) {
    console.log(`      ${String(count).padStart(4)}  ${reason}`);
  }
  const codes = new Set(failures.map(failure => failure.httpStatus));
  if (codes.has(401) || codes.has(403)) {
    console.log('\n    HTTP 401/403: this CALDER_API_KEY is rejected. Check the key itself, not the messages.');
  }
  if (codes.has(404)) {
    console.log('\n    HTTP 404: the key is valid but owns none of these messages. Calder scopes reads to the');
    console.log('    key\'s own project, so a key from a different project answers 404 for every id.');
  }
  if (codes.has(429)) {
    console.log('\n    HTTP 429: rate limited. Re-run with fewer rows (limit in reconcile.ts) and try again.');
  }
  if (failures.every(failure => failure.reason === 'request_failed' && !failure.httpStatus)) {
    console.log('\n    No response at all: CALDER_BASE_URL is wrong or the host is unreachable from here.');
  }
}
console.log('');
await pool.end();
