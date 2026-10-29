/**
 * Sends one launch letter to the wait-list, once.
 *
 *   npm run launch:mail -- --campaign=launch_announcement            # dry run, prints what would go
 *   npm run launch:mail -- --campaign=launch_announcement --send     # actually sends
 *   npm run launch:mail -- --campaign=launch_note --send --limit=5   # first five, to check by eye
 *
 * Why a script and not a button: it runs under an operator's own shell, prints the exact recipient
 * count before anything leaves, and every send is idempotent through `waitlist_launch_send` — running
 * it twice does not put a second copy in anybody's inbox. A dry run is the default, because the
 * failure mode that actually happens is sending a launch twice, not forgetting to send it.
 *
 * The letter is a real address change, so this refuses to start when the mail provider is not
 * configured: a half-configured run would mark rows as sent without anything having been delivered.
 */
import 'dotenv/config';
import { createEmailRuntime } from '../server/email/runtime';
import { createPostgresLaunchStore, unsubscribeUrl, LAUNCH_CAMPAIGNS, type LaunchCampaign } from '../server/waitlist/launch';
import { pool } from '../server/auth';

function argument(name: string): string | null {
  const prefix = `--${name}=`;
  const found = process.argv.find(value => value.startsWith(prefix));
  return found ? found.slice(prefix.length) : null;
}

function fail(message: string): never {
  console.error(`\n  ✗ ${message}\n`);
  process.exit(1);
}

const campaignArgument = argument('campaign');
if (!campaignArgument || !LAUNCH_CAMPAIGNS.includes(campaignArgument as LaunchCampaign)) {
  fail(`--campaign must be one of: ${LAUNCH_CAMPAIGNS.join(', ')}`);
}
const campaign = campaignArgument as LaunchCampaign;
const sending = process.argv.includes('--send');
const limit = Number(argument('limit') ?? '200');

const runtime = createEmailRuntime({ pool, secret: process.env.BETTER_AUTH_SECRET ?? '', mode: 'live' });
const { config, emails } = runtime;
const store = createPostgresLaunchStore(pool);

if (!emails.configured) {
  fail('The email provider is not configured (EMAIL_PROVIDER / CALDER_API_KEY / CALDER_FROM_EMAIL). Nothing was sent.');
}

const total = await store.countPending(campaign);
const dryRunLabel = sending ? 'SEND' : 'DRY RUN';
console.log(`\n  Intake launch mail · ${campaign} · ${dryRunLabel}`);
console.log(`  from:     ${campaign === 'launch_note' ? config.welcomeFromName : config.announcementFromName} <${campaign === 'launch_note' ? config.welcomeFromEmail : config.announcementFromEmail}>`);
console.log(`  reply-to: ${config.welcomeReplyTo ?? config.replyTo ?? '(none)'}`);
console.log(`  waiting:  ${total} recipient${total === 1 ? '' : 's'}\n`);

if (total === 0) {
  console.log('  Nothing to do. Every subscriber has already had this letter.\n');
  process.exit(0);
}

if (!sending) {
  const preview = await store.pending(campaign, limit);
  for (const recipient of preview.slice(0, 10)) {
    const masked = recipient.email.replace(/^(.).*?(@.*)$/, '$1***$2');
    console.log(`    ${masked}  ${unsubscribeUrl(config.appOrigin, recipient.id, process.env.BETTER_AUTH_SECRET ?? '')}`);
  }
  if (preview.length > 10) console.log(`    … and ${preview.length - 10} more`);
  console.log(`\n  Nothing was sent. Re-run with --send to deliver to ${Math.min(total, limit)} of ${total}.\n`);
  await pool.end();
  process.exit(0);
}

let sent = 0;
let failed = 0;
let offset = 0;

// One page at a time, re-querying after each page: a send marks the row, so the next query
// naturally skips it. This keeps memory flat and makes a crash mid-run resumable.
while (offset === 0 || sent + failed > 0) {
  const batch = await store.pending(campaign, Math.min(limit, 25));
  if (batch.length === 0) break;
  for (const recipient of batch) {
    try {
      const outcome = await emails.send({
        type: campaign,
        to: recipient.email,
        // Deterministic per recipient and campaign: the email service dedupes on this key, so a
        // retry after a network failure cannot become a second email.
        eventId: `waitlist:${campaign}:${recipient.id}`,
        variables: {
          marketingUrl: config.marketingOrigin,
          unsubscribeUrl: unsubscribeUrl(config.appOrigin, recipient.id, process.env.BETTER_AUTH_SECRET ?? ''),
        },
      });
      if (outcome.status === 'sent' || (outcome.status === 'skipped' && outcome.reason === 'duplicate')) {
        await store.record(recipient, campaign, 'deliveryId' in outcome ? outcome.deliveryId : null, 'accepted');
        sent += 1;
      } else {
        await store.record(recipient, campaign, 'deliveryId' in outcome ? outcome.deliveryId : null, 'failed');
        failed += 1;
        const reason = 'reason' in outcome ? outcome.reason : 'errorCode' in outcome ? outcome.errorCode : 'unknown';
        console.error(`  ✗ ${recipient.email}: ${reason}`);
      }
    } catch (error) {
      failed += 1;
      console.error(`  ✗ ${recipient.email}: ${error instanceof Error ? error.message : 'unknown error'}`);
    }
    // A short gap keeps us well inside any provider's per-second limit and lets a Ctrl-C land
    // between messages rather than in the middle of one.
    await new Promise(resolve => setTimeout(resolve, 120));
  }
  offset += batch.length;
  if (process.env.LAUNCH_MAIL_PAUSE) break;
}

console.log(`\n  sent ${sent} · failed ${failed} · ${Math.max(0, total - sent)} still pending\n`);
await pool.end();
process.exit(failed > 0 ? 1 : 0);
