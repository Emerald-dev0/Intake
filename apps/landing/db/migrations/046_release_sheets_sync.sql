-- The spreadsheet sync release note.
--
-- A form can have its own Google Sheet now: Intake creates it, writes the header, and appends rows
-- on a schedule. This migration seeds the changelog entry so the site and the database agree, and
-- the entry is bundled with the site as well (src/content/changelog.ts).
--
-- It creates nothing else. Migration 045 holds the sync tables; this file only writes the note.
--
-- Rollback: DELETE FROM release WHERE slug = 'keep-responses-in-a-sheet'; — the entry disappears.
-- The sync tables and any spreadsheet already created are untouched.
--
-- The closing paragraph was corrected when "connect a spreadsheet you already have" shipped: it had
-- said connecting an existing spreadsheet was not built yet. This migration had not been applied to
-- any environment at that point; migration 048 also carries the same correction as an UPDATE, so an
-- environment that did apply it earlier still ends up with the current copy.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_keep_responses_in_a_sheet', 'keep-responses-in-a-sheet', 'Keep every response in a spreadsheet',
  'A form can have its own Google Sheet now, made by Intake in your Drive and updated on a schedule. It reads the sheet before it writes, so an answer that already landed is never written twice.',
  $notes$## The gap this closes
Reading responses in Intake worked. Downloading them as a CSV worked. What did not work was the thing people actually do with answers: put them in a spreadsheet and keep looking at it. That meant downloading a file, opening it, and repeating the whole thing tomorrow — and every download was a decision about which columns were which.
A form can now have a spreadsheet of its own. Intake creates it in your Google Drive, writes the header row once, and adds a row for each response as it arrives. The columns are the same as the CSV: the response ID, when it was submitted, the respondent’s email when the form collects one, then one column per question in the order the form asks them.
## Why it is not instant, and why that is fine
Google Forms does not tell other software when a new response arrives. There is no notification to subscribe to, and this deployment has no queue or cron to hang one off, so the honest answer is that Intake asks. It asks once a minute while a form is busy and every few minutes while it is quiet. A new answer usually shows up within a minute or two, and a form with years of answers fills in over a few minutes in the background rather than making you wait on a page.
Anything that claims to update a Google Sheet the instant somebody clicks Submit is either subscribed to something Google does not offer, or guessing. We would rather say how it works.
## The hard part: writing twice
Appending rows to a spreadsheet and recording that you did are two separate things, and nothing ties them together. If the rows land and the process dies before it writes down that they landed, a retry writes them again — the same answers, twice, in a file somebody is reading.
So the spreadsheet is the record. Before every run, Intake reads the Response ID column of the destination and skips anything already in it, whatever its own bookkeeping believes. Only then does it append the rest, in bounded chunks, with the cursor moved forward after the write and the note about the write both succeed. A write is never retried inside a run: if the answer is unclear, the next run looks at the sheet and works out what actually happened. The list of response IDs Intake keeps is a shortcut for the common case, never the authority.
## What it asks for, and what it does not touch
Google asks one permission for this: spreadsheets the app created itself. It is called drive.file, and it is the narrowest permission that can do the job. Intake cannot browse your Drive, open a spreadsheet it did not make, or read a document, a photo, or anything else you keep there. The two broader options were rejected on purpose: the full Drive scope would cover every file you own, and the spreadsheets scope would cover every spreadsheet you own.
It is asked for at the moment you set up syncing for a form, never when you connect Google Forms, and never when you open response insights. If you say no, nothing else changes.
## What happens when things go wrong
A spreadsheet you deleted or moved out of reach is reported as exactly that, and Intake offers to start a new one. It never deletes or moves a file in your Drive, and turning syncing off leaves the spreadsheet and everything in it untouched.
A permission you removed shows up as a permission you removed, with one button to allow it again — syncing resumes at the point it stopped. A brief failure at Google is described as a short break, because it is one: Intake waits, tries again, and never advances past answers it did not write. And if the form’s questions changed after rows were written, syncing stops with an explanation instead of quietly filing new answers under old headings.
## What is not here yet
When this shipped, syncing only worked with spreadsheets Intake created; connecting one you already have came next, and is in “Connect a spreadsheet you already have”. There is no filter: a sync takes every response to the form, all of it, in order. And if you want the answers in a database rather than a spreadsheet, that is still the CSV.$notes$,
  ARRAY['feature'], 'published', DATE '2026-11-06',
  '[{"label":"Changelog","url":"/changelog"},{"label":"Trust and permissions","url":"/trust"}]'::jsonb,
  ARRAY['One row per response, one column per question, in the order the form asks them — the same layout as the CSV download.', 'Intake creates the spreadsheet called “[form name] — Intake Responses” and keeps one link to it on the form. Turning syncing off never deletes it.', 'It is not instant. While a form is getting answers Intake checks about once a minute, and every few minutes when it is quiet, so an answer usually appears within a minute or two.', 'Before writing, it reads the sheet’s Response ID column and skips anything already there — which is what stops a duplicate when a write landed but Intake never heard back.', 'One extra, optional Google permission: spreadsheets Intake created itself. Nothing else in your Drive is visible, and connecting Google Forms still asks for nothing new.', 'If the form’s questions changed after answers were written, syncing stops and says so rather than putting new answers under headings that mean something else.', 'It is part of Pro. Your answers stay in Google Forms and in your sheet; Intake keeps no copy of them, only the list of response IDs it has written.'],
  'For anyone who reads the same spreadsheet every morning and would rather it filled itself.',
  TIMESTAMPTZ '2026-11-06T18:30:00.000Z', TIMESTAMPTZ '2026-11-06T18:30:00.000Z', TIMESTAMPTZ '2026-11-06T18:30:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;
