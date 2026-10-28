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
import { pool } from '../server/auth';

const dry = process.argv.includes('--dry');
const runtime = createEmailRuntime({ pool, secret: process.env.BETTER_AUTH_SECRET ?? '', mode: 'live' });

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
  console.log('\n  ! The provider could not answer for some messages. Either the API key cannot read them or');
  console.log('    they were deleted provider-side. Those rows stay open rather than being guessed at.');
}
console.log('');
await pool.end();
