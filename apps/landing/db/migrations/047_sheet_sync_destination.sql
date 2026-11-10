-- Where a sync's rows go: a spreadsheet Intake made, or one the person picked.
--
-- Phase C could only write to a spreadsheet Intake had created, so the destination was implied and
-- never written down. Phase D lets a person choose an existing spreadsheet through Google Picker,
-- and those two things are not the same promise:
--
--   created   Intake made this file. It may write the header row into it and treat it as its own.
--   selected  Somebody else's file. Intake may append rows to one worksheet, must never rewrite a
--             header it did not write, and must refuse a worksheet that already holds other data.
--
-- Storing which one it is lets the engine enforce that difference in one place instead of trusting
-- the screen that set it up. The default backfills every existing row as 'created', which is
-- exactly what they are.
--
-- `spreadsheet_title` is the file's name as Google last reported it, kept so the panel can say which
-- spreadsheet it is without a round trip to Google on every render. It is a label, not an identity:
-- renaming the file changes nothing, and the id is what identifies it.
--
-- Rollback: ALTER TABLE form_sheet_sync DROP COLUMN spreadsheet_title, DROP COLUMN destination; —
-- every sync falls back to being treated as Intake-created, which is what Phase C assumed. No
-- spreadsheet, form or response is touched.

ALTER TABLE form_sheet_sync
  ADD COLUMN IF NOT EXISTS destination text NOT NULL DEFAULT 'created'
    CHECK (destination IN ('created', 'selected'));

ALTER TABLE form_sheet_sync
  ADD COLUMN IF NOT EXISTS spreadsheet_title text
    CHECK (spreadsheet_title IS NULL OR char_length(spreadsheet_title) BETWEEN 1 AND 200);
