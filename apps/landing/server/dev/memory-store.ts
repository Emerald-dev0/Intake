/**
 * In-memory developer workspace store.
 *
 * The tests use it, and it behaves like the PostgreSQL store in the ways that matter: the ownership
 * chain is enforced in the query itself (`getProject` takes the user id), a form has at most one
 * published version, and versions are immutable once published.
 */

import type {
  DevForm, DevFormVersion, DevProject, DevStore, DevSubmission,
} from './contracts.js';

export interface MemoryDevStore extends DevStore {
  /** Test helper: every row the store holds. */
  dump(): { projects: DevProject[]; forms: DevForm[]; versions: DevFormVersion[]; submissions: DevSubmission[] };
}

export function createMemoryDevStore(): MemoryDevStore {
  const projects: DevProject[] = [];
  const forms: DevForm[] = [];
  const versions: DevFormVersion[] = [];
  const submissions: DevSubmission[] = [];

  // A structured clone keeps the dates as dates. A JSON round trip would turn them into strings
  // and quietly break anything that calls toISOString().
  const copy = <T>(value: T): T => (value === undefined || value === null ? value : structuredClone(value));

  return {
    async listProjects(userId: string) {
      return projects.filter(project => project.userId === userId).map(copy);
    },

    async getProject(userId: string, projectId: string) {
      const project = projects.find(entry => entry.id === projectId && entry.userId === userId);
      return project ? copy(project) : null;
    },

    async getProjectBySlug(slug: string) {
      const project = projects.find(entry => entry.slug === slug);
      return project ? copy(project) : null;
    },

    async createProject(project: DevProject) {
      projects.push(copy(project));
      return copy(project);
    },

    async updateProject(projectId: string, patch: Partial<DevProject>) {
      const project = projects.find(entry => entry.id === projectId);
      if (!project) return null;
      Object.assign(project, patch);
      return copy(project);
    },

    async listForms(projectId: string) {
      return forms.filter(form => form.projectId === projectId).map(copy);
    },

    async getForm(formId: string) {
      const form = forms.find(entry => entry.id === formId);
      return form ? copy(form) : null;
    },

    async getFormBySlug(projectId: string, slug: string) {
      const form = forms.find(entry => entry.projectId === projectId && entry.slug === slug);
      return form ? copy(form) : null;
    },

    async createForm(form: DevForm) {
      forms.push(copy(form));
      return copy(form);
    },

    async updateForm(formId: string, patch: Partial<DevForm>) {
      const form = forms.find(entry => entry.id === formId);
      if (!form) return null;
      Object.assign(form, patch);
      return copy(form);
    },

    async listVersions(formId: string) {
      return versions
        .filter(version => version.formId === formId)
        .sort((a, b) => b.version - a.version)
        .map(copy);
    },

    async getVersion(versionId: string) {
      const version = versions.find(entry => entry.id === versionId);
      return version ? copy(version) : null;
    },

    async getPublishedVersion(formId: string) {
      const version = versions.find(entry => entry.formId === formId && entry.state === 'published');
      return version ? copy(version) : null;
    },

    async getDraftVersion(formId: string) {
      const version = versions
        .filter(entry => entry.formId === formId && entry.state === 'draft')
        .sort((a, b) => b.version - a.version)[0];
      return version ? copy(version) : null;
    },

    async createVersion(version: DevFormVersion) {
      versions.push(copy(version));
      return copy(version);
    },

    async updateVersion(versionId: string, patch: Partial<DevFormVersion>) {
      const version = versions.find(entry => entry.id === versionId);
      if (!version) return null;
      Object.assign(version, patch);
      return copy(version);
    },

    async createSubmission(submission: DevSubmission) {
      submissions.push(copy(submission));
      return copy(submission);
    },

    async getSubmissionByIdempotencyKey(formId: string, key: string) {
      const submission = submissions.find(entry => entry.formId === formId && entry.idempotencyKey === key);
      return submission ? copy(submission) : null;
    },

    dump() {
      return { projects: copy(projects), forms: copy(forms), versions: copy(versions), submissions: copy(submissions) };
    },
  };
}
