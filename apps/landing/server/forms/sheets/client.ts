/**
 * The Sheets API client.
 *
 * It follows the same shape as the Forms client, for the same reasons: the host is a constant,
 * the only path parameter is an id checked against a strict pattern before it is used, redirects
 * are refused so a bearer token cannot be forwarded anywhere, and every response is parsed into a
 * small typed value rather than passed around raw.
 *
 * Endpoints (https://sheets.googleapis.com/$discovery/rest?version=v4), all of which accept the
 * `drive.file` scope — that is the whole point of choosing it:
 *
 *   POST /v4/spreadsheets                                        spreadsheets.create
 *   GET  /v4/spreadsheets/{id}                                   spreadsheets.get
 *   GET  /v4/spreadsheets/{id}/values:batchGet                   spreadsheets.values.batchGet
 *   POST /v4/spreadsheets/{id}/values/{range}:append             spreadsheets.values.append
 *
 * Two decisions are load-bearing and should not be softened:
 *
 * 1. Every write uses `valueInputOption=RAW`. Google does not interpret a RAW cell, so a respondent
 *    who types `=IMPORTXML(...)` gets a cell containing that text, not a live formula running in
 *    somebody's browser. This is stronger than the apostrophe prefix the CSV export uses, because
 *    nothing is added to what the person actually wrote.
 * 2. Nothing here retries a write. A retried append is how the same twenty rows get written twice.
 *    Retries belong to reads; a failed write is reconciled against the sheet itself (see sync.ts).
 */

const SHEETS_ORIGIN = 'https://sheets.googleapis.com';
const SPREADSHEET_ID = /^[A-Za-z0-9_-]{20,120}$/;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 4_000_000;

export type GoogleSheetsOperation =
  | 'spreadsheets.create'
  | 'spreadsheets.get'
  | 'values.batchGet'
  | 'values.append'
  | 'values.update';

export interface GoogleSheetsErrorInfo {
  operation: GoogleSheetsOperation;
  /** http: Google answered with an error status. network/timeout: no usable answer, outcome unknown. */
  kind: 'http' | 'network' | 'timeout' | 'malformed_response';
  httpStatus?: number;
  googleStatus?: string;
  reason?: string;
  retryAfterSeconds?: number;
}

export class GoogleSheetsApiError extends Error {
  readonly info: GoogleSheetsErrorInfo;

  constructor(info: GoogleSheetsErrorInfo) {
    super(`Google Sheets ${info.operation} failed (${info.kind}${info.httpStatus ? ` ${info.httpStatus}` : ''})`);
    this.name = 'GoogleSheetsApiError';
    this.info = info;
  }
}

export interface CreatedSpreadsheet {
  spreadsheetId: string;
  spreadsheetUrl: string | null;
  sheetId: number;
  sheetTitle: string;
}

export interface SpreadsheetSheet {
  sheetId: number;
  title: string;
  rowCount: number;
}

export interface SpreadsheetMetadata {
  spreadsheetId: string;
  title: string;
  spreadsheetUrl: string | null;
  sheets: SpreadsheetSheet[];
}

export interface SheetState {
  /** The header row exactly as the sheet holds it, trimmed to its last non-empty cell. */
  header: string[];
  /** Every response id already written in column A, header excluded. */
  responseIds: string[];
}

export interface GoogleSheetsClient {
  createSpreadsheet(accessToken: string, input: { title: string; sheetTitle: string }): Promise<CreatedSpreadsheet>;
  getSpreadsheet(accessToken: string, spreadsheetId: string): Promise<SpreadsheetMetadata>;
  /** Reads the header row and the id column in one request. */
  readSheetState(accessToken: string, spreadsheetId: string, sheetTitle: string): Promise<SheetState>;
  /** Appends rows verbatim. Never retried by this client. */
  appendRows(accessToken: string, spreadsheetId: string, sheetTitle: string, rows: string[][]): Promise<{ updatedRows: number }>;
  /** Writes the header row for a sheet that has no data in it yet. */
  writeHeader(accessToken: string, spreadsheetId: string, sheetTitle: string, header: string[]): Promise<void>;
}

export type SheetsFetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function isSpreadsheetId(value: unknown): value is string {
  return typeof value === 'string' && SPREADSHEET_ID.test(value);
}

/**
 * A1 range strings are built here, never accepted from a request.
 *
 * A tab can be renamed by its owner, so the title is whatever Google last reported rather than
 * something Intake assumed. Quotes are doubled and control characters removed, which is all A1
 * notation needs: the title cannot escape into the range string.
 */
function sheetRange(sheetTitle: string, suffix: string): string {
  const clean = sheetTitle.replace(/[\r\n\t]+/g, ' ').slice(0, 100);
  return `'${clean.replace(/'/g, "''")}'!${suffix}`;
}

async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new Error('response_too_large');
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new Error('response_too_large');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function readGoogleError(json: unknown): Pick<GoogleSheetsErrorInfo, 'googleStatus' | 'reason'> {
  if (!json || typeof json !== 'object') return {};
  const error = (json as { error?: unknown }).error;
  if (!error || typeof error !== 'object') return {};
  const record = error as { status?: unknown; details?: unknown };
  const out: Pick<GoogleSheetsErrorInfo, 'googleStatus' | 'reason'> = {};
  if (typeof record.status === 'string' && /^[A-Z_]{3,40}$/.test(record.status)) out.googleStatus = record.status;
  if (Array.isArray(record.details)) {
    for (const detail of record.details) {
      if (!detail || typeof detail !== 'object') continue;
      const reason = (detail as { reason?: unknown }).reason;
      if (typeof reason === 'string' && /^[a-zA-Z0-9_]{1,64}$/.test(reason)) {
        out.reason = reason;
        break;
      }
    }
  }
  return out;
}

function retryAfter(response: Response): { retryAfterSeconds?: number } {
  const header = response.headers.get('retry-after');
  if (!header) return {};
  const seconds = Number(header);
  // Google sends seconds; anything else (an HTTP date, junk) is ignored rather than guessed at.
  return Number.isFinite(seconds) && seconds >= 0 && seconds <= 300 ? { retryAfterSeconds: Math.ceil(seconds) } : {};
}

export function createGoogleSheetsClient(options: { fetchImpl?: SheetsFetchLike; timeoutMs?: number } = {}): GoogleSheetsClient {
  const fetchImpl: SheetsFetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(
    operation: GoogleSheetsOperation,
    accessToken: string,
    path: string,
    init: { method: 'GET' | 'POST' | 'PUT'; body?: unknown; query?: Record<string, string | string[]> } = { method: 'GET' },
  ): Promise<Record<string, unknown>> {
    const url = new URL(path, SHEETS_ORIGIN);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      // A repeated parameter (batchGet's `ranges`) is sent as itself, not as a joined string.
      if (Array.isArray(value)) for (const item of value) url.searchParams.append(key, item);
      else url.searchParams.set(key, value);
    }
    if (url.origin !== SHEETS_ORIGIN) throw new GoogleSheetsApiError({ operation, kind: 'malformed_response' });

    let response: Response;
    let raw: string;
    try {
      response = await fetchImpl(url.toString(), {
        method: init.method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(init.method === 'POST' || init.method === 'PUT' ? { 'content-type': 'application/json' } : {}),
          accept: 'application/json',
        },
        ...(init.method === 'POST' || init.method === 'PUT' ? { body: JSON.stringify(init.body ?? {}) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = await limitedText(response);
    } catch (error) {
      const name = error instanceof Error ? error.name : '';
      throw new GoogleSheetsApiError({ operation, kind: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' });
    }

    let json: unknown = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    if (!response.ok) throw new GoogleSheetsApiError({ operation, kind: 'http', httpStatus: response.status, ...readGoogleError(json), ...retryAfter(response) });
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new GoogleSheetsApiError({ operation, kind: 'malformed_response', httpStatus: response.status });
    return json as Record<string, unknown>;
  }

  function spreadsheetPath(operation: GoogleSheetsOperation, spreadsheetId: string): string {
    if (!isSpreadsheetId(spreadsheetId)) throw new GoogleSheetsApiError({ operation, kind: 'malformed_response' });
    return `/v4/spreadsheets/${encodeURIComponent(spreadsheetId)}`;
  }

  return {
    async createSpreadsheet(accessToken, input) {
      const json = await call('spreadsheets.create', accessToken, '/v4/spreadsheets', {
        method: 'POST',
        body: {
          properties: { title: input.title },
          // The first tab is created with the spreadsheet, so there is never a window where the
          // sync points at a tab that does not exist.
          sheets: [{ properties: { title: input.sheetTitle } }],
        },
      });
      if (!isSpreadsheetId(json.spreadsheetId)) throw new GoogleSheetsApiError({ operation: 'spreadsheets.create', kind: 'malformed_response' });
      const sheets = Array.isArray(json.sheets) ? json.sheets : [];
      const first = sheets[0] && typeof sheets[0] === 'object' ? (sheets[0] as { properties?: Record<string, unknown> }) : null;
      const properties = first?.properties ?? null;
      const sheetId = properties && Number.isInteger(properties.sheetId) ? (properties.sheetId as number) : null;
      const title = properties && typeof properties.title === 'string' ? properties.title : null;
      if (sheetId === null || title === null) throw new GoogleSheetsApiError({ operation: 'spreadsheets.create', kind: 'malformed_response' });
      return {
        spreadsheetId: json.spreadsheetId,
        spreadsheetUrl: typeof json.spreadsheetUrl === 'string' ? json.spreadsheetUrl : null,
        sheetId,
        sheetTitle: title,
      };
    },

    async getSpreadsheet(accessToken, spreadsheetId) {
      // `fields` keeps the answer small: a spreadsheet resource is otherwise megabytes of grid data.
      const json = await call('spreadsheets.get', accessToken, spreadsheetPath('spreadsheets.get', spreadsheetId), {
        method: 'GET',
        query: { fields: 'spreadsheetId,properties.title,spreadsheetUrl,sheets.properties' },
      });
      const sheets = Array.isArray(json.sheets) ? json.sheets : [];
      const parsed: SpreadsheetSheet[] = [];
      for (const sheet of sheets) {
        const properties = sheet && typeof sheet === 'object' ? (sheet as { properties?: Record<string, unknown> }).properties : null;
        if (!properties || !Number.isInteger(properties.sheetId) || typeof properties.title !== 'string') continue;
        parsed.push({
          sheetId: properties.sheetId as number,
          title: properties.title,
          rowCount: Number.isInteger(properties.rowCount) ? (properties.rowCount as number) : 0,
        });
      }
      const properties = json.properties && typeof json.properties === 'object' ? (json.properties as { title?: unknown }) : null;
      return {
        spreadsheetId: typeof json.spreadsheetId === 'string' ? json.spreadsheetId : spreadsheetId,
        title: properties && typeof properties.title === 'string' ? properties.title : '',
        spreadsheetUrl: typeof json.spreadsheetUrl === 'string' ? json.spreadsheetUrl : null,
        sheets: parsed,
      };
    },

    async readSheetState(accessToken, spreadsheetId, sheetTitle) {
      const json = await call('values.batchGet', accessToken, `${spreadsheetPath('values.batchGet', spreadsheetId)}/values:batchGet`, {
        method: 'GET',
        query: {
          ranges: [sheetRange(sheetTitle, 'A1:A'), sheetRange(sheetTitle, '1:1')],
          majorDimension: 'ROWS',
          valueRenderOption: 'FORMATTED_VALUE',
        },
      });
      const ranges = Array.isArray(json.valueRanges) ? json.valueRanges : [];
      const ids = readColumn(ranges[0]);
      const header = readRow(ranges[1]);
      // Row 1 of the id column is the header cell; the ids start at row 2.
      return { header, responseIds: ids.slice(1).filter(cell => cell !== '') };
    },

    async appendRows(accessToken, spreadsheetId, sheetTitle, rows) {
      if (!rows.length) return { updatedRows: 0 };
      const json = await call('values.append', accessToken, `${spreadsheetPath('values.append', spreadsheetId)}/values/${encodeURIComponent(sheetRange(sheetTitle, 'A1'))}:append`, {
        method: 'POST',
        query: { valueInputOption: 'RAW', insertDataOption: 'INSERT_ROWS', includeValuesInResponse: 'false' },
        body: { range: sheetRange(sheetTitle, 'A1'), majorDimension: 'ROWS', values: rows },
      });
      const updates = json.updates && typeof json.updates === 'object' ? (json.updates as { updatedRows?: unknown }) : null;
      const updatedRows = updates && Number.isInteger(updates.updatedRows) ? (updates.updatedRows as number) : rows.length;
      return { updatedRows };
    },

    async writeHeader(accessToken, spreadsheetId, sheetTitle, header) {
      // An exact write, not an append: the header belongs in row 1 wherever the table currently
      // starts. Only ever called on a sheet with no data rows in it.
      const range = sheetRange(sheetTitle, `A1:${columnLetter(Math.max(1, header.length))}1`);
      await call('values.update', accessToken, `${spreadsheetPath('values.update', spreadsheetId)}/values/${encodeURIComponent(range)}`, {
        method: 'PUT',
        query: { valueInputOption: 'RAW', includeValuesInResponse: 'false' },
        body: { range, majorDimension: 'ROWS', values: [header] },
      });
    },
  };
}

function readColumn(range: unknown): string[] {
  const values = range && typeof range === 'object' ? (range as { values?: unknown }).values : null;
  if (!Array.isArray(values)) return [];
  const out: string[] = [];
  for (const row of values) {
    if (!Array.isArray(row)) continue;
    const cell = row[0];
    out.push(typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : '');
  }
  return out;
}

function readRow(range: unknown): string[] {
  const values = range && typeof range === 'object' ? (range as { values?: unknown }).values : null;
  if (!Array.isArray(values) || !Array.isArray(values[0])) return [];
  const out = values[0].map(cell => (typeof cell === 'string' ? cell : typeof cell === 'number' ? String(cell) : ''));
  // Trim trailing empties so a sheet with a formatted-but-empty tail still compares equal.
  while (out.length && out[out.length - 1] === '') out.pop();
  return out;
}

/** 1 → A, 26 → Z, 27 → AA. Only used for the header row, which is at most a few dozen columns. */
export function columnLetter(index: number): string {
  let remaining = Math.max(1, Math.floor(index));
  let out = '';
  while (remaining > 0) {
    const rem = (remaining - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    remaining = Math.floor((remaining - 1) / 26);
  }
  return out;
}
