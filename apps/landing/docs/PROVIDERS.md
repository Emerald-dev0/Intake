# Providers: what works, what is next, and how the next one lands

Intake is a form builder that writes into somebody else's account. That makes the provider list the
product's horizon, not a marketing flourish: every new provider is a new OAuth app, a new scope
negotiation, a new form-writing client, and a new honesty problem on the public site.

This document is the map. For the Typeform console walkthrough specifically, see
[`TYPEFORM.md`](./TYPEFORM.md). For the connection layer's data model, encryption and token
lifecycle, see [`../server/providers/README.md`](../server/providers/README.md).

## Status, in one table

| Provider | Connection | Create | Edit in place | Import | Notes |
| --- | --- | --- | --- | --- | --- |
| Google Forms | Live | Yes | Yes | Yes | `forms.body` for create/edit; `forms.responses.readonly` only as an optional, separately requested permission for Response Insights and the CSV export of responses. No Drive scope. |
| Typeform | Live | Yes | Yes, with limits | Yes | `accounts:read`, `forms:read`, `forms:write`, `offline`. Edit is a verified read-modify-write; deletes, type changes and reordering a form with logic are refused (see [TYPEFORM.md](./TYPEFORM.md)) |
| Microsoft | Live, identity only | No | No | No | No supported Forms API exists; the UI says so |
| SurveyMonkey | Planned | — | — | — | Public roadmap |
| Google Sheets | Planned | — | — | — | Public roadmap; would need its own narrow sheets scope |
| Jira | Planned | — | — | — | Public roadmap |
| n8n | Planned | — | — | — | Public roadmap |

"Planned" means exactly one thing: the name and mark appear in the homepage roadmap under
**Next in line**, monochrome, behind a `PLANNED` chip, and never in a sentence that implies it works.
No dates. No "coming soon". No waitlist for a provider.

Those four names live in `src/content/site.ts` (`ROADMAP_PROVIDERS`) so the homepage, the footer
roadmap line, the marketing pages and the no-script fallback cannot drift apart. Adding or removing a
name there changes every surface at once.

## The layers a provider touches

Adding one is not a single file. Work through these in order; the checklist at the end is the short
version.

1. **Registry** — `server/providers/registry.ts` defines the OAuth shape: authorization and token
   endpoints, whether PKCE applies, whether an OIDC nonce applies, requested and required scopes,
   the identity probe, revocation support, and the human-readable scope descriptions the consent
   screen shows. Only providers whose registry entry resolves to a configured client id and secret
   appear as connectable.
2. **Connection storage** — `provider_connection` already handles any `provider` id, so a new
   provider normally needs no migration. Tokens are encrypted with AES-256-GCM whose associated data
   binds `user + provider + field`.
3. **Routes** — `server/providers/routes.ts` serves `POST /api/providers/:provider/start` and
   `GET /api/providers/:provider/callback`. A new redirect URI is
   `{BETTER_AUTH_URL}/api/providers/<id>/callback`, and nothing else.
4. **Form client** — `server/forms/providers/<id>/` implements create, read and (where the API allows
   it) update behind the shared boundary. If the provider has no supported API, do not write the
   client and do not fabricate a form: Microsoft is the precedent, and the Connections screen states
   that it records identity only.
5. **Capability reporting** — the connection payload reports `formsApi: supported | unsupported` and
   a short note. The UI renders the note verbatim, so write it for a customer, not for a developer.
6. **Workspace UI** — `src/app/pages/ConnectionsPage.tsx` lists connections; the composer and library
   read capable providers. Nothing in the workspace may offer a provider that cannot act.
7. **Public surfaces** — in this order:
   - `src/components/ProviderLogos.tsx` — add the mark only if you have the brand's real geometry
     (Simple Icons, CC0). Live marks may use brand colour; planned marks are monochrome by
     construction (`PlannedProviderLogo` has no `tone` prop to get wrong).
   - `src/content/site.ts` — `LIVE_PROVIDERS`, `ROADMAP_PROVIDERS`, `ROADMAP_NOTE`, plus the title,
     description and FAQ answers.
   - `vite.config.ts` — the no-script fallback, the `llms.txt` facts, structured data, the sitemap.
   - `src/marketing/*` — hero lede, `#providers` board, footer roadmap line.
8. **Docs** — a `<PROVIDER>.md` runbook beside `TYPEFORM.md` (console steps, redirect URI, scopes and
   why each is asked for, what was verified without a live account, rollback), a row in the table
   above, and a note in `server/providers/README.md`.
9. **Tests** — `test/marketing-content.test.mjs` asserts the built document names the live providers
   and labels the roadmap; `test/marketing-experience.test.mjs` asserts the planned group renders
   monochrome with its `PLANNED` chip. A provider that ships without those assertions is a provider
   that will quietly become a lie on the homepage six months from now.

## Reading responses, and exporting them

Google Forms is the only provider Intake can read responses from, and it is the only one where
reading is a permission of its own. Everything below lives in
`server/forms/insights/` plus the Google client in `server/forms/providers/google/client.ts`.

### The permission

`forms.responses.readonly` is requested only through an explicit, optional grant: the button in
Response Insights, or the one on the Connections screen under Manage. Connecting Google Forms never
asks for it. Without it there is no response data of any kind — not a summary, not an empty file,
not a partial read. The API answers `403` with `code: "responses_scope_required"`, and the UI turns
that into the button that fixes it.

### Endpoints

| Route | What it does |
| --- | --- |
| `GET /api/forms/:id/insights` | Summary of the answers: counts, choices, averages, top phrases. Bounded at 5 pages of 200 responses. |
| `GET /api/forms/:id/insights/export.csv` | The full export: one row per response, streamed as it is read. |

Both routes run the same gate, in the same order: signed in → within the abuse limit → the form
belongs to the caller, is a Google form, and is finished → the plan is Pro → the Google connection is
usable → the response scope is granted. The export has no looser door than the summary. A missing or
foreign form answers `404` with no distinguishing detail, exactly as it does for a form that never
existed.

Error codes, unchanged from Response Insights:

| Code | Status | Meaning |
| --- | --- | --- |
| `pro_required` | 403 | Response reading is a Pro feature. |
| `reauthorization_required` | 403 | The Google connection is missing, expired, or was refused by Google. |
| `responses_scope_required` | 403 | The optional response permission has not been granted. |
| `no_responses` | 404 | The export ran and there is nothing in it (or nothing in the requested date range). |
| `invalid_since` | 400 | The `since` value is not an ISO 8601 timestamp or a `YYYY-MM-DD` date. |

### Pagination

`forms.responses.list` returns a `nextPageToken` and nothing else to page with, so both routes
follow the token until it is gone. The client clamps `pageSize` to Google's documented maximum of
5000 and treats an unspecified page size as "Google decides" rather than sending `0`. A page token
is only ever the one Google handed back: it must be a non-empty string of reasonable length, and it
is refused before a request is made if it is not.

The export asks for 1000 per page and caps itself at 400 pages (400,000 responses). The cap exists
to bound one request that a person is waiting on. If it is ever reached, the file says so in a line
of its own instead of ending as though it were the whole form.

### Filtering

The only filter Google documents for `forms.responses.list` is a timestamp comparison:

```
filter=timestamp > 2026-10-01T00:00:00Z     (or >=)
```

Intake builds that string itself from a validated timestamp. `?since=` on the export route accepts a
`YYYY-MM-DD` date (pinned to UTC midnight) or an RFC 3339 timestamp, with optional
`&since_exclusive=true`. Anything else is a `400 invalid_since`. No query parameter is ever forwarded
to Google, and unknown parameters are not read at all.

### The CSV

`server/forms/insights/export.ts` is pure: questions and responses in, a string out. It has no
network, no database, and no logger.

- **Shape** — three leading columns (`Response ID`, `Submitted at`, `Respondent email`) then one
  column per question, in form order, titled with the question as the owner wrote it.
- **Rows** — one per response. An unanswered question is an empty cell in its own column, so no
  answer ever shifts sideways. A multi-value answer keeps all its values in one cell.
- **Escaping** — RFC 4180: a cell is quoted when it contains a comma, a quote or a line break, and
  inner quotes are doubled. Line breaks inside an answer are kept; null bytes are dropped.
- **Formula injection** — a value or a question title starting with `=`, `+`, `-`, `@`, tab or
  carriage return is prefixed with `'`, so a spreadsheet reads it as text. The title matters as much
  as the answer here: a form owner can name a question `=cmd|calc`.
- **Times** — ISO 8601, UTC, normalized from whatever offset Google sent.
- **Branding** — a `#` comment block at the top names Intake, the form, and when the file was made.
  A client or a script can tell it from data at a glance. A closing line states the exact number of
  responses written; if the export stopped early it says that instead, so an incomplete file can
  never pass for a complete one.
- **Filename** — `intake-form-responses-YYYY-MM-DD.csv`, sent as
  `Content-Disposition: attachment` with `Cache-Control: no-store` and `nosniff`.

### Failure behaviour

The first page is fetched before any header is sent, so anything a person can act on arrives as a
normal JSON error with a real status. After the file has started, a failure is written into the file
as `# INCOMPLETE: …` with the count so far and the fix to try. Backpressure is respected: a slow
reader slows the paging instead of buffering the whole form, and if the reader goes away, paging
stops.

Retries are bounded (`server/forms/providers/google/retry.ts`): 429, 408, 5xx, timeouts and network
failures get up to three attempts with exponential backoff, jitter, and Google's `Retry-After`
honoured up to a 4 second cap. `400`, `401`, `403` and `404` are never retried — they are answers,
and retrying them only spends quota. There is no unbounded concurrency: one page at a time.

### What is not stored

No response body and no respondent email. On the summary and export paths they are held in local
variables for the length of one request and are never written to a table, a log line or a cache.
Never add logging of an answer, an email address or a token to this path — the tests in
`test/insights-export.test.mjs` and `test/forms-responses-client.test.mjs` are written to make that
kind of change loud.

The spreadsheet sync below does keep coordination state, including a list of response IDs. That is
documented there, in the privacy policy and in the changelog; it is not a copy of anybody's answers.

### Reading one response

`google.getResponse(token, formId, responseId)` exists in the client and reuses the same client,
token and error contract. It is not exposed as a route yet; when it is, it goes behind the same gate
as the export.

## Keeping responses in a spreadsheet

Live for Google Forms only. `server/forms/sheets/` holds all of it: the client, the store, the sync
engine, the worker and the routes. The rows are produced by the same code that produces the CSV
(`responseCells` in `server/forms/insights/export.ts`), so the two can never disagree about which
column an answer belongs in.

### The permission

`https://www.googleapis.com/auth/drive.file`, and nothing else.

- It is per-file: it reaches only the files this app created, plus files the person explicitly picks
  in Google's own file chooser. That is the whole reason it is the choice — `spreadsheets` is *sensitive* and would grant every spreadsheet the person owns, and
  `drive` / `drive.readonly` are *restricted* and would need a security assessment. Neither is
  requested anywhere in this repository.
- It is a separate optional capability (`sheets` in `server/providers/service.ts`), requested through
  the same incremental-auth route as `responses`. Connecting Google Forms never asks for it, and
  granting `sheets` never grants `responses`.
- The capability is proven from the scopes actually returned by Google, not from the scopes asked
  for. A grant that omits it leaves the panel in `awaiting_authorization` and every write route
  answers `403 sheets_scope_required`.

### Endpoints

| Route | What it does |
| --- | --- |
| `GET /api/forms/:id/sheets` | The state of this form's sync: one word for the screen, plus the destination and counters. Needs no Sheets permission; it is what tells the screen to ask for one. |
| `POST /api/forms/:id/sheets` | Creates the spreadsheet (title `[form] — Intake Responses`, tab `Responses`), writes the header, records the sync. `409 already_enabled` if one is already running. |
| `POST /api/forms/:id/sheets/enable` | Resumes a sync that was switched off, on the same spreadsheet. |
| `POST /api/forms/:id/sheets/sync` | Marks the sync due now. It does not do the work in the request: a form with years of answers would hold the browser open for minutes. |
| `DELETE /api/forms/:id/sheets` | Switches syncing off. The spreadsheet is never deleted. Deliberately needs no Google call, so it works even when the authorization has lapsed. |

Gate order is the insights order: signed in → abuse limit (`forms.sheets`, 10 per 10 minutes) → the
form is the caller's own, Google, and finished → plan is Pro → connection usable → `sheets` scope
granted. `DELETE` stops after the plan check.

### Connecting a spreadsheet the person already has

The panel offers two destinations, and they are deliberately not one button:

- **Create a new spreadsheet** — the behaviour above. Intake made the file, so it initialises it.
- **Connect an existing spreadsheet** — Google's own file chooser (Google Picker), then one worksheet
  in it, then an explicit confirmation. Intake appends to that worksheet and never restructures it.

Which files Intake can reach after this: **exactly the one spreadsheet that was picked**. Picking is
the grant — Google documents `drive.file` as reaching "files that the user shares with an app while
using the Google Picker API". Intake cannot browse Drive, cannot list a folder, and cannot see any
file that was not picked. Nothing broader is requested.

| Route | What it does |
| --- | --- |
| `GET /api/forms/:id/sheets/picker` | The values the browser needs to open the chooser: the public API key, the Cloud project number, and a **short-lived access token** (the same one the server uses). No refresh token, no client secret. `503 picker_unavailable` when the deployment has no key; `409 token_expired` when the grant has lapsed. |
| `POST /api/forms/:id/sheets/inspect` | `{ spreadsheetId }` → the file's title, URL and worksheets. `{ spreadsheetId, sheetId }` additionally returns the verdict for that worksheet and the header Intake would write. Writes nothing. |
| `POST /api/forms/:id/sheets/connect` | `{ spreadsheetId, sheetId, replace? }` → connects it. Inspects the worksheet **again** in this request, writes the header only when the worksheet is empty, and reuses the form's one `form_sheet_sync` row. |

The browser's spreadsheet id is a claim, not a fact: it is shape-checked (`^[A-Za-z0-9_-]{20,120}$`),
then read with the caller's own connection. A file they cannot open is `404 spreadsheet_not_found`
(with no hint that it exists), a file reachable without the picker grant is `403 spreadsheet_forbidden`,
a Google outage is `502 sheets_unavailable`, and rate limiting is `429 rate_limited`.

Worksheet verdicts (`server/forms/sheets/destination.ts`):

| Verdict | Meaning | What Connect does |
| --- | --- | --- |
| `empty` | No content in the first rows. | Writes the header row, then the sync engine fills it from the beginning. |
| `compatible` | The header row is exactly this form's columns. | Leaves the header alone; the engine skips response ids already in the sheet. |
| `unsuitable` | Somebody's own content, or a table for different questions, or content beside the table. | `409 worksheet_unsuitable` with the reason. Never writes. |

The worksheet is stored by its numeric `sheetId`, never by name, so renaming a tab changes nothing
(the display name is refreshed on the next run). A tab that is deleted stops the sync as
`worksheet_missing` — permanent, and recoverable by choosing another worksheet. A tab whose columns
were replaced stops as `worksheet_unsuitable`; a tab that still holds Intake's own header, but for
questions that have since changed, stops as `questions_changed`.

Switching a live sync to another destination is allowed but needs `replace: true`, which the panel
only sends after the person ticks the confirmation. The previous spreadsheet is never touched: not a
cell is written, cleared or deleted.

### Picker configuration

In the **same** Google Cloud project as the Forms client:

1. Enable **Google Picker API** (APIs & Services → Library).
2. Create an **API key**, then restrict it: *Application restrictions → Websites* with the exact
   origins (`https://intake.app/*`, `https://www.intake.app/*`, and the local dev origin), and *API
   restrictions → Google Picker API*. The key is public by design; the referrer restriction is what
   makes that acceptable.
3. Set `GOOGLE_PICKER_API_KEY` (the key) and `GOOGLE_PICKER_APP_ID` (the **project number**, not the
   name) on the API service. Both are optional: without them the option is disabled with a plain
   message and creating a new spreadsheet still works.

`server/forms/sheets/picker.ts` validates both values, and `server/preflight.ts` reports the state.
The key reaches the browser at runtime from the route above — never from a `VITE_`-prefixed build
variable, which this repo's preflight rejects.

### How the sync runs

There is no queue and no cron in this deployment (Render runs one web service). So:

- **The database is the queue.** `form_sheet_sync.next_sync_at` says what is due; a form that is not
  due is not touched. A restart, a deploy or a missed tick loses nothing, because the due time is a
  row, not a timer.
- **The timer is only a nudge.** `server/forms/sheets/worker.ts` ticks every 20 seconds and claims
  up to 5 forms, 2 at a time, with an `unref()`ed interval and a `stop()` that waits for in-flight
  work. It starts next to the waitlist delivery loop in `server/index.ts`.
- **One worker per form.** `claimDue` takes a 5-minute lease in a single statement with
  `FOR UPDATE SKIP LOCKED`. A second instance — a rolling deploy, or the service scaled to two — gets
  nothing. A lease that expires is reclaimed, so a process that dies mid-run does not strand a form.
- **A superseded run is fenced.** Every write is `WHERE run_id = $1`; a run whose lease was taken
  over throws `StaleSyncRunError` and records nothing.

Cadence: a form that just wrote rows is due again in 60 seconds, an idle one in 5 minutes, a form
with more history than one run can write is due again immediately. A failure schedules its own retry
(exponential backoff with jitter, capped at 30 minutes, `Retry-After` honoured) and a permanent
failure — revoked permission, missing spreadsheet, changed questions — is set 24 hours out instead of
being retried in a loop.

### Idempotency, and the window Google does not close

Appending rows and recording that you appended them are two systems with no transaction between
them. If the append lands and Intake dies before it writes down that it landed, a naive retry
duplicates the rows. Response IDs in Intake's own table cannot solve that on their own, because the
failure is precisely a missing record.

The design makes the spreadsheet the ledger:

1. Every run begins by reading the destination: `values:batchGet` of `'Tab'!1:1` and `'Tab'!A1:A`.
   That is the header row and every response ID already in the file.
2. Anything in that column is skipped and counted, whatever `form_sheet_row` believes. A row somebody
   deleted from the sheet is therefore written again rather than silently lost.
3. Only the remainder is appended, in chunks of 400, with `valueInputOption=RAW` and
   `insertDataOption=INSERT_ROWS`. A write is **never** retried inside a run: a retried append is
   exactly how duplicates happen.
4. The cursor (`cursor_last_submitted`) is advanced, and the IDs recorded, only after the append
   succeeded. A failed or ambiguous append leaves the cursor where it was.
5. The next run reads the sheet again, so an ambiguous append reconciles itself: what landed is
   skipped, what did not is written once.

The cursor is an inclusive lower bound (`timestamp >= cursor`), because Google's timestamps are not
unique — two responses can share a millisecond. Rows are de-duplicated by response ID, which is
unique, and the run stops at 2000 rows per form so a long history cannot hold a worker forever; it
says `more` and is due again immediately.

### Failure classification

| Condition | Code | Retry |
| --- | --- | --- |
| Sheets 401/403, or a connection that cannot be refreshed | `permission_revoked` | 24 hours; the panel offers to allow the permission again |
| Sheets 404/400 | `destination_unavailable` | 24 hours; the panel offers a new spreadsheet |
| Header mismatch on a sheet that already has rows | `questions_changed` | 24 hours; never guesses a column |
| Sheets 429 / 5xx / timeout / network | `rate_limited` / `sheets_unavailable` | backoff, capped at 30 minutes |
| Forms 404 | `form_unavailable` | 24 hours |
| Anything else | `internal_error` | backoff |

A transient failure never blocks future runs, and a permanent one is never retried indefinitely.
Nothing about a failure advances the cursor.

### What is stored, and what is not

`form_sheet_sync` holds one row per form: destination, tab id and title, header signature, status,
cursor, counters, last error, schedule and lease. `form_sheet_row` holds `(sync_id, response_id)`
and nothing else. Neither table holds an answer, a respondent email or a token, and both are deleted
with the form. The IDs exist only so the common case is one cheap comparison rather than a full
re-read, and the sheet — not the table — decides what has been written.

Deleting a form stops its sync (cascade). Disabling a sync clears the lease and stops the schedule.
Neither touches the spreadsheet: Intake does not delete files in somebody's Drive.

## The honesty rule

A provider is **live** on the public site only when all four of these are true:

1. the OAuth connection completes against the real provider (not an emulator, not a fixture),
2. the scope list is the narrowest one that makes the feature work, and every extra scope has a
   sentence explaining why,
3. a form is actually created in a real account, and the responder link opens,
4. `docs/<PROVIDER>.md` records what was verified, by whom, and what was not.

Until then it is **planned**: name and mark only, monochrome, behind a chip, with no date.

Anything else — a coloured logo next to a working provider, an FAQ answer in the future tense, a
tooltip saying "beta" — is the kind of claim this project has already had to walk back once. Don't
ship it.

## Checklist

```
[ ] registry entry + env keys in .env.example (never VITE_)
[ ] redirect URI registered: {BETTER_AUTH_URL}/api/providers/<id>/callback
[ ] scopes justified in docs/<PROVIDER>.md, one line each
[ ] identity probe labels the connected account
[ ] form client in server/forms/providers/<id>/ (or a documented "no API" decision)
[ ] capability note written for a customer
[ ] Connections UI + composer only offer what can act
[ ] LIVE_PROVIDERS / ROADMAP_PROVIDERS updated
[ ] homepage hero, #providers board, footer line, FAQ
[ ] no-script fallback + llms.txt + structured data
[ ] marketing tests updated (live marks, planned chips, no-script text)
[ ] tsc (app + server), vite build, full test suite
[ ] runbook + rollback in docs/<PROVIDER>.md
```

## Rollback

Set the provider's client id/secret to empty. The registry stops resolving it, the connect button
disappears, and the server refuses to start an authorization it cannot finish. Existing connections
stay in the database but cannot be refreshed; the UI reports them as needing reconnection. Nothing
breaks for other providers, and no migration is needed.
