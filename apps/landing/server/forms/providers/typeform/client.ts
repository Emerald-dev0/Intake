export const TYPEFORM_API_ORIGIN = 'https://api.typeform.com';
export const TYPEFORM_EU_API_ORIGIN = 'https://api.eu.typeform.com';
export const TYPEFORM_EU_API_ORIGIN_NEW = 'https://api.typeform.eu';
const FORM_ID = /^[a-zA-Z0-9]{8,}$/;
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

export type TypeformOperation =
  | 'forms.create'
  | 'forms.get'
  | 'forms.update'
  | 'forms.list'
  | 'forms.delete'
  | 'forms.responses.list'
  | 'me.get';

export interface TypeformApiErrorInfo {
  operation: TypeformOperation;
  kind: 'http' | 'network' | 'timeout' | 'malformed_response';
  httpStatus?: number;
  typeformCode?: string;
  retryAfterSeconds?: number;
}

export class TypeformApiError extends Error {
  readonly info: TypeformApiErrorInfo;

  constructor(info: TypeformApiErrorInfo) {
    super(`Typeform ${info.operation} failed (${info.kind}${info.httpStatus ? ` ${info.httpStatus}` : ''})`);
    this.name = 'TypeformApiError';
    this.info = info;
  }
}

export interface TypeformClient {
  createForm(accessToken: string, input: { title: string; fields?: TypeformField[]; settings?: TypeformSettings; theme?: TypeformTheme; welcomeScreens?: TypeformWelcomeScreen[]; thankYouScreens?: TypeformThankYouScreen[]; logic?: TypeformLogic[] }): Promise<TypeformCreatedFormResponse>;
  getForm(accessToken: string, formId: string): Promise<TypeformFormResource>;
  updateForm(accessToken: string, formId: string, input: { title?: string; fields?: TypeformField[]; settings?: TypeformSettings; theme?: TypeformTheme; welcomeScreens?: TypeformWelcomeScreen[]; thankYouScreens?: TypeformThankYouScreen[]; logic?: TypeformLogic[]; override?: boolean }): Promise<TypeformFormResource>;
  listForms(accessToken: string, page?: number, pageSize?: number): Promise<TypeformFormsListResponse>;
  deleteForm(accessToken: string, formId: string): Promise<void>;
  listResponses(accessToken: string, formId: string, page?: number, pageSize?: number): Promise<TypeformResponsesPage>;
  getUserInfo(accessToken: string): Promise<TypeformUserInfo>;
}

export interface TypeformCreatedFormResponse {
  id: string;
  title: string;
  _links: { display: string; edit: string };
}

export interface TypeformFormResource {
  id: string;
  title: string;
  type: string;
  settings: TypeformSettings;
  theme: TypeformTheme;
  fields: TypeformField[];
  logic: TypeformLogic[];
  welcomeScreens: TypeformWelcomeScreen[];
  thankYouScreens: TypeformThankYouScreen[];
  _links: { display: string; edit: string };
  createdAt: string;
  updatedAt: string;
  workspace: { id: string; name: string };
}

export interface TypeformSettings {
  language: string;
  isPublic: boolean;
  autosaveProgress: boolean;
  progressBar: 'percentage' | 'proportion' | 'none';
  showTypeformBranding: boolean;
  meta: {
    allowIndexing: boolean;
    googleAnalytics?: string;
    facebookPixel?: string;
    googleTagManager?: string;
  };
  redirectAfterSubmitUrl?: string;
}

export interface TypeformTheme {
  id: string;
  name: string;
  background: { hue: number; brightness: number; type: string };
  colors: {
    question: string;
    answer: string;
    button: string;
    background: string;
  };
  font: string;
  hasTransparentButton: boolean;
}

export interface TypeformField {
  id?: string;
  ref?: string;
  title: string;
  type: TypeformFieldType;
  properties?: Record<string, unknown>;
  validations?: Record<string, unknown>;
  attachment?: { type: string; href: string };
  layout?: Record<string, unknown>;
}

export type TypeformFieldType =
  | 'short_text'
  | 'long_text'
  | 'multiple_choice'
  | 'dropdown'
  | 'picture_choice'
  | 'yes_no'
  | 'email'
  | 'number'
  | 'rating'
  | 'opinion_scale'
  | 'date'
  | 'file_upload'
  | 'statement'
  | 'website'
  | 'payment'
  | 'calendly'
  | 'group'
  | 'matrix';

export interface TypeformLogic {
  ref: string;
  type: 'field' | 'hidden';
  actions: TypeformLogicAction[];
}

export interface TypeformLogicAction {
  action: 'jump' | 'end' | 'hide';
  details: {
    to?: { type: 'field' | 'thankyou_screen'; value: string };
    condition?: { op: string; value: unknown };
  };
}

export interface TypeformWelcomeScreen {
  ref: string;
  title: string;
  properties: { showButton: boolean; buttonText: string; description?: string };
}

export interface TypeformThankYouScreen {
  ref: string;
  title: string;
  properties: { showButton: boolean; buttonText: string; buttonMode: 'redirect' | 'close'; buttonLink?: string; redirectUrl?: string };
}

export interface TypeformFormsListResponse {
  items: Array<{ id: string; title: string; theme: { id: string; name: string }; workspace: { id: string; name: string }; _links: { display: string }; createdAt: string; updatedAt: string }>;
  pageCount: number;
  totalItems: number;
}

export interface TypeformResponsesPage {
  items: TypeformResponse[];
  pageCount: number;
  totalItems: number;
}

export interface TypeformResponse {
  formId: string;
  token: string;
  landedAt: string;
  submittedAt: string;
  metadata: { userAgent: string; platform: string; referer: string; networkId: string; browser: string; os: string; device: string; hidden: Record<string, string> };
  answers: TypeformAnswer[];
  hidden: Record<string, string>;
  calculated: Record<string, unknown>;
}

export interface TypeformAnswer {
  field: { id: string; type: TypeformFieldType; ref: string };
  type: 'text' | 'number' | 'boolean' | 'choice' | 'choices' | 'date' | 'file_url' | 'payment';
  text?: string;
  number?: number;
  boolean?: boolean;
  choice?: { label: string };
  choices?: { labels: string[] };
  date?: string;
  fileUrl?: string;
  payment?: { amount: number; currency: string };
}

export interface TypeformUserInfo {
  id: string;
  email: string;
  name: string;
  accountType: 'personal' | 'business';
  plan: string;
}

export type FetchLike = (input: string, init: RequestInit) => Promise<Response>;

function getApiOrigin(accessToken: string): string {
  if (accessToken.startsWith('eu_')) return TYPEFORM_EU_API_ORIGIN_NEW;
  if (accessToken.startsWith('tfp_')) return TYPEFORM_EU_API_ORIGIN;
  return TYPEFORM_API_ORIGIN;
}

export function createTypeformClient(options: { fetchImpl?: FetchLike; timeoutMs?: number } = {}): TypeformClient {
  const fetchImpl: FetchLike = options.fetchImpl ?? ((input, init) => fetch(input, init));
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  async function call(operation: TypeformOperation, accessToken: string, path: string, body?: unknown, query?: Record<string, string>, method: 'GET' | 'POST' | 'PUT' | 'DELETE' = 'GET'): Promise<Record<string, unknown>> {
    const origin = getApiOrigin(accessToken);
    const url = new URL(path, origin);
    for (const [key, value] of Object.entries(query ?? {})) url.searchParams.set(key, value);
    if (url.origin !== TYPEFORM_API_ORIGIN && url.origin !== TYPEFORM_EU_API_ORIGIN && url.origin !== TYPEFORM_EU_API_ORIGIN_NEW) {
      throw new TypeformApiError({ operation, kind: 'malformed_response' });
    }

    let response: Response;
    let raw: string;
    try {
      response = await fetchImpl(url.toString(), {
        method,
        headers: {
          authorization: `Bearer ${accessToken}`,
          ...(method !== 'GET' ? { 'content-type': 'application/json' } : {}),
          accept: 'application/json',
        },
        ...(method !== 'GET' ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(timeoutMs),
      });
      raw = await limitedText(response);
    } catch (error) {
      if (error instanceof ResponseTooLargeError) throw new TypeformApiError({ operation, kind: 'malformed_response' });
      const name = error instanceof Error ? error.name : '';
      throw new TypeformApiError({ operation, kind: name === 'TimeoutError' || name === 'AbortError' ? 'timeout' : 'network' });
    }

    let json: unknown = null;
    if (raw) {
      try {
        json = JSON.parse(raw);
      } catch {
        json = null;
      }
    }
    if (!response.ok) throw new TypeformApiError({ operation, kind: 'http', httpStatus: response.status, ...readTypeformError(json), ...retryAfter(response) });
    if (!json || typeof json !== 'object' || Array.isArray(json)) throw new TypeformApiError({ operation, kind: 'malformed_response', httpStatus: response.status });
    return json as Record<string, unknown>;
  }

  return {
    async createForm(accessToken, input) {
      const json = await call('forms.create', accessToken, '/forms', {
        title: input.title,
        ...(input.fields !== undefined ? { fields: input.fields } : {}),
        ...(input.settings !== undefined ? { settings: input.settings } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
        ...(input.welcomeScreens !== undefined ? { welcome_screens: input.welcomeScreens } : {}),
        ...(input.thankYouScreens !== undefined ? { thankyou_screens: input.thankYouScreens } : {}),
        ...(input.logic !== undefined ? { logic: input.logic } : {}),
      });
      if (typeof json.id !== 'string' || !json.id) throw new TypeformApiError({ operation: 'forms.create', kind: 'malformed_response' });
      const links = json._links as Record<string, unknown> | undefined;
      return { id: json.id, title: String(json.title ?? ''), _links: { display: String(links?.display ?? ''), edit: String(links?.edit ?? '') } };
    },

    async getForm(accessToken, formId) {
      if (!isFormId(formId)) throw new TypeformApiError({ operation: 'forms.get', kind: 'malformed_response' });
      const json = await call('forms.get', accessToken, `/forms/${encodeURIComponent(formId)}`, undefined, undefined, 'GET');
      return parseFormResource(json, formId);
    },

    async updateForm(accessToken, formId, input) {
      if (!isFormId(formId)) throw new TypeformApiError({ operation: 'forms.update', kind: 'malformed_response' });
      const json = await call('forms.update', accessToken, `/forms/${encodeURIComponent(formId)}`, {
        ...(input.title !== undefined ? { title: input.title } : {}),
        ...(input.fields !== undefined ? { fields: input.fields } : {}),
        ...(input.settings !== undefined ? { settings: input.settings } : {}),
        ...(input.theme !== undefined ? { theme: input.theme } : {}),
        ...(input.welcomeScreens !== undefined ? { welcome_screens: input.welcomeScreens } : {}),
        ...(input.thankYouScreens !== undefined ? { thankyou_screens: input.thankYouScreens } : {}),
        ...(input.override !== undefined ? { override: input.override } : {}),
      });
      return parseFormResource(json, formId);
    },

    async listForms(accessToken, page = 1, pageSize = 200) {
      const json = await call('forms.list', accessToken, '/forms', undefined, { page: String(page), page_size: String(pageSize) }, 'GET');
      return parseFormsList(json);
    },

    async deleteForm(accessToken, formId) {
      if (!isFormId(formId)) throw new TypeformApiError({ operation: 'forms.delete', kind: 'malformed_response' });
      await call('forms.delete', accessToken, `/forms/${encodeURIComponent(formId)}`, undefined, undefined, 'DELETE');
    },

    async listResponses(accessToken, formId, page = 1, pageSize = 200) {
      if (!isFormId(formId)) throw new TypeformApiError({ operation: 'forms.responses.list', kind: 'malformed_response' });
      const json = await call('forms.responses.list', accessToken, `/forms/${encodeURIComponent(formId)}/responses`, undefined, { page: String(page), page_size: String(pageSize) }, 'GET');
      return parseResponsesPage(json);
    },

    async getUserInfo(accessToken) {
      const json = await call('me.get', accessToken, '/me', undefined, undefined, 'GET');
      return parseUserInfo(json);
    },
  };
}

function parseFormResource(json: Record<string, unknown>, expectedId: string): TypeformFormResource {
  if (json.id !== expectedId || typeof json.id !== 'string') throw new TypeformApiError({ operation: 'forms.get', kind: 'malformed_response' });
  const links = json._links as Record<string, unknown> | undefined;
  return {
    id: json.id,
    title: String(json.title ?? ''),
    type: String(json.type ?? ''),
    settings: json.settings as TypeformSettings,
    theme: json.theme as TypeformTheme,
    fields: (json.fields as unknown[])?.map(f => f as TypeformField) ?? [],
    logic: (json.logic as unknown[])?.map(l => l as TypeformLogic) ?? [],
    welcomeScreens: (json.welcome_screens as unknown[])?.map(w => w as TypeformWelcomeScreen) ?? [],
    thankYouScreens: (json.thankyou_screens as unknown[])?.map(t => t as TypeformThankYouScreen) ?? [],
    _links: { display: String(links?.display ?? ''), edit: String(links?.edit ?? '') },
    createdAt: String(json.created_at ?? ''),
    updatedAt: String(json.updated_at ?? ''),
    workspace: json.workspace as { id: string; name: string },
  };
}

function parseFormsList(json: Record<string, unknown>): TypeformFormsListResponse {
  const items = (json.items as Array<Record<string, unknown>>) ?? [];
  return {
    items: items.map(item => {
      const itemLinks = item._links as Record<string, unknown> | undefined;
      return {
        id: String(item.id ?? ''),
        title: String(item.title ?? ''),
        theme: item.theme as { id: string; name: string },
        workspace: item.workspace as { id: string; name: string },
        _links: { display: String(itemLinks?.display ?? '') },
        createdAt: String(item.created_at ?? ''),
        updatedAt: String(item.updated_at ?? ''),
      };
    }),
    pageCount: Number(json.page_count ?? 0),
    totalItems: Number(json.total_items ?? 0),
  };
}

function parseResponsesPage(json: Record<string, unknown>): TypeformResponsesPage {
  const items = (json.items as Array<Record<string, unknown>>) ?? [];
  return {
    items: items.map(item => ({
      formId: String(item.form_id ?? ''),
      token: String(item.token ?? ''),
      landedAt: String(item.landed_at ?? ''),
      submittedAt: String(item.submitted_at ?? ''),
      metadata: item.metadata as TypeformResponse['metadata'],
      answers: ((item.answers as Array<Record<string, unknown>>) ?? []).map(a => a as unknown as TypeformAnswer),
      hidden: item.hidden as Record<string, string>,
      calculated: item.calculated as Record<string, unknown>,
    })),
    pageCount: Number(json.page_count ?? 0),
    totalItems: Number(json.total_items ?? 0),
  };
}

function parseUserInfo(json: Record<string, unknown>): TypeformUserInfo {
  return {
    id: String(json.id ?? ''),
    email: String(json.email ?? ''),
    name: String(json.name ?? ''),
    accountType: String(json.account_type ?? 'personal') as 'personal' | 'business',
    plan: String(json.plan ?? ''),
  };
}

function isFormId(value: unknown): value is string {
  return typeof value === 'string' && FORM_ID.test(value);
}

function readTypeformError(json: unknown): Pick<TypeformApiErrorInfo, 'typeformCode'> {
  const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : null;
  if (!error || typeof error !== 'object') return {};
  const row = error as { code?: unknown };
  const out: Pick<TypeformApiErrorInfo, 'typeformCode'> = {};
  if (typeof row.code === 'string' && /^[A-Z_]{3,60}$/.test(row.code)) out.typeformCode = row.code;
  return out;
}

function retryAfter(response: Response): { retryAfterSeconds?: number } {
  const value = Number(response.headers.get('retry-after'));
  return Number.isFinite(value) && value > 0 && value <= 3600 ? { retryAfterSeconds: Math.ceil(value) } : {};
}

export function editUrl(formId: string, origin: string = TYPEFORM_API_ORIGIN): string {
  if (origin === TYPEFORM_EU_API_ORIGIN || origin === TYPEFORM_EU_API_ORIGIN_NEW) {
    return `https://admin.typeform.com/form/${encodeURIComponent(formId)}/edit`;
  }
  return `https://admin.typeform.com/form/${encodeURIComponent(formId)}/edit`;
}