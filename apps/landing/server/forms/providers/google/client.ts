import { redact } from '../../../providers/oauth';
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

export type GoogleFormsOperation = 'forms.create' | 'forms.get' | 'forms.batchUpdate' | 'forms.setPublishSettings';

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
  /** Google's message, stripped of control characters and secrets and cut short. */
  detail?: string;
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
      raw = await response.text();
    } catch (error) {
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
  };
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

function readGoogleError(json: unknown): Pick<GoogleFormsApiErrorInfo, 'googleStatus' | 'reason' | 'detail'> {
  const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : null;
  if (!error || typeof error !== 'object') return {};
  const row = error as { status?: unknown; message?: unknown; details?: unknown };
  const out: Pick<GoogleFormsApiErrorInfo, 'googleStatus' | 'reason' | 'detail'> = {};
  if (typeof row.status === 'string' && /^[A-Z_]{3,40}$/.test(row.status)) out.googleStatus = row.status;
  if (typeof row.message === 'string') {
    const detail = redact(row.message.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim()).slice(0, 240);
    if (detail) out.detail = detail;
  }
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
