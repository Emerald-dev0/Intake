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
import { DevError, type DevService } from './service.ts';
import { DEV_FORM_ACTIONS, type DevFormAction } from './contracts.ts';

export interface DevRouterDeps {
  service: DevService;
  /** Resolves the signed-in person, or null when there is no session. */
  getSession: (req: Request) => Promise<{ id: string; email: string; name: string } | null>;
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

  // Any failure inside a handler becomes a status code that says what actually happened.
  const handle = (error: unknown, res: Response): void => {
    if (error instanceof DevError) {
      res.status(error.status).json({ error: error.code, message: error.message, ...(error.details ? { fieldErrors: error.details } : {}) });
      return;
    }
    res.status(500).json({ error: 'dev_failed', message: 'The developer workspace could not complete that request.' });
  };

  // ── projects ────────────────────────────────────────────────────────────────

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
