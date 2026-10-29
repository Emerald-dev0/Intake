/**
 * Release Manager domain types.
 *
 * A "release" is one public changelog announcement and the internal record of how it got there.
 * The vocabulary here is the single source of truth for the whole feature: the database columns,
 * the admin API, the public API, the admin console and the public changelog all speak these
 * names, so a status can never mean two different things in two different places.
 *
 * Rules that hold everywhere:
 *   - the browser never decides a status, a category, a slug or a publication date; the server does;
 *   - a release only becomes public when it reaches `published`, and the public API only ever
 *     returns rows in that state;
 *   - the slug is the permanent URL, so it is frozen the moment the release is published.
 */

import type { ReleaseCategory } from '../../src/lib/releases.ts';

export const RELEASE_STATUSES = [
  'draft',
  'in_review',
  'approved',
  'awaiting_deployment',
  'published',
  'cancelled',
] as const;
export type ReleaseStatus = typeof RELEASE_STATUSES[number];

/** States from which a release can still be published. */
export const PUBLISHABLE_STATUSES: ReleaseStatus[] = ['approved', 'awaiting_deployment'];

// The category vocabulary is shared with the public page so a release can never be filed under a
// label the reader cannot see. The server owns the meaning; the client only renders it.
export { RELEASE_CATEGORIES, type ReleaseCategory } from '../../src/lib/releases.ts';

/** GitHub labels that classify a change. Anything else is not a release classification. */
export const RELEASE_LABEL_PREFIX = 'release:';

export const RELEASE_SOURCE_KINDS = ['pull_request', 'commit', 'release', 'deployment'] as const;
export type ReleaseSourceKind = typeof RELEASE_SOURCE_KINDS[number];

export const RELEASE_SOURCE_PROVIDERS = ['github', 'manual'] as const;
export type ReleaseSourceProvider = typeof RELEASE_SOURCE_PROVIDERS[number];

/** Deployment states as observed from the GitHub Deployments API. */
export const DEPLOYMENT_STATES = ['success', 'failure', 'error', 'in_progress', 'queued', 'pending', 'unknown'] as const;
export type DeploymentState = typeof DEPLOYMENT_STATES[number];

/** How many highlights a release may carry, and how long each one may be. */
export const RELEASE_HIGHLIGHT_LIMIT = 6;
export const RELEASE_HIGHLIGHT_TEXT_LIMIT = 200;
export const RELEASE_AUDIENCE_LIMIT = 240;

export const RELEASE_LINK_LIMIT = 12;
export const RELEASE_LINK_LABEL_LIMIT = 80;
export const RELEASE_LINK_URL_LIMIT = 500;

export interface ReleaseLink {
  label: string;
  url: string;
}

export interface ReleaseRecord {
  id: string;
  slug: string;
  title: string;
  summary: string;
  body: string;
  categories: ReleaseCategory[];
  status: ReleaseStatus;
  /** Publication date the reader sees, in UTC. Set by the operator, never by the clock alone. */
  releaseDate: string | null;
  links: ReleaseLink[];
  heroImageUrl: string | null;
  shareText: string | null;
  /** The short version of the announcement: what changed, in a few lines. */
  highlights: string[];
  /** One line naming who the release is for. */
  audience: string | null;
  authorUserId: string | null;
  authorName: string | null;
  authorEmail: string | null;
  approvedByUserId: string | null;
  approvedAt: Date | null;
  publishedAt: Date | null;
  publishedByUserId: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface ReleaseSource {
  id: string;
  releaseId: string;
  kind: ReleaseSourceKind;
  provider: ReleaseSourceProvider;
  /** Provider-side identifier: pull request number, commit sha, deployment id. */
  externalId: string | null;
  url: string | null;
  title: string | null;
  /** Short provider-supplied description (pull request body, commit message). */
  detail: string | null;
  labels: string[];
  /** Provider-side state, e.g. `merged`, `closed`, `success`. */
  state: string | null;
  /** Deployment observation, only meaningful for deployment sources. */
  deploymentState: DeploymentState | null;
  deploymentEnvironment: string | null;
  deploymentRef: string | null;
  deploymentSha: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export const RELEASE_AUDIT_ACTIONS = [
  'created',
  'updated',
  'submitted',
  'approved',
  'rejected',
  'approval_revoked',
  'published',
  'corrected',
  'cancelled',
  'source_linked',
  'source_updated',
  'source_removed',
  'checklist_updated',
  'draft_generated',
] as const;
export type ReleaseAuditAction = typeof RELEASE_AUDIT_ACTIONS[number];

export interface ReleaseAuditEntry {
  id: string;
  releaseId: string;
  action: ReleaseAuditAction;
  /** Administrator who performed the action. Null when the record predates attribution. */
  actorUserId: string | null;
  actorName: string | null;
  actorEmail: string | null;
  /** Short, already-safe description of what changed. */
  detail: string | null;
  createdAt: Date;
}

export const CHECKLIST_STATUSES = ['verified', 'confirmed', 'unconfirmed', 'not_applicable', 'unknown', 'blocked'] as const;
export type ChecklistStatus = typeof CHECKLIST_STATUSES[number];

export const CHECKLIST_KEYS = [
  'content',
  'tests',
  'typecheck',
  'migrations',
  'documentation',
  'claims',
  'preview',
  'deployment',
  'approval',
] as const;
export type ChecklistKey = typeof CHECKLIST_KEYS[number];

export interface ChecklistItem {
  key: ChecklistKey;
  label: string;
  /** `automatic` items are computed from real state; `manual` items need a human answer. */
  kind: 'automatic' | 'manual';
  status: ChecklistStatus;
  /** One line explaining the status, always present when the status is not a plain pass. */
  detail: string;
  /** True when a person explicitly marked the item as not applicable. */
  notApplicable: boolean;
}

/** What an administrator may record for a manual checklist item. */
export const CHECKLIST_DECISIONS = ['confirmed', 'unconfirmed', 'not_applicable'] as const;
export type ChecklistDecision = typeof CHECKLIST_DECISIONS[number];

/** The public shape of a release. Never includes drafts, source ids, actors or internal notes. */
export interface PublicRelease {
  slug: string;
  title: string;
  summary: string;
  body: string;
  categories: ReleaseCategory[];
  releaseDate: string | null;
  publishedAt: string | null;
  links: ReleaseLink[];
  heroImageUrl: string | null;
  highlights: string[];
  audience: string | null;
}

export interface ReleaseListItem {
  id: string;
  slug: string;
  title: string;
  summary: string;
  status: ReleaseStatus;
  categories: ReleaseCategory[];
  releaseDate: string | null;
  publishedAt: Date | null;
  updatedAt: Date;
  authorName: string | null;
  sourceCount: number;
  hasDeployment: boolean;
  deploymentState: DeploymentState | null;
}

export interface ReleaseListResult {
  items: ReleaseListItem[];
  total: number;
  page: number;
  pageSize: number;
  totalPages: number;
}

export interface ReleaseDraftInput {
  title?: string;
  summary?: string;
  body?: string;
  slug?: string;
  categories?: ReleaseCategory[];
  releaseDate?: string | null;
  links?: ReleaseLink[];
  heroImageUrl?: string | null;
  shareText?: string | null;
  highlights?: string[];
  audience?: string | null;
}

export interface ReleaseStore {
  list(input: { limit: number; offset: number; status: ReleaseStatus | null }): Promise<{ items: ReleaseListItem[]; total: number }>;
  get(id: string): Promise<ReleaseRecord | null>;
  getBySlug(slug: string): Promise<ReleaseRecord | null>;
  create(input: { release: ReleaseRecord }): Promise<ReleaseRecord>;
  update(id: string, patch: Partial<ReleaseRecord>): Promise<ReleaseRecord | null>;
  listPublished(input: { limit: number; offset: number }): Promise<{ items: PublicRelease[]; total: number }>;
  getPublishedBySlug(slug: string): Promise<PublicRelease | null>;
  listSources(releaseId: string): Promise<ReleaseSource[]>;
  findSourceByExternalId(input: { provider: ReleaseSourceProvider; kind: ReleaseSourceKind; externalId: string }): Promise<ReleaseSource | null>;
  addSource(source: ReleaseSource): Promise<ReleaseSource>;
  updateSource(id: string, patch: Partial<ReleaseSource>): Promise<ReleaseSource | null>;
  removeSource(id: string): Promise<boolean>;
  listAudit(releaseId: string): Promise<ReleaseAuditEntry[]>;
  addAudit(entry: ReleaseAuditEntry): Promise<void>;
  listChecklistDecisions(releaseId: string): Promise<Array<{ key: ChecklistKey; decision: ChecklistDecision; note: string | null }>>;
  setChecklistDecision(input: { releaseId: string; key: ChecklistKey; decision: ChecklistDecision; note: string | null; actorUserId: string | null }): Promise<void>;
  /**
   * Record a webhook delivery. Returns false when the delivery id was already processed, which is
   * how a repeated GitHub delivery is ignored instead of applied twice.
   */
  recordWebhookDelivery(input: { deliveryId: string; eventType: string }): Promise<boolean>;
}
