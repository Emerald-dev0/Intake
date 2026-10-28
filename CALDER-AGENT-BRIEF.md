# Calder: agent brief — make silent delivery failures visible

Copy everything below the line into your coding agent, running in `Emerald-dev0/Calder`.

---

## Role

You are working in the Calder monorepo (`Emerald-dev0/Calder`, pnpm + turbo). This is a hosted email
API and dashboard. Real customer mail rides it, so correctness beats cleverness and a regression in
sending is worse than a missing feature.

Your job is **not** to make sending work. It mostly works. Your job is to stop the product from
reporting things it does not know, and to stop accepting a message it cannot attribute without saying
so. Everything below was diagnosed from Calder's own code and one real project's dashboard, so treat
the file paths and behaviours as established rather than hypotheses to re-derive. Verify them, then
fix.

## The evidence this comes from

One project (`Intake`, `proj_b38633656251`) showing this on `/senders`:

- Stream card, transactional, 7 days: **Sent 5, Delivered 0, Bounced 0, Complaints 0.**
- The only sender, `daniel@intake.calder.click`, verified: **4 sent**, and the operator never
  registered `hello@intake.calder.click`, which the client sends as.
- The display name reads **"Daniel from Calder"**, which no client configuration asked for.
- Delivery does work: Calder's own signup/login codes arrive fine for that operator, and they take the
  company-mail path, not this one.

So: five messages were accepted by the provider, none has a delivery outcome, none bounced, and one of
them is not attributed to any sender. Every one of those is explainable by Calder reporting less than
it knows — or reporting a zero where "unknown" is the truth.

## Established facts (verify, do not re-investigate from scratch)

1. `apps/api/src/services/sender-service.ts` — `resolveSender`. A `sender_…` id that is unknown or not
   `verified`/`connected` throws (`validation_error` / `sender_not_ready`). A **bare address** with no
   identity returns `{ senderIdentityId: null, email, displayName: null }` and the send proceeds
   *unattributed*. This is how a project sends from an address it never registered.
2. `apps/dashboard/lib/senders/service.ts` — `senderHealth` groups by `emails.senderIdentityId`, while
   `streamStats` counts all rows with a delivery outcome. That asymmetry is why "5 sent" and "4 sent"
   can appear on one screen with no explanation.
3. `apps/api/src/lib/drain.ts` — the `transport` column is written **only in the success branch**
   (`.set({ status: "sent", …, transport: transportName })`). A failed row therefore has
   `transport = null` forever, and the dashboard renders that as `Transport: —`, which an operator
   reasonably reads as "nothing was routed".
4. `packages/observability/src/safe-errors.ts` — `safeDeliveryReason` returns an allowlisted code or
   the bare fallback `provider_error`. Real SES verdicts (`MessageRejected`, `Throttling`,
   `AccountSuspendedException`, `MailFromDomainNotVerified`, …) survive; anything unclassified does
   not. So `provider_error` on a row means "we do not know", and it is displayed as if it were a cause.
5. `apps/api/src/routes/ses-events.ts` — delivery truth arrives at `POST /v1/ses/events` via SNS, and
   the endpoint **refuses subscription confirmations unless `SES_SNS_TOPIC_ARNS` is set**. With that
   unset, `Delivered` stays 0 permanently while mail lands normally.
6. `packages/notify/src/send.ts` — company/platform mail is sent "straight to the provider, outside the
   customer pipeline" (`defaultFrom()`, no queue, no transport chain). It is the reason "but my login
   code arrived" is not evidence about the tenant pipeline, and it is a useful contrast to keep in
   mind, not something to unify.
7. `packages/db/src/schema/senders.ts` — `isDefault` (transactional) and `isDefaultMarketing` are only
   consulted when a send omits a sender. A client that always names one never needs either.

## Task 1 — An unattributed send must not look like a normal one

**Problem.** `POST /v1/emails` with an unregistered `from` address returns 202 and the message leaves.
The only trace is a `null` `senderIdentityId`.

**Change.** Do not start rejecting these — that breaks every existing caller. Make it observable:

- In the accepted response, include the attribution that was resolved, e.g.
  `sender: { id | null, email, display_name | null, attributed: boolean }`. Additive only; keep every
  existing field.
- In the drain, record a `delivery_events`/`email_events` row (or add a field, whichever the schema
  already supports) marking the send as unattributed, so it is queryable without reading logs.
- Log once, at `warn`, with the email id and the requested address.

**Acceptance.** A test that sends from an unregistered address against a project with no matching
identity asserts: 202 still returned, response says `attributed: false`, and the email row has a
recorded unattributed event. A second test asserts a registered address returns `attributed: true` and
no such event.

## Task 2 — "Delivered 0" must never mean "we are not listening"

**Problem.** Delivery truth depends on SNS ingress. When `SES_SNS_TOPIC_ARNS` is unset (or nothing has
ever arrived), every screen confidently reports 0 delivered, 0 bounced, 0.0% bounce — which reads as
"your mail is fine" or "your mail is dying", depending on the reader, and both are wrong.

**Change.**

- Add a single source of truth for delivery-event health: is the SNS topic allowlist configured, and
  when did the last SES event arrive? Expose it from the API (health/status route is the natural home,
  it already distinguishes configured from deliverable).
- On the senders page and the stream cards, when events are unconfigured or stale (definition: a
  project with accepted sends in the window and zero events received), replace the confident zeros with
  an explicit state: *"No delivery events received — Delivered and Bounced are unknown, not zero."*
  Link to the setup step.
- Do the same in any email-detail view that shows `Transport: —`. Prefer words over the dash:
  `not delivered by any transport`, and for failures, list the transports that were attempted if that
  is not already persisted.

**Acceptance.** Tests for the classifier function (unconfigured / stale / fresh) sitting next to the
existing dashboard unit tests, plus a rendering test proving the zeros are replaced by the unknown
state. No SQL that runs per render without an index — this is a cheap aggregate, keep it cheap.

## Task 3 — Keep the cause, not just the class

**Problem.** `provider_error` sends an operator to the wrong place. The detail exists in the server log
and dies there.

**Change.** Persist a *safe, finite* discriminator alongside the allowlisted code: the transport leg
that failed and the error's constructor name (e.g. `{ code: "provider_error", leg: "default",
errorName: "TypeError" }`). Keep the existing rule absolutely: never persist provider messages, request
ids, addresses, or credentials. Constructor names and leg names are from our own code, so they are safe
by construction — add them to a comment so the next person does not widen it.

**Acceptance.** A test asserting a thrown `TypeError` from the fallback leg yields that shape, and a
test asserting an arbitrary provider message (containing an address) is **not** written to the row.

## Task 4 — Make the senders page arithmetic add up

**Problem.** "5 sent" on the stream and "4 sent" on the sender card, on the same page, with no way to
learn why. The delta is unattributed mail (Task 1).

**Change.** When any message in the window is unattributed, show it as its own row/line — "1 sent
without a registered sender" — linking to those messages and to Add Sender Identity. A number that
reconciles is worth more than a chart.

**Acceptance.** Query test: one row with `senderIdentityId null` and one attributed, in the same
window, produces a total equal to the stream count.

## Task 5 — Close the deployment loop (small, do it last)

`apps/api/vercel.json` no longer declares `functions` (correct — Vercel validates it before the build
and `api/index.js` is generated and gitignored). Two follow-ups:

- The 60 s max duration and 1 GB memory that lived there must be documented as project settings in
  `docs/DEPLOYMENT.md`, since the repo can no longer carry them. Say plainly what breaks without them
  (cron drain batches cut at the plan default).
- The repo-root `calder` Vercel project (separate team) is still failing while `calder-web` and
  `calder-dashboard` build fine. Determine whether it is a duplicate of `calder-web`; if so, say so in
  `docs/DEPLOYMENT.md` rather than leaving two projects building one site.

## Non-negotiables

- Never convert an accepted send into a rejected one. Every change here is additive.
- Do not touch billing, auth, or plan limits.
- Do not persist anything provider-shaped (see Task 3). The allowlist in `safe-errors.ts` is the model.
- Do not "fix" the company-mail path to go through the queue, and do not make tenant mail go through
  the company path.
- Keep the existing gates green, and keep the tests you add meaningful — a test that passes with the
  bug reintroduced is worse than no test. Prove each one by reverting the fix locally and watching it
  fail.

## Verification before you report

```
pnpm install --frozen-lockfile
pnpm typecheck
pnpm lint
pnpm format:check
pnpm test
pnpm build
```

Then, in the PR body: what each change makes visible that was previously silent, the two tests that
would have caught the "5 vs 4" and the false "Delivered 0", and anything you deliberately left alone.

## Report back with

1. Which of the five tasks landed, and the exact acceptance test names.
2. Any place where the honest fix was to *remove* a number rather than compute it better.
3. What a project owner must still do by hand (registering `hello@`, renaming a display name, setting
   the SNS topic allowlist) — because those are configuration, not code, and the product should say so
   where the gap shows.
