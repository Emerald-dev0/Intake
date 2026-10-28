/**
 * Why is Intake's mail not arriving?
 *
 *   npm run email:doctor            # configuration, DNS, and the last two weeks of deliveries
 *   npm run email:doctor -- --days=30
 *
 * Everything this prints is either read from the environment, asked of DNS, or counted from Intake's
 * own `email_delivery` table. It does not guess, and it cannot see inside the mail provider: when the
 * provider accepted a message and failed it later, that is the provider's transport and this script
 * says so instead of blaming Intake's code.
 *
 * Read it top to bottom. The first failing section is the one to fix.
 */
import 'dotenv/config';
import { resolveMx, resolveTxt } from 'node:dns/promises';
import { readEmailConfig } from '../server/email/config';
import { pool } from '../server/auth';

const days = Number(process.argv.find(value => value.startsWith('--days='))?.slice('--days='.length) ?? '14');

function line(label: string, value: string, ok: 'pass' | 'warn' | 'fail' | 'info' = 'info') {
  const mark = { pass: '✓', warn: '!', fail: '✗', info: '·' }[ok];
  console.log(`  ${mark} ${label.padEnd(26)} ${value}`);
}

function section(title: string) {
  console.log(`\n${title}`);
}

let failures = 0;

section('Configuration');
let config;
try {
  config = readEmailConfig(process.env);
} catch (error) {
  console.log(`  ✗ ${error instanceof Error ? error.message : 'Email configuration is invalid.'}`);
  process.exit(1);
}

line('provider', config.provider, config.provider === 'calder' ? 'pass' : 'warn');
line('usable', config.configured ? 'yes' : 'no — nothing can be sent', config.configured ? 'pass' : (failures++, 'fail'));
line('API key', config.apiKey ? `${config.apiKey.slice(0, 12)}… (${config.apiKey.length} chars)` : 'missing', config.apiKey ? 'pass' : 'fail');
line('system sender', config.fromEmail || '(sender id only)', config.fromEmail || config.senderId ? 'pass' : 'fail');
line('personal sender', config.welcomeFromEmail, 'info');
line('announcement sender', config.announcementFromEmail || '(falls back to system sender)', 'info');
line('reply-to', config.welcomeReplyTo ?? config.replyTo ?? '(none)', 'info');
line('webhook secret', config.webhookSecret ? 'set' : 'missing — delivery failures are invisible without it', config.webhookSecret ? 'pass' : 'warn');
line('X row', config.xUrl ?? '(unset — no social row)', config.xUrl ? 'pass' : 'warn');
line('logo origin', `${config.assetBaseUrl}/brand/intake-mark.png`, 'info');

// The mark is fetched by the recipient's client, not by us, so a broken URL fails silently in every
// inbox at once. Ask the origin directly; a 200 is not proof the client will show it, but a 404 is
// proof it will not.
try {
  const response = await fetch(`${config.assetBaseUrl.replace(/\/$/, '')}/brand/intake-mark.png`, { method: 'HEAD' });
  line('logo reachable', `${response.status} ${response.headers.get('content-type') ?? ''}`.trim(), response.ok ? 'pass' : 'fail');
  if (!response.ok) failures += 1;
} catch {
  line('logo reachable', 'could not be fetched from this machine', 'warn');
}

const domain = (config.fromEmail || config.welcomeFromEmail).split('@')[1];
if (domain) {
  section(`DNS for ${domain}`);
  const txt = async (name: string) => {
    try { return (await resolveTxt(name)).map(parts => parts.join('')); } catch { return []; }
  };

  const spf = (await txt(domain)).filter(record => record.startsWith('v=spf1'));
  line('SPF', spf[0] ?? 'none published — Gmail and Outlook will distrust this domain', spf.length ? 'pass' : 'fail');
  if (!spf.length) failures += 1;
  if (spf.length > 1) line('SPF duplicates', `${spf.length} records — receivers treat multiple SPF records as a permanent error`, 'fail');

  const dmarc = (await txt(`_dmarc.${domain}`)).filter(record => record.startsWith('v=DMARC1'));
  line('DMARC', dmarc[0] ?? 'none published', dmarc.length ? 'pass' : 'warn');

  // DKIM selectors are provider-chosen, so these are the common ones rather than a guarantee.
  const selectors = ['calder', 's1', 'ses', 'k1', 'mail', 'default'];
  const found: string[] = [];
  for (const selector of selectors) {
    const records = await txt(`${selector}._domainkey.${domain}`);
    if (records.some(record => record.includes('p='))) found.push(selector);
  }
  line('DKIM selector', found.length ? found.join(', ') : `none found at ${selectors.join(', ')} — check the provider dashboard`, found.length ? 'pass' : 'warn');

  try {
    const mx = await resolveMx(domain);
    if (mx.length) line('MX', `${mx.length} record(s) — the domain can also receive replies`, 'pass');
  } catch { line('MX', 'no mail exchanger — replies to this domain will bounce', 'warn'); }
}

section(`Deliveries, last ${days} days`);
const since = new Date(Date.now() - days * 86_400_000);
const rows = await pool.query<{ status: string; count: string }>(
  'SELECT status, count(*)::text AS count FROM email_delivery WHERE created_at >= $1 GROUP BY status ORDER BY count(*) DESC',
  [since],
);
if (rows.rows.length === 0) {
  console.log('  · No deliveries recorded in this window.');
} else {
  for (const row of rows.rows) {
    const settled = ['delivered', 'sent'].includes(row.status);
    line(row.status, `${row.count}`, settled ? 'pass' : ['failed', 'failed_remote', 'bounced', 'complained'].includes(row.status) ? 'fail' : 'warn');
  }
}

const failures_ = await pool.query<{ email_type: string; recipient: string; provider_message_id: string | null; created_at: Date }>(
  `SELECT email_type, recipient, provider_message_id, created_at FROM email_delivery
    WHERE created_at >= $1 AND status IN ('failed', 'failed_remote', 'bounced', 'complained')
    ORDER BY created_at DESC LIMIT 15`,
  [since],
);
if (failures_.rows.length) {
  console.log('\n  Recent failures (provider message ids are what you search for in the provider dashboard):');
  for (const row of failures_.rows) {
    const masked = row.recipient.replace(/^(.).*?(@.*)$/, '$1***$2');
    console.log(`    ${row.created_at.toISOString().slice(0, 16).replace('T', ' ')}  ${row.email_type.padEnd(28)} ${masked.padEnd(28)} ${row.provider_message_id ?? '(no id — never accepted)'}`);
  }
}

const stuck = await pool.query<{ count: string }>(
  `SELECT count(*)::text AS count FROM email_delivery
    WHERE status IN ('accepted', 'queued', 'sent') AND created_at < now() - interval '10 minutes'`,
);
const stuckCount = Number(stuck.rows[0]?.count ?? 0);
if (stuckCount > 0) {
  console.log(`\n  ! ${stuckCount} delivery(ies) are still open after ten minutes. The provider accepted them and`);
  console.log('    never reported back. Run: npm run email:reconcile');
}

console.log(`\n${failures === 0 ? '  Configuration looks sendable.' : `  ${failures} configuration problem(s) above must be fixed first.`}`);
console.log('  This cannot see inside the provider: a message it accepted and failed later is theirs to explain.');
await pool.end();
process.exit(failures === 0 ? 0 : 1);
