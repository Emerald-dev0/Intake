# AI provider layer

```text
User request
    ↓
FormInterpreter (server/forms/interpretation)      ← provider-independent
    ↓
AiProvider interface (provider.ts)
    ├── GroqProvider   (groq.ts)    ← primary
    ├── OpenAIProvider (openai.ts)  ← optional, explicitly selectable
    └── unconfigured   (provider.ts) → fails closed with model_not_configured
    ↓
OpenAI-compatible Chat Completions transport (chat-completions.ts)
```

Nothing outside this folder knows which vendor produced the structured output. The model never
controls Google Forms: it returns a JSON object that Intake validates with its own schemas, planners
and capability checks before anything is stored or executed.

## Files

| File | Responsibility |
| --- | --- |
| `provider.ts` | `AiProvider` interface, failure taxonomy, fail-closed stand-in |
| `chat-completions.ts` | Shared request body, bounded response reading, JSON extraction, HTTP → application error mapping |
| `groq.ts` | Groq endpoint, `GROQ_API_KEY`, `GROQ_MODEL` (default `openai/gpt-oss-120b`), optional `GROQ_REASONING_EFFORT` |
| `openai.ts` | OpenAI endpoint, `OPENAI_API_KEY`, `OPENAI_MODEL` (default `gpt-4o-mini`) |
| `registry.ts` | Deterministic provider selection + safe status description |
| `usage-scope.ts` | Per-operation collection of model calls (tokens, latency, outcome) |

## Configuration

| Variable | Where | Meaning |
| --- | --- | --- |
| `GROQ_API_KEY` | API service (Render) | Enables the primary provider |
| `GROQ_MODEL` | API service | Defaults to `openai/gpt-oss-120b` |
| `GROQ_REASONING_EFFORT` | API service | Optional `low`/`medium`/`high` |
| `AI_PROVIDER` | API service | Optional explicit `groq` or `openai`; a missing credential for the chosen provider is a startup error |
| `AI_MAX_COMPLETION_TOKENS` | API service | Optional 256–32768 ceiling per model call |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | API service | Optional alternate provider |

None of these may be `VITE_*` variables: anything with that prefix is compiled into the browser
bundle. Keys are sent only in the `Authorization` header of a server-side request and never appear in
a prompt, a log line quoted to the user, or an error message.

## Failure taxonomy

`model_not_configured` (missing/rejected credential or model settings) · `model_timeout` ·
`model_unavailable` (5xx or network) · `model_rate_limited` (429) · `model_provider_error` (other
non-OK) · `model_invalid_output` (unparseable, truncated, refused, wrong shape).

Raw provider bodies are never surfaced: each code has one safe, user-facing sentence, and the HTTP
status map lives in `server/forms/errors.ts` and `server/forms/edit-routes.ts`.

## Rules

1. **One attempt per call.** No internal retry and no cross-vendor fallback. Retrying could duplicate
   a downstream action and would make cost unpredictable.
2. **Validate everything.** A successful HTTP response is not structured output; the JSON must parse,
   satisfy the schema, and survive Intake's own validators.
3. **Observe, don't charge.** The transport records every call (success or failure). Credit pricing is
   decided elsewhere, by the server, per logical operation — see `server/credits/README.md`.
