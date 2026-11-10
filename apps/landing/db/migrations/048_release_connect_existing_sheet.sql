-- The "connect a spreadsheet you already have" release note.
--
-- Choosing an existing spreadsheet is a new way into the same sync engine: Google's own file chooser
-- picks the file, one worksheet is chosen, and the engine appends to it. This migration seeds the
-- changelog entry so the site and the database agree; the entry is bundled with the site as well
-- (src/content/changelog.ts).
--
-- It also refreshes the closing paragraph of the previous entry ('keep-responses-in-a-sheet'): that
-- paragraph said connecting an existing spreadsheet was not built yet, which stopped being true with
-- this release. Nothing else in that entry changes, and the statement is a no-op if that copy is
-- already current.
--
-- It creates nothing else. Migration 045 holds the sync tables and 047 the destination columns; this
-- file only writes the notes.
--
-- Rollback: DELETE FROM release WHERE slug = 'connect-a-spreadsheet-you-already-have'; — the entry
-- disappears. No spreadsheet, sync or connection is touched.

INSERT INTO release (id, slug, title, summary, body, categories, status, release_date, links, highlights, audience, published_at, created_at, updated_at)
VALUES (
  'rel_connect_a_spreadsheet_you_already_have', 'connect-a-spreadsheet-you-already-have', 'Connect a spreadsheet you already have',
  'Keeping answers in a sheet used to mean letting Intake make the sheet. Now you can point it at one you already have: pick it in Google’s own file chooser, choose the tab, and Intake adds rows to it without touching anything else in the file.',
  $notes$## The obvious next question
Keeping responses in a spreadsheet shipped, and the first thing everybody asked was the sensible thing: what if I already have a spreadsheet? A tracker you have been filling in by hand, a dashboard a client looks at, a sheet with formulas in the columns to the right of the answers. Making a new sheet and copying everything across was not a real answer.
So the panel now offers two things. Create a new spreadsheet, which works exactly as before. Or connect an existing one, which opens Google’s own file chooser, lets you pick a file, then shows you its tabs and asks which one the answers belong in.
## What Intake can and cannot see
This is the part worth being precise about, because it is where a feature like this usually overreaches.
Intake cannot browse your Drive, and it never could. When you pick a spreadsheet in Google’s chooser, Google gives Intake access to that one file — that act of picking is the permission. Everything else in your Drive stays invisible: documents, photos, the other spreadsheets, the folder this one happens to sit in.
No new Google permission was added to make this work. The permission Intake already has for spreadsheets is per-file, and a file you pick counts. That is the whole reason the chooser is the right way to do this rather than a list of your files.
Nothing about your Google account changes if you never press the button. Creating a new spreadsheet, reading responses, and connecting Google Forms all work exactly as they did.
## Being careful around somebody else’s work
A spreadsheet you made is not Intake’s to tidy up. So before anything is written, Intake looks at the tab you chose and works out which of three situations it is in.
An empty tab is easy: it gets the header row and then the answers, starting with the ones already in the form.
A tab that already holds this form’s answers is also fine. Intake recognises the columns, leaves the header alone, and adds only the answers that are missing — the same check that stops duplicates on a sheet it made itself.
Anything else is refused. If the tab has a header of its own, or data that is not this form’s, or notes typed into the columns beside the table, Intake says so and stops. It will not clear the tab, will not overwrite a header, will not move your notes down to make room, and will not decide for you which column was meant to be the name.
That last case — notes beside the table — is worth explaining, because it is the one people are surprised by. Adding rows in the middle of a sheet pushes everything beside them down. Intake could do that quietly. It does not, because it would break whatever those notes were lined up with.
## Changing your mind later
You can point a form at a different spreadsheet whenever you like. The panel explains what switching means before it happens: this form stops adding to the old sheet, the old sheet keeps every row it already has, and the new one starts from the beginning.
The old file is not deleted, not emptied and not edited. It is your file, and Intake does not touch it once it stops writing to it.
## When Google moves the furniture
Tabs get renamed. They get deleted. Somebody replaces a header row with their own. None of that should ever end with answers landing in the wrong place.
Renaming a tab is harmless — Intake stores the tab’s identity, not its name, and the name it shows you follows whatever the tab is called now.
A deleted tab stops the sync and says the tab is gone, with one button to choose a different one. The rest of the file is untouched. A replaced header stops the sync too, rather than writing under columns that now mean something else. If the tab still holds exactly the header Intake wrote but the form’s questions have since changed, it says that instead — because the fix is different.
## What is not here yet
There is still no filter: a connected spreadsheet gets every response to the form, in order. Intake does not write to a second tab, does not create charts or formulas, and does not read anything back out of your file. And if you want all of this in a database rather than a spreadsheet, the CSV download is still the way.$notes$,
  ARRAY['feature'], 'published', DATE '2026-11-10',
  '[{"label":"Changelog","url":"/changelog"},{"label":"Trust and permissions","url":"/trust"}]'::jsonb,
  ARRAY['Two clear choices on the form’s spreadsheet panel: create a new spreadsheet, or connect an existing one.', 'Picking happens in Google’s own file chooser. You see your files; Intake only ever receives the one you picked, and it cannot browse your Drive.', 'You choose which tab the rows go into. Intake remembers the tab itself, so renaming it later changes nothing.', 'An empty tab gets the header row and is filled from the start. A tab that already holds this form’s answers is continued — the answers already in it are skipped, not repeated.', 'A tab with somebody else’s data in it is refused, with the reason. Intake never clears a tab, never replaces a header it did not write, and never guesses which column is which.', 'Switching to a different spreadsheet asks you first, and the old one is left exactly as it was — nothing deleted, nothing edited.', 'No new Google permission was added for any of this. Choosing a file in the chooser is what grants access to that file.'],
  'For anyone who already has a tracker, a dashboard or a client’s sheet, and would rather the answers went there.',
  TIMESTAMPTZ '2026-11-10T09:30:00.000Z', TIMESTAMPTZ '2026-11-10T09:30:00.000Z', TIMESTAMPTZ '2026-11-10T09:30:00.000Z'
)
ON CONFLICT (slug) DO NOTHING;

-- The previous entry no longer ends by promising this one.
UPDATE release
   SET body = replace(body, $old$Syncing only works with spreadsheets Intake created. Pointing it at a spreadsheet you already have needs Google’s own file chooser in the flow, and that is the next piece, not this one. There is also no filter: a sync takes every response to the form, all of it, in order. And if you want the answers in a database rather than a spreadsheet, that is still the CSV.$old$, $new$When this shipped, syncing only worked with spreadsheets Intake created; connecting one you already have came next, and is in “Connect a spreadsheet you already have”. There is no filter: a sync takes every response to the form, all of it, in order. And if you want the answers in a database rather than a spreadsheet, that is still the CSV.$new$),
       updated_at = now()
 WHERE slug = 'keep-responses-in-a-sheet'
   AND body LIKE '%' || $old$Syncing only works with spreadsheets Intake created. Pointing it at a spreadsheet you already have needs Google’s own file chooser in the flow, and that is the next piece, not this one. There is also no filter: a sync takes every response to the form, all of it, in order. And if you want the answers in a database rather than a spreadsheet, that is still the CSV.$old$ || '%';
