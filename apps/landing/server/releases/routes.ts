/**
 * Release Manager admin API.
 *
 * Mounted inside the existing admin router (`/api/admin/releases`), so every request has already
 * passed the server-side allowlist and verified-session gate and `res.locals.admin` holds the
 * authenticated operator. There is no second authentication system and no client-side-only hiding.
 *
 * The routes are thin on purpose: they validate input, call the service, and translate a service
 * error into an honest status code. Every write is audited by the service.
 */

import express, { Router, type Request, type Response } from 'express';
import { randomUUID } from 'node:crypto';
import type { RateLimitStore } from '../security/rate-limit';
import { requestNetworkSubject, setRateLimitHeaders } from '../security/rate-limit';
import {
  CHECKLIST_DECISIONS, type ChecklistDecision, type ChecklistKey, type ReleaseCategory, type ReleaseLink,
  type ReleaseSource, type ReleaseStatus,
} from './contracts.ts';
import { ReleaseError, type ReleaseActor, type ReleaseAction, type ReleaseService } from './service.ts';
import type { ReleaseDraftInput } from './contracts.ts';
import { buildShareCopy, buildShareCopyWithinLimit } from './share.ts';
import { buildDraft } from './drafting.ts';
import {
  fetchCommit, fetchGitHubRelease, fetchLatestDeployment, fetchPullRequest, GitHubError,
  parseCommitReference, parsePullRequestReference, parseReleaseTag, readGitHubConfig,
  type GitHubConfig,
} from './github.ts';
import {
  parseAudience, parseBody, parseCategories, parseHeroImageUrl, parseHighlights, parseLinks,
  parseReleaseDate, parseShareText, parseSlug, parseSourceKind, parseSummary, parseTitle, parseNote,
  type FieldErrors, type ParseResult,
} from './validation.ts';

const RATE_RULES = {
  read: { limit: 120, windowSeconds: 60 },
  write: { limit: 60, windowSeconds: 60 },
  github: { limit: 20, windowSeconds: 60 },
} as const;

type Quota = keyof typeof RATE_RULES;

export interface ReleaseAdminRouterDeps {
  service: ReleaseService;
  rateLimiter?: RateLimitStore;
  env?: NodeJS.ProcessEnv;
  /** Public origin used to build the permanent changelog URL. */
  publicOrigin: string;
  github?: GitHubConfig;
  now?: () => Date;
}

function actorOf(req: Request): ReleaseActor {
  const admin = adminFromRequest(req);
  return { id: admin.id, name: admin.name ?? admin.email, email: admin.email };
}

/** The administrator identity the parent admin router already verified and attached. */
function adminFromRequest(req: Request): { id: string; name: string; email: string } {
  const locals = req.res?.locals as { admin?: { id: string; name?: string; email: string } } | undefined;
  const admin = locals?.admin;
  if (!admin?.id) throw new ReleaseError('unauthorized', 'Administrator access is required.');
  return { id: admin.id, name: admin.name ?? admin.email, email: admin.email };
}

function parsePage(value: unknown, fallback: number, max: number): number {
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < 1) return fallback;
  return Math.min(parsed, max);
}

function fieldError(res: Response, errors: FieldErrors, message: string): void {
  res.status(400).json({ error: 'invalid_release', message, fieldErrors: errors });
}

/**
 * Read one field from a request body. An absent field is left alone; an empty string is allowed
 * only where the caller says so; anything else is validated and recorded as a field error.
 */
function readField<T>(raw: unknown, parse: (value: unknown) => ParseResult<T>, errors: FieldErrors, field: string, allowEmpty = false): T | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (allowEmpty && typeof raw === 'string' && raw.trim() === '') return '' as unknown as T;
  const parsed = parse(raw);
  if (!parsed.ok) {
    errors[field] = parsed.errors[field] ?? 'That value is not valid.';
    return undefined;
  }
  return parsed.value;
}

function serviceError(res: Response, error: unknown): void {
  if (error instanceof ReleaseError) {
    const status = error.code === 'not_found' ? 404 : error.code === 'unauthorized' ? 401 : 409;
    res.status(status).json({ error: error.code, message: error.message, ...error.details });
    return;
  }
  res.status(500).json({ error: 'release_failed', message: 'The release could not be updated.' });
}

export function createReleaseAdminRouter(deps: ReleaseAdminRouterDeps): Router {
  const router = Router();
  const githubConfig = deps.github ?? readGitHubConfig(deps.env ?? process.env);
  const now = deps.now ?? (() => new Date());

  async function allow(req: Request, res: Response, quota: Quota): Promise<boolean> {
    if (!deps.rateLimiter) return true;
    try {
      const decision = await deps.rateLimiter.consume(
        `admin.releases.${quota}`,
        `admin:${requestNetworkSubject(req)}`,
        RATE_RULES[quota],
      );
      if (decision.allowed) return true;
      setRateLimitHeaders(res, decision.retryAfterSeconds);
      res.status(429).json({ error: 'Too many release requests. Wait briefly and try again.' });
      return false;
    } catch {
      res.status(503).json({ error: 'Rate-limit storage is temporarily unavailable.' });
      return false;
    }
  }

  router.get('/github', async (req, res) => {
    if (!await allow(req, res, 'read')) return;
    res.json({
      configured: githubConfig.configured,
      repository: githubConfig.repository,
      webhookConfigured: Boolean(githubConfig.webhookSecret),
      apiBaseUrl: githubConfig.apiBaseUrl,
    });
  });

  router.get('/', async (req, res) => {
    if (!await allow(req, res, 'read')) return;
    const statusRaw = typeof req.query.status === 'string' ? req.query.status : '';
    const status = statusRaw && statusRaw !== 'all' ? (statusRaw as ReleaseStatus) : null;
    const page = parsePage(req.query.page, 1, 500);
    const limit = parsePage(req.query.limit, 25, 100);
    try {
      const result = await deps.service.list({ limit, offset: (page - 1) * limit, status });
      res.json({ items: result.items, total: result.total, page, pageSize: limit, totalPages: Math.ceil(result.total / limit) });
    } catch {
      res.status(503).json({ error: 'Release storage is temporarily unavailable.' });
    }
  });

  router.post('/', express.json({ limit: '64kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'write')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: FieldErrors = {};
    const title = readField<string>(body.title, parseTitle, errors, 'title', true);
    const summary = readField<string>(body.summary, parseSummary, errors, 'summary', true);
    const bodyText = readField<string>(body.body, parseBody, errors, 'body', true);
    const categories = readField<ReleaseCategory[]>(body.categories, parseCategories, errors, 'categories');
    const releaseDate = readField<string | null>(body.releaseDate, parseReleaseDate, errors, 'releaseDate');
    const links = readField<ReleaseLink[]>(body.links, parseLinks, errors, 'links');
    const heroImageUrl = readField<string | null>(body.heroImageUrl, parseHeroImageUrl, errors, 'heroImageUrl');
    const shareText = readField<string | null>(body.shareText, parseShareText, errors, 'shareText');
    const slug = readField<string>(body.slug, parseSlug, errors, 'slug');
    if (Object.keys(errors).length > 0) return fieldError(res, errors, 'The release could not be saved.');
    try {
      const release = await deps.service.create(actorOf(req), {
        title: title ?? '',
        summary: summary ?? '',
        body: bodyText ?? '',
        slug,
        categories: categories ?? [],
        releaseDate,
        links: links ?? [],
        heroImageUrl: heroImageUrl ?? null,
        shareText: shareText ?? null,
      });
      res.status(201).json({ release });
    } catch (error) {
      serviceError(res, error);
    }
  });

  router.get('/:id', async (req, res) => {
    if (!await allow(req, res, 'read')) return;
    try {
      const detail = await deps.service.get(req.params.id);
      if (!detail) return res.status(404).json({ error: 'not_found', message: 'That release no longer exists.' });
      const readiness = await deps.service.readiness(req.params.id);
      res.json({
        ...detail,
        readiness: { ready: readiness.ready, blockers: readiness.blockers },
        github: { configured: githubConfig.configured, repository: githubConfig.repository },
        previewUrl: `${deps.publicOrigin}/changelog/${detail.release.slug}`,
      });
    } catch {
      res.status(503).json({ error: 'Release storage is temporarily unavailable.' });
    }
  });

  router.put('/:id', express.json({ limit: '64kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'write')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const errors: FieldErrors = {};
    const patch: Record<string, unknown> = {};
    const title = readField<string>(body.title, parseTitle, errors, 'title');
    if (title !== undefined) patch.title = title;
    const summary = readField<string>(body.summary, parseSummary, errors, 'summary');
    if (summary !== undefined) patch.summary = summary;
    const bodyText = readField<string>(body.body, parseBody, errors, 'body');
    if (bodyText !== undefined) patch.body = bodyText;
    const categories = readField<ReleaseCategory[]>(body.categories, parseCategories, errors, 'categories');
    if (categories !== undefined) patch.categories = categories;
    const releaseDate = readField<string | null>(body.releaseDate, parseReleaseDate, errors, 'releaseDate');
    if (releaseDate !== undefined) patch.releaseDate = releaseDate;
    const links = readField<ReleaseLink[]>(body.links, parseLinks, errors, 'links');
    if (links !== undefined) patch.links = links;
    const heroImageUrl = readField<string | null>(body.heroImageUrl, parseHeroImageUrl, errors, 'heroImageUrl');
    if (heroImageUrl !== undefined) patch.heroImageUrl = heroImageUrl;
    const shareText = readField<string | null>(body.shareText, parseShareText, errors, 'shareText');
    if (shareText !== undefined) patch.shareText = shareText;
    const highlights = readField<string[]>(body.highlights, parseHighlights, errors, 'highlights');
    if (highlights !== undefined) patch.highlights = highlights;
    const audience = readField<string | null>(body.audience, parseAudience, errors, 'audience');
    if (audience !== undefined) patch.audience = audience;
    const slug = readField<string>(body.slug, parseSlug, errors, 'slug');
    if (slug !== undefined) patch.slug = slug;
    if (Object.keys(errors).length > 0) return fieldError(res, errors, 'The release could not be saved.');
    try {
      const release = await deps.service.update(actorOf(req), req.params.id, patch as ReleaseDraftInput);
      res.json({ release });
    } catch (error) {
      serviceError(res, error);
    }
  });

  router.post('/:id/state', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'write')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const action = typeof body.action === 'string' ? body.action : '';
    const allowed = ['submit', 'approve', 'reject', 'revoke_approval', 'await_deployment', 'publish', 'cancel', 'restore'];
    if (!allowed.includes(action)) {
      return res.status(400).json({ error: 'invalid_action', message: 'That release action is not recognised.' });
    }
    const note = parseNote(body.note) ?? undefined;
    try {
      const release = await deps.service.transition(actorOf(req), req.params.id, action as ReleaseAction, note);
      res.json({ release });
    } catch (error) {
      serviceError(res, error);
    }
  });

  /**
   * Link a source. With GitHub configured the pull request, commit, release or deployment is read
   * from the API so the release carries real context; without it the link is still recorded, and
   * the response says plainly that no GitHub metadata was attached.
   */
  router.post('/:id/sources', express.json({ limit: '32kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'github')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const kind = parseSourceKind(body.kind);
    if (!kind) return res.status(400).json({ error: 'invalid_source', message: 'Choose a pull request, commit, release or deployment.' });
    const timestamp = now();
    const base = {
      id: `src_${randomUUID().replace(/-/g, '').slice(0, 20)}`,
      releaseId: req.params.id,
      kind,
      provider: 'manual' as const,
      externalId: null,
      url: typeof body.url === 'string' ? body.url.trim().slice(0, 500) || null : null,
      title: typeof body.title === 'string' ? body.title.trim().slice(0, 300) || null : null,
      detail: typeof body.detail === 'string' ? body.detail.trim().slice(0, 2_000) || null : null,
      labels: [],
      state: null,
      deploymentState: null,
      deploymentEnvironment: null,
      deploymentRef: null,
      deploymentSha: null,
      createdAt: timestamp,
      updatedAt: timestamp,
    };

    try {
      let source: ReleaseSource = base;
      let attached = false;
      if (kind === 'pull_request') {
        const reference = typeof body.pullRequest === 'string'
          ? parsePullRequestReference(body.pullRequest)
          : typeof body.number === 'number' ? parsePullRequestReference(String(body.number)) : null;
        if (reference && githubConfig.configured) {
          const pull = await fetchPullRequest(githubConfig, reference);
          source = {
            ...base,
            provider: 'github',
            externalId: String(pull.number),
            url: pull.htmlUrl || base.url,
            title: pull.title,
            detail: pull.body.slice(0, 2_000) || null,
            labels: pull.labels,
            state: pull.merged ? 'merged' : pull.state,
          };
          attached = true;
        } else if (reference) {
          source = { ...base, externalId: String(reference) };
        }
      } else if (kind === 'commit') {
        const sha = typeof body.commit === 'string' ? parseCommitReference(body.commit) : null;
        if (sha && githubConfig.configured) {
          const commit = await fetchCommit(githubConfig, sha);
          source = { ...base, provider: 'github', externalId: commit.sha, url: commit.url || base.url, title: commit.message.split('\n')[0] ?? null, detail: commit.message.slice(0, 2_000) };
          attached = true;
        } else if (sha) {
          source = { ...base, externalId: sha };
        }
      } else if (kind === 'release') {
        const tag = typeof body.tag === 'string' ? parseReleaseTag(body.tag) : null;
        if (tag && githubConfig.configured) {
          const release = await fetchGitHubRelease(githubConfig, tag);
          source = { ...base, provider: 'github', externalId: release.tagName, url: release.htmlUrl || base.url, title: release.name, detail: release.body.slice(0, 2_000) || null, state: release.draft ? 'draft' : 'published' };
          attached = true;
        } else if (tag) {
          source = { ...base, externalId: tag };
        }
      } else if (kind === 'deployment') {
        const ref = typeof body.ref === 'string' ? body.ref.trim().slice(0, 200) : '';
        if (githubConfig.configured) {
          const deployment = await fetchLatestDeployment(githubConfig, ref || undefined);
          if (deployment) {
            source = {
              ...base,
              provider: 'github',
              externalId: String(deployment.id),
              url: deployment.url ?? base.url,
              title: deployment.environment ? `Deployment to ${deployment.environment}` : 'Deployment',
              detail: deployment.description,
              state: deployment.state,
              deploymentState: deployment.state as ReleaseSource['deploymentState'],
              deploymentEnvironment: deployment.environment || null,
              deploymentRef: deployment.ref || null,
              deploymentSha: deployment.sha || null,
            };
            attached = true;
          }
        }
      }
      const created = await deps.service.addSource(actorOf(req), req.params.id, source);
      res.status(201).json({ source: created, githubMetadataAttached: attached });
    } catch (error) {
      if (error instanceof GitHubError) {
        const status = error.code === 'not_found' ? 404 : error.code === 'not_configured' ? 503 : 502;
        res.status(status).json({ error: error.code, message: error.message });
        return;
      }
      serviceError(res, error);
    }
  });

  /** Read a pull request and, when asked, turn it into an editable changelog draft. */
  router.post('/:id/draft', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'github')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const reference = typeof body.pullRequest === 'string' ? parsePullRequestReference(body.pullRequest) : null;
    if (!reference) return res.status(400).json({ error: 'invalid_reference', message: 'Give a pull request number or URL.' });
    if (!githubConfig.configured) {
      return res.status(503).json({
        error: 'github_not_configured',
        message: 'The GitHub integration is not configured on this server. Write the draft by hand instead.',
      });
    }
    try {
      const pull = await fetchPullRequest(githubConfig, reference);
      const draft = buildDraft(pull);
      const apply = body.apply === true;
      if (apply) {
        await deps.service.update(actorOf(req), req.params.id, {
          title: draft.title,
          summary: draft.summary,
          body: draft.body,
          categories: draft.categories,
        });
        await deps.service.recordDraftGenerated(actorOf(req), req.params.id, `Draft generated from pull request #${pull.number}.`);
      }
      res.json({ draft, applied: apply, pullRequest: { number: pull.number, title: pull.title, url: pull.htmlUrl, merged: pull.merged, labels: pull.labels } });
    } catch (error) {
      if (error instanceof GitHubError) {
        const status = error.code === 'not_found' ? 404 : 502;
        res.status(status).json({ error: error.code, message: error.message });
        return;
      }
      serviceError(res, error);
    }
  });

  router.delete('/:id/sources/:sourceId', async (req, res) => {
    if (!await allow(req, res, 'write')) return;
    try {
      const removed = await deps.service.removeSource(actorOf(req), req.params.id, req.params.sourceId);
      if (!removed) return res.status(404).json({ error: 'not_found', message: 'That source is no longer linked.' });
      res.json({ removed: true });
    } catch (error) {
      serviceError(res, error);
    }
  });

  router.post('/:id/checklist', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'write')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const key = typeof body.key === 'string' ? body.key : '';
    const decision = typeof body.decision === 'string' ? body.decision : '';
    if (!CHECKLIST_DECISIONS.includes(decision as ChecklistDecision)) {
      return res.status(400).json({ error: 'invalid_decision', message: 'Choose confirmed, unconfirmed or not applicable.' });
    }
    try {
      await deps.service.setChecklistDecision(actorOf(req), req.params.id, key as ChecklistKey, decision as ChecklistDecision, parseNote(body.note));
      const readiness = await deps.service.readiness(req.params.id);
      res.json({ checklist: readiness.checklist, ready: readiness.ready, blockers: readiness.blockers });
    } catch (error) {
      serviceError(res, error);
    }
  });

  /** Build the share copy. The text is returned for the administrator to edit; nothing is posted. */
  router.post('/:id/share', express.json({ limit: '8kb', strict: true }), async (req, res) => {
    if (!await allow(req, res, 'read')) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    try {
      const detail = await deps.service.get(req.params.id);
      if (!detail) return res.status(404).json({ error: 'not_found', message: 'That release no longer exists.' });
      const url = `${deps.publicOrigin}/changelog/${detail.release.slug}`;
      const title = typeof body.title === 'string' && body.title.trim() ? body.title.trim() : detail.release.title;
      const summary = typeof body.summary === 'string' && body.summary.trim() ? body.summary.trim() : detail.release.summary;
      const copy = buildShareCopyWithinLimit({ title, summary, url });
      const full = buildShareCopy({ title, summary, url });
      res.json({ text: copy.text, withinLimit: copy.withinLimit, length: copy.length, fullText: full.text, url });
    } catch (error) {
      serviceError(res, error);
    }
  });

  /** The exact payload the public page will show, so a draft can be previewed before publication. */
  router.get('/:id/preview', async (req, res) => {
    if (!await allow(req, res, 'read')) return;
    try {
      const detail = await deps.service.get(req.params.id);
      if (!detail) return res.status(404).json({ error: 'not_found', message: 'That release no longer exists.' });
      const release = detail.release;
      res.json({
        release: {
          slug: release.slug,
          title: release.title,
          summary: release.summary,
          body: release.body,
          categories: release.categories,
          releaseDate: release.releaseDate,
          publishedAt: release.publishedAt ? release.publishedAt.toISOString() : null,
          links: release.links,
          heroImageUrl: release.heroImageUrl,
        },
        url: `${deps.publicOrigin}/changelog/${release.slug}`,
      });
    } catch (error) {
      serviceError(res, error);
    }
  });

  return router;
}
