/**
 * The CSV a form owner downloads.
 *
 * This module is pure: questions and responses in, a string out. It never touches a network, a
 * database or a log, which is what makes the export safe — the only copy of a respondent's answer
 * is the one Google holds and the file the person asked for.
 *
 * Two rules drive everything here:
 *
 * 1. **A row must line up.** Columns come from the form's questions, in form order, and every row
 *    is written to that shape. A skipped question is an empty cell in its own column, never a
 *    shift into the next one.
 * 2. **A cell must be data.** Respondent text goes into a file a person will open in a
 *    spreadsheet, and a spreadsheet runs anything that looks like a formula. Any value that starts
 *    with a formula lead-in is neutralized before it is written.
 */

import type { GoogleFormResponse } from '../providers/google/client';

export interface ExportQuestion {
  id: string;
  /** The question as the form owner wrote it. Used as the column header. */
  title: string;
}

export interface BuildCsvInput {
  formTitle: string;
  questions: readonly ExportQuestion[];
  responses: readonly GoogleFormResponse[];
  /** When the file was produced. Passed in so the output is deterministic in tests. */
  exportedAt: Date;
  /** The site the file came from, for the credit line. */
  siteUrl: string;
}

/**
 * A spreadsheet treats a cell beginning with any of these as a formula. The apostrophe does not
 * change what the reader sees; it stops the spreadsheet from evaluating the value.
 */
const FORMULA_LEAD = /^[=+\-@\t\r]/;

/**
 * One CSV field, quoted only when it needs to be.
 *
 * A quoted field may contain commas, quotes and line breaks — that is what quoting is for, and a
 * multiline answer keeps its line breaks rather than being flattened into something the person
 * never wrote.
 */
export function csvCell(value: string): string {
  // A null byte is not text and can truncate the file for the reader.
  const text = value.replace(/\u0000/g, '');
  const guarded = FORMULA_LEAD.test(text) ? `'${text}` : text;
  return /[",\r\n]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

function csvRow(cells: readonly string[]): string {
  return cells.map(cell => csvCell(cell)).join(',');
}

/**
 * Comment text, kept to one plain line.
 *
 * A comment is not a data cell, so it is not quoted. That means it must not be able to break the
 * line it is on: no line breaks, and no double quote that would put a reader into quoted mode for
 * everything that follows.
 */
function plain(value: string): string {
  return value.replace(/[\r\n\t]+/g, ' ').replace(/"/g, "'").replace(/\u0000/g, '').trim();
}

/**
 * The credit lines at the top of the file.
 *
 * They are marked with `#` so a reader — and a script — can tell them from data at a glance, and
 * they carry no respondent information. Everything after them is the table.
 */
function preamble(input: BuildCsvInput): string[] {
  return [
    `# Exported from Intake - ${plain(input.siteUrl.replace(/^https?:\/\//, ''))}`,
    `# Form: ${plain(input.formTitle)}`,
    `# Exported: ${input.exportedAt.toISOString()}`,
    '# Answers below are your respondents\' own words, as Google Forms recorded them.',
  ];
}

/**
 * The header row. The first three columns are Intake's; the rest are the form's own questions, in
 * the order the form asks them.
 */
function headerRow(questions: readonly ExportQuestion[]): string[] {
  return ['Response ID', 'Submitted at', 'Respondent email', ...questions.map(question => question.title)];
}

/** One response as one row, in the same column order as the header. */
function responseRow(questions: readonly ExportQuestion[], response: GoogleFormResponse): string[] {
  const cells = [response.responseId, response.lastSubmittedTime ?? response.createTime ?? '', response.respondentEmail ?? ''];
  for (const question of questions) {
    // Unanswered is an empty cell in this question's own column — the columns never move.
    const values = response.answers[question.id];
    // A checkbox answer keeps all of its values; a single answer is the same rule with one value.
    cells.push(values && values.length ? values.join(', ') : '');
  }
  return cells;
}

/** The whole file: credit lines, a header, then one row per response. */
export function buildResponsesCsv(input: BuildCsvInput): string {
  const lines = [...preamble(input), csvRow(headerRow(input.questions))];
  for (const response of input.responses) lines.push(csvRow(responseRow(input.questions, response)));
  // CRLF and a final newline, so every spreadsheet and every `cat` sees the same file.
  return `${lines.join('\r\n')}\r\n`;
}

/**
 * The first line of the file, written before the responses are read.
 *
 * An export streams: the person gets bytes while Google is still being paged, instead of waiting
 * for the last page before the first byte. The header is known before any response is, so it goes
 * out first and the file is valid as soon as the first row follows.
 */
export function csvPreamble(input: BuildCsvInput): string {
  return `${[...preamble(input), csvRow(headerRow(input.questions))].join('\r\n')}\r\n`;
}

/** One response line, for a caller writing page by page. */
export function csvResponseLine(questions: readonly ExportQuestion[], response: GoogleFormResponse): string {
  return `${csvRow(responseRow(questions, response))}\r\n`;
}

/** `intake-form-responses-2026-11-06.csv` — the date the file was produced, in UTC. */
export function csvFilename(exportedAt: Date): string {
  return `intake-form-responses-${exportedAt.toISOString().slice(0, 10)}.csv`;
}
