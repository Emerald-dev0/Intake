/**
 * Deciding whether a worksheet somebody picked can receive rows.
 *
 * Every failure mode here is somebody else's data, so the rules are stated as tests: an empty
 * worksheet is initialised, one that already holds this form's table is used as it is, and anything
 * else — a foreign header, stray content beside the table, a table for a different form — is
 * refused with a reason a person can act on.
 */

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { assessWorksheet, headerMatches, SAMPLE_ROWS } from '../server/forms/sheets/destination.ts';
import { headerFor } from '../server/forms/sheets/sync.ts';

const QUESTIONS = [{ id: 'q1', title: 'What is your name?' }, { id: 'q2', title: 'Anything else?' }];
const HEADER = headerFor(QUESTIONS);

const assess = sample => assessWorksheet({ sample, expectedHeader: HEADER });

test('an empty worksheet is empty, and says so without a reason to fix anything', () => {
  for (const sample of [[], [[]], [[], [], []], [['', '', '']]]) {
    const result = assess(sample);
    assert.equal(result.verdict, 'empty');
    assert.equal(result.reason, null);
    assert.equal(result.existingRows, 0);
  }
});

test('a worksheet that already holds this form’s table is compatible, and counts what is in it', () => {
  const result = assess([
    HEADER,
    ['r1', '2026-11-06T10:00:00.000Z', '', 'Ada', ''],
    ['r2', '2026-11-06T10:01:00.000Z', '', 'Bola', 'Yes'],
  ]);
  assert.equal(result.verdict, 'compatible');
  assert.equal(result.reason, null);
  assert.equal(result.existingRows, 2, 'these are the rows a sync will skip rather than repeat');
  assert.equal(result.existingIds, 2);
});

test('a sheet whose header row carries extra blank cells still matches', () => {
  // Google trims trailing empty cells when it reads, but a sheet may hold them, and a row that is
  // wider than the table is not a different table.
  const result = assess([[...HEADER, '', ''], ['r1', 'x', '', 'Ada', '', '', '']]);
  assert.equal(result.verdict, 'compatible');
});

test('a worksheet with a header of its own is refused, not overwritten', () => {
  const result = assess([['Name', 'Email'], ['Ada', 'ada@example.com']]);
  assert.equal(result.verdict, 'unsuitable');
  assert.match(result.reason, /content of its own/);
  assert.match(result.reason, /will not write into or over it/);
});

test('a header with no data under it is still somebody’s work, and still refused', () => {
  const result = assess([['Name', 'Email']]);
  assert.equal(result.verdict, 'unsuitable');
  assert.match(result.reason, /content of its own/);
});

test('a worksheet with rows but no header is refused too', () => {
  const result = assess([['Ada', 'ada@example.com', '2026-11-06']]);
  assert.equal(result.verdict, 'unsuitable');
  assert.match(result.reason, /content of its own/);
});

test('an Intake table for a different set of questions is named as such', () => {
  const result = assess([
    ['Response ID', 'Submitted at', 'Respondent email', 'How was it?'],
    ['r1', 'x', '', 'Good'],
  ]);
  assert.equal(result.verdict, 'unsuitable');
  assert.match(result.reason, /different set of questions/);
});

test('content beside the table is refused even when the header matches', () => {
  // Appending with INSERT_ROWS would shift the notes beside the table, so this is not a safe
  // destination even though the first five columns look exactly right.
  const result = assess([
    HEADER,
    ['r1', 'x', '', 'Ada', '', '', 'a note somebody typed'],
  ]);
  assert.equal(result.verdict, 'unsuitable');
  assert.match(result.reason, /other data in the columns beside it/);
});

test('the sample is the first rows only, and a table deeper in a sheet is not guessed at', () => {
  // The first row is blank, then the table starts. Intake reads from row 1 by design, so a table
  // that starts lower is not this form's table as far as the writer is concerned.
  const result = assess([
    ['', ''],
    ['Name', 'Email'],
    ['Ada', 'ada@example.com'],
  ]);
  assert.equal(result.verdict, 'unsuitable');
  assert.match(result.reason, /content of its own/);
  assert.equal(SAMPLE_ROWS, 25);
});

test('header comparison trims and ignores what Google omits', () => {
  assert.equal(headerMatches([' Response ID ', 'Submitted at'], ['Response ID', 'Submitted at']), true);
  assert.equal(headerMatches(['Response ID'], ['Response ID', 'Submitted at']), false);
  assert.equal(headerMatches(['Response ID', 'Submitted at', '', ''], ['Response ID', 'Submitted at']), true);
  assert.equal(headerMatches([], ['Response ID']), false);
});

test('numbers in cells are read as text, not skipped', () => {
  const result = assess([['Name', 42]]);
  assert.equal(result.verdict, 'unsuitable');
});
