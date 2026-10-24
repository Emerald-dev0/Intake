# Intake early-access wait-list

**There is no public wait-list page, and there must not be one.** `/auth/sign-up` is the public
action: the product is usable on the free plan today, so nobody queues to get in. The route, the
prerendered `waitlist.html` document, its stylesheet and its page component were removed; a test in
`test/deployment.test.mjs` fails if a shipped document mentions a wait-list again.

What remains is the machinery this document describes:

- `POST /api/waitlist` and the `waitlist` table, used by the **Pro "Notify me"** forms on `/pricing`
  and the marketing pricing card. Those collect interest in a plan that is not on sale yet; they do
  not gate the product.
- The `waitlist_welcome` email, the worker, and the operator view at `/admin/waitlist`.

It is storage and mail, **not** an authorization system: existing auth APIs and account permissions
are unchanged.

## What happens when someone asks to be notified

1. The browser posts **same-origin** JSON `{ email, website }` to `/api/waitlist`. No database module, provider client, sender, template, or credential is imported into the browser.
2. The API validates and normalizes the email, bounds the JSON body to 4 KiB, rejects cross-site browser submissions, and checks distributed rate limits. A filled `website` honeypot is silently dropped. Network buckets allow 200 attempts/10 minutes (shared NAT/proxy egress); recipient buckets allow 5/hour. Subjects are keyed-HMACed by the existing limiter, never stored as raw network/email values.
3. A parameterized PostgreSQL upsert saves one row per normalized address. Its `pending` welcome state is written **in that same insert**. Rejoining preserves the original id, signup time, and delivery state.
4. The API returns `{ status: 'joined' }` for new and repeat addresses alike. It does not reveal membership, email configuration, or delivery status. A database/limiter failure returns 503, never a fabricated success.
5. A server-side worker wakes after a join and polls every 30 seconds. It atomically claims due rows, sends at most three emails concurrently, and recovers expired five-minute leases after a process restart. The attempt number fences stale completions.
6. All sends use the normal `EmailService` → Calder adapter. The deterministic key is `intake:waitlist-welcome:waitlist:<entry UUID>`. Local acceptance records also prevent resend after the provider’s replay window expires. Retry attempts update the **original** delivery record, so webhooks can still correlate the message.

The welcome is sent immediately after the address is saved, **not held until launch**. The notification form says to look out for a note; nothing claims that saving an address proves mail was delivered.

## The email

- Type: `waitlist_welcome` (separate from account creation’s `welcome`).
- Subject: **You're on the Intake wait-list — a note from Daniel**.
- Default From and Reply-To: **daniel@intake.calder.click**.
- Approved plaintext: [`server/email/waitlist-welcome.ts`](server/email/waitlist-welcome.ts). It is Daniel’s supplied letter verbatim, including the signature and `https://intake.calder.click`.
- HTML: the same paragraphs in a restrained, email-client-safe letter layout. No account-security disclaimer, extra greeting, signup button, or markdown signature is added to the wait-list message.
- Calder dashboard template aliases cannot override this approved letter.
- A system `CALDER_REPLY_TO` does **not** override the personal reply address.

Calder’s API accepts a bare sending address or sender identity, not a `fromName` property. Set the display name on the verified sending identity in Calder if needed. Outbound sending does not itself create an inbound mailbox: make sure Daniel’s reply address actually receives mail.

## Before redeploying

### 1. Apply migrations

From `apps/landing`, with the intended database environment securely configured:

```bash
npm ci
# Existing deployments already have Better Auth tables. New installations need npm run db:migrate first.
npm run db:migrate:intake
npm run preflight -- --db
```

The migration runner must apply both `017_waitlist.sql` and **`018_waitlist_welcome.sql`** before the new API goes live. Readiness checks include the outbox columns, not just the old table. Preflight also checks the rest of the product; Google/AI credentials are not needed by the wait-list itself.

Migration 018 normalizes legacy addresses, merges case/whitespace duplicates while preserving the oldest signup/event id, and excludes the old `<uuid>_removed` tombstones from sending. Existing, nonremoved entries become pending welcomes. **Review historical entries before rollout** if you do not want those previously opted-in subscribers to receive a first welcome.

### 2. Check Render email settings (server-only)

| Setting | Value / requirement |
| --- | --- |
| `CALDER_API_KEY` | A live Calder key for production. A test key simulates delivery and never reaches a real inbox. |
| `CALDER_FROM_EMAIL` or `CALDER_SENDER_ID` | A verified system sending identity; required by the existing email runtime. |
| `CALDER_WELCOME_FROM_EMAIL` | `daniel@intake.calder.click`. **Replace the old `daniel@calder.click` dashboard override if present.** |
| `CALDER_WELCOME_FROM_NAME` | `Daniel from Intake` (the provider’s identity controls the displayed name). |
| `CALDER_WELCOME_REPLY_TO` | `daniel@intake.calder.click`, or leave unset to use the personal sender. Check any existing override. |
| `CALDER_WEBHOOK_SECRET` | The signing secret for the registered `/api/webhooks/calder` endpoint. |
| `BETTER_AUTH_URL` | The exact HTTPS frontend origin. |

Verify the **intake.calder.click sending domain** in Calder, including its required ownership, SPF, DKIM, and DMARC records. `configured=true` validates settings; it cannot prove domain readiness, an inbound mailbox, or actual inbox placement. None of these secrets belongs in a `VITE_*` variable.

Keep the existing Render commands: build **`npm ci`**, start **`npm start`**, Node **22.x**. The startup failure was caused by a server import of root-only development `playwright`; `/api/og` now serves the checked-in social card, with no browser package, binary, or frontend network request needed in production. New metadata uses the static `/og.png` asset on Vercel.

### 3. Redeploy Vercel

Build `npm run build` from `apps/landing`. Set `BACKEND_URL` to the real Render HTTPS origin and `VITE_SITE_URL=https://intake.calder.click` for this production domain. The wait-list has its own static metadata/no-script document, route rule, and sitemap entry. Existing sign-in remains reachable for operators.

## Delivery states and recovery

Verified, allowlisted administrators can inspect `/admin/waitlist`; there is no public read/list endpoint or browser-to-database admin helper. The page prominently shows **Total subscribers** across all pages, plus each address, signup time, and welcome status. Rejoining does not increase the count, and legacy removed entries are excluded. A failed or suppressed welcome does not by itself remove a saved subscriber. Use **Refresh** to fetch the latest total. The page is read-only and paginated.

| Welcome state | Meaning |
| --- | --- |
| `pending` | Saved and waiting, including retryable provider failures or absent configuration. |
| `sending` | Claimed by a worker; automatically recoverable after the lease expires. |
| `accepted` | Calder accepted/queued the business event, or an earlier acceptance was recovered locally. **Not proof of inbox delivery.** |
| `suppressed` | Known bounce/complaint/manual suppression, provider suppression, or a legacy removed row. Never automatically resent. |
| `blocked` | Permanent validation, sender-verification, authentication, quota, or template failure. Requires an operator to fix the cause. |

Transient failures back off from one minute to at most one hour; missing configuration is reconsidered after five minutes. Provider attempts are also bounded (three by default), and the timeout covers the response body as well as headers. Signups are not rolled back when email fails.

After fixing a permanent configuration problem, an operator may deliberately requeue **only blocked** entries on the database:

```sql
UPDATE waitlist
SET welcome_status = 'pending', welcome_next_attempt_at = now(), welcome_error_code = NULL
WHERE welcome_status = 'blocked';
```

Do not requeue accepted or suppressed rows, change event ids, or clear the delivery history to force resends. Calder’s signed `email.delivered`, bounce, and complaint webhooks update `email_delivery`; the admin Email page is the delivery source of truth.

List removal is currently human-operated: a subscriber replies to Daniel or emails him, and the operator fulfills the removal/deletion request. There is no automatic email-reply parser or bulk product-update sender in this change. Future update campaigns need their own consent/unsubscribe workflow.

## Verification

```bash
npm run build
npx tsx --test test/waitlist*.test.mjs test/admin-waitlist*.test.mjs \
  test/email-*.test.mjs test/production-start.test.mjs test/routes.test.mjs \
  test/deployment.test.mjs test/marketing-cta.test.mjs test/seo.test.mjs test/preflight.test.mjs
```

The wait-list tests execute the actual migration and store SQL on PGlite’s PostgreSQL engine, with a mocked Calder transport. They cover normalized/concurrent joins, exclusive and expired leases, stale finishes, exact HTML/plaintext copy and sender/reply-to, retries/restarts, canonical delivery tracking, missing configuration, suppression, signed delivery webhooks, public privacy, admin authorization, accessible UI states, and production startup without Playwright.

For **live** confirmation after deployment, use one consenting test address in the page, confirm one subscriber row and one `waitlist_welcome` delivery, wait for the signed `email.delivered` event, inspect the received text/From/Reply-To, and reply to verify Daniel receives it. Join that same address again to confirm no second welcome. Automated mocked acceptance is not a substitute for this inbox check.

The development preview in this session uses a temporary local database and **does not send real email**. No production environment variables or live inbox were available for verification.
