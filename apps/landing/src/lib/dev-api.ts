/**
 * The developer workspace client.
 *
 * A thin, typed wrapper around `/api/dev`. The console is a convenience: every rule — who owns
 * what, which moves a form may make, whether a definition is valid — is enforced by the server,
 * so a failure here is a message to read, not a rule to re-implement.
 */

export type DevFormStatus = 'draft' | 'published' | 'paused' | 'closed' | 'archived';
export type DevFormAction = 'publish' | 'pause' | 'resume' | 'close' | 'reopen' | 'archive' | 'restore';

export interface DevField {
  id: string;
  type: string;
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

  createProject: (input: { name: string; slug?: string; description?: string }) =>
    request<{ project: DevProject }>('/projects', { method: 'POST', body: JSON.stringify(input) }).then(result => result.project),

  getProject: (projectId: string) => request<DevProjectDetail>(`/projects/${encodeURIComponent(projectId)}`),

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
