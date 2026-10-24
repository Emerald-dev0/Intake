# Composed mail

A note an operator writes in the dashboard and sends to selected accounts. It is **not a broadcast**:
every recipient gets their own message, their own delivery record and their own provider idempotency
key, and the admin has to read the rendered email before anything leaves.

- **Compose:** `/admin/mail`
- **Per-recipient records:** `/admin/email` (type `admin_message`, shown as "composed mail")
- **Server:** `server/admin/mail.ts` (rules and composition), `server/admin/mail-postgres.ts` (storage),
  `server/admin/routes.ts` (`/api/admin/mail/*`), `server/email/templates.ts` (`admin_message`)

---

## 1. The flow

```
select accounts ──▶ POST /api/admin/mail/preview ──▶ rendered HTML + recipient count + previewId
       │                                                        │
       └─────────────────────────── admin reads it ◀────────────┘
                                    │
                                    ▼
                     POST /api/admin/mail/send  { draft, selection, previewId, confirmedRecipients }
                                    │
                        one EmailService.send() per recipient
```

Nothing is sent by previewing. A send request must carry the `previewId` that was rendered from the
same draft and the same recipient set, and the confirmed recipient count. If either has drifted, the
send is refused (`409 recipient_count_changed`) and the admin previews again.

## 2. What the server enforces

| Rule | Where | Why |
| --- | --- | --- |
| Session + verified allowlisted admin | `server/admin/routes.ts` middleware | Same gate as every other admin endpoint. No separate mail auth path. |
| 6 sends/minute | `RATE_RULES.mail` | A person cannot write more than that; it stops a stuck loop from mailing the user base. |
| 100 recipients per send | `MAIL_RECIPIENT_CAP` | Bounded request time with a real provider. The UI shows the cap before you confirm and refuses to send over it. |
| One message per recipient | `createMailService().send` | A partial failure has to be visible per person. |
| Draft re-validated on send | `parseComposeDraft` | Preview and send share one validator, so nothing is approved under one rule and sent under another. |
| Unknown `{{tokens}}` refused | `parseComposeDraft` | A typo becomes a held-back form error, never `Hi {{naem}},` in someone's inbox. |
| Links must be `https://` or a `/path` | `parseComposeDraft` | No `javascript:`, no `data:`, no offsite redirects. |
| Suppression list respected | `EmailService` (unchanged) | A bounced or complaining address is skipped, counted, and recorded as `skipped`. |
| Recipient set resolved server-side | `MailStore.resolve` | The browser sends a selection or user ids; it never decides eligibility. |
| Bodies are escaped, not trusted | `admin_message` template | The body is a textarea. It is escaped and split into paragraphs, never rendered as markup. |

## 3. What is recorded, and what is not

Recorded:

- one `email_delivery` row per recipient (`email_type = 'admin_message'`), with the provider message id,
  status, error code and idempotency key;
- one `admin_mail_send` row per send: subject, selection kind and label, and the accepted / skipped /
  failed counts, plus which admin pressed the button.

Not recorded, deliberately:

- the message body. The copy that went out is in each recipient's mailbox; an archive of personal
  correspondence in the admin database would be a liability, not a feature;
- recipient addresses inside the send log. The `email_delivery` rows already carry them, so the log
  could not be made anonymous by omission — it simply does not need a second copy.

## 4. The `campaign` stream

`EmailStream` is `transactional | campaign | marketing`. A composed note is sent on `campaign`, because
it is neither a product-triggered message nor a bulk marketing send. `marketing` remains unused: Intake
has no newsletter, no drip sequence and no bulk send.

If a deployment wants the operator note to travel on the transactional lane instead, that is a change
to one line in `server/email/service.ts` — but the default is the honest one.

## 5. Setup

1. Apply `db/migrations/020_admin_mail.sql` (`npm run db:migrate:intake`; the runner applies it
   automatically). Without it the compose screen still renders but every route reports `503
   mail_unavailable` — it never pretends a message was sent.
2. Email delivery itself is unchanged: `CALDER_API_KEY`, a sender identity (`CALDER_SENDER_ID` or
   `CALDER_FROM_EMAIL`) and optionally `CALDER_WEBHOOK_SECRET`. See `server/email/README.md`.
3. Add the operators to `ADMIN_EMAILS` (comma-separated, exact addresses, verified accounts only).

## 6. Limits worth stating plainly

- **No scheduling, no drafts, no resend button.** Compose, preview, send. A failed recipient is visible
  in the result table and on the Email page; retrying is a new send.
- **No batch larger than 100 per action.** Larger audiences are sent in explicit batches, with the count
  shown each time. That is a deliberate ceiling on how much a single click can do.
- **No tracking pixels, no click rewriting, no open rates.** The analytics page counts site traffic, not
  email engagement. Delivery state comes from the provider's webhooks, and nothing more.
- **Composed mail is one-way.** Replies go to `CALDER_REPLY_TO`; the dashboard does not ingest them.
