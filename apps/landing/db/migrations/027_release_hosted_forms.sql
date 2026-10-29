-- Phase: hosted forms for developers.
--
-- A feature developers can use is a public announcement, so it ships with a changelog entry like
-- everything else.
-- The entry is seeded here so the page and the changelog agree from the first request: the public
-- changelog reads the database first and the bundled notes second.
--
-- Rollback: DELETE FROM release WHERE slug = 'hosted-forms-for-developers'; — the page and its entry disappear together.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_hosted_forms_for_developers', 'hosted-forms-for-developers', 'Hosted forms, and the address they keep',
  'A developer can now build a form, publish it at a permanent address and put it in a page — with the answers checked on the server.',
  $notes$## What you can do now
Make a project, make a form in it, write the questions, and publish it. The form gets an address of its own — /forms/your-project/your-form — and a snippet you can paste into a page to embed it there instead.
The questions you can ask are the usual ones: a line of text, a paragraph, an email, a number, a date, a dropdown, one choice, several choices, or a box to tick. Each one can carry a label, a line of help text and a required flag.
## The address does not move
Editing a published form does not move it and does not rewrite it. A published version is frozen: the next edit becomes the next version, and the one people are answering stays exactly as it was. A snippet you pasted into a page last month still points at the same form, and the answers are still read against the version that was live when they arrived.
## What the server checks
Every answer is checked on the server against the published version: required questions answered, email addresses that look like email addresses, choices that are actually on the form, and nothing else smuggled in under a question that does not exist.
A retry is the same answer and not a second one. Each form makes one key when it loads and reuses it, so a double tap or a connection that drops halfway leaves one response, not two.
Nothing is stored that was not asked for. The referrer and the browser’s user agent are kept, shortened, because they answer “how did people find this form” without keeping a list of who visited.
## The look of it
A form that lives in an iframe on somebody else’s page cannot inherit that page’s stylesheet, its variables or its fonts. That is the browser’s rule, not a setting, so the theme is configuration: primary colour, background, text, border, typeface and corner radius, in light, dark or system, with a transparent background if you would rather your own page showed through.
## What is still to come
Answers are being stored, and the inbox to read them — with search, filters and a CSV export — is the next piece. Webhooks are not promised yet, and neither is an SDK: both are on the developer page under “not promised”, which is where they will stay until they are real.$notes$,
  ARRAY['feature'], 'published', DATE '2026-10-29',
  '[{"label":"Developers","url":"/developers"},{"label":"Changelog","url":"/changelog"}]'::jsonb,
  ARRAY['A form keeps its address for good, so a snippet pasted into a page keeps working.', 'Answers are checked against the version that was live, and a retry never sends the same person twice.', 'The theme is a setting, not an inheritance: an iframe cannot read your CSS, so the colours are configuration.'],
  'For developers who want a form in their product without a form system in their repo.',
  TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z', TIMESTAMPTZ '2026-10-29T00:00:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
