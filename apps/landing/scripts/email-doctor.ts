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
import { configuredSenders, senderGaps, type RegisteredSender } from '../server/email/senders';
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

// Sender identities are the one part of this pipeline where being wrong is silent: Calder resolves a
// bare `from` address to an identity, and when there is none it sends the message unattributed rather
// than refusing it. The result is mail that looks sent, a sender count that does not include it, and
// a display name the recipient sees that nobody in this repo ever typed.
const configured = configuredSenders(config);
if (config.provider === 'calder' && config.apiKey) {
  section('Senders in Calder');
  type SenderRow = { email?: unknown; display_name?: unknown; status?: unknown };
  let registered: RegisteredSender[] = [];
  let listed = false;
  try {
    const response = await fetch(`${config.baseUrl.replace(/\/$/, '')}/v1/senders?limit=50`, {
      headers: { authorization: `Bearer ${config.apiKey}`, 'user-agent': 'intake-email-doctor' },
      signal: AbortSignal.timeout(8_000),
    });
    if (!response.ok) throw new Error(`${response.status} ${response.statusText}`);
    const body = (await response.json()) as { data?: SenderRow[] };
    registered = (Array.isArray(body.data) ? body.data : [])
      .filter((row): row is SenderRow & { email: string } => typeof row.email === 'string')
      .map(row => ({
        email: row.email,
        displayName: typeof row.display_name === 'string' ? row.display_name : null,
        status: typeof row.status === 'string' ? row.status : 'unknown',
      }));
    listed = true;
  } catch (error) {
    line('sender list', `could not be read (${error instanceof Error ? error.message : 'unknown error'})`, 'warn');
  }

  if (listed) {
    const gaps = senderGaps(configured, registered);
    const seen = new Set<string>();
    for (const sender of configured) {
      const email = sender.email.trim().toLowerCase();
      if (!email || seen.has(email)) continue;
      seen.add(email);
      const gap = gaps.find(entry => entry.role === sender.role && entry.email === email);
      if (!gap) {
        line(`${sender.role} sender`, `${email} — "${sender.name}"`, 'pass');
      } else if (gap.kind === 'unregistered') {
        line(`${sender.role} sender`, `${email} — not registered`, 'fail');
        console.log('      Calder accepts an address it does not know and sends it unattributed: the');
        console.log('      recipient sees no Intake name, and the send is missing from every sender count.');
        failures += 1;
      } else if (gap.kind === 'not-ready') {
        line(`${sender.role} sender`, `${email} is ${gap.status}`, 'fail');
        console.log('      Sends from it fail with sender_not_ready, before any provider call.');
        failures += 1;
      } else {
        line(`${sender.role} sender`, `${email}`, 'pass');
        line('  display name', `Calder shows "${gap.providerName}", not "${gap.configuredName}"`, 'warn');
      }
    }
  }
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

// One question the delivery table cannot answer: has the provider ever called us back? A deployment
// with a registered endpoint and zero rows here looks exactly like a deployment where nothing has
// been delivered, and the difference decides whether you fix a secret or a mail server.
section('Provider events (webhooks)');
const webhookRows = await pool.query<{ event_type: string; count: string; last: Date }>(
  `SELECT event_type, count(*)::text AS count, max(received_at) AS last
     FROM email_webhook_event GROUP BY event_type ORDER BY count(*) DESC`,
);
const attempted = Number(
  (await pool.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM email_delivery
      WHERE created_at >= $1 AND status IN ('accepted', 'queued', 'sent', 'delivered', 'bounced', 'complained')`,
    [since],
  )).rows[0]?.count ?? 0,
);
if (webhookRows.rows.length === 0) {
  if (attempted > 0) {
    line('provider events', `none received, ${attempted} delivery row(s) in the window`, (failures++, 'fail'));
    console.log('      The provider has never called this deployment back, so delivery, bounce and');
    console.log('      complaint state are unknown — not zero. Check CALDER_WEBHOOK_SECRET, the');
    console.log('      endpoint registered in Calder, and whether their dispatcher is running at all.');
  } else {
    line('provider events', 'none received — and nothing was sent in this window', 'info');
  }
} else {
  const truthful = new Set(['email.delivered', 'email.bounced', 'email.complained', 'email.failed']);
  for (const row of webhookRows.rows) {
    const when = new Date(row.last).toISOString().slice(0, 16).replace('T', ' ');
    line(row.event_type, `${row.count} · last ${when}`, truthful.has(row.event_type) ? 'pass' : 'info');
  }
  if (webhookRows.rows.every(row => !truthful.has(row.event_type))) {
    line('delivery truth', 'queued/sent only — no delivered, bounced or failed event has ever arrived', 'warn');
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
