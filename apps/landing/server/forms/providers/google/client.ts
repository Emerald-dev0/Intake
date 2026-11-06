import type { GoogleRequest } from './plan';

/**
 * Thin client for the three Google Forms API v1 methods Intake uses. It is the only place that
 * builds Forms API URLs, sends the bearer token, or reads a Forms API response.
 *
 * Endpoints (https://forms.googleapis.com/$discovery/rest?version=v1):
 *   POST /v1/forms                                 forms.create           ?unpublished=<bool>
 *   POST /v1/forms/{formId}:batchUpdate            forms.batchUpdate
 *   POST /v1/forms/{formId}:setPublishSettings     forms.setPublishSettings
 *
 * Safety properties:
 * - the host is a constant. Nothing from a request, the environment or a response can change it;
 * - the only path parameter is a form id, checked against a strict pattern before it is used;
 * - redirects are refused, so a bearer token cannot be forwarded anywhere;
 * - responses are parsed into small typed values and never returned raw.
 */

export const GOOGLE_FORMS_ORIGIN = 'https://forms.googleapis.com';
const FORM_ID = /^[A-Za-z0-9_-]{8,256}$/;
const DEFAULT_TIMEOUT_MS = 20_000;
const MAX_RESPONSE_BYTES = 5_000_000;

class ResponseTooLargeError extends Error {}

async function limitedText(response: Response): Promise<string> {
  const declared = Number(response.headers.get('content-length'));
  if (Number.isFinite(declared) && declared > MAX_RESPONSE_BYTES) throw new ResponseTooLargeError();
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new ResponseTooLargeError();
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

export type GoogleFormsOperation = 'forms.create' | 'forms.get' | 'forms.batchUpdate' | 'forms.setPublishSettings' | 'forms.listResponses' | 'forms.getResponse';

export interface GoogleFormResource {
  formId: string;
  revisionId: string;
  info: { title: string; description?: string };
  responderUri: string | null;
  isQuiz: boolean;
  items: GoogleFormItemResource[];
}

export interface GoogleFormItemResource {
  itemId: string;
  title: string;
  description?: string;
  kind: 'question' | 'section' | 'text' | 'media' | 'question_group' | 'other';
  questionId?: string;
  questionType?: 'short_text' | 'long_text' | 'multiple_choice' | 'dropdown' | 'checkboxes' | 'date' | 'time' | 'scale' | 'rating' | 'file_upload' | 'grid' | 'unknown';
  required?: boolean;
  options?: { value: string; hasImage: boolean; isOther: boolean; hasRouting: boolean; goToAction?: string; goToSectionId?: string }[];
  hasGrading?: boolean;
  shuffledOptions?: boolean;
}

export interface GoogleFormsApiErrorInfo {
  operation: GoogleFormsOperation;
  /**
   * http: Google answered with an error status.
   * network: the request could not be completed.
   * timeout: no answer within the time limit; the request may still have been processed.
   * malformed_response: Google answered successfully but not with what the API documents.
   */
  kind: 'http' | 'network' | 'timeout' | 'malformed_response';
  httpStatus?: number;
  /** Google's canonical status such as INVALID_ARGUMENT or PERMISSION_DENIED. */
  googleStatus?: string;
  /** ErrorInfo.reason such as SERVICE_DISABLED or ACCESS_TOKEN_SCOPE_INSUFFICIENT. */
  reason?: string;
  retryAfterSeconds?: number;
}

export class GoogleFormsApiError extends Error {
  readonly info: GoogleFormsApiErrorInfo;

  constructor(info: GoogleFormsApiErrorInfo) {
    super(`Google Forms ${info.operation} failed (${info.kind}${info.httpStatus ? ` ${info.httpStatus}` : ''})`);
    this.name = 'GoogleFormsApiError';
    this.info = info;
  }
}

export interface CreatedFormResponse {
  formId: string;
  responderUri: string | null;
}

export interface PublishStateResponse {
  isPublished: boolean | null;
  isAcceptingResponses: boolean | null;
}

export interface GoogleFormsClient {
  createForm(accessToken: string, input: { title: string; documentTitle: string; unpublished: boolean }): Promise<CreatedFormResponse>;
  getForm(accessToken: string, formId: string): Promise<GoogleFormResource>;
  batchUpdate(accessToken: string, formId: string, requests: readonly GoogleRequest[], writeControl?: { requiredRevisionId: string }): Promise<{ replies: unknown[] }>;
  setPublishSettings(accessToken: string, formId: string, state: { isPublished: boolean; isAcceptingResponses: boolean }): Promise<PublishStateResponse>;
  listResponses(accessToken: string, formId: string, options?: ListResponsesOptions): Promise<GoogleFormResponsesPage>;
  getResponse(accessToken: string, formId: string, responseId: string): Promise<GoogleFormResponse>;
}

/** Google returns at most this many responses in one page. Asking for more is not an error; it is a cap. */
export const MAX_RESPONSE_PAGE_SIZE = 5000;

/** What one response looks like once it has been read and normalized. */
export interface GoogleFormResponse {
  /** Google's id for this answer set. Stable, and the only safe key for de-duplicating pages. */
  responseId: string;
  /** When the respondent started, when Google recorded it. */
  createTime: string | null;
  /** When the respondent last submitted. This is the timestamp `filter` compares against. */
  lastSubmittedTime: string | null;
  /** Only present when the form collects verified email addresses. Often null. */
  respondentEmail: string | null;
  /** Question id to the answer values given. A checkbox answer keeps every value it was given. */
  answers: Record<string, string[]>;
  /** Quiz score, when the form is a quiz. */
  totalScore: number | null;
}

export interface ListResponsesOptions {
  /**
   * Google's documented cap is 5000 and is applied here rather than trusted from the caller. Zero
   * and absent both mean "let Google choose", which is its own default.
   */
  pageSize?: number;
  pageToken?: string;
  /**
   * Only responses submitted at or after this instant. Built into Google's `filter` here, so a
   * caller supplies a timestamp rather than a query string that reaches the API unchecked.
   * Google supports only `timestamp > N` and `timestamp >= N`.
   */
  since?: string;
  /** Ask for responses after the instant rather than at-and-after it. */
  sinceExclusive?: boolean;
}

/** One page of responses, normalized. Raw respondent payloads never leave this module. */
export interface GoogleFormResponsesPage {
  responses: GoogleFormResponse[];
  nextPageToken: string | null;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function isFormId(value: unknown): value is string {
  return typeof value === 'string' && FORM_ID.test(value);
}

export function createGoogleFormsClient(options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): GoogleFormsClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(operation: GoogleFormsOperation, accessToken: string, path: string, body?: unknown, query?: Record<string, string>, method: 'GET' | 'POST' = 'POST'): Promise<Record<string, unknown>> {
    const url = new URL(path, GOOGLE_FORMS_ORIGIN);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    if (url.origin !== GOOGLE_FORMS_ORIGIN) throw new GoogleFormsApiError({ operation, kind: 'malformed_response' });

    let response: Response;
    let raw: string;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: { authorization: `Bearer ${accessToken}`, ...(method === 'POST' ? { 'content-type': 'application/json' } : {}), accept: 'application/json' },
        ...(method === 'POST' ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = await limitedText(response);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw new GoogleFormsApiError({ operation, kind: 'malformed_response' });
      const name = error instanceof Error ? error.name : '';
      throw new GoogleFormsApiError({ operation, kind: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' });
    }

    let json: unknown = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    if (!response.ok) throw new GoogleFormsApiError({ operation, kind: 'http', httpStatus: response.status, ...readGoogleError(json), ...retryAfter(response) });
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new GoogleFormsApiError({ operation, kind: 'malformed_response', httpStatus: response.status });
    return json as Record<string, unknown>;
  }

  function formPath(operation: GoogleFormsOperation, formId: string, method?: string): string {
    if (!isFormId(formId)) throw new GoogleFormsApiError({ operation, kind: 'malformed_response' });
    return `/v1/forms/${encodeURIComponent(formId)}${method ? `:${method}` : ''}`;
  }

  return {
    async createForm(accessToken, input) {
      // Only info.title and info.documentTitle are copied by forms.create. Everything else is added
      // afterwards with batchUpdate. Created unpublished so a half-built form never accepts responses.
      const json = await call(
        'forms.create',
        accessToken,
        '/v1/forms',
        { info: { title: input.title, documentTitle: input.documentTitle } },
        input.unpublished ? { unpublished: 'true' } : undefined,
      );
      if (!isFormId(json.formId)) throw new GoogleFormsApiError({ operation: 'forms.create', kind: 'malformed_response' });
      return { formId: json.formId, responderUri: typeof json.responderUri === 'string' ? json.responderUri : null };
    },

    async getForm(accessToken, formId) {
      const json = await call('forms.get', accessToken, formPath('forms.get', formId), undefined, undefined, 'GET');
      return parseFormResource(json, formId);
    },

    async batchUpdate(accessToken, formId, requests, writeControl) {
      const json = await call('forms.batchUpdate', accessToken, formPath('forms.batchUpdate', formId, 'batchUpdate'), {
        requests,
        ...(writeControl ? { writeControl } : {}),
      });
      return { replies: Array.isArray(json.replies) ? json.replies : [] };
    },

    async setPublishSettings(accessToken, formId, state) {
      const json = await call('forms.setPublishSettings', accessToken, formPath('forms.setPublishSettings', formId, 'setPublishSettings'), {
        publishSettings: { publishState: { isPublished: state.isPublished, isAcceptingResponses: state.isAcceptingResponses } },
      });
      const settings = json.publishSettings && typeof json.publishSettings === 'object' ? (json.publishSettings as Record<string, unknown>) : null;
      const published = settings?.publishState && typeof settings.publishState === 'object' ? (settings.publishState as Record<string, unknown>) : null;
      return {
        isPublished: typeof published?.isPublished === 'boolean' ? published.isPublished : null,
        isAcceptingResponses: typeof published?.isAcceptingResponses === 'boolean' ? published.isAcceptingResponses : null,
      };
    },

    async listResponses(accessToken, formId, options = {}) {
      const query: Record<string, string> = {};
      const pageSize = readPageSize(options.pageSize);
      if (pageSize !== null) query.pageSize = String(pageSize);
      if (options.pageToken !== undefined) {
        if (typeof options.pageToken !== 'string' || !options.pageToken || options.pageToken.length > 2000) {
          throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'malformed_response' });
        }
        query.pageToken = options.pageToken;
      }
      // The filter is assembled from a validated timestamp. A caller cannot hand Google a query
      // string, so nothing arbitrary reaches the API.
      const filter = buildResponsesFilter(options.since, options.sinceExclusive);
      if (filter) query.filter = filter;
      const json = await call(
        'forms.listResponses',
        accessToken,
        `${formPath('forms.listResponses', formId)}/responses`,
        undefined,
        Object.keys(query).length ? query : undefined,
        'GET',
      );
      return parseResponsesPage(json);
    },

    async getResponse(accessToken, formId, responseId) {
      if (typeof responseId !== 'string' || !validResponseId(responseId)) {
        throw new GoogleFormsApiError({ operation: 'forms.getResponse', kind: 'malformed_response' });
      }
      const json = await call(
        'forms.getResponse',
        accessToken,
        `${formPath('forms.getResponse', formId)}/responses/${encodeURIComponent(responseId)}`,
        undefined,
        undefined,
        'GET',
      );
      const parsed = parseResponse(json);
      if (!parsed) throw new GoogleFormsApiError({ operation: 'forms.getResponse', kind: 'malformed_response' });
      return parsed;
    },
  };
}

/** A page size of zero or nothing means "Google decides". Anything else must be a real page size. */
function readPageSize(value: unknown): number | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 1) {
    throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'malformed_response' });
  }
  return Math.min(value, MAX_RESPONSE_PAGE_SIZE);
}

/** RFC3339 in UTC, which is the only timestamp format Google accepts in `filter`. */
const RFC3339_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,9})?Z$/;

function buildResponsesFilter(since: unknown, exclusive: unknown): string | null {
  if (since === undefined || since === null) return null;
  if (typeof since !== 'string' || !RFC3339_UTC.test(since) || Number.isNaN(Date.parse(since))) {
    throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'malformed_response' });
  }
  return `timestamp ${exclusive === true ? '>' : '>='} ${since}`;
}

function validResponseId(value: string): boolean {
  return value.length > 0 && value.length <= 256 && /^[A-Za-z0-9_-]+$/.test(value);
}

/**
 * Read one response into the shape the rest of Intake uses.
 *
 * Everything a respondent typed is bounded here: the answer count, the number of values in one
 * answer, and the length of each value. A response that does not look like a response is dropped
 * rather than half-read, so a caller never sees a row it cannot trust.
 */
function parseResponse(entry: unknown): GoogleFormResponse | null {
  const record = asRecord(entry);
  if (!record) return null;
  if (typeof record.responseId !== 'string' || !validResponseId(record.responseId)) return null;

  const answerMap = asRecord(record.answers);
  const answers: Record<string, string[]> = {};
  if (answerMap) {
    const entries = Object.entries(answerMap);
    if (entries.length > 200) return null;
    for (const [questionId, value] of entries) {
      if (!validItemId(questionId)) continue;
      const answer = asRecord(value);
      const textAnswers = answer ? asRecord(answer.textAnswers) : null;
      const list = textAnswers && Array.isArray(textAnswers.answers) ? textAnswers.answers : [];
      const values: string[] = [];
      // A checkbox question can legitimately carry many values, but not an unbounded number.
      for (const item of list.slice(0, 50)) {
        const candidate = asRecord(item)?.value;
        if (typeof candidate === 'string' && candidate.trim() && candidate.length <= 2000) values.push(candidate);
      }
      if (values.length) answers[questionId] = values;
    }
  }

  return {
    responseId: record.responseId,
    createTime: readTimestamp(record.createTime),
    lastSubmittedTime: readTimestamp(record.lastSubmittedTime),
    respondentEmail: readEmail(record.respondentEmail),
    answers,
    totalScore: typeof record.totalScore === 'number' && Number.isFinite(record.totalScore) ? record.totalScore : null,
  };
}

function readTimestamp(value: unknown): string | null {
  if (typeof value !== 'string' || value.length > 40) return null;
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) return null;
  // Stored as Google sent it, in UTC, so two exports of the same answer say the same thing.
  return new Date(parsed).toISOString();
}

function readEmail(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const email = value.trim();
  if (!email || email.length > 320 || !email.includes('@')) return null;
  return email;
}

/** Copy out only what Intake uses, bounded per value. A page that does not fit is not guessed at. */
function parseResponsesPage(json: Record<string, unknown>): GoogleFormResponsesPage {
  const raw = Array.isArray(json.responses) ? json.responses : [];
  if (raw.length > MAX_RESPONSE_PAGE_SIZE) throw new GoogleFormsApiError({ operation: 'forms.listResponses', kind: 'malformed_response' });
  const responses: GoogleFormResponse[] = [];
  for (const entry of raw) {
    const parsed = parseResponse(entry);
    if (parsed) responses.push(parsed);
  }
  const nextPageToken = typeof json.nextPageToken === 'string' && json.nextPageToken && json.nextPageToken.length <= 2000
    ? json.nextPageToken
    : null;
  return { responses, nextPageToken };
}

function validItemId(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value.length <= 64 && /^[A-Za-z0-9_-]+$/.test(value);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return typeof value === 'object' && value !== null && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

/** Copy only the documented current-form fields needed to review and safely mutate questions. */
function parseFormResource(json: Record<string, unknown>, expectedId: string): GoogleFormResource {
  const info = asRecord(json.info);
  const settings = asRecord(json.settings);
  const quizSettings = asRecord(settings?.quizSettings);
  if ((json.settings !== undefined && !settings) || (settings?.quizSettings !== undefined && !quizSettings) ||
      (quizSettings?.isQuiz !== undefined && typeof quizSettings.isQuiz !== 'boolean')) {
    throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
  }
  if (json.formId !== expectedId || typeof json.revisionId !== 'string' || !json.revisionId || json.revisionId.length > 512 ||
      !info || typeof info.title !== 'string' || info.title.length > 300 || !Array.isArray(json.items) || json.items.length > 1000) {
    throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
  }
  const itemIds = new Set<string>();
  const questionIds = new Set<string>();
  const items: GoogleFormItemResource[] = [];
  for (const value of json.items) {
    const item = asRecord(value);
    if (!item || !validItemId(item.itemId) || itemIds.has(item.itemId) ||
        (item.title !== undefined && (typeof item.title !== 'string' || item.title.length > 1000)) ||
        (item.description !== undefined && (typeof item.description !== 'string' || item.description.length > 4000))) {
      throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
    }
    itemIds.add(item.itemId);
    const kinds = ['questionItem', 'pageBreakItem', 'textItem', 'imageItem', 'videoItem', 'questionGroupItem'].filter(key => item[key] !== undefined);
    if (kinds.length > 1) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
    const kindKey = kinds[0];
    const parsed: GoogleFormItemResource = {
      itemId: item.itemId,
      title: typeof item.title === 'string' ? item.title : '',
      ...(typeof item.description === 'string' ? { description: item.description } : {}),
      kind: kindKey === 'questionItem' ? 'question' : kindKey === 'pageBreakItem' ? 'section' : kindKey === 'textItem' ? 'text' :
        kindKey === 'imageItem' || kindKey === 'videoItem' ? 'media' : kindKey === 'questionGroupItem' ? 'question_group' : 'other',
    };
    if (kindKey === 'questionItem') {
      const questionItem = asRecord(item.questionItem);
      const question = asRecord(questionItem?.question);
      if (!question || !validItemId(question.questionId) || questionIds.has(question.questionId) ||
          (question.required !== undefined && typeof question.required !== 'boolean')) {
        throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
      }
      questionIds.add(question.questionId);
      parsed.questionId = question.questionId;
      parsed.required = question.required === true;
      if (question.grading !== undefined && !asRecord(question.grading)) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
      parsed.hasGrading = asRecord(question.grading) !== null;
      const questionKinds = ['choiceQuestion', 'textQuestion', 'dateQuestion', 'timeQuestion', 'scaleQuestion', 'ratingQuestion', 'fileUploadQuestion', 'rowQuestion'].filter(key => question[key] !== undefined);
      if (questionKinds.length !== 1) {
        parsed.questionType = 'unknown';
      } else if (question.choiceQuestion !== undefined) {
        const choice = asRecord(question.choiceQuestion);
        if (!choice || typeof choice.type !== 'string' || !Array.isArray(choice.options) || choice.options.length > 200 || (choice.shuffle !== undefined && typeof choice.shuffle !== 'boolean')) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
        parsed.questionType = choice.type === 'RADIO' ? 'multiple_choice' : choice.type === 'DROP_DOWN' ? 'dropdown' : choice.type === 'CHECKBOX' ? 'checkboxes' : 'unknown';
        parsed.shuffledOptions = choice.shuffle === true;
        parsed.options = choice.options.map(optionValue => {
          const option = asRecord(optionValue);
          if (!option || typeof option.value !== 'string' || option.value.length > 500 || (option.isOther !== undefined && typeof option.isOther !== 'boolean') ||
              (option.image !== undefined && !asRecord(option.image))) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
          if ((option.goToAction !== undefined && typeof option.goToAction !== 'string') || (option.goToSectionId !== undefined && typeof option.goToSectionId !== 'string') ||
              (typeof option.goToAction === 'string' && typeof option.goToSectionId === 'string')) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
          return { value: option.value, hasImage: asRecord(option.image) !== null, isOther: option.isOther === true,
            hasRouting: typeof option.goToAction === 'string' || typeof option.goToSectionId === 'string',
            ...(typeof option.goToAction === 'string' ? { goToAction: option.goToAction } : {}),
            ...(typeof option.goToSectionId === 'string' ? { goToSectionId: option.goToSectionId } : {}) };
        });
      } else if (question.textQuestion !== undefined) {
        const textQuestion = asRecord(question.textQuestion);
        parsed.questionType = textQuestion?.paragraph === true ? 'long_text' : textQuestion?.paragraph === false ? 'short_text' : 'unknown';
      } else if (question.dateQuestion !== undefined) parsed.questionType = 'date';
      else if (question.timeQuestion !== undefined) parsed.questionType = 'time';
      else if (question.scaleQuestion !== undefined) parsed.questionType = 'scale';
      else if (question.ratingQuestion !== undefined) parsed.questionType = 'rating';
      else if (question.fileUploadQuestion !== undefined) parsed.questionType = 'file_upload';
      else if (question.rowQuestion !== undefined) parsed.questionType = 'grid';
      else parsed.questionType = 'unknown';
    }
    items.push(parsed);
  }
  if (info.description !== undefined && (typeof info.description !== 'string' || info.description.length > 4000)) throw new GoogleFormsApiError({ operation: 'forms.get', kind: 'malformed_response' });
  const description = typeof info.description === 'string' ? info.description : undefined;
  const responderUri = typeof json.responderUri === 'string' && json.responderUri.length <= 2048 ? json.responderUri : null;
  return { formId: expectedId, revisionId: json.revisionId, info: { title: info.title, ...(description !== undefined ? { description } : {}) },
    responderUri, isQuiz: quizSettings?.isQuiz === true, items };
}

/** The reply to createItem carries the new item's id. Nothing else from a reply is used. */
export function createdItemId(reply: unknown): string | null {
  if (!reply || typeof reply !== 'object') return null;
  const created = (reply as { createItem?: unknown }).createItem;
  if (!created || typeof created !== 'object') return null;
  const id = (created as { itemId?: unknown }).itemId;
  return typeof id === 'string' && id.length > 0 && id.length <= 64 && /^[A-Za-z0-9_-]+$/.test(id) ? id : null;
}

function readGoogleError(json: unknown): Pick<GoogleFormsApiErrorInfo, 'googleStatus' | 'reason'> {
  const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : null;
  if (!error || typeof error !== 'object') return {};
  const row = error as { status?: unknown; details?: unknown };
  const out: Pick<GoogleFormsApiErrorInfo, 'googleStatus' | 'reason'> = {};
  if (typeof row.status === 'string' && /^[A-Z_]{3,40}$/.test(row.status)) out.googleStatus = row.status;
  // Keep only normalized provider reason codes for the fixed error mapping. Never retain or return
  // Google's free-form message: it can quote rejected user content or carry sensitive diagnostics.
  if (Array.isArray(row.details)) {
    for (const item of row.details) {
      const reason = item && typeof item === 'object' ? (item as { reason?: unknown }).reason : null;
      if (typeof reason === 'string' && /^[A-Z0-9_]{3,80}$/.test(reason)) {
        out.reason = reason;
        break;
      }
    }
  }
  return out;
}

function retryAfter(response: Response): { retryAfterSeconds?: number } {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 && value <= 3600 ? { retryAfterSeconds: Math.ceil(value) } : {};
}
