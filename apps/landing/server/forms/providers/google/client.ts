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

export type GoogleFormsOperation = 'forms.create' | 'forms.batchUpdate' | 'forms.setPublishSettings';

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
  batchUpdate(accessToken: string, formId: string, requests: readonly GoogleRequest[]): Promise<{ replies: unknown[] }>;
  setPublishSettings(accessToken: string, formId: string, state: { isPublished: boolean; isAcceptingResponses: boolean }): Promise<PublishStateResponse>;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

export function isFormId(value: unknown): value is string {
  return typeof value === 'string' && FORM_ID.test(value);
}

export function createGoogleFormsClient(options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): GoogleFormsClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(operation: GoogleFormsOperation, accessToken: string, path: string, body: unknown, query?: Record<string, string>): Promise<Record<string, unknown>> {
    const url = new URL(path, GOOGLE_FORMS_ORIGIN);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    if (url.origin !== GOOGLE_FORMS_ORIGIN) throw new GoogleFormsApiError({ operation, kind: 'malformed_response' });

    let response: Response;
    let raw: string;
    try {
      response = await fetchImpl(url.toString(), {
        method: 'POST',
        headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', accept: 'application/json' },
        body: JSON.stringify(body),
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

  function formPath(operation: GoogleFormsOperation, formId: string, method: string): string {
    if (!isFormId(formId)) throw new GoogleFormsApiError({ operation, kind: 'malformed_response' });
    return `/v1/forms/${encodeURIComponent(formId)}:${method}`;
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

    async batchUpdate(accessToken, formId, requests) {
      const json = await call('forms.batchUpdate', accessToken, formPath('forms.batchUpdate', formId, 'batchUpdate'), { requests });
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
