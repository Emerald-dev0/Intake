/**
 * The developer workspace client.
 *
 * A thin, typed wrapper around `/api/dev`. The console is a convenience: every rule — who owns
 * what, which moves a form may make, whether a definition is valid — is enforced by the server,
 * so a failure here is a message to read, not a rule to re-implement.
 */

export type DevFormStatus = 'draft' | 'published' | 'paused' | 'closed' | 'archived';
export type DevFormAction = 'publish' | 'pause' | 'resume' | 'close' | 'reopen' | 'archive' | 'restore';

export type DevFieldType =
  | 'short_text' | 'long_text' | 'email' | 'number'
  | 'dropdown' | 'single_choice' | 'multiple_choice' | 'checkbox' | 'date';

export interface DevField {
  id: string;
  type: DevFieldType;
  label: string;
  description: string | null;
  required: boolean;
  options: string[];
  placeholder: string | null;
}

export interface DevTheme {
  mode: 'light' | 'dark' | 'system';
  primary: string;
  background: string;
  text: string;
  border: string;
  fontFamily: string | null;
  radius: number;
  transparentBackground: boolean;
}

export interface DevFormDefinition {
  fields: DevField[];
  theme: DevTheme;
  submitLabel: string | null;
  successMessage: string | null;
}

export interface DevProject {
  id: string;
  name: string;
  slug: string;
  description: string | null;
  status: 'active' | 'archived';
  createdAt: string;
  updatedAt: string;
}

export interface DevForm {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  status: DevFormStatus;
  createdAt: string;
  updatedAt: string;
}

export interface DevFormVersion {
  id: string;
  formId: string;
  version: number;
  definition: DevFormDefinition;
  state: 'draft' | 'published' | 'superseded';
  createdAt: string;
  publishedAt: string | null;
}

/** One answer to a hosted form. */
export interface DevSubmission {
  id: string;
  formId: string;
  formVersionId: string;
  projectId: string;
  answers: Record<string, string | number | boolean | string[]>;
  source: { referrer?: string; userAgent?: string };
  idempotencyKey: string | null;
  submittedAt: string;
}

export interface DevSubmissionPage {
  items: DevSubmission[];
  /** The exact number of answers that match, counted by the database. */
  total: number;
  perDay: Array<{ day: string; count: number }>;
}

/** The result of a summary: what the answers sound like, and the counts beside it. */
export interface DevInsights {
  summary: string;
  highlights: string[];
  caveats: string[];
  /** The exact counts, computed from the rows rather than by the model. */
  statistics: {
    totalResponses: number;
    truncated: boolean;
    questions: Array<{
      id: string;
      title: string;
      kind: string;
      answered: number;
      choices?: Array<{ label: string; count: number }>;
      average?: number;
      topPhrases?: Array<{ phrase: string; count: number }>;
    }>;
  };
  answersRead: number;
  answersTotal: number;
  cost: { credits: number; status: string };
}

/** The counters for the last thirty days. */
export interface DevUsage {
  windowDays: number;
  projects: Array<{ projectId: string; name: string; slug: string; accepted: number; rejected: number; bytes: number }>;
  totals: { accepted: number; rejected: number; bytes: number };
}

/** How the owner of a project wants to be told about new answers. */
export interface DevNotifyPreference {
  mode: 'off' | 'threshold' | 'digest';
  threshold: number;
  pending: number;
  lastSentAt: string | null;
}

export interface DevProjectDetail {
  project: DevProject;
  forms: DevForm[];
}

export interface DevFormDetail {
  form: DevForm;
  project: DevProject;
  publishedVersion: DevFormVersion | null;
  draftVersion: DevFormVersion | null;
  versions: DevFormVersion[];
}

export interface DevFieldError {
  path: string;
  message: string;
}

/** The server's answer when it refuses something, in the console's words. */
export class DevApiError extends Error {
  constructor(public readonly status: number, public readonly code: string, message: string, public readonly fieldErrors: DevFieldError[] = []) {
    super(message);
    this.name = 'DevApiError';
  }
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`/api/dev${path}`, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: init.body ? { 'Content-Type': 'application/json', accept: 'application/json' } : { accept: 'application/json' },
    ...init,
  });
  const text = await response.text();
  let payload: Record<string, unknown> = {};
  if (text) {
    try {
      payload = JSON.parse(text) as Record<string, unknown>;
    } catch {
      payload = {};
    }
  }
  if (!response.ok) {
    const fieldErrors = Array.isArray(payload.fieldErrors) ? (payload.fieldErrors as DevFieldError[]) : [];
    throw new DevApiError(
      response.status,
      typeof payload.error === 'string' ? payload.error : 'request_failed',
      typeof payload.message === 'string' ? payload.message : 'That request could not be completed.',
      fieldErrors,
    );
  }
  return payload as T;
}

export const devApi = {
  listProjects: () => request<{ projects: DevProject[] }>('/projects').then(result => result.projects),

  usage: () => request<DevUsage>('/usage'),

  createProject: (input: { name: string; slug?: string; description?: string }) =>
    request<{ project: DevProject }>('/projects', { method: 'POST', body: JSON.stringify(input) }).then(result => result.project),

  getProject: (projectId: string) => request<DevProjectDetail>(`/projects/${encodeURIComponent(projectId)}`),

  getNotificationPreference: (projectId: string) =>
    request<DevNotifyPreference>(`/projects/${encodeURIComponent(projectId)}/notifications`),

  setNotificationPreference: (projectId: string, input: { mode: DevNotifyPreference['mode']; threshold?: number }) =>
    request<DevNotifyPreference>(`/projects/${encodeURIComponent(projectId)}/notifications`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),

  updateProject: (projectId: string, input: { name?: string; description?: string }) =>
    request<{ project: DevProject }>(`/projects/${encodeURIComponent(projectId)}`, { method: 'PATCH', body: JSON.stringify(input) })
      .then(result => result.project),

  createForm: (projectId: string, input: { name: string; slug?: string }) =>
    request<DevFormDetail>(`/projects/${encodeURIComponent(projectId)}/forms`, { method: 'POST', body: JSON.stringify(input) }),

  getForm: (formId: string) => request<DevFormDetail>(`/forms/${encodeURIComponent(formId)}`),

  saveDefinition: (formId: string, definition: unknown) =>
    request<DevFormDetail>(`/forms/${encodeURIComponent(formId)}/definition`, {
      method: 'PUT',
      body: JSON.stringify({ definition }),
    }),

  publishForm: (formId: string) => request<DevFormDetail>(`/forms/${encodeURIComponent(formId)}/publish`, { method: 'POST' }),

  applyAction: (formId: string, action: DevFormAction) =>
    request<DevFormDetail>(`/forms/${encodeURIComponent(formId)}/state`, { method: 'POST', body: JSON.stringify({ action }) }),

  listSubmissions: (formId: string, options: { q?: string; limit?: number; offset?: number } = {}) => {
    const query = new URLSearchParams();
    if (options.q) query.set('q', options.q);
    if (options.limit) query.set('limit', String(options.limit));
    if (options.offset) query.set('offset', String(options.offset));
    const suffix = query.toString() ? `?${query.toString()}` : '';
    return request<DevSubmissionPage>(`/forms/${encodeURIComponent(formId)}/submissions${suffix}`);
  },

  /** Asks the model what the answers sound like. It costs credits, like every other AI operation. */
  summarizeAnswers: (formId: string) => request<DevInsights>(`/forms/${encodeURIComponent(formId)}/insights`, { method: 'POST' }),

  /** The address of the CSV file. The browser downloads it; the server builds it. */
  submissionsCsvUrl: (formId: string) => `/api/dev/forms/${encodeURIComponent(formId)}/submissions.csv`,
};

/** The wording the console shows for each state of a form. */
export const FORM_STATUS_LABEL: Record<DevFormStatus, string> = {
  draft: 'Draft',
  published: 'Published',
  paused: 'Paused',
  closed: 'Closed',
  archived: 'Archived',
};

/** What a person can do with a form right now. The server refuses anything else. */
export function availableActions(status: DevFormStatus): DevFormAction[] {
  switch (status) {
    case 'draft':
      return [];
    case 'published':
      return ['pause', 'close', 'archive'];
    case 'paused':
      return ['resume', 'close', 'archive'];
    case 'closed':
      return ['reopen', 'archive'];
    case 'archived':
      return ['restore'];
    default:
      return [];
  }
}

export const ACTION_LABEL: Record<DevFormAction, string> = {
  publish: 'Publish',
  pause: 'Pause',
  resume: 'Resume',
  close: 'Close',
  reopen: 'Reopen',
  archive: 'Archive',
  restore: 'Restore',
};

/** How a field type is written on screen. */
export const FIELD_LABEL: Record<string, string> = {
  short_text: 'Short text',
  long_text: 'Long text',
  email: 'Email',
  number: 'Number',
  dropdown: 'Dropdown',
  single_choice: 'Single choice',
  multiple_choice: 'Multiple choice',
  checkbox: 'Checkbox',
  date: 'Date',
};
