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

    const existing = await this.store.getProjectBySlug(userId, slug.value);
    if (existing) {
      throw new DevError(409, 'slug_taken', 'You already have a project with that address.', [
        { path: 'slug', message: 'Pick another address.' },
      ]);
    }

    const timestamp = this.now();
    const project: DevProject = {
      id: this.id(),
      userId,
      name: name.value,
      slug: slug.value,
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

  async createForm(userId: string, projectId: string, input: { name?: unknown; slug?: unknown }): Promise<DevFormDetail> {
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

  /** The definition the public endpoint serves. Only a published form has one. */
  async getPublishedDefinition(formId: string): Promise<{ form: DevForm; definition: DevFormDefinition } | null> {
    const form = await this.store.getForm(formId);
    if (!form || form.status !== 'published') return null;
    const version = await this.store.getPublishedVersion(form.id);
    if (!version) return null;
    return { form, definition: version.definition };
  }
}
