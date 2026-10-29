/**
 * Intake for Developers — the workspace domain.
 *
 * A project belongs to a person. A form belongs to a project. A form has versions, and a published
 * version never changes: that is what lets a submission be checked against the definition that was
 * live when it was accepted.
 *
 * The vocabulary here is the single source of truth for the tables, the API, the console and the
 * hosted form, so a status cannot mean two different things in two different places.
 */

/** The states a hosted form can be in. The public endpoint enforces them. */
export const DEV_FORM_STATUSES = ['draft', 'published', 'paused', 'closed', 'archived'] as const;
export type DevFormStatus = typeof DEV_FORM_STATUSES[number];

/** The field types the hosted form renders. */
export const DEV_FIELD_TYPES = [
  'short_text',
  'long_text',
  'email',
  'number',
  'dropdown',
  'single_choice',
  'multiple_choice',
  'checkbox',
  'date',
] as const;
export type DevFieldType = typeof DEV_FIELD_TYPES[number];

/** Field types that need a list of options to mean anything. */
export const CHOICE_FIELD_TYPES: DevFieldType[] = ['dropdown', 'single_choice', 'multiple_choice'];

/** How many fields a form may have, and how many options a choice field may offer. */
export const DEV_FIELD_LIMIT = 60;
export const DEV_OPTION_LIMIT = 40;

export interface DevField {
  /** Stable within the form: the key a submission is stored against. */
  id: string;
  type: DevFieldType;
  label: string;
  description: string | null;
  required: boolean;
  /** Only for the choice types. */
  options: string[];
  placeholder: string | null;
}

export interface DevTheme {
  /** `system` follows the reader's operating system. */
  mode: 'light' | 'dark' | 'system';
  primary: string;
  background: string;
  text: string;
  border: string;
  fontFamily: string | null;
  /** Corner radius in pixels. */
  radius: number;
  /** A transparent background lets the host page show through. */
  transparentBackground: boolean;
}

export interface DevFormDefinition {
  fields: DevField[];
  theme: DevTheme;
  submitLabel: string | null;
  successMessage: string | null;
}

export const DEV_PROJECT_STATUSES = ['active', 'archived'] as const;
export type DevProjectStatus = typeof DEV_PROJECT_STATUSES[number];

export interface DevProject {
  id: string;
  userId: string;
  name: string;
  slug: string;
  description: string | null;
  status: DevProjectStatus;
  createdAt: Date;
  updatedAt: Date;
}

export interface DevForm {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  status: DevFormStatus;
  createdAt: Date;
  updatedAt: Date;
}

export type DevFormVersionState = 'draft' | 'published' | 'superseded';

export interface DevFormVersion {
  id: string;
  formId: string;
  version: number;
  definition: DevFormDefinition;
  state: DevFormVersionState;
  createdAt: Date;
  publishedAt: Date | null;
}

/** A form with the two versions the console needs: the live one and the one being edited. */
export interface DevFormDetail {
  form: DevForm;
  project: DevProject;
  /** The published version, when the form has one. */
  publishedVersion: DevFormVersion | null;
  /** The draft version being edited. */
  draftVersion: DevFormVersion | null;
  versions: DevFormVersion[];
}

export interface DevProjectDetail {
  project: DevProject;
  forms: DevForm[];
}

/** The lifecycle a form may go through, enforced by the server. */
export const DEV_FORM_ACTIONS = ['publish', 'pause', 'resume', 'close', 'reopen', 'archive', 'restore'] as const;
export type DevFormAction = typeof DEV_FORM_ACTIONS[number];

/** A response to a hosted form. */
export interface DevSubmission {
  id: string;
  formId: string;
  formVersionId: string;
  projectId: string;
  answers: Record<string, string | number | boolean | string[]>;
  source: { referrer?: string; userAgent?: string };
  idempotencyKey: string | null;
  submittedAt: Date;
}

export interface DevStore {
  listProjects(userId: string): Promise<DevProject[]>;
  getProject(userId: string, projectId: string): Promise<DevProject | null>;
  /** The public address of a project. Unique across every account, not per person. */
  getProjectBySlug(slug: string): Promise<DevProject | null>;
  createProject(project: DevProject): Promise<DevProject>;
  updateProject(projectId: string, patch: Partial<DevProject>): Promise<DevProject | null>;

  listForms(projectId: string): Promise<DevForm[]>;
  getForm(formId: string): Promise<DevForm | null>;
  getFormBySlug(projectId: string, slug: string): Promise<DevForm | null>;
  createForm(form: DevForm): Promise<DevForm>;
  updateForm(formId: string, patch: Partial<DevForm>): Promise<DevForm | null>;

  listVersions(formId: string): Promise<DevFormVersion[]>;
  getVersion(versionId: string): Promise<DevFormVersion | null>;
  getPublishedVersion(formId: string): Promise<DevFormVersion | null>;
  getDraftVersion(formId: string): Promise<DevFormVersion | null>;
  createVersion(version: DevFormVersion): Promise<DevFormVersion>;
  updateVersion(versionId: string, patch: Partial<DevFormVersion>): Promise<DevFormVersion | null>;

  createSubmission(submission: DevSubmission): Promise<DevSubmission>;
  getSubmissionByIdempotencyKey(formId: string, key: string): Promise<DevSubmission | null>;

  /** The answers to a form, newest first, with the exact total counted in SQL. */
  listSubmissions(input: DevSubmissionQuery): Promise<DevSubmissionPage>;
  getSubmission(submissionId: string): Promise<DevSubmission | null>;
}

/** How the inbox reads the answers. */
export interface DevSubmissionQuery {
  /** The project the answers belong to — the ownership boundary for every read. */
  projectId: string;
  /** Only this form, when one is named. */
  formId?: string;
  /** A word to look for anywhere in the answers. */
  search?: string;
  /** Only answers from this date onwards. */
  since?: Date;
  /** Only answers from this date until. */
  until?: Date;
  limit: number;
  offset: number;
}

export interface DevSubmissionPage {
  items: DevSubmission[];
  /** The exact number of answers that match, counted by the database. */
  total: number;
  /** The number of answers per day, oldest first. */
  perDay: Array<{ day: string; count: number }>;
}
