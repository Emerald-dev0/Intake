/**
 * The developer workspace API.
 *
 * Mounted at `/api/dev`, behind the same session the rest of the signed-in area uses — there is no
 * second authentication system for developers. Every route resolves the person from the session,
 * and every read and write goes through the service, which checks ownership on the server.
 *
 * The routes are thin: they read the body, call the service, and turn a service error into an
 * honest status code. A form that belongs to somebody else is a 404, not a 403 — the console
 * should not confirm that somebody else's project exists.
 */

import express, { Router, type Request, type Response } from 'express';
import { createHash } from 'node:crypto';
import { DevError, type DevService } from './service.ts';
import { DEV_FORM_ACTIONS, type DevFormAction, type DevStore } from './contracts.ts';
import { summarizeResponses, type InsightQuestion } from '../forms/insights/summary.ts';
import { MAX_ANSWERS_READ, type DevInsightModel } from './insights.ts';
import type { AiOperationRunner } from '../ai/operations.ts';

export interface DevRouterDeps {
  service: DevService;
  /** The counters, read directly from the store. */
  store: DevStore;
  /** Resolves the signed-in person, or null when there is no session. */
  getSession: (req: Request) => Promise<{ id: string; email: string; name: string } | null>;
  /** The AI summary of a form's answers. Absent when the server has no model configured. */
  insights?: {
    runner: AiOperationRunner;
    model: DevInsightModel;
    /** What one summary costs, in the credits the customer already has. */
    cost: number;
  };
}

/** The field types the statistics know how to count. */
function insightKind(type: string): InsightQuestion['kind'] {
  if (type === 'dropdown' || type === 'single_choice' || type === 'multiple_choice') return 'choice';
  if (type === 'short_text' || type === 'long_text') return 'text';
  if (type === 'checkbox') return 'other';
  return 'other';
}

/** A key that is the same for the same answers, so a repeat is not charged twice. */
function insightsOperationKey(formId: string, total: number, latest: string | undefined): string {
  const digest = createHash('sha256').update(`${formId}:${total}:${latest ?? ''}`).digest('hex').slice(0, 16);
  return `devi_${formId.slice(0, 16)}_${digest}`;
}

/** The JSON body a definition is allowed to be. A form is small; a megabyte is not one. */
const DEFINITION_LIMIT = '128kb';

export function createDevRouter(deps: DevRouterDeps): Router {
  const router = Router();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  // The session comes first, so an unauthenticated caller never reaches a handler.
  router.use(async (req, res, next) => {
    try {
      const user = await deps.getSession(req);
      if (!user) {
        res.status(401).json({ error: 'not_authenticated', message: 'You are not signed in. Sign in, then try again.' });
        return;
      }
      res.locals.user = user;
      next();
    } catch {
      res.status(503).json({ error: 'storage_unavailable', message: 'Intake is temporarily unavailable. Please try again later.' });
    }
  });

  const userId = (res: Response): string => (res.locals.user as { id: string }).id;
  const now = (): Date => new Date();

  // Any failure inside a handler becomes a status code that says what actually happened.
  const handle = (error: unknown, res: Response): void => {
    if (error instanceof DevError) {
      res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { fieldErrors: error.details } : {}) });
      return;
    }
    res.status(500).json({ error: 'dev_failed', message: 'The developer workspace could not complete that request.' });
  };

  // ── projects ────────────────────────────────────────────────────────────────

  /**
   * The usage of every project the person owns.
   *
   * The counters are ours, counted from the rows: answers accepted, requests refused, and the
   * bytes of answers stored. They are here so a developer can see their own project; an operator
   * compares them with what Render, Neon, Vercel and the model provider report, and the two
   * should agree.
   */
  router.get('/usage', async (_req, res) => {
    try {
      const projects = await deps.service.listProjects(userId(res));
      const since = new Date(now().getTime() - 30 * 24 * 60 * 60 * 1000);
      const days = await deps.store.listUsage({ since });
      const byProject = new Map<string, { accepted: number; rejected: number; bytes: number }>();
      for (const day of days) {
        const current = byProject.get(day.projectId) ?? { accepted: 0, rejected: 0, bytes: 0 };
        current.accepted += day.accepted;
        current.rejected += day.rejected;
        current.bytes += day.bytes;
        byProject.set(day.projectId, current);
      }
      const rows = projects.map(project => ({
        projectId: project.id,
        name: project.name,
        slug: project.slug,
        ...(byProject.get(project.id) ?? { accepted: 0, rejected: 0, bytes: 0 }),
      }));
      res.json({
        windowDays: 30,
        projects: rows,
        totals: rows.reduce((sum, row) => ({
          accepted: sum.accepted + row.accepted,
          rejected: sum.rejected + row.rejected,
          bytes: sum.bytes + row.bytes,
        }), { accepted: 0, rejected: 0, bytes: 0 }),
      });
    } catch (error) {
      handle(error, res);
    }
  });

  router.get('/projects', async (_req, res) => {
    try {
      const projects = await deps.service.listProjects(userId(res));
      res.json({ projects });
    } catch (error) {
      handle(error, res);
    }
  });

  router.post('/projects', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    try {
      const project = await deps.service.createProject(userId(res), {
        name: req.body?.name,
        slug: req.body?.slug,
        description: req.body?.description,
      });
      res.status(201).json({ project });
    } catch (error) {
      handle(error, res);
    }
  });

  router.get('/projects/:projectId/notifications', async (req, res) => {
    try {
      const preference = await deps.service.getNotificationPreference(userId(res), req.params.projectId);
      res.json(preference);
    } catch (error) {
      handle(error, res);
    }
  });

  router.put('/projects/:projectId/notifications', express.json({ limit: '4kb', strict: true }), async (req, res) => {
    try {
      const preference = await deps.service.setNotificationPreference(userId(res), req.params.projectId, {
        mode: req.body?.mode,
        threshold: req.body?.threshold,
      });
      res.json(preference);
    } catch (error) {
      handle(error, res);
    }
  });

  router.get('/projects/:projectId', async (req, res) => {
    try {
      const detail = await deps.service.getProjectDetail(userId(res), req.params.projectId);
      res.json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  router.patch('/projects/:projectId', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    try {
      const project = await deps.service.updateProject(userId(res), req.params.projectId, {
        name: req.body?.name,
        description: req.body?.description,
      });
      res.json({ project });
    } catch (error) {
      handle(error, res);
    }
  });

  // ── forms ───────────────────────────────────────────────────────────────────

  router.post('/projects/:projectId/forms', express.json({ limit: '16kb', strict: true }), async (req, res) => {
    try {
      const detail = await deps.service.createForm(userId(res), req.params.projectId, {
        name: req.body?.name,
        slug: req.body?.slug,
      });
      res.status(201).json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  router.get('/forms/:formId', async (req, res) => {
    try {
      const detail = await deps.service.getFormDetail(userId(res), req.params.formId);
      res.json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  router.put('/forms/:formId/definition', express.json({ limit: DEFINITION_LIMIT, strict: true }), async (req, res) => {
    try {
      const detail = await deps.service.saveDefinition(userId(res), req.params.formId, req.body?.definition ?? req.body);
      res.json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  router.post('/forms/:formId/publish', async (req, res) => {
    try {
      const detail = await deps.service.publish(userId(res), req.params.formId);
      res.json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  // ── the answers ─────────────────────────────────────────────────────────────

  /**
   * A summary of what the answers say.
   *
   * The counts are computed here, from the rows. The model only says what the answers sound
   * like, and it is never asked for a number. The whole thing is one charged operation through
   * the canonical runner: nothing is charged when the model fails, and the same answers are
   * never charged twice.
   */
  router.post('/forms/:formId/insights', async (req, res) => {
    if (!deps.insights) {
      res.status(503).json({ error: 'insights_unavailable', message: 'Summaries are not available on this server right now.' });
      return;
    }
    try {
      const detail = await deps.service.getFormDetail(userId(res), req.params.formId);
      const definition = detail.publishedVersion?.definition ?? detail.draftVersion?.definition ?? null;
      const fields = definition?.fields ?? [];
      if (fields.length === 0) {
        res.status(400).json({ error: 'no_questions', message: 'This form has no questions, so there is nothing to summarise.' });
        return;
      }

      const page = await deps.service.listSubmissions(userId(res), detail.form.id, { limit: MAX_ANSWERS_READ });
      if (page.total === 0) {
        res.status(400).json({ error: 'no_answers', message: 'This form has no answers yet, so there is nothing to summarise.' });
        return;
      }

      const questions: InsightQuestion[] = fields.map(field => ({
        id: field.id,
        title: field.label,
        kind: insightKind(field.type),
        options: field.options.length ? field.options : undefined,
      }));
      const allAnswers = page.items.map(item => {
        const row: Record<string, string[]> = {};
        for (const field of fields) {
          const value = item.answers[field.id];
          if (value === undefined) continue;
          row[field.id] = Array.isArray(value) ? value : [String(value)];
        }
        return row;
      });

      // The exact numbers, counted from the rows.
      const statistics = summarizeResponses(questions, allAnswers);

      const latest = page.items[0]?.submittedAt.toISOString() ?? '';
      const key = insightsOperationKey(detail.form.id, page.total, latest);
      const outcome = await deps.insights.runner.run({
        userId: userId(res),
        operationType: 'dev_insights',
        operationKey: key,
        execute: async () => {
          const result = await deps.insights!.model.summarize({
            questions: questions.map(question => ({ id: question.id, title: question.title, kind: question.kind })),
            answers: allAnswers,
            totalAnswers: page.total,
          });
          return { kind: 'usable' as const, value: result, cost: deps.insights!.cost };
        },
      });

      if (!outcome.ok) {
        const code = (outcome.error as { code?: string } | null)?.code ?? 'model_unavailable';
        res.status(code === 'insufficient_credits' ? 402 : 502).json({
          error: code,
          message: code === 'insufficient_credits'
            ? 'You do not have enough credits for a summary right now.'
            : 'The summary could not be produced. No credits were spent.',
        });
        return;
      }

      res.json({
        summary: outcome.value.summary,
        highlights: outcome.value.highlights,
        caveats: outcome.value.caveats,
        statistics,
        answersRead: allAnswers.length,
        answersTotal: page.total,
        cost: { credits: outcome.charge.cost, status: outcome.charge.status },
      });
    } catch (error) {
      if (error instanceof DevError) {
        res.status(error.status).json({ error: error.code, message: error.message });
        return;
      }
      res.status(500).json({ error: 'insights_failed', message: 'The summary could not be produced. No credits were spent.' });
    }
  });

  router.get('/forms/:formId/submissions', async (req, res) => {
    try {
      const page = await deps.service.listSubmissions(userId(res), req.params.formId, {
        search: typeof req.query.q === 'string' ? req.query.q : undefined,
        limit: typeof req.query.limit === 'string' ? Number(req.query.limit) : undefined,
        offset: typeof req.query.offset === 'string' ? Number(req.query.offset) : undefined,
      });
      res.json(page);
    } catch (error) {
      handle(error, res);
    }
  });

  router.get('/forms/:formId/submissions.csv', async (req, res) => {
    try {
      const { filename, csv } = await deps.service.exportSubmissionsCsv(userId(res), req.params.formId);
      res.set('Content-Type', 'text/csv; charset=utf-8');
      res.set('Content-Disposition', `attachment; filename="${filename}"`);
      res.set('Cache-Control', 'no-store');
      res.send(csv);
    } catch (error) {
      handle(error, res);
    }
  });

  router.get('/submissions/:submissionId', async (req, res) => {
    try {
      const detail = await deps.service.getSubmission(userId(res), req.params.submissionId);
      res.json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  router.post('/forms/:formId/state', express.json({ limit: '8kb', strict: true }), async (req, res) => {
    const action = req.body?.action as DevFormAction | undefined;
    if (!action || !DEV_FORM_ACTIONS.includes(action)) {
      res.status(400).json({ error: 'invalid_action', message: 'That form action is not recognised.' });
      return;
    }
    try {
      const detail = await deps.service.applyAction(userId(res), req.params.formId, action);
      res.json(detail);
    } catch (error) {
      handle(error, res);
    }
  });

  return router;
}
