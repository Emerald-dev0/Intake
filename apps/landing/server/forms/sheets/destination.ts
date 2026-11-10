/**
 * Deciding whether a worksheet somebody picked is a safe place to write.
 *
 * This is pure: a sample of cells in, a verdict out. It is the one place that decides whether an
 * existing worksheet can receive rows, so the connect route, the sync engine and the tests all ask
 * the same question and get the same answer.
 *
 * The rule is deliberately conservative. Intake is a guest in a file it did not make, and every
 * failure mode here is somebody's data:
 *
 *   - a worksheet with anything in it that is not already this form's table is refused, because
 *     appending under a foreign header mislabels every answer that follows;
 *   - a worksheet whose table matches but which carries content in the columns beyond it is refused
 *     too, because `INSERT_ROWS` would shift that content around;
 *   - a worksheet that is already this form's table is accepted as it is, and its existing rows are
 *     read like any others — the sync engine de-duplicates by response id, so history written before
 *     the connection is not written again.
 */

export const WORKSHEET_VERDICTS = ['empty', 'compatible', 'unsuitable'] as const;
export type WorksheetVerdict = (typeof WORKSHEET_VERDICTS)[number];

export interface WorksheetAssessment {
  verdict: WorksheetVerdict;
  /** One sentence a person can act on. Null when the answer is yes. */
  reason: string | null;
  /** How many non-empty rows sit under the header, for the confirmation screen. */
  existingRows: number;
  /** How many of those look like response ids already — the rows a sync will skip. */
  existingIds: number;
}

/** How far down a worksheet the inspection reads. Enough to see a table, cheap to fetch. */
export const SAMPLE_ROWS = 25;

const cell = (value: unknown): string => (typeof value === 'string' ? value.trim() : typeof value === 'number' ? String(value) : '');

function isEmptyRow(row: readonly unknown[] | undefined): boolean {
  return !row || row.every(value => cell(value) === '');
}

/** A header row compares equal when the cells match, ignoring trailing blanks Google omits. */
export function headerMatches(header: readonly unknown[], expected: readonly string[]): boolean {
  const actual = header.map(cell);
  while (actual.length && actual[actual.length - 1] === '') actual.pop();
  return actual.length === expected.length && expected.every((title, index) => actual[index] === title.trim());
}

export function assessWorksheet(input: {
  /** The first `SAMPLE_ROWS` rows of the worksheet, as Google returned them. */
  sample: readonly (readonly unknown[])[];
  /** The header this form needs, column for column. */
  expectedHeader: readonly string[];
}): WorksheetAssessment {
  const rows = input.sample.filter(row => Array.isArray(row));
  const nonEmpty = rows.filter(row => !isEmptyRow(row));

  if (nonEmpty.length === 0) {
    return { verdict: 'empty', reason: null, existingRows: 0, existingIds: 0 };
  }

  const header = rows[0] ?? [];
  if (headerMatches(header, input.expectedHeader)) {
    const body = nonEmpty.slice(1);
    // Content beyond the table's own columns would be displaced by an append, even though the
    // header looks right. That is somebody else's data in the same grid, so it is not ours to move.
    const width = input.expectedHeader.length;
    const stray = body.some(row => row.slice(width).some(value => cell(value) !== ''));
    if (stray) {
      return {
        verdict: 'unsuitable',
        reason: 'This worksheet has Intake’s header row but also other data in the columns beside it. Choose a worksheet that only holds this form’s responses.',
        existingRows: body.length,
        existingIds: 0,
      };
    }
    const ids = body.filter(row => cell(row[0]) !== '').length;
    return { verdict: 'compatible', reason: null, existingRows: body.length, existingIds: ids };
  }

  if (/^response\s*id$/i.test(cell(header[0]))) {
    return {
      verdict: 'unsuitable',
      reason: 'This worksheet already holds an Intake table, but for a different set of questions. Choose an empty worksheet, or connect a different spreadsheet.',
      existingRows: nonEmpty.length - 1,
      existingIds: 0,
    };
  }

  // Whether the first row is a header, a title, or data, it is not Intake's, and the safe answer is
  // the same for all three: refuse, and point at a worksheet that is empty.
  return {
    verdict: 'unsuitable',
    reason: 'This worksheet already has content of its own in its first rows. Intake will not write into or over it — choose an empty worksheet, or one it set up before.',
    existingRows: nonEmpty.length,
    existingIds: 0,
  };
}
