# Form creation engine

Turns a structured **form specification** into a real form in the user's own Google account.

```text
FormSpecification (JSON)
        │  validation.ts        pure, no network: every problem listed, AI-readable
        ▼
FormsProvider.createForm(userId, spec)
        │  providers/google/    plan.ts → adapter.ts → client.ts
        ▼
getProviderConnection(userId, "google")     existing provider service: decrypts, refreshes tokens
        ▼
Google Forms API   forms.create → forms.batchUpdate → forms.setPublishSettings
        ▼
real, published Google Form  →  { providerFormId, editUrl, responderUrl }
```

This engine remains **independent of the model**. Phase 6's server-side interpreter produces a validated
`FormSpecification` in a user-owned draft; only after explicit confirmation does it hand the specification to this
same engine. See [interpretation/README.md](interpretation/README.md). Google stays the source of truth for the form and
for every response; Intake hosts no form renderer, no responder page and no response collection.

**Status.** Everything here is verified locally with a stateful emulator of the Google Forms API at the `fetch`
boundary, not against real Google, Neon or Vercel (see [Testing](#testing) and
[Verify against a real account](#verify-against-a-real-account)). Microsoft Forms has a slot in the architecture and no
implementation, because Microsoft publishes no supported Forms API.

## Files

| Path | Role |
| --- | --- |
| `specification.ts` → `../../src/lib/specification.ts` | Shared `FormSpecification` types, question types and limits. Provider independent; server still owns validation. |
| `validation.ts` | `parseFormSpecification`: strict, pure validation with structured issues. |
| `provider.ts` | `FormsProvider`, `CreatedForm`, and the pending-provider used for Microsoft. |
| `providers/index.ts` | The provider slots: `google` (real) and `microsoft` (refuses, no request). |
| `providers/google/plan.ts` | Pure translation of a specification into Google requests, and the Google layout rules. |
| `providers/google/client.ts` | The only code that talks to `forms.googleapis.com`. Hardened `fetch`, error mapping. |
| `providers/google/adapter.ts` | `GoogleFormsProvider`: connection → create → batchUpdate → publish, and failure reporting. |
| `engine.ts` | Orchestration: provider choice, validation, limits, persistence, response shaping, logging. |
| `routes.ts` | `POST /api/forms` and `GET /api/forms`. |
| `store.ts`, `memory-store.ts`, `postgres-store.ts` | Ownership records (`form` table). |
| `errors.ts`, `logging.ts` | Structured errors with HTTP statuses; secret-free logging and request ids. |
| `../../src/lib/forms.ts` | Browser-safe contract: response types, defensive parsers, `safeFormUrl`, the example spec. |
| `../../db/migrations/002_forms.sql` | The `form` table. |

## The form specification

```jsonc
{
  "title": "Final Year Project Registration",          // required, ≤ 200 characters
  "description": "Register for the showcase.",          // optional, ≤ 2000
  "questions": [                                        // required, 1–100, in the order respondents see them
    { "id": "full_name", "type": "short_text", "title": "Full name", "required": true },
    { "id": "department", "type": "dropdown", "title": "Department", "options": ["Science", "Arts"] },
    { "id": "need_accommodation", "type": "multiple_choice", "title": "Do you need accommodation?",
      "required": true, "options": ["Yes", "No"] },
    { "id": "accommodation_type", "type": "dropdown", "title": "What type?", "required": true,
      "options": ["On campus", "Off campus"],
      "visibility": { "when": { "question": "need_accommodation", "equals": "Yes" } } }
  ]
}
```

It describes intent, not Google's schema. Deliberately small:

| Question field | Meaning |
| --- | --- |
| `id` | Stable reference for `visibility`. Starts with a letter; letters, digits, `_`, `-`; ≤ 64; unique. |
| `title` | The question as respondents read it (≤ 500). |
| `description` | Optional help text (≤ 1000). |
| `type` | One of the six types below. |
| `required` | Optional boolean; default not required. |
| `options` | Required for choice types (1–100 distinct, each ≤ 200); not allowed for the others. |
| `visibility` | Optional `{ when: { question, equals } }`. See [Conditional logic](#conditional-logic). |

### Supported question types

| `type` | Respondent sees | Google Forms question |
| --- | --- | --- |
| `short_text` | One line | short answer |
| `long_text` | Paragraph | paragraph |
| `email` | One line, for an email address | short answer, plus the warning `email_validation_unavailable` (the API cannot turn on email validation) |
| `multiple_choice` | **One** answer from a list | multiple choice (radio) |
| `dropdown` | One answer from a menu | dropdown |
| `checkboxes` | **Several** answers | checkboxes |

Vocabulary note: `multiple_choice` means one answer. The landing-page demo in `src/lib/types.ts` uses `single_choice` and
calls checkboxes `multiple_choice`; this engine does not. Sending `single_choice` returns a validation issue with a hint.

Not supported (rejected, not approximated): phone, number, date, time, rating, file upload, grids, sections written by
hand, validation rules, quizzes, confirmation messages, custom themes.

## Validation

`parseFormSpecification(input)` is pure: no network, no time, no randomness. It returns either the normalized,
frozen specification or **every** problem it found (up to 50), each shaped for a person or a model to repair:

```json
{ "code": "options_required", "path": "questions[3].options",
  "message": "\"dropdown\" question \"department\" needs at least one option.",
  "hint": "Add an \"options\" array such as [\"Option A\", \"Option B\"]." }
```

It is strict: unknown properties are rejected (so a credential-shaped key can never ride along), `null` counts as
absent, and text is trimmed with control characters removed (titles and options become single-line; descriptions keep
their line breaks).

| Code | Raised when |
| --- | --- |
| `specification_invalid`, `invalid_type` | The input, or a field, has the wrong JSON type. |
| `unknown_property` | A property that is not part of the schema. |
| `title_required`, `title_too_long`, `description_too_long` | Form title or description. |
| `questions_required`, `too_many_questions`, `question_invalid` | The question list or one of its entries. |
| `question_id_required`, `question_id_invalid`, `duplicate_question_id` | Question ids. |
| `question_title_required`, `question_title_too_long` | Question text. |
| `question_type_required`, `unsupported_question_type` | Type missing or not one of the six. |
| `options_required`, `options_not_allowed`, `too_many_options`, `option_invalid`, `duplicate_option` | Options on choice types (and on non-choice types). |
| `visibility_invalid`, `unsupported_condition_operator` | Malformed rule, or an operator other than `equals`. |
| `unknown_question_reference`, `self_reference`, `forward_reference` | The controlling question does not exist, is the question itself, or comes later. |
| `unsupported_condition_source` | The controlling question is not `multiple_choice` or `dropdown`. |
| `unknown_option_reference` | `equals` is not one of the controlling question's options (exact match). |
| `too_many_issues` | More than 49 problems; fix these and validate again. |

A validated specification is registered internally. `createForm` on a provider re-validates anything that is not
registered, so **no provider request can follow an invalid specification**, whichever code path calls the adapter.

## Provider adapters

```ts
interface FormsProvider {
  readonly id: 'google' | 'microsoft';
  readonly capabilities: { createForm: boolean; note?: string };
  createForm(userId: string, specification: FormSpecification, context?: { requestId: string; log: FormLogger }): Promise<CreatedForm>;
}

interface CreatedForm {            // what adapters return; raw provider responses never leave the adapter
  provider: 'google' | 'microsoft';
  providerFormId: string;
  title: string;
  editUrl?: string;
  responderUrl?: string;           // only ever a URL Google itself returned, and only if it passes safeFormUrl
  published: boolean;
  warnings: { code: string; questionId?: string; message: string }[];
  externalAccountId: string;       // server-only: completes the ownership chain, never sent to the browser
}
```

The creation engine depends on this interface; the model interpreter uses a **separate** `FormInterpreter`
boundary and the Google planner to check the current target's capabilities before showing a ready draft.
Supporting another provider would require its adapter, capability plan, provider registry entry and corresponding
draft-route/UI target support. Microsoft stays explicitly unavailable.

### The Microsoft limitation

Microsoft publishes no supported API for creating or editing Forms. `OrgSettings-Forms.ReadWrite.All` only changes
tenant settings. The `forms.office.com/formapi` surface the Forms website uses is undocumented, and this code does not
call it, scrape it or imitate it. The Microsoft slot is `createPendingProvider`: it reports
`provider_not_supported` ("Microsoft Forms creation is not available yet…"), HTTP 501, and makes **no** network request
and reads **no** connection. The workspace shows the option disabled with that reason. A Microsoft *connection* still
works (Phase 4); it records which account was authorized and nothing more.

## The Google flow

Checked against the Google Forms API Discovery document (revision 20260922) and the Forms API guides. Scope: `forms.body`
only, which is already requested and required by the connect flow (`FORMS_BODY_SCOPE` is asserted equal to the registry).

1. **Connection.** `getProviderConnection(userId, 'google')` (the existing service). It decrypts the user's own grant and
   refreshes an expired access token itself. The adapter contains **no OAuth or token logic**. It refuses a result that
   belongs to another user, is not Google, or lacks `forms.body`.
2. **`POST /v1/forms?unpublished=true`** with `{ info: { title, documentTitle } }`. `forms.create` copies only the title,
   so nothing else is sent. `unpublished=true` means a half-built form can never accept responses. The response gives
   `formId` and `responderUri`.
3. **`POST /v1/forms/{id}:batchUpdate`** in one atomic request, applied in order: `updateFormInfo` (description, with
   `updateMask: "description"`) if there is one, then one `createItem` per question and section break, each with an
   explicit `location.index` starting at `0`. Section breaks are `pageBreakItem: {}`. Routing options use
   `goToAction` (`NEXT_SECTION`, `SUBMIT_FORM`) or `goToSectionId`.
4. **Second `batchUpdate`, only when needed.** A routing option can only name a section that already exists, and
   `batchUpdate` validates requests one at a time. When a question must route to a *later* section, batch 1 creates the
   whole final structure with that question in place but plain. Batch 2 creates the routed version at the same position and
   deletes the plain copy (`createItem` then `deleteItem`), using only those two basic requests.
5. **`POST /v1/forms/{id}:setPublishSettings`** with
   `{ publishSettings: { publishState: { isPublished: true, isAcceptingResponses: true } } }` and no update mask.
   Forms created through the API after 30 June 2026 are unpublished until this call. If the reply explicitly says the form
   is not published or not accepting responses, that is treated as a failure, not a success.
6. **Result.** `editUrl` is `https://docs.google.com/forms/d/{formId}/edit` (built from the validated id; the API does not
   return one). `responderUrl` is Google's `responderUri` from step 2, kept only if it is an `https://docs.google.com/forms/…`
   URL with no credentials or port.

Every request goes to `https://forms.googleapis.com` with `Authorization: Bearer …` (the header is set only inside
`client.ts`), `redirect: 'error'`, and a 20-second timeout. Form ids and section ids read from Google's replies are
checked against a strict pattern before they are used in a URL or a request body. Nothing is retried automatically:
`batchUpdate` is not idempotent and `forms.create` would make a duplicate.

Worst case is four sequential calls (about 20 s each on a bad day; usually about a second each). A proxy in front of Intake
may cut the browser's connection sooner. The server keeps going and records the result, and the form then appears under
**Recent forms**.

### What the API cannot do (and Intake therefore does not claim)

- Turn on email validation for a question (hence the `email` warning).
- Configure section-level "after this section, go to…" navigation.
- Delete a form, share it, or change who can access it (those are Drive API operations; no Drive scope is requested).
- Read responses (needs `forms.responses.readonly`, not requested).

## Conditional logic

The specification says *what should appear when*; the adapter translates it to what Google can actually do.

```json
{ "id": "accommodation_type", "type": "dropdown", "options": ["On campus", "Off campus"],
  "visibility": { "when": { "question": "need_accommodation", "equals": "Yes" } } }
```

Provider-independent rules (validator): the controlling question must be **earlier**, must be `multiple_choice` or
`dropdown`, and `equals` must be one of its options exactly. Checkboxes can never control anything, and there are no
other operators: no `not`, `any of`, or numeric comparisons.

Google implements this only as **section routing** on multiple-choice and dropdown answers. There is no per-question
show/hide. So the adapter puts the conditional questions in their own section and routes to it (trigger answer) or past it
(every other answer). Consecutive questions that share the same condition share one section. Layouts the routing model
cannot express are **refused with an explanation** (HTTP 422 `unsupported_by_provider`, nothing created) rather than built
in a way that behaves differently from what was asked:

| Code | Refused because | Fix |
| --- | --- | --- |
| `google_condition_source_not_required` | A respondent could skip the controlling question, and Google would then have no answer to route on. | Mark the controlling question `"required": true`. |
| `google_nested_condition` | The controlling question is itself conditional. | Ask the second question in an unconditional section, or drop the nesting. |
| `google_condition_placement` | The conditional group is not directly after the group holding its controlling question, or two conditional groups sit back to back (for example `Yes` and `No` branches together). | Keep each conditional group directly after its controlling question, with an always-shown question between different groups. |

The behaviour of every layout the adapter accepts is tested by walking the built form as a respondent for every
combination of answers and comparing what they see with what the specification says they should see.

## HTTP API

Both routes require a signed-in Intake user. The user comes from the session and **nowhere else**.

### `POST /api/forms`

Request (JSON, ≤ 100 KB, must come from the Intake origin):

```json
{ "provider": "google", "specification": { "title": "…", "questions": [ … ] } }
```

Only those two properties are accepted. `accessToken`, `userId`, `connectionId`, `providerAccountId` and anything else are
rejected with `invalid_request` and `unknown_property` issues; their values are never echoed or logged. The connection is
always derived from the session user and the provider.

`201`:

```json
{ "requestId": "req_…",
  "form": { "id": "…", "provider": "google", "providerFormId": "…", "title": "…",
            "editUrl": "https://docs.google.com/forms/d/…/edit", "responderUrl": "https://docs.google.com/forms/d/e/…/viewform",
            "published": true, "createdAt": "…" },
  "warnings": [ { "code": "email_validation_unavailable", "questionId": "email", "message": "…" } ] }
```

`form.id` is `null` if the form was created but Intake could not save its record; the links are still valid.

Failures share one shape: `{ error, code, requestId, issues?, provider?, stage?, outcome?, retryable?, detail?, partialForm? }`.
`X-Request-Id` carries the same id.

| `code` | HTTP | Meaning |
| --- | --- | --- |
| `not_authenticated` | 401 | No Intake session. The only 401: provider problems are never 401. |
| `forbidden` | 403 | Request did not come from the Intake origin. |
| `invalid_request` | 400 (413 if too large) | Not JSON, wrong shape, unknown property. |
| `unsupported_provider` | 400 | `provider` is not `"google"` or `"microsoft"`. |
| `validation_failed` | 422 | The specification is invalid. `issues` lists every problem. |
| `unsupported_by_provider` | 422 | Valid, but Google cannot express it. `issues` explains why. |
| `provider_not_supported` | 501 | Microsoft. |
| `provider_not_connected` | 409 | No connection for this user. UI: **Connect Google Forms**. |
| `provider_reauthorization_required` | 409 | Expired, revoked, or missing scope. UI: **Reconnect Google**. |
| `provider_not_configured` | 503 | Google OAuth is not configured on this server (needed to renew a token). |
| `provider_unavailable`, `provider_error` | 503, 502 | Google unreachable, timed out, or failed. |
| `provider_permission_denied` | 502 | Google refused (for example the Forms API is not enabled for the Cloud project). |
| `provider_rejected` | 502 | Google rejected the request as invalid. `detail` carries its sanitized explanation. |
| `provider_rate_limited` | 429 | Google is limiting requests. |
| `rate_limited`, `creation_in_progress` | 429, 409 | Intake's own limits: one creation at a time per user, 12 per 10 minutes. |
| `storage_unavailable` | 503 | Session or database unavailable. |
| `internal_error` | 500 | A bug. No stack, message or internals are returned. |

### `GET /api/forms`

`{ requestId, forms: [{ id, provider, providerFormId, title, status, failureStage, editUrl, responderUrl, createdAt }] }`
for the signed-in user only, newest first, at most 20. No specification, account id or request id.

## Partial failure

Google has no transaction across these calls, and Intake does not pretend to. Every failure says exactly what exists:

| Stage | Failure | `outcome` | What exists in the user's Google account | Retry |
| --- | --- | --- | --- | --- |
| `connection` | not connected, needs reauthorization, not configured, storage | `not_created` | nothing | after fixing the cause |
| `create` | Google rejects the request (4xx) | `not_created` | nothing | yes (`retryable: true` for 429) |
| `create` | 5xx, timeout, network drop, unusable reply | `unknown` | **maybe** a form: Intake cannot know | no; check Google Forms first |
| `add_questions` | any | `partial` | an **unpublished** form with none of the questions | no: a retry makes a second form |
| `configure_logic` | any | `partial` | **unpublished**; all questions, no routing | no |
| `publish` | rejected | `partial`, `partialForm.state: "unpublished"` | complete but unpublished | publish it in Google, or discard |
| `publish` | timeout or network drop | `partial`, `partialForm.state: "publish_unconfirmed"` | complete; publish state unknown | check in Google |

A `partial` failure returns `partialForm: { providerFormId, editUrl, state }` and the workspace links it. The engine also
saves an `incomplete` record (never with a responder link) so the form can be found later, because Intake has no Drive scope
with which to delete it. A Google 401 marks the connection `reauthorization_required` so the next attempt does not reach
Google with a token it just rejected.

## Persistence

Migration `db/migrations/002_forms.sql` (apply with `npm run db:migrate:intake`) adds one table, `form`:

`id`, `user_id` → `"user"(id)` `ON DELETE CASCADE`, `provider`, `external_account_id`, `provider_form_id`, `title`,
`status` (`created` or `incomplete`), `edit_url`, `responder_url`, `failure_stage`, `request_id`, `specification` (jsonb),
`specification_version`, `created_at`, `updated_at`; `UNIQUE (provider, provider_form_id)`; index on
`(user_id, created_at DESC)`.

It completes the ownership chain **Intake user → provider connection → provider account → form**. The provider remains the
source of truth; the table stores no respondent data and no credentials. Every read is scoped by the session's user id. The
save happens after the provider work and is best effort: if it fails, the request still succeeds (the form exists),
`form.id` is `null`, and `form.create.persist_failed` logs the provider form id for an operator.

## Logging

One JSON object per line. Every line for an operation carries the same `requestId`, which is also returned to the caller.

| Event | Level | When |
| --- | --- | --- |
| `form.create.started` | info | A request reached the engine. |
| `form.create.validation_failed` | warn | The specification is invalid, or Google cannot express it. `issueCount`, `codes`. |
| `form.create.provider_request` | info | Before each Google call: `operation`, `stage`, `formId`. |
| `form.create.provider_failed` | error | A Google step failed: `stage`, `operation`, `httpStatus`, `googleStatus`, `reason`, `outcome`, `code`. |
| `form.create.completed` | info | `formId`, `questionCount`, `published`, `recorded`, `warningCount`, `durationMs`. |
| `form.create.rejected` | warn | Refused before any provider work (bad request, origin, limits). Property names only, never values. |
| `form.create.persist_failed` | error | The form exists but its record could not be saved. |

Never logged: access or refresh tokens, client secrets, authorization codes, ciphertext, request bodies, stack traces, raw
provider responses, or what the user wrote into the form (titles, descriptions, options, email addresses). Fields whose key
looks like a credential are masked, and every string is capped at 300 characters and passed through the same `redact` used by
the provider code. The Intake user id is logged so an operator can follow a request.

One bounded exception: when Google rejects a request, `form.create.provider_failed` carries Google's own error message as
`detail` (control characters removed, `redact`ed, at most 240 characters), because it is the main diagnostic for an
integration that can only be verified against the real API. Google's messages describe what was wrong with the request and
could occasionally quote a fragment of a rejected value. If that is not acceptable for a deployment, delete the `detail`
line in `providers/google/adapter.ts` `failure()`.

## Security notes

- **Authorization:** session user only; provider and specification are the only inputs; ownership re-checked in the adapter.
- **CSRF:** the `POST` requires an `Origin` (or `Referer`) equal to `BETTER_AUTH_URL`, checked before the body is read.
- **SSRF:** the host is fixed; only ids that match a strict pattern reach a URL path; `redirect: 'error'`; no URL from the
  browser or from a model is ever fetched.
- **Link injection:** `responderUrl` and `editUrl` are checked on the server and again in the browser (`safeFormUrl`:
  `https`, `docs.google.com`, `/forms/…`, no credentials, no port). Anything else is dropped and never rendered as a link.
- **Error leakage:** provider errors are mapped to fixed messages; the one provider-supplied string (`detail`, only for a
  generic Google rejection) is truncated to 240 characters, stripped of control characters and passed through `redact`. The
  route tests assert that no response body or log line contains a token, ciphertext or the provider account id. There is no
  runtime scanner: the guarantee is that responses are built by copying named fields, never by spreading provider data.
- **Abuse and quota:** one creation in flight per user and 12 per 10 minutes (in memory, per process).
- **Model independence:** the engine accepts only a typed specification.

## Testing

`npm test` (builds the client first). Nothing needs a Google or Microsoft account, OAuth credentials, Neon, or Vercel.

| File | Covers |
| --- | --- |
| `test/helpers/google-forms-fake.mjs` | A stateful emulator of the Forms API used at the `fetch` boundary. It keeps a form and enforces the documented rules: only the title copied on create, `unpublished=true` (without it the emulator publishes, as the old API did, so a forgotten parameter is caught), ordered `batchUpdate` with valid `location.index`, routing only to existing sections and only on radio or dropdown, and a complete publish body. It also contains a respondent simulator. |
| `test/helpers/forms-harness.mjs` | The real provider service and memory store, the real adapter and client, and the emulator, wired together. |
| `forms-validation.test.mjs` | Valid short-text and multiple-choice specs; missing title; missing options; invalid type; duplicate ids; bad branching references; strictness. |
| `forms-google-plan.test.mjs` | Type mapping, batch shapes, and behavioural equivalence: every layout is built and walked as a respondent for every answer combination. Refusal rules. |
| `forms-google-adapter.test.mjs` | Call order, headers, bodies; result mapping; every connection failure; each stage failing with its outcome; token refresh through the real service; user isolation; no secrets; zero requests for invalid input. |
| `forms-routes.test.mjs` | Authentication, CSRF, forbidden keys, ownership and isolation, partial failures, persistence failure, concurrency and limits, logging, no secrets or user content in logs. |
| `forms-storage.test.mjs` | The migration (second file, idempotent, ownership and CHECK rules) and the Postgres and memory stores (parameterized, user-scoped, newest first). |
| `forms-engine.test.mjs` | The logger (masking, bounds, event names), request ids, the error-code/status table, the engine turning a bug into a safe `internal_error`, and rejected-token reporting. |
| `forms-contract.test.mjs` | The browser-side parsers and link checks in `src/lib/forms.ts`: unknown fields dropped, unsafe links become `null`, unreadable bodies never read as success. |
| `forms-page.test.mjs` | The workspace page under jsdom: every state, safe links, no sign-in redirect on provider problems, invalid JSON never sent. |
| `frontend.test.mjs`, `routes.test.mjs` | `/app/forms` route ownership and rendering; the real server process failing closed without a database. |

Database: `npm test` checks the migration text and the store against a fake pool. As a one-off, outside the repository and
not part of `npm test` (it would need a new dev dependency), `002_forms.sql` and `postgres-store.ts` were also run against an
in-process PostgreSQL (PGlite): the migration applies after `001`, re-applies harmlessly, and the real store's save and list,
every `CHECK`, the `UNIQUE` and foreign-key rules, the cascade on user deletion and the jsonb round trip behaved as
documented. That is PostgreSQL semantics, not Neon: the migration has not been applied to a real Neon database.

The emulator encodes Google's documented behaviour as understood from its reference; it cannot prove Google agrees. It was
also used to find a real bug during development (a page break as the first item), which is why batch 1 builds the complete
final structure. As a check that the tests are not vacuous, realistic bugs were injected one at a time (CSRF check removed,
wrong user's token, form published before its questions, account id leaked, form title logged, and others) and each was caught.

## Verify against a real account

Not done in this repository's environment. To do it:

1. In the Google Cloud project that owns the OAuth client, **enable the Google Forms API**. Without it the workspace shows
   "The Google Forms API is not enabled…" (`SERVICE_DISABLED`).
2. Ensure the consent screen includes `https://www.googleapis.com/auth/forms.body`, and the account is a test user while the
   app is in testing.
3. Apply migrations: `npm run db:migrate` then `npm run db:migrate:intake`.
4. Sign in, open **Connections**, connect Google. Open **Forms**, click **Create form** with the prefilled example.
5. Confirm in Google Forms: the form exists with all questions, is published and accepting responses, the Yes/No question
   routes as expected, and **Open form** / **Edit form** open the right pages. Submit a test response.
6. Confirm the `form` row and that `GET /api/forms` lists it. Confirm logs show the five events with one `requestId`.
7. Revoke Intake in the Google account and create again: the workspace should offer **Reconnect Google**.

Things this checklist would confirm that mocks cannot: that `forms.body` alone is accepted for all three calls, that the
returned `responderUri` opens the live form, that Google accepts `createItem` followed by `deleteItem` in one `batchUpdate`
and routes sections as documented (the emulator only encodes that reading of the docs), that a field the emulator treats as
optional is not required in practice, and the real latency.

## Known limitations

- Google only; Microsoft is architecture only.
- Layout rules above; nesting, back-to-back branches and optional controlling questions are refused.
- No editing, deleting or sharing of forms after creation, and no reading responses.
- The legacy direct `POST /api/forms` endpoint has no durable idempotency key: repeat calls create new forms. The user-facing natural-language flow uses an atomic draft claim at `POST /api/forms/confirm` and replays a completed result instead of creating again.
- Limits are in memory and per process; a second API instance would have its own counters.
- Email questions cannot be validated by Google's API and are created as short answer with a warning.
- The list shows the 20 most recent forms; there is no pagination.
