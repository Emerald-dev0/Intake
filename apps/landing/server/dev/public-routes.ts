/**
 * The public side of a hosted developer form.
 *
 * Two routes, both unauthenticated, both about a form somebody published on purpose:
 *
 * - `GET /api/dev/public/forms/:projectSlug/:formSlug` — the definition of a published form.
 * - `POST /api/dev/public/forms/:projectSlug/:formSlug/submissions` — an answer.
 *
 * A form that is not published is a 404, not a 403: a draft, a paused form and a closed form are
 * all simply not there, so their addresses cannot be probed. A submission is validated against the
 * published version, rate-limited, and a retry with the same key does not create a second answer.
 */

import express, { Router, type Request, type Response } from 'express';
import type { RateLimitStore } from '../security/rate-limit';
import { requestNetworkSubject, setRateLimitHeaders } from '../security/rate-limit';
import type { DevStore } from './contracts.ts';
import {
  newSubmissionId,
  normaliseIdempotencyKey,
  readSource,
  validateSubmission,
} from './submissions.ts';

/** A submission body is small: a form is a handful of questions, not a file upload. */
export const SUBMISSION_BODY_LIMIT = '32kb';

const READ_LIMIT = { limit: 120, windowSeconds: 60 };
const SUBMIT_LIMIT = { limit: 20, windowSeconds: 60 };

export interface PublicDevRouterDeps {
  store: DevStore;
  rateLimiter?: RateLimitStore;
  now?: () => Date;
  /** Tells the owner that there are new answers, if they asked to be told. Never throws. */
  notify?: (input: { projectId: string; userId: string; projectName: string; formName: string }) => Promise<boolean>;
}

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export function createPublicDevRouter(deps: PublicDevRouterDeps): Router {
  const router = Router();
  const now = deps.now ?? (() => new Date());

  async function allow(req: Request, res: Response, scope: string, rule: { limit: number; windowSeconds: number }): Promise<boolean> {
    if (!deps.rateLimiter) return true;
    try {
      const decision = await deps.rateLimiter.consume(scope, `network:${requestNetworkSubject(req)}`, rule);
      if (decision.allowed) return true;
      setRateLimitHeaders(res, decision.retryAfterSeconds);
      res.status(429).json({ error: 'rate_limited', message: 'Too many requests. Wait briefly and try again.' });
      return false;
    } catch {
      res.status(503).json({ error: 'forms_unavailable', message: 'The form is temporarily unavailable. Try again shortly.' });
      return false;
    }
  }

  /** The published form behind an address, or null when there is not one. */
  async function findPublished(projectSlug: string, formSlug: string) {
    if (!SLUG.test(projectSlug) || !SLUG.test(formSlug)) return null;
    const project = await deps.store.getProjectBySlug(projectSlug);
    if (!project) return null;
    const form = await deps.store.getFormBySlug(project.id, formSlug);
    if (!form || form.status !== 'published') return null;
    const version = await deps.store.getPublishedVersion(form.id);
    if (!version) return null;
    return { project, form, version };
  }

  /** The counters. A failure to count never fails the request it was counting. */
  async function count(projectId: string | undefined, delta: { accepted?: number; rejected?: number; bytes?: number }): Promise<void> {
    if (!projectId) return;
    try {
      await deps.store.recordUsage({ projectId, ...delta, day: now() });
    } catch {
      /* metering is not worth failing an answer for */
    }
  }

  router.get('/forms/:projectSlug/:formSlug', async (req, res) => {
    if (!await allow(req, res, 'dev.public.read', READ_LIMIT)) return;
    try {
      const found = await findPublished(String(req.params.projectSlug ?? ''), String(req.params.formSlug ?? ''));
      if (!found) {
        res.status(404).json({ error: 'not_found', message: 'There is no form at this address.' });
        return;
      }
      res.json({
        form: {
          name: found.form.name,
          slug: found.form.slug,
          projectSlug: found.project.slug,
          version: found.version.version,
        },
        definition: found.version.definition,
      });
    } catch {
      res.status(503).json({ error: 'forms_unavailable', message: 'The form is temporarily unavailable. Try again shortly.' });
    }
  });

  router.post('/forms/:projectSlug/:formSlug/submissions', express.json({ limit: SUBMISSION_BODY_LIMIT, strict: true }), async (req, res) => {
    if (!await allow(req, res, 'dev.public.submit', SUBMIT_LIMIT)) return;
    try {
      const found = await findPublished(String(req.params.projectSlug ?? ''), String(req.params.formSlug ?? ''));
      if (!found) {
        res.status(404).json({ error: 'not_found', message: 'There is no form at this address.' });
        return;
      }

      // A retry with the same key is the same answer, not a second one.
      const idempotencyKey = normaliseIdempotencyKey(req.get('Idempotency-Key'));
      if (idempotencyKey) {
        const existing = await deps.store.getSubmissionByIdempotencyKey(found.form.id, idempotencyKey);
        if (existing) {
          res.status(200).json({ submission: { id: existing.id, receivedAt: existing.submittedAt.toISOString() }, duplicate: true });
          return;
        }
      }

      const validation = validateSubmission(found.version.definition, req.body);
      if (!validation.ok) {
        await count(found.project.id, { rejected: 1 });
        res.status(400).json({
          error: 'invalid_submission',
          message: 'Some answers need another look.',
          fieldErrors: validation.errors,
        });
        return;
      }

      const submission = await deps.store.createSubmission({
        id: newSubmissionId(),
        formId: found.form.id,
        formVersionId: found.version.id,
        projectId: found.project.id,
        answers: validation.answers,
        source: readSource(req.headers as Record<string, string | string[] | undefined>),
        idempotencyKey,
        submittedAt: now(),
      });
      await count(found.project.id, { accepted: 1, bytes: JSON.stringify(validation.answers).length });
      res.status(201).json({ submission: { id: submission.id, receivedAt: submission.submittedAt.toISOString() }, duplicate: false });
      // The notice goes out after the answer has been accepted, and never slows the answer down.
      if (deps.notify) {
        void deps.notify({
          projectId: found.project.id,
          userId: found.project.userId,
          projectName: found.project.name,
          formName: found.form.name,
        }).catch(() => undefined);
      }
    } catch {
      res.status(503).json({ error: 'forms_unavailable', message: 'The form is temporarily unavailable. Try again shortly.' });
    }
  });

  return router;
}
