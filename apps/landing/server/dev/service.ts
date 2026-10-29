/**
 * The rules of the developer workspace.
 *
 * Two things live here: the ownership chain (a user owns a project, a project owns a form, a form
 * owns its versions) and the lifecycle of a hosted form. Both are enforced on the server, on every
 * call — the console is a convenience, not the boundary.
 *
 * Every function that takes a `userId` answers the same question first: does this person own the
 * thing they are asking about? If not, the answer is a 404, because a project that belongs to
 * somebody else should not even confirm that it exists.
 */

import { randomUUID } from 'node:crypto';
import {
  type DevForm,
  type DevFormAction,
  type DevFormDefinition,
  type DevFormDetail,
  type DevFormVersion,
  type DevProject,
  type DevProjectDetail,
  type DevStore,
} from './contracts.js';
import { emptyDefinition, validateDefinition, validateFormName, validateProjectName, validateSlug } from './validation.js';

/** One cell of a CSV file: quoted when it has to be, and never a formula a spreadsheet would run. */
function csvCell(value: string): string {
  const text = value.replace(/\r?\n/g, ' ');
  const guarded = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return /[",]/.test(guarded) ? `"${guarded.replace(/"/g, '""')}"` : guarded;
}

export class DevError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = 'DevError';
  }
}

const notFound = (what: string) => new DevError(404, 'not_found', `That ${what} does not exist.`);

export interface DevServiceDeps {
  store: DevStore;
  now?: () => Date;
  id?: () => string;
}

/**
 * Which lifecycle moves are legal from which state.
 *
 * A form is published by publishing a version, so `publish` here means "put the live version
 * back in front of people" and only makes sense for a form that has one.
 */
const TRANSITIONS: Record<DevFormAction, { from: DevForm['status'][]; to: DevForm['status'] }> = {
  publish: { from: ['draft', 'paused', 'closed'], to: 'published' },
  pause: { from: ['published'], to: 'paused' },
  resume: { from: ['paused'], to: 'published' },
  close: { from: ['published', 'paused'], to: 'closed' },
  reopen: { from: ['closed'], to: 'published' },
  archive: { from: ['draft', 'published', 'paused', 'closed'], to: 'archived' },
  restore: { from: ['archived'], to: 'draft' },
};

export class DevService {
  private readonly store: DevStore;
  private readonly now: () => Date;
  private readonly id: () => string;

  constructor(deps: DevServiceDeps) {
    this.store = deps.store;
    this.now = deps.now ?? (() => new Date());
    this.id = deps.id ?? (() => `dev_${randomUUID().replace(/-/g, '').slice(0, 24)}`);
  }

  // ── projects ────────────────────────────────────────────────────────────────

  async listProjects(userId: string): Promise<DevProject[]> {
    return this.store.listProjects(userId);
  }

  async createProject(userId: string, input: { name?: unknown; slug?: unknown; description?: unknown }): Promise<DevProject> {
    const name = validateProjectName(input.name);
    if (!name.ok) throw new DevError(400, 'invalid_project', 'The project needs a name.', name.errors);
    const slug = validateSlug(input.slug, name.value);
    if (!slug.ok) throw new DevError(400, 'invalid_project', 'The project address is not usable.', slug.errors);

    // The public address is shared by everybody, not namespaced by account: two people's projects
    // cannot both live at /forms/checkout. An address the developer chose themselves is refused so
    // they can pick another; one derived from the name gets a short suffix instead.
    const supplied = typeof input.slug === 'string' && input.slug.trim() !== '';
    let address = slug.value;
    const taken = await this.store.getProjectBySlug(address);
    if (taken) {
      if (supplied) {
        throw new DevError(409, 'slug_taken', 'That address is already in use by another project.', [
          { path: 'slug', message: 'Pick another address.' },
        ]);
      }
      for (let attempt = 0; attempt < 8; attempt += 1) {
        const candidate = `${slug.value.slice(0, 54).replace(/-+$/, '')}-${randomUUID().slice(0, 4)}`;
        if (!await this.store.getProjectBySlug(candidate)) {
          address = candidate;
          break;
        }
      }
      if (address === slug.value) {
        throw new DevError(409, 'slug_taken', 'That address is already in use by another project.', [
          { path: 'slug', message: 'Pick another address.' },
        ]);
      }
    }

    const timestamp = this.now();
    const project: DevProject = {
      id: this.id(),
      userId,
      name: name.value,
      slug: address,
      description: typeof input.description === 'string' ? input.description.trim().slice(0, 400) || null : null,
      status: 'active',
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    return this.store.createProject(project);
  }

  async getProjectDetail(userId: string, projectId: string): Promise<DevProjectDetail> {
    const project = await this.store.getProject(userId, projectId);
    if (!project) throw notFound('project');
    const forms = await this.store.listForms(project.id);
    return { project, forms };
  }

  async updateProject(userId: string, projectId: string, input: { name?: unknown; description?: unknown }): Promise<DevProject> {
    const project = await this.store.getProject(userId, projectId);
    if (!project) throw notFound('project');

    const patch: Partial<DevProject> = { updatedAt: this.now() };
    if (input.name !== undefined) {
      const name = validateProjectName(input.name);
      if (!name.ok) throw new DevError(400, 'invalid_project', 'The project needs a name.', name.errors);
      patch.name = name.value;
    }
    if (input.description !== undefined) {
      patch.description = typeof input.description === 'string' ? input.description.trim().slice(0, 400) || null : null;
    }
    const updated = await this.store.updateProject(project.id, patch);
    if (!updated) throw notFound('project');
    return updated;
  }

  // ── forms ───────────────────────────────────────────────────────────────────

  async listForms(userId: string, projectId: string): Promise<DevForm[]> {
    const project = await this.store.getProject(userId, projectId);
    if (!project) throw notFound('project');
    return this.store.listForms(project.id);
  }

  async createForm(
    userId: string,
    projectId: string,
    input: { name?: unknown; slug?: unknown; sourceOperationKey?: string | null },
  ): Promise<DevFormDetail> {
    const project = await this.store.getProject(userId, projectId);
    if (!project) throw notFound('project');

    const name = validateFormName(input.name);
    if (!name.ok) throw new DevError(400, 'invalid_form', 'The form needs a name.', name.errors);
    const slug = validateSlug(input.slug, name.value);
    if (!slug.ok) throw new DevError(400, 'invalid_form', 'The form address is not usable.', slug.errors);

    const existing = await this.store.getFormBySlug(project.id, slug.value);
    if (existing) {
      throw new DevError(409, 'slug_taken', 'That project already has a form with this address.', [
        { path: 'slug', message: 'Pick another address.' },
      ]);
    }

    const timestamp = this.now();
    const form: DevForm = {
      id: this.id(),
      projectId: project.id,
      name: name.value,
      slug: slug.value,
      status: 'draft',
      sourceOperationKey: input.sourceOperationKey ?? null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };
    const created = await this.store.createForm(form);

    const version: DevFormVersion = {
      id: this.id(),
      formId: created.id,
      version: 1,
      definition: emptyDefinition(),
      state: 'draft',
      createdAt: timestamp,
      publishedAt: null,
    };
    await this.store.createVersion(version);
    return this.getFormDetail(userId, created.id);
  }

  async getFormDetail(userId: string, formId: string): Promise<DevFormDetail> {
    const form = await this.store.getForm(formId);
    if (!form) throw notFound('form');
    // The ownership chain: the form belongs to a project, and the project belongs to the person.
    const project = await this.store.getProject(userId, form.projectId);
    if (!project) throw notFound('form');

    const versions = await this.store.listVersions(form.id);
    const publishedVersion = versions.find(version => version.state === 'published') ?? null;
    const draftVersion = versions.find(version => version.state === 'draft') ?? null;
    return { form, project, publishedVersion, draftVersion, versions };
  }

  /** Saves the definition of the draft version. A published version is never touched. */
  async saveDefinition(userId: string, formId: string, definition: unknown): Promise<DevFormDetail> {
    const detail = await this.getFormDetail(userId, formId);
    const parsed = validateDefinition(definition);
    if (!parsed.ok) throw new DevError(400, 'invalid_definition', 'The form has something wrong with it.', parsed.errors);

    const draft = detail.draftVersion;
    if (!draft) {
      // The draft was published and no new one exists yet: open a fresh draft from the live version.
      const next = await this.store.createVersion({
        id: this.id(),
        formId: detail.form.id,
        version: detail.versions.length + 1,
        definition: parsed.value,
        state: 'draft',
        createdAt: this.now(),
        publishedAt: null,
      });
      void next;
    } else {
      await this.store.updateVersion(draft.id, { definition: parsed.value });
    }
    return this.getFormDetail(userId, formId);
  }

  /**
   * Publishes the draft version.
   *
   * Publishing checks the definition again, this time with the fields required: a form with no
   * fields is a draft, not something to put in front of people.
   */
  async publish(userId: string, formId: string): Promise<DevFormDetail> {
    const detail = await this.getFormDetail(userId, formId);
    const draft = detail.draftVersion;
    if (!draft) throw new DevError(409, 'nothing_to_publish', 'There is nothing waiting to be published.');

    const parsed = validateDefinition(draft.definition, { requireFields: true });
    if (!parsed.ok) throw new DevError(400, 'invalid_definition', 'The form is not ready to publish.', parsed.errors);

    const timestamp = this.now();
    if (detail.publishedVersion) {
      await this.store.updateVersion(detail.publishedVersion.id, { state: 'superseded' });
    }
    await this.store.updateVersion(draft.id, { state: 'published', publishedAt: timestamp });
    await this.store.updateForm(detail.form.id, { status: 'published', updatedAt: timestamp });
    return this.getFormDetail(userId, formId);
  }

  /** Moves a form through its lifecycle, refusing the moves that make no sense. */
  async applyAction(userId: string, formId: string, action: DevFormAction): Promise<DevFormDetail> {
    const detail = await this.getFormDetail(userId, formId);
    const rule = TRANSITIONS[action];
    if (!rule) throw new DevError(400, 'unknown_action', 'That is not something a form can do.');

    if (action === 'publish') {
      // Publishing means putting the live version back in front of people, so there has to be one.
      if (!detail.publishedVersion) {
        throw new DevError(409, 'nothing_to_publish', 'Publish the form first, then you can bring it back.');
      }
    }
    if (!rule.from.includes(detail.form.status)) {
      throw new DevError(
        409,
        'invalid_transition',
        `A ${detail.form.status} form cannot be ${action === 'restore' ? 'restored' : `${action}d`}.`,
      );
    }

    const timestamp = this.now();
    await this.store.updateForm(detail.form.id, { status: rule.to, updatedAt: timestamp });
    return this.getFormDetail(userId, formId);
  }

  /**
   * Deletes a form, its versions and its answers.
   *
   * Two rules, both on the server:
   *
   * 1. A form that is live cannot be deleted by accident. Close it first — that is a deliberate
   *    act, and it stops the public endpoint a moment before the answers go.
   * 2. The confirmation has to be the form's own address. A delete that fires from a stale tab,
   *    a mis-wired client or a stray retry cannot take anything with it.
   */
  async deleteForm(userId: string, formId: string, confirmation: string): Promise<void> {
    const detail = await this.getFormDetail(userId, formId);

    if (detail.form.status === 'published') {
      throw new DevError(
        409,
        'form_live',
        'This form is still live. Close it first, then delete it.',
      );
    }

    if (confirmation.trim() !== detail.form.slug) {
      throw new DevError(
        400,
        'confirmation_required',
        `Type the form's address (${detail.form.slug}) to delete it.`,
      );
    }

    await this.store.deleteForm(detail.form.id);
  }

  // ── the notification preference ─────────────────────────────────────────────

  /**
   * How this person wants to be told about new answers.
   *
   * Off unless they say otherwise. The check is the account's own, so one person cannot read or
   * change another's preference.
   */
  async getNotificationPreference(userId: string, projectId: string) {
    const project = await this.store.getProject(userId, projectId);
    if (!project) throw notFound('project');
    const preference = await this.store.getNotificationPreference(userId, projectId);
    if (!preference) {
      return { mode: 'off' as const, threshold: 10, pending: 0, lastSentAt: null };
    }
    return { mode: preference.mode, threshold: preference.threshold, pending: preference.pending, lastSentAt: preference.lastSentAt };
  }

  async setNotificationPreference(userId: string, projectId: string, input: { mode?: unknown; threshold?: unknown }) {
    const project = await this.store.getProject(userId, projectId);
    if (!project) throw notFound('project');

    const mode = input.mode === 'threshold' || input.mode === 'digest' || input.mode === 'off' ? input.mode : null;
    if (!mode) throw new DevError(400, 'invalid_preference', 'Choose off, every N answers, or a daily digest.');

    let threshold = 10;
    if (input.threshold !== undefined && input.threshold !== null && input.threshold !== '') {
      const value = Number(input.threshold);
      if (!Number.isSafeInteger(value) || value < 1 || value > 1000) {
        throw new DevError(400, 'invalid_preference', 'The threshold has to be a whole number between 1 and 1000.', [
          { path: 'threshold', message: 'Between 1 and 1000.' },
        ]);
      }
      threshold = value;
    }

    const existing = await this.store.getNotificationPreference(userId, projectId);
    const timestamp = this.now();
    const saved = await this.store.saveNotificationPreference({
      id: existing?.id ?? this.id(),
      userId,
      projectId,
      mode,
      threshold,
      pending: existing?.pending ?? 0,
      lastSentAt: existing?.lastSentAt ?? null,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp,
    });
    return { mode: saved.mode, threshold: saved.threshold, pending: saved.pending, lastSentAt: saved.lastSentAt };
  }

  // ── the answers ─────────────────────────────────────────────────────────────

  /**
   * The answers to a form.
   *
   * The form is checked for ownership first, and the query is made against the project as well,
   * so an answer can never be read by anyone but the account that owns the form it belongs to.
   */
  async listSubmissions(userId: string, formId: string, options: { search?: string; since?: Date; until?: Date; limit?: number; offset?: number } = {}) {
    const detail = await this.getFormDetail(userId, formId);
    const limit = Math.min(Math.max(options.limit ?? 50, 1), 200);
    const offset = Math.max(options.offset ?? 0, 0);
    const search = typeof options.search === 'string' ? options.search.trim().slice(0, 120) : '';
    return this.store.listSubmissions({
      projectId: detail.project.id,
      formId: detail.form.id,
      search: search || undefined,
      since: options.since,
      until: options.until,
      limit,
      offset,
    });
  }

  /** One answer, read through the same ownership chain. */
  async getSubmission(userId: string, submissionId: string) {
    const submission = await this.store.getSubmission(submissionId);
    if (!submission) throw notFound('answer');
    const project = await this.store.getProject(userId, submission.projectId);
    if (!project) throw notFound('answer');
    const form = await this.store.getForm(submission.formId);
    return { submission, form, project };
  }

  /**
   * The answers as a CSV file.
   *
   * The columns are the questions of the form, in order, so the file reads like the form does.
   * Values are quoted the way a spreadsheet expects, and a value that starts with a character a
   * spreadsheet would treat as a formula is neutralised before it lands in the file.
   */
  async exportSubmissionsCsv(userId: string, formId: string): Promise<{ filename: string; csv: string }> {
    const detail = await this.getFormDetail(userId, formId);
    const definition = detail.publishedVersion?.definition ?? detail.draftVersion?.definition ?? null;
    const fields = definition?.fields ?? [];
    const page = await this.store.listSubmissions({
      projectId: detail.project.id,
      formId: detail.form.id,
      limit: 10000,
      offset: 0,
    });

    const header = ['Submitted at', ...fields.map(field => field.label)];
    const lines = [header.map(cell => csvCell(cell)).join(',')];
    for (const submission of page.items) {
      const row: string[] = [submission.submittedAt.toISOString()];
      for (const field of fields) {
        const value = submission.answers[field.id];
        row.push(value === undefined ? '' : Array.isArray(value) ? value.join(', ') : String(value));
      }
      lines.push(row.map(cell => csvCell(cell)).join(','));
    }
    return { filename: `${detail.form.slug}-responses.csv`, csv: `${lines.join('\r\n')}\r\n` };
  }

  /** The definition the public endpoint serves. Only a published form has one. */
  async getPublishedDefinition(formId: string): Promise<{ form: DevForm; definition: DevFormDefinition } | null> {
    const form = await this.store.getForm(formId);
    if (!form || form.status !== 'published') return null;
    const version = await this.store.getPublishedVersion(form.id);
    if (!version) return null;
    return { form, definition: version.definition };
  }
}
