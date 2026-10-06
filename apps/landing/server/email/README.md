# Intake transactional email

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

Intake only ever sends on the `transactional` stream in this phase. `from` is a `sender_…` id when
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
- Low credits:    `intake:credits-low:{userId}:{utc-day}`
- Security:       `intake:security-*:{eventId}`

A retry, a double-click or a duplicated hook therefore replays Calder's stored response instead of
sending twice. The delivery is also recorded locally *before* the request goes out, so a crash
mid-send leaves a `sending` row rather than a mystery.

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

Every template renders **both** an HTML and a plaintext part, links only ever point at Intake, and
user-supplied values (names, account labels) are escaped. Security notices carry their action link in
the plaintext part too: telling a plaintext reader to "secure your account now" without a URL is not
a notice.

---

## 8. Environment

```env
# Provider — server only. A CALDER_* variable must never carry a VITE_ prefix.
EMAIL_PROVIDER=calder          # calder | memory (tests) | none
CALDER_API_KEY=calder_sk_live_…
CALDER_BASE_URL=https://api.calder.click
CALDER_FROM_EMAIL=hello@intake.example   # required unless CALDER_SENDER_ID is set
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

## 9. Logging and secrets

- One logger, `logging.ts`. Keys matching `/token|secret|password|authorization|api_?key|otp|code|cookie|credential|key$/` are replaced with `[redacted]` **before formatting**.
- Addresses are masked (`a***@example.com`) unless already masked.
- An OTP, a reset token or an API key must never be passed to a log call at all — the redaction is a
  safety net, not a licence.
- Webhook payloads are logged by event id and type only.
- The admin surface is aggregate: counts, statuses and error codes. No bodies, no addresses, no keys.

---

## 10. Tests

```
test/email-service.test.mjs        provider contract: retries, timeouts, idempotency, taxonomy
test/email-otp.test.mjs            codes: TTL, attempts, lock, cooldown, purpose scoping
test/email-webhooks.test.mjs       signature, replay, bounce/complaint suppression, size limits
test/email-authorization.test.mjs  routes: session scoping, recipient authority, rate limits
test/email-templates.test.mjs      rendering, escaping, plaintext parity, secret-free logging
```

No test needs a network or a database. `npm test` runs them alongside the rest of the suite.
