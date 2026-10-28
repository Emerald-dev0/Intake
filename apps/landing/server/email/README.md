# Intake transactional email

The early-access `waitlist_welcome` flow is documented in [WAITLIST.md](../../WAITLIST.md), including Daniel’s approved copy, durable retries, sender configuration, and the live delivery checklist.

Calder is Intake's email provider. **This directory is the only place in Intake that knows that.**

```
Application code ──▶ EmailNotifier / OtpService
                          │
                          ▼
                     EmailService          (idempotency, suppression, records, taxonomy)
                          │
                          ▼
                     EmailProvider         (an interface: send, status, id)
                          │
                          ▼
                   CalderEmailProvider     (HTTP, auth headers, retries, error mapping)
                          │
                          ▼
                     Calder API            (POST /v1/emails, GET /v1/emails/:id, webhooks)
```

There is no `sendCalderEmail()` anywhere else in the codebase. A route, a provider callback or a
credit charge calls the notifier or the OTP service; those call `EmailService`; the service calls an
`EmailProvider`. Swapping the provider is one file and one env var.

Calder delivers. **Intake owns every decision**: who is allowed to receive a message, whether a code
is correct, how many attempts are left, when a token dies, what the email says, and what happens when
delivery fails.

---

Composed mail (a note an operator writes in `/admin/mail` and sends to selected accounts, one message
each) is documented in [docs/MAIL.md](../../docs/MAIL.md). It uses this same stack: the `admin_message`
template, the normal suppression check, one `email_delivery` row per recipient, and the `campaign`
stream.

## 1. The files

| File | Responsibility |
| --- | --- |
| `index.ts` | Public surface. Import from here, never from a sibling module. |
| `config.ts` | `readEmailConfig(env)`: every `CALDER_*` variable, validated once, never logged. |
| `types.ts` | `EmailMessage`, `EmailProvider`, `EmailStore`, `EmailErrorCode`, `EmailType`, `maskEmail`. |
| `errors.ts` | `EmailError` + the failure taxonomy. The only error type allowed across the provider seam. |
| `service.ts` | `EmailService`: validation → suppression → idempotency → provider → record. |
| `providers/calder.ts` | The Calder adapter: auth header, `Idempotency-Key`, timeout, bounded retries, error mapping. |
| `templates.ts` | HTML + plaintext for every email, in Intake's voice and palette. |
| `otp.ts` | One-time codes: generation, HMAC proof, TTL, attempts, resend cooldown, send cap. |
| `store.ts` | `EmailStore`: deliveries, suppressions, webhook ids (`email_delivery`, `email_suppression`, `email_webhook_event`). |
| `webhooks.ts` | `POST /api/webhooks/calder`: signature verification, replay protection, bounce/complaint suppression. |
| `notifications.ts` | The event catalogue (welcome, security, provider, low credits). |
| `routes.ts` | `/api/account/email/*`: verification, email change, password reset. Server-authorised. |
| `runtime.ts` | Wires the stack for one process (`live` → Postgres, `test` → memory). |
| `bridge.ts` | The one-way seam into Better Auth, so `server/auth.ts` never imports this runtime. |
| `logging.ts` | Structured logging that redacts secrets and masks addresses by construction. |

---

## 2. The provider seam

```ts
interface EmailProvider {
  readonly id: 'calder' | 'memory';
  send(message: EmailMessage): Promise<ProviderSendResult>;
  status(providerMessageId: string): Promise<EmailStatusSnapshot | null>;
}
```

`createCalderProvider({ config })` is the production implementation.
`createMemoryEmailProvider()` is a test double that records what *would* have been sent and can be
told to fail with a typed `EmailError`.

### Calder contract (verified against the Calder repository)

- `POST {CALDER_BASE_URL}/v1/emails`
- `Authorization: Bearer {CALDER_API_KEY}`, `Idempotency-Key: {intake:…}`
- Body: `{ from, to, subject, html, text, stream: 'transactional', reply_to?, tags?, metadata?, template?, variables? }`
- `GET /v1/emails/:id` → `{ data: { … } }`; Intake unwraps the envelope for `status()`.

Intake sends on `transactional` (verification, resets, security, receipts) and `campaign` (a note an
operator composed in the admin dashboard and sent to selected accounts, one message each). `from` is a `sender_…` id when
`CALDER_SENDER_ID` is set, otherwise `CALDER_FROM_EMAIL`.

### Timeouts and retries

- One attempt gets `EMAIL_TIMEOUT_MS` (default **10 000 ms**) via `AbortSignal.timeout`.
- `EMAIL_MAX_ATTEMPTS` (default **3**, hard-bounded 1–5) is the *total* number of attempts.
- Retries happen **only** for `429`, `5xx`, a timeout/abort, or `idempotency_conflict` — never for
  `400/401/403/404/422`.
- Backoff is exponential with jitter, and a `Retry-After` header wins when Calder sends one.
- A permanent failure returns immediately; nothing retries into a black hole.

### Error mapping (`providers/calder.ts`)

Calder's machine-readable `code` is consulted **before** the HTTP status, because the status alone
lies: `403 domain_not_verified` is not an auth problem and `429 plan_limit_reached` is not
throttling you can wait out.

| Calder `code` | Intake `EmailErrorCode` | Retryable |
| --- | --- | --- |
| `organization_sending_unavailable` | `email_provider_unavailable` | yes |
| `plan_limit_reached` | `email_quota_exceeded` | no |
| `domain_not_verified`, `sender_not_ready` | `email_sender_not_verified` | no |
| `suppressed` | `email_suppressed` | no |
| `idempotency_conflict`, `conflict` | `email_idempotency_conflict` | yes |
| `authentication_error`, `authorization_error` | `email_provider_authentication_failed` | no |
| `rate_limit_error` | `email_provider_rate_limited` | yes |
| `validation_error` (recipient) | `email_invalid_recipient` | no |
| `validation_error` (other) | `email_validation_error` | no |
| `not_found` | `email_template_error` | no |

Status fallbacks when no code is present: `409` → idempotency conflict, `422` → validation,
`404` → template, `429` → rate limited, `400` → validation, `401/403` → authentication failed,
`>=500` → unavailable (retryable).

---

## 3. Idempotency

Every send carries a **deterministic** key derived from a business event, not from a random id:

```
intake:{type}:{eventId}
```

- OTP:            `intake:otp:{challengeId}` (or `{eventId}` when the caller supplies one)
- Password reset: `intake:password-reset:{sha256(token)}`
- Welcome:        `intake:welcome:{userId}`
- Wait-list:      `intake:waitlist-welcome:waitlist:{entryId}`
- Low credits:    `intake:credits-low:{userId}:{utc-day}`
- Security:       `intake:security-*:{eventId}`

A retry, a double-click or a duplicated hook therefore replays an accepted local delivery record
(or Calder’s stored response while a send is still uncertain) instead of sending twice. The delivery is also recorded locally *before* the request goes out, so a crash
mid-send leaves a `pending` delivery record rather than a mystery. Retry attempts retain the canonical record id so provider webhooks still find the event. OTP subjects are stored without their plaintext code.

---

## 4. One-time codes (`otp.ts`)

| Rule | Value |
| --- | --- |
| Length | 6 digits, `crypto.randomInt`, no modulo bias |
| TTL | 10 minutes (`OTP_TTL_SECONDS`) |
| Attempts | 5 (`OTP_MAX_ATTEMPTS`), then the challenge is destroyed |
| Resend cooldown | 60 s (`OTP_RESEND_COOLDOWN_SECONDS`) |
| Send cap | 5/hour (`OTP_MAX_SENDS_PER_HOUR`) |
| Storage | HMAC-SHA256 of the code, keyed with `BETTER_AUTH_SECRET`. The plaintext code exists only inside the rendered email. |

`start()` → `sent | cooldown | send_limit | delivery_failed`
`verify()` → `verified | invalid | locked | expired | missing`

Purposes (`verify_email`, `email_change`, `sign_in`) are **separate namespaces**: a code issued to
change an address cannot verify an account. A successful verify destroys the challenge before the
caller is told it worked, so a replay resolves to `missing`.

The PostgreSQL store keeps codes in Better Auth's own `verification` table with the identifier
`intake-otp:{purpose}:{userId}`. An expired row is deleted on read but still returned, so the user is
told *expired* rather than *no such code* — a distinction that only the service can make.

---

## 5. Webhooks

`POST /api/webhooks/calder`, mounted **before** any JSON body parser, because the HMAC covers raw
bytes.

- Header: `webhook-signature: t={unix seconds},v1={hex hmac-sha256}`
- `v1 = HMAC-SHA256(secret, "{t}.{rawBody}")`, compared with `timingSafeEqual`
- Tolerance: ±300 s (`SIGNATURE_TOLERANCE_SECONDS`)
- Payloads over 64 KiB are refused with `413` before anything is parsed
- Every event id is recorded once (`email_webhook_event`); a replay answers `200 {duplicate:true}` so
  Calder stops retrying
- A hard bounce (`bounceType: 'Permanent'`) or a complaint suppresses the address; a **transient**
  bounce does not — Calder's own consumer treats soft bounces as retryable, and suppressing them
  would punish greylisting and full mailboxes
- Terminal states never regress: a late `delivered` cannot un-bounce a row

If `CALDER_WEBHOOK_SECRET` is unset, every webhook is rejected with `401`. Unverified payloads are
never trusted.

---

## 6. Routes (`/api/account/email`)

| Route | Auth | Notes |
| --- | --- | --- |
| `GET /config` | public | `{ deliveryConfigured, verificationRequired }`. Booleans only: no provider, address or key. |
| `GET /status` | session | Verified flag + address, from the database. |
| `POST /verify` | session | Sends a code **to the address on the account**; the request body cannot choose a recipient. |
| `POST /verify/confirm` | session | Six digits, then `setEmailVerified` and one welcome email. |
| `POST /change` | session | Codes the *new* address. Rejects an invalid address and the current one. |
| `POST /change/confirm` | session | Rewrites the address only after the code lands. |
| `POST /password/reset` | public | Always `202`, whatever the answer: account existence is not disclosed. |

Better Auth generates, stores, hashes and expires the reset token. Intake owns the rate limit and
the delivery. Rate limits: per-user for signed-in routes, per-address + per-network for reset.

Every handler is wrapped so a rejected promise becomes a `500` through Express, never an unhandled
rejection.

---

## 7. Event catalogue

| Event | Template | Idempotency key |
| --- | --- | --- |
| Email verified | `welcome` | `welcome:{userId}` |
| Password reset requested | `password_reset` | `password-reset:{token hash}` |
| Password changed | `security_password_changed` | one-shot |
| Email changed | `security_email_changed` | one-shot ×2 (old and new address) |
| New sign-in from a new network | `security_new_sign_in` | `{userId}:{utc-day}` |
| Google linked / unlinked | `security_google_connected` / `_disconnected` | one-shot |
| Forms provider connected / removed | `provider_connection_added` / `_removed` | one-shot |
| Credits below 20 % | `credits_low` | `{userId}:{utc-day}` |

Two launch letters exist for the one-time "we are live" mail. They are not transactional and not
interchangeable: `launch_announcement` signs as **The Intake Team** from `CALDER_ANNOUNCEMENT_FROM_EMAIL`;
`launch_note` signs as **Daniel** from `CALDER_WELCOME_FROM_EMAIL` and promises that replies reach a
person. Both carry the wait-list footer (why you received it, plus a signed unsubscribe link) and both
are sent by `npm run launch:mail` — see §11.

Every template renders **both** an HTML and a plaintext part, links only ever point at Intake (the one
exception is the X profile in the footer), and user-supplied values (names, account labels) are escaped. Security notices carry their action link in
the plaintext part too: telling a plaintext reader to "secure your account now" without a URL is not
a notice.

---

## 8. Environment

Three senders, two addresses each. The address comes from Intake's environment; **the display name
a recipient sees comes from the sender identity in the provider dashboard**, because Calder's send
schema takes a bare address. Create both identities before advertising either one.

```env
# Provider — server only. A CALDER_* variable must never carry a VITE_ prefix.
EMAIL_PROVIDER=calder          # calder | memory (tests) | none
CALDER_API_KEY=calder_sk_live_…
CALDER_BASE_URL=https://api.calder.click
CALDER_FROM_EMAIL=hello@intake.example   # required unless CALDER_SENDER_ID is set
CALDER_ANNOUNCEMENT_FROM_EMAIL=          # launch mail only; falls back to CALDER_FROM_EMAIL
CALDER_ANNOUNCEMENT_FROM_NAME=The Intake Team
INTAKE_ASSET_BASE_URL=                  # origin serving /brand/intake-mark.png
INTAKE_X_URL=https://x.com/intake       # footer social row; unset = no row
CALDER_FROM_NAME=Intake
CALDER_SENDER_ID=              # optional sender_… identity; wins over FROM_EMAIL
CALDER_REPLY_TO=               # optional
CALDER_WEBHOOK_SECRET=whsec_…  # required for delivery/bounce/complaint webhooks

# Behaviour
EMAIL_TIMEOUT_MS=10000         # per attempt, 1000–30000
EMAIL_MAX_ATTEMPTS=3           # total attempts, 1–5

# Optional: manage copy in Calder's dashboard instead of in Intake's templates
CALDER_TEMPLATE_OTP=intake-otp
CALDER_TEMPLATE_PASSWORD_RESET=intake-password-reset
CALDER_TEMPLATE_WELCOME=intake-welcome
```

`readEmailConfig` refuses to guess: a placeholder key, a `whsec_` secret pasted into the API-key slot,
or a key with no sender identity all report `email_provider_not_configured` rather than pretending to
send. `npm run preflight` names the exact variable that is wrong and never prints its value.

---

## 9. Design system

Every message is built by `design.ts`, not by each template. One shell: paper ground, the mark, a
card with an accent rule, a footer. The rules it exists to enforce:

- **Tables for structure, inline styles only.** No flex, no grid, no CSS variables.
- **The mark is a PNG** at `/brand/intake-mark.png` on `INTAKE_ASSET_BASE_URL`. Gmail and Outlook strip
  SVG; a mail client has no page to resolve a relative path against, so the URL must be absolute.
- **The wordmark stays text**, so it survives a client that blocks images.
- **Dark mode is declared `light only`.** The card is cream by design; a client that inverts it produces
  dark text on dark paper.
- **The X row is in every footer** and is omitted entirely when `INTAKE_X_URL` is unset — a social row
  pointing nowhere is worse than no social row.

Two footers, never mixed: `transactional` carries the support address and the account disclaimer;
`list` says why the recipient is on the list and offers an unsubscribe. Account boilerplate in a
launch email reads like a phishing attempt.

`npx tsx scripts/preview-emails.ts` renders every list/launch letter to `docs/email-preview/` with the
inbox row it will produce. Look at it before changing copy: a template that has only been asserted
against has not been designed.

## 10. Logging and secrets

- One logger, `logging.ts`. Keys matching `/token|secret|password|authorization|api_?key|otp|code|cookie|credential|key$/` are replaced with `[redacted]` **before formatting**.
- Addresses are masked (`a***@example.com`) unless already masked.
- An OTP, a reset token or an API key must never be passed to a log call at all — the redaction is a
  safety net, not a licence.
- Webhook payloads are logged by event id and type only.
- The admin surface is aggregate: counts, statuses and error codes. No bodies, no addresses, no keys.

---

## 11. Sending launch mail

```bash
npm run launch:mail -- --campaign=launch_announcement            # dry run: prints who and how many
npm run launch:mail -- --campaign=launch_note --send --limit=5   # first five, to read yourself
npm run launch:mail -- --campaign=launch_note --send            # everyone still owed this letter
```

- **Dry run is the default.** The failure that actually happens is sending a launch twice.
- `waitlist_launch_send` (migration `021`) makes each send idempotent per subscriber per campaign:
  re-running the script cannot deliver a second copy.
- `unsubscribed_at` is permanent and is honoured by the sender. The link is
  `/api/waitlist/unsubscribe?id=…&token=…`, where the token is an HMAC of the row id (no address ever
  appears in a URL) and a forged or truncated link answers 400 without revealing whether the address
  is on the list.
- Run against a real mailbox first. Nothing here has been exercised against Calder's live API from
  this branch.

## 12. When mail does not arrive

Two failure shapes look identical to a user and are completely different underneath.

**Calder refused the send.** `POST /v1/emails` answered 4xx/5xx, `mapCalderError` classified it, the
delivery row says `failed` with an `error_code`, and the caller told the user. Fix the cause: an
unverified sender, a plan limit, a suppressed address.

**Calder accepted the send and failed it later.** The API answered 202 with an `em_…` id, so Intake
recorded `queued` — correctly, because acceptance is not delivery. Then Calder's own transport gave up
minutes later and the message shows `Exhausted: provider_error` in their dashboard. Intake learns about
this only from a webhook, or by asking:

```bash
npm run email:doctor        # config, DNS (SPF/DMARC/DKIM/MX), last 14 days of statuses, open rows
npm run email:reconcile     # ask Calder for every row still open, write what it says
```

`reconcile.ts` never guesses: an unrecognised provider state, a thrown call or a null answer leaves the
row open rather than inventing a status. Settled rows are never reopened — a late `delivered` does not
un-bounce an address.

`email:reconcile` is the fallback path, not the good one. If `CALDER_WEBHOOK_SECRET` is unset, or the
endpoint is misregistered, nothing tells Intake that a message failed and a row sits at `queued` for
ever. The doctor flags both.

**What Intake cannot do:** diagnose the transport. If the doctor reports clean configuration, aligned
DNS and a `failed_remote` row, the message was accepted and then lost inside the provider. Take the
`provider_message_id` from the doctor's failure list and read the provider's timeline for that id.

### What `Transport: —` and `Exhausted: provider_error` actually mean

Both are summaries, and it is easy to read more into them than they carry. Read against Calder's code:

- **`Transport: —` does not mean "no transport was assigned."** The column is written *only on success*
  (`apps/api/src/lib/drain.ts`: the `.set({ status: "sent", transport: transportName })` branch after a
  leg accepts). A row that failed every leg keeps a null transport by construction. Empty here means
  "nothing was delivered", not "nothing was routed".
- **`provider_error` is the fallback, not a verdict.** `safeDeliveryReason`
  (`packages/observability/src/safe-errors.ts`) returns an allowlisted code when the thrown error has
  one and `provider_error` when it does not. A real SES rejection arrives with its own name —
  `MessageRejected`, `MailFromDomainNotVerified`, `AccountSuspendedException`, `Throttling` — and is
  preserved. So `provider_error` says the failure was *not* a named provider verdict: it happened
  around the send, in a leg whose exception carried no classified code.
- **"Provider-side reputation problem" is therefore not what this looks like.** Reputation shows up as
  throttling or a named rejection. This shape is a pipeline failure whose detail lives in the server
  log and in the row's `failed` drain event, not in the dashboard label.

### The counter-evidence that matters: Calder's own login mail

Calder's platform mail — signup verification and password reset — takes a different path on purpose.
`apps/dashboard/lib/send-auth-email.ts` calls `sendCompanyEmailQuietly`, and `packages/notify/src/send.ts`
sends it "straight to the provider, outside the customer pipeline": `defaultFrom()`, no queue, no
per-project transport chain, `stream: "transactional"` hardcoded. It arriving proves the provider
credential and outbound connectivity work. It says nothing about the Intake project's chain, and it is
not evidence against a tenant-side failure either.

Intake's own OTPs are *not* that path: they go through `POST /v1/emails` and the same queued pipeline as
list mail, so "our OTP arrived" and "their login mail arrived" are two different claims.

### So what to pull, in order

1. The `failed` drain event for that email id in Calder (`recordDrainEvent`, `data.code`) — that is the
   classified code, and the send leg it came from.
2. The API/worker log line for the same id (`drain: chain refused, row failed` carries the code; the
   thrown error itself is only in the log).
3. Whether the row has a `sender_identity_id` at all, and whether that sender is `verified` with a
   transport bound. A sender that is not ready fails the chain *before* any provider call, and it is
   classified (`sender_not_ready`) rather than bare — so seeing that code instead is the whole answer.
4. Only then the provider's timeline for `provider_message_id`, if there is one.

## 12. Tests

```
test/email-service.test.mjs        provider contract: retries, timeouts, idempotency, taxonomy
test/email-otp.test.mjs            codes: TTL, attempts, lock, cooldown, purpose scoping
test/email-webhooks.test.mjs       signature, replay, bounce/complaint suppression, size limits
test/email-authorization.test.mjs  routes: session scoping, recipient authority, rate limits
test/email-templates.test.mjs      rendering, escaping, plaintext parity, secret-free logging
```

No test needs a network or a database. `npm test` runs them alongside the rest of the suite.
