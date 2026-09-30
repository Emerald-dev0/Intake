# Phase 6 — Describe, review, create

The authenticated `/app/forms` workspace accepts ordinary language instead of JSON. The landing playground is unrelated and still only a demo. Nothing external is created during interpretation or revision.

```text
User's request / change
   → server-side FormInterpreter (OpenAI structured JSON output)
   → strict interpretation-result check
   → existing parseFormSpecification + Google planGoogleForm
   → user-owned draft (PostgreSQL form_draft)
   → readable review / optional revisions
   → explicit POST /api/forms/confirm
   → atomic draft claim
   → existing FormEngine.createForm → user's Google connection → Google Forms API
   → actual responder/edit links or a truthful failure/partial state
```

The model never receives access/refresh tokens, calls a tool, selects a connection, or contacts Google. Only the server-session user id and the draft's Google provider determine the connection. The legacy structured-specification `POST /api/forms` remains available to developer clients; the natural-language UI does **not** use it. Read [../README.md](../README.md) for the engine's exact types, validation, Google routing constraints and failure semantics.

## Model integration

There was no AI SDK or inference service in the repository. The server-only `openai.ts` uses Node's built-in `fetch` with the OpenAI Chat Completions **strict JSON Schema** `response_format`. Default model: `gpt-4o-mini` (configurable with `OPENAI_MODEL`; choose another model only if it supports strict structured outputs). It was chosen because the [model reference](https://developers.openai.com/api/docs/models/gpt-4o-mini) lists Chat Completions, structured outputs and a relatively low token price; inference still requires an eligible API account and may incur charges. This avoids a new runtime dependency. It can be replaced by another `FormInterpreter` implementation without changing the routes, draft storage, or form engine. The credential is read only on the API service from `OPENAI_API_KEY`; it is never a `VITE_` variable. If missing or rejected, requests fail visibly as `model_not_configured`. No heuristic, fixture or fake inference substitutes for the model in production.

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

The existing `POST /api/forms` direct structured-spec API does **not** have a draft idempotency claim; developer clients must not blindly retry that endpoint. The user-facing workflow always goes through `/confirm`.

## Cost, failures, privacy

- One model call in flight per user and **8 calls / 10 minutes**; in-memory per API process, like the existing creation limiter. 30-second inference timeout, 6,000 max completion tokens, 120 KiB max model response. There is no automatic model or form-creation retry. A production multi-instance deployment needing a global quota should move inference limits to shared storage.
- Only event names, request/user/draft ids, durations, issue counts/statuses and question counts are logged; not requests, questions, options, descriptions, OAuth credentials, raw model/provider bodies or full chat content. Provider errors retain the engine's existing bounded diagnostic policy.
- Inference sends the user's form request and, for revisions, the current form specification to OpenAI. Do not enter sensitive respondent data in the **form description**. Intake stores specifications, not collected responses. The provider hosts responder pages and responses.
- A browser/network timeout during confirmation is **ambiguous**; the UI disables another create until the draft status has been checked. If still `creating`, it will not be automatically retried. If Google created an incomplete form, the response includes a safe edit link and the draft stays blocked. This avoids making a duplicate just because a response was lost.

## Configuration

- **Local server startup:** Node 22+, `npm ci`, a Neon-compatible `DATABASE_URL`, `BETTER_AUTH_SECRET` (32+ characters), and `BETTER_AUTH_URL` (the exact public frontend origin). Run `npm run db:migrate`, then `npm run db:migrate:intake` to apply `001`, `002`, `003`. Run `npm run dev:api` and `npm run dev` in separate terminals; the Vite `/api` proxy is relative in browser code. Without a database the API fails closed. Blank `OPENAI_API_KEY` does not prevent startup, but interpretation reports an explicit configuration error.
- **Automated tests/build:** `npm test`, `npm run typecheck`, `npm run build`. No credentials, Neon, model billing or Google account are needed; tests use mocked inference and a stateful Google Forms API emulator.
- **Live model interpretation:** Add `OPENAI_API_KEY` on the **API server** only. Optionally set a supported `OPENAI_MODEL` (default `gpt-4o-mini`). Confirm the provider account has API access, quota and billing as appropriate; the repository cannot provision them.
- **Real Google Form creation:** Configure `GOOGLE_OAUTH_CLIENT_ID`, `GOOGLE_OAUTH_CLIENT_SECRET`, a Google consent screen allowing `forms.body`, the exact OAuth redirect URI, and enable the Google Forms API. Connect Google in the Intake workspace as a signed-in user. `PROVIDER_TOKEN_KEY` is recommended for production. These values belong on the API server, never in Vite. Microsoft OAuth credentials are optional and do not enable Microsoft Forms creation.

## Live verification

**Not run in this checkout**: no Neon URL, OpenAI key, Google Cloud OAuth credentials or real connected Google account were available.

1. Apply Better Auth and all Intake migrations to the intended Neon database. Open `/app/forms` through the authenticated frontend origin.
2. With a live model key, describe a simple registration form; verify title, required/optional questions, choices, assumptions and the email warning. Check the provider's actual branch/section layout is not claimed for unsupported requests. Ask a clarification-worthy and an unsupported request. Revise the first draft twice; refresh the tab and check the server-owned current version remains.
3. Confirm no Google call/form before **Create form**. Connect Google with `forms.body` permission, explicitly confirm, and inspect the resulting real Google edit and responder pages, publish state and a test response.
4. Double-submit the same draft, refresh, and confirm the result replays the same provider form id. Induce a safe authorization failure (reconnect then retry), an incomplete build and an ambiguous create timeout in a non-production test account; verify no automatic duplicate.
5. Verify logs contain request ids but not the prompt, options or credentials. Verify signing out or switching Intake users cannot read or confirm another user's draft.

The model's ability to interpret nuanced real prompts and Google's acceptance of the adapter's actual requests still need this live test; mocks cannot prove either. Do not claim an end-to-end live form has been created until those checks are done.
