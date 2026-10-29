-- Phase: the developer platform, as one release.
--
-- Six developer capabilities shipped today. They are one thing to a developer, so the changelog
-- now says so: one release, with the problem, the solution and how to use it. The individual
-- entries stay where they are — their addresses do not move.
--
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'intake-for-developers'; — the page and its entry
-- disappear together. The other releases are untouched.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_intake_for_developers', 'intake-for-developers', 'Intake for Developers',
  'The whole developer platform in one release: build a form, publish it at an address that never moves, put it in your page, read the answers, and know what it cost.',
  $notes$## The problem we kept hearing
Intake was built for people. You describe the form you want in a sentence, Intake drafts the questions, you read them over, and they land in the Google or Typeform account you connected. That is a good shape for somebody who wants a form.
Developers kept asking a different question, and it was never "can Intake make a form". It was: I want the form at my address, in my page, and the answers where my code can reach them. Until today the honest answer was to use the provider's form, the provider's responses tab, and to write the integration yourself if you wanted the answers in your own system.
That is a lot to ask of somebody who only wanted to know how many people filled in their form. So today the developer platform arrives as one piece rather than six: the form, the checks, the inbox, the summary, the numbers, the notice, and the way to finish with a form when it has done its job.
## What is there now
### A form at an address that is yours
Make a project, make a form in it, write the questions, publish it. The form gets an address of its own — /forms/your-project/your-form — and a snippet you can paste into a page to embed it there instead. Editing a published form does not move it and does not rewrite it: a published version is frozen, the next edit becomes the next version, and the one people are answering stays exactly as it was.
A form that lives in an iframe on somebody else's page cannot inherit that page's stylesheet, its variables or its fonts. That is the browser's rule, not a setting, so the theme is configuration: primary colour, background, text, border, typeface and corner radius, in light, dark or system, with a transparent background if you would rather your own page showed through.
### Answers that are checked before they are stored
Every answer is checked on the server against the published version: required questions answered, email addresses that look like email addresses, choices that are actually on the form, and nothing else smuggled in under a question that does not exist. A payload is 32 kilobytes at most, a request has ten seconds to finish, and an address can send twenty submissions a minute.
A retry is the same answer and not a second one. Each form makes one key when it loads and reuses it, so a double tap, or a connection that drops halfway, leaves one response and not two.
### An inbox, and numbers you can trust
The responses are in the console: search them, filter them, page through them, open one, and export the lot as CSV. The count at the top is counted by the database rather than by the page, so the number of responses is the number of responses — not a model's guess at one, and not a number that drifts when you are looking at page nine.
### What the answers sound like
The same twenty credits a day you already have can summarise a set of responses for three credits. There is no second wallet and no second currency. The cost is shown before you run it, the exact counts are counted in SQL and printed beside the interpretation, and a provider that fails costs nothing at all.
### What it cost, and what it did
Every project reports what happened over the last thirty days: submissions accepted, requests refused, and the bytes stored — per project and across the platform. It is the number you need when somebody asks what this thing is costing.
### Hearing about new answers
Ask to be emailed when a project has new answers, every N answers or as a daily digest. It is off until you turn it on, it only ever goes to you, and a repeated trigger does not send the same notice twice.
### Finishing with a form
Pause it, close it, reopen it, archive it, delete it — from the console, without touching your site. The public endpoint enforces the state, so a closed form stops taking answers the moment you close it. A live form has to be closed before it can be deleted, and deleting one asks you to type its address first.
## How to use it
- Sign in and open the developer console at /app/developers.
- Make a project — the thing the forms and the answers belong to.
- Make a form in it and write the questions: short and long text, email, number, date, dropdown, one choice, several choices, or a box to tick. Each can carry a label, a line of help and a required flag.
- Publish it. You get an address and a snippet; paste the snippet into your page, or link to the address if you would rather the form had a page of its own.
- Read the answers in the inbox, export them as CSV, and run a summary when you want the shape of them rather than the rows.
- Turn on the notice if you want to hear about new answers instead of watching for them.
- Close, archive or delete the form when it has done its job.
## What it does not do yet
- There are no webhooks to your own backend. Today the inbox and the CSV are how the answers get out. The developer page says so in the same words, and it will say so there first when that changes.
- There is no SDK and no API key. The plain embed is the interface.
- The form lives on an Intake address, not on a domain of your own.
- There are no file uploads, and there is no payment collection inside a form.
- Paid plans are built but switched off: everybody is on the same free plan with twenty credits a day, and no price is promised before that changes.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label": "Developers", "url": "/developers"}, {"label": "Changelog", "url": "/changelog"}]'::jsonb,
  ARRAY['A form you build in the console, published at an address that never moves, with a snippet you can paste into a page.', 'Every answer is checked on the server against the version that was live — and a retry never sends the same person twice.', 'An inbox you can search, filter and export to CSV, with counts that come from the database rather than from the page.', 'Your answers summarised for three of the credits you already have, with the exact counts counted beside the interpretation.', 'Usage per project and in total: accepted, refused and stored, over the last thirty days.', 'An email when new answers arrive — every N answers, or a daily digest. Off until you turn it on.'],
  'For developers who want a form in their own page and the answers in their own hands, without building a form system first.',
  TIMESTAMPTZ '2026-10-29T15:00:00.000Z', TIMESTAMPTZ '2026-10-29T15:00:00.000Z', TIMESTAMPTZ '2026-10-29T15:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
