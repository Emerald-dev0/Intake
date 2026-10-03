# Phase 6 — Describe, review, create

The authenticated `/app/forms` workspace accepts ordinary language instead of JSON. The landing playground is unrelated and still only a demo. Nothing external is created during interpretation or revision.

```text
User's request / change
   → server-side FormInterpreter (provider-abstracted structured JSON output)
   → strict interpretation-result check
   → existing parseFormSpecification + Google planGoogleForm
   → user-owned draft (PostgreSQL form_draft)
   → readable review / optional revisions
   → explicit POST /api/forms/confirm
   → atomic draft claim
   → existing FormEngine.createForm → user's Google connection → Google Forms API
   → actual responder/edit links or a truthful failure/partial state
```

The model never receives access/refresh tokens, calls a tool, selects a connection, or contacts Google. Only the server-session user id and the draft's Google provider determine the connection. Production composition disables the legacy structured-specification `POST /api/forms`; a persisted, reviewed draft and explicit confirmation are required. Read [../README.md](../README.md) for the engine's exact types, validation, Google routing constraints and failure semantics.

## Model integration

Interpretation runs through the provider abstraction in [`server/ai/`](../../ai/): routes, drafts, validators and the Google Forms engine depend only on `FormInterpreter`, never on a vendor. **Groq is the primary provider**; OpenAI remains selectable.

| Provider | Default model | Credential | Notes |
| --- | --- | --- | --- |
| Groq (primary) | `openai/gpt-oss-120b` | `GROQ_API_KEY` | Groq documents *strict* JSON-schema constrained decoding for this model, which the validator-first pipeline relies on. `GROQ_MODEL` changes it without a code change. |
| OpenAI (optional) | `gpt-4o-mini` | `OPENAI_API_KEY` | Used when `AI_PROVIDER=openai`, or when it is the only credential present. |

Both providers speak the same OpenAI-compatible Chat Completions contract, so `server/ai/chat-completions.ts` implements one request body, one bounded response reader, one JSON extractor and one error mapping. There is no SDK, no streaming, no tool calling, no internal retry and no request-time failover between vendors. A single call is attempted once; a failure is reported rather than re-sent, which is also what protects downstream actions from duplication. Inference has a 30-second timeout, `AI_MAX_COMPLETION_TOKENS` (default 6,000) and a bounded response size.

Keys are read from the API service only and are never `VITE_` variables. A credential is never part of the model input. When no credential exists, `resolveAiProvider` returns a fail-closed stand-in that raises `model_not_configured` on use, so every other route still works and no heuristic, fixture or fake inference substitutes for a model in production.

Failures map to a stable application taxonomy — `model_not_configured`, `model_timeout`, `model_unavailable`, `model_rate_limited`, `model_provider_error`, `model_invalid_output` — and raw provider payloads never reach the browser. Every model call, including failed ones, is observed (provider, model, schema name, token counts, latency, outcome, error category) so one logical operation can be recorded and charged once. See [`server/ai/README.md`](../../ai/README.md).

The result union is `ready` (complete specification and assumptions), `needs_clarification` (one question), or `unsupported` (explanation). Every response must have the exact expected keys and mutually exclusive fields. A ready result is normalized by the existing strict validator and checked by the **actual Google planner before it becomes a draft**. A planner rejection becomes `unsupported`, not a silently altered form. Malformed/partial model output is refused; it cannot reach the provider. The prompt documents the six implemented question types, Google section-routing limitations, sensible defaults, non-invention of sensitive choices and revision preservation of existing questions/ids. It is still model output: the user must review it. We have not tested its real-world interpretation quality against a live model.

The provider is Google only. A request needing native date/file upload, explicit sections, arbitrary conditions, response validation or another unsupported setting should be declined or clarified, not approximated without disclosure. Email maps to a Google short-answer item; the review displays the engine's warning that Google's API cannot enable email-format validation. Phone/number are short-text, not validated widgets. Google creates routing sections automatically only for supported visibility rules. Microsoft creation is not offered.

## API and state

All routes require a Better Auth session. POST and DELETE require the existing exact trusted-origin check before reading a body. Bodies are JSON, max 64 KiB; request text max 3,000 characters; a clarification max 1,000. Unknown input keys (including user ids, connection ids and tokens) are rejected. Responses are no-store with a request id and never contain provider credentials.

| Route | Request | Result |
| --- | --- | --- |
| `POST /api/forms/interpret` | `{ "provider":"google", "request":"...", "clarification"?:"..." }` | `{ status:"ready", draft }` or `{ status:"needs_clarification", question }` or `{ status:"unsupported", explanation }`. |
| `POST /api/forms/revise` | `{ "draftId":"<uuid>", "version":1, "request":"...", "clarification"?:"..." }` | Same statuses. Revision supplies the **server's** current specification to the model; no provider call. |
| `GET /api/forms/draft/:id` | None | Session-owned current specification, assumptions, warnings, status and the last public creation result. Used to check status after a lost response. |
| `DELETE /api/forms/draft/:id` | None | Discard a **ready** draft, never a provider form. |
| `POST /api/forms/confirm` | `{ "draftId":"<uuid>", "version":1, "confirm":true }` | The **existing** form engine's creation result plus draft state. A repeat confirmation after success or an uncertain/partial outcome replays the saved outcome without contacting Google; only a definitively not-created failure leaves the draft ready for a deliberate retry. |

`form_draft` is migration `003_form_drafts.sql`; apply with `npm run db:migrate:intake` **after** Better Auth migrations. It holds the current validated specification separately from assumptions and the eventual public creation result, with `user_id` FK and a monotonically increasing optimistic `version`. No conversational transcript, respondent data or OAuth credentials are stored. A revision is a compare-and-swap of `(user_id, id, version, status='ready')`. Only an atomic `ready → creating` claim permits a provider operation. A known `not_created` failure releases the draft so the user can reconnect/fix it and confirm again. A success becomes `created`; a partial or uncertain outcome becomes `blocked` and can never be submitted again. A crash or failed result write leaves `creating` locked; do **not** automatically release it — check Recent forms and Google Forms, and investigate with the request id. An already-created draft replays its real links without a new operation. The existing engine still revalidates on confirmation and resolves the OAuth connection from the session.

Only the opaque draft id is stored in browser `sessionStorage` to reopen a draft in the **same tab** on reload. The form specification stays on the server. Initial clarification context and revision instruction/answer are temporary browser state, not a chat table; a reload during clarification requires asking again. A browser session that loses its draft id cannot browse old unpublished drafts (created forms still appear under Recent forms). Discarded ready drafts are deleted; created/blocked drafts remain for safety/audit. Retention and draft recovery/search are future work.

The router can retain direct `POST /api/forms` for isolated compatibility tests, but production passes `allowDirectCreation: false` and returns HTTP 405 before parsing the specification. Do not enable it in a deployed service: it has no persisted review step or draft idempotency claim.

## Cost, failures, privacy

- One model call in flight per user per API process, plus PostgreSQL-backed user/network limits: **8 AI calls / 10 minutes per user** and a broader network ceiling. Confirmed creation, editing, provider reads/import/refresh, and OAuth lifecycle operations also use distributed technical limits. Limiter failure stops expensive work before the model/provider call. See the [production guide](../../../PRODUCTION.md) for exact ceilings and proxy caveats. Inference has a 30-second timeout, 6,000 max completion tokens, and bounded response size. There is no automatic model or form-creation retry.
- Only event names, request/user/draft ids, durations, issue counts/statuses and question counts are logged; not requests, questions, options, descriptions, OAuth credentials, raw model/provider bodies or full chat content. Provider errors retain the engine's existing bounded diagnostic policy.
- Inference sends the user's form request and, for revisions, the current form specification to the configured provider (Groq by default). Do not enter sensitive respondent data in the **form description**. Intake stores specifications, not collected responses. The provider hosts responder pages and responses.
- A browser/network timeout during confirmation is **ambiguous**; the UI disables another create until the draft status has been checked. If still `creating`, it will not be automatically retried. If Google created an incomplete form, the response includes a safe edit link and the draft stays blocked. This avoids making a duplicate just because a response was lost.

## Configuration

- **Local server startup:** Node 22+, `npm ci`, a Neon-compatible `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ characters), and `BETTER_AUTH_URL` (the exact public frontend origin). Run `npm run db:migrate`, then `npm run db:migrate:intake` to apply all tracked migrations through `007` (credits). Run `npm run dev:api` and `npm run dev` in separate terminals; the Vite `/api` proxy is relative in browser code. Without a database the API fails closed. Blank `GROQ_API_KEY` (and `OPENAI_API_KEY`) does not prevent startup, but interpretation reports an explicit configuration error.
- **Automated tests/build:** `npm test`, `npm run typecheck`, `npm run build`. No credentials, Neon, model billing or Google account are needed; tests use mocked inference and a stateful Google Forms API emulator.
- **Credits:** Each interpretation is one metered logical operation. A free account starts each UTC day with 20 credits; Pro adds a 500-credit monthly reserve. `GET /api/credits` (and the `credits` field on successful interpretation responses) shows the balance; `402 insufficient_credits` means the account is out of credits and no model call was made. Prices and the ledger are documented in [`server/credits/README.md`](../../credits/README.md).
- **Live model interpretation:** Add `GROQ_API_KEY` on the **API server** only. Optionally set `GROQ_MODEL` (default `openai/gpt-oss-120b`) or `GROQ_REASONING_EFFORT`. `AI_PROVIDER` and `OPENAI_API_KEY`/`OPENAI_MODEL` remain available for an OpenAI deployment. Confirm the provider account has API access, quota and billing as appropriate; the repository cannot provision them.
- **Real Google Form creation:** Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, a Google consent screen allowing `forms.body`, the exact OAuth redirect URI, and enable the Google Forms API. Connect Google in the Intake workspace as a signed-in user. `PROVIDER_TOKEN_KEY` is recommended for production. These values belong on the API server, never in Vite. Microsoft OAuth credentials are optional and do not enable Microsoft Forms creation.

## Live verification

**Not run in this checkout**: no Neon URL, Groq/OpenAI key, Google Cloud OAuth credentials or real connected Google account were available. Groq's interpretation quality, and whether `openai/gpt-oss-120b` returns valid strict-schema output for realistic prompts, can only be proven with a live key.

1. Apply Better Auth and all Intake migrations to the intended Neon database. Open `/app/forms` through the authenticated frontend origin.
2. With a live model key, describe a simple registration form; verify title, required/optional questions, choices, assumptions and the email warning. Check the provider's actual branch/section layout is not claimed for unsupported requests. Ask a clarification-worthy and an unsupported request. Revise the first draft twice; refresh the tab and check the server-owned current version remains.
3. Confirm no Google call/form before **Create form**. Connect Google with `forms.body` permission, explicitly confirm, and inspect the resulting real Google edit and responder pages, publish state and a test response.
4. Double-submit the same draft, refresh, and confirm the result replays the same provider form id. Induce a safe authorization failure (reconnect then retry), an incomplete build and an ambiguous create timeout in a non-production test account; verify no automatic duplicate.
5. Verify logs contain request ids but not the prompt, options or credentials. Verify signing out or switching Intake users cannot read or confirm another user's draft.

The model's ability to interpret nuanced real prompts and Google's acceptance of the adapter's actual requests still need this live test; mocks cannot prove either. Do not claim an end-to-end live form has been created until those checks are done.
