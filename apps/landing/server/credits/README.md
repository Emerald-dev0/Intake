# AI credits and entitlements

Successful, usable AI operations cost credits according to a validated server-side proposal; failed,
clarifying and unsupported interpretations cost nothing. This folder owns entitlements, operation
pricing in credits, atomic consumption, the immutable ledger and the public balance endpoint. The
server alone decides which plan and balance apply. Public USD plan metadata is separate and display-only
in `src/lib/plans.ts`; it does not grant entitlements, set charges or implement billing.

The browser contract is one-way and limited to the server's public projection plus bounded cost examples:

```json
{
  "credits": {
    "plan": "free", "subscriptionStatus": "none", "availableCredits": 18,
    "dailyRemaining": 18, "dailyLimit": 20, "monthlyRemaining": 0, "monthlyLimit": 0,
    "nextDailyReset": "2026-10-04T00:00:00.000Z", "nextMonthlyReset": "2026-11-01T00:00:00.000Z"
  },
  "costGuide": {
    "formCreate": { "min": 2, "max": 5, "standard": 2, "complexMin": 3 },
    "formEdit": { "min": 1, "max": 5, "singleChange": 1, "majorMin": 3 }
  }
}
```

Token counts, ledger rows, operation ids and provider details never cross the balance boundary. The
cost guide contains only safe examples/ranges produced by the same server classifiers used to charge.
`GET /api/credits` accepts no body and no query: a client cannot submit a user, plan, price or balance.
Credit limits are user entitlements, distinct from the operational abuse controls in
`server/security/rate-limit.ts` (which throttle request rate, not spend).

## Files

| File | Responsibility |
| --- | --- |
| `entitlements.ts` | Server-authoritative plans, daily/monthly buckets, UTC reset keys, consumption order, public balance projection |
| `pricing.ts` | Deterministic server-side credit costs, classifiers (creation, edit) and public cost guide |
| `ledger.ts` | `CreditStore` contract + the PostgreSQL and in-memory implementations |
| `service.ts` | `CreditService`: balance, up-front affordability check, one charge per operation, usage recording, plan hook |
| `routes.ts` | `GET /api/credits` |
| `../../db/migrations/007_ai_credits.sql` | `user_entitlement`, `credit_ledger`, the logical `ai_operation` schema; archives an incompatible Phase 12 table without deleting it |
| `../../db/migrations/007_ai_operations.sql` | Retained historical migration id; intentionally a no-op for compatibility |
| `../../db/migrations/008_ai_operation_compat.sql` | Backfills safe telemetry fields from the preserved Phase 12 table |
| `../../db/migrations/009_admin_indexes.sql` | Read-path indexes for the Phase 12 admin console |

Metering is applied by `server/ai/operations.ts`, which wraps one logical AI operation and is used by
`server/forms/interpretation/routes.ts` (creation and revision) and the edit routes.

## Public plan and price display

The public `/pricing` page reads its plan limits and USD values from `src/lib/plans.ts`: Free is $0;
Pro is $6.99/month or $59.99/year. The page's monthly/annual toggle only changes the displayed
comparison; the annual amount is $23.89 less than twelve monthly payments (28.5%, rounded to one decimal). This
metadata is not a payment quote or subscription: checkout and self-service plan changes are not
implemented. The Vite build emits a crawlable `/pricing` document and the sitemap lists it. Existing
entitlements and all operation charges continue to come from server state and server classifiers.

## Entitlements

| Plan | Daily grant (UTC) | Monthly reserve | Rollover |
| --- | ---: | ---: | --- |
| Free | 20 | — | none |
| Pro | 20 | 500 per billing period | none |

- Daily credits are keyed by the UTC date (`YYYY-MM-DD`) and never accumulate: yesterday's unused
  credits are not spendable today.
- The monthly reserve is keyed by the billing period when the billing system sets
  `current_period_start`, and by the UTC calendar month otherwise. Unused monthly credits do not move
  to the next period.
- Consumption order is fixed and documented in code (`BUCKET_PRIORITY`): **daily first, then
  monthly**. A Pro user spends their 20 daily credits before touching the 500-credit reserve.
- A plan change never deletes history. `bucketEnabled` / `applyPlanBuckets` stop a bucket the current
  plan does not grant from being spent (a downgraded account cannot keep spending a monthly reserve),
  while the recorded grants and consumption stay in the ledger for audit.
- Grants are idempotent: a partial unique index on `(user_id, entry_type, period_key)` means a grant
  can be issued once per period even if several requests arrive at the same moment.
- Resets are decided server-side in UTC. The browser only formats the instants it is given.

## AI operation costs (credits)

Credit costs are a deterministic function of the **validated** result, never of raw model output, and
the model has no influence on them. The browser cannot propose or select a charge.

| Cost | Creation (`form_create`) | Edit / revision (`form_edit`, `form_revise`) |
| ---: | --- | --- |
| 1 | — | a simple change: one question added, updated, removed or moved, or one text change |
| 2 | a normal form (~6 questions, no branching) | a moderate edit: several small changes |
| 3–5 | larger or conditional forms (3 × conditional rules + question count) | restructuring, many questions touched, structural operations |

`MIN_CREATION_COST` / `MAX_CREATION_COST` / `MIN_EDIT_COST` / `MAX_EDIT_COST` bound the classifiers,
and `insufficient_credits` is raised up front when the balance cannot cover the cheapest operation —
so a user who cannot afford anything never pays for a model call that is then discarded.

## One logical operation, one charge

A logical operation is what the user asked for ("add a phone number field"), not what Intake did
internally. One operation may include several model calls, a validation pass and a structured-output
correction; the user is still charged once.

- The client may send `operationId` (8–64 characters of `[A-Za-z0-9_-]`). Anything else is replaced by
  a server-generated key, so a malformed id can never weaken idempotency.
- The key is stored in `credit_ledger.operation_key` (unique per user, operation and bucket) and
  `ai_operation (user_id, operation_key)`. Replaying the same key returns the original charge state
  (`already_charged`) instead of charging again.
- If the model provider fails, times out, returns invalid output, or the request is an honest
  clarification/unsupported answer, **nothing is charged**. Only a validated, usable result is billed.
- Executing an already-reviewed draft against the Google Forms API is not an AI operation: publishing
  a confirmed form costs no extra credits.

## Ledger and usage records

`credit_ledger` is the append-only source of truth. Its `entry_type` values are `daily_grant`,
`monthly_grant`, `ai_consumption`, `manual_adjustment` and `expiration`; `credits` is signed and
nonzero, each row carries its bucket and period key, and consumption rows carry the operation key and
type. There is no update or delete path in the store.

`ai_operation` records what happened for every attempt, including the free ones: user, operation id
and key, operation type, provider, model, input/output/total tokens, latency, outcome
(`succeeded` / `failed` / `no_result`), error category and the credits charged. It is the audit trail
for "why was this charged?" and the only place raw token economics are stored.

## Atomicity and failure behavior

`createPostgresCreditStore` performs a whole charge in **one transaction**: it locks the user's
`user_entitlement` row (`SELECT … FOR UPDATE`) as a per-user mutex, ensures the period's grants with
`ON CONFLICT DO NOTHING`, plans the allocation across buckets with the `allocate` helper, and inserts
one `ai_consumption` row per bucket. Because the balance is computed inside the lock, concurrent
requests cannot race a read-modify-write, cannot overdraw, and a balance can never go negative. The
in-memory store used by tests mirrors these semantics with per-user promise chaining.

If ledger storage is unavailable, the operation is refused with `storage_unavailable` **before** any
model call: nothing is charged and nothing is given away. Usage-recording failures never fail a
request that already succeeded for the user; they are reported as safe, non-fatal errors.

## HTTP surface

| Endpoint / response | Result |
| --- | --- |
| `GET /api/credits` | `200 { credits: { plan, subscriptionStatus, availableCredits, dailyRemaining, dailyLimit, monthlyRemaining, monthlyLimit, nextDailyReset, nextMonthlyReset }, costGuide }`, `Cache-Control: no-store` |
| | `401 not_authenticated` when signed out |
| | `503 storage_unavailable` when the ledger cannot be read |
| Successful metered interpretation | Post-charge `credits` projection plus `operationCost: { credits, status }`; status is `charged` or `already_charged` |
| Clarification, unsupported or failed interpretation | `operationCost: { credits: 0, status: "not_charged" }` where the operation result is returned |

Successful AI responses carry the post-charge balance (`credits`) so the workspace can update the
meter without a second round trip. A refused operation returns `402` with the stable code
`insufficient_credits`, no charge and no partial work; the browser names the state, available bucket
limits and server-supplied reset times. The `costGuide` helps the interface preview supported costs;
it never selects or overrides the charge.

## Not implemented in this phase

- Payments or subscriptions — `setPlan` is a server-side hook; no route exposes it and no plan change
  happens automatically. Public prices do not imply a billing integration.
- Manual credit-adjustment UI, per-user overrides, credit purchasing and rollover. Phase 12's read-only
  admin console remains in place; it does not grant or adjust credits.
- Any browser-side decision about entitlement, balance or operation charge.

When billing arrives, integrate it through a deliberate server-side path that updates
`CreditService.setPlan`; never derive plan state from the public pricing metadata. The plan catalogue
in `src/lib/plans.ts` is the public display extension point, and this folder remains responsible for
entitlements and operation costs.

## Tests

From `apps/landing`:

```bash
node --test --import tsx test/credits.test.mjs          # plans, grants, buckets, pricing, idempotency, concurrency
node --test --import tsx test/ai-operations.test.mjs    # one logical operation = one charge
node --test --import tsx test/credits-routes.test.mjs   # HTTP behavior, 402, usage rows, plans
node --test --import tsx test/credits-client.test.mjs   # public-balance parsing and copy
node --test --import tsx test/pricing.test.mjs          # public prices and generated /pricing SEO document
```

`test/credits.test.mjs` runs against the same store contract the PostgreSQL implementation satisfies;
the SQL semantics themselves (locking, unique indexes) require a real PostgreSQL instance and were not
exercised against Neon.
