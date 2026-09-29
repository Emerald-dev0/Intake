import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { ValidationIssue } from '../../src/lib/forms';
import { logSafe } from '../providers/oauth';
import { assertPublic, trustedMutation } from '../providers/routes';
import type { SessionUser } from '../providers/service';
import type { FormEngine } from './engine';
import { statusFor, toFailureBody, type FormErrorInfo } from './errors';
import { createFormLogger, newRequestId, type FormLogger } from './logging';

const MAX_BODY = '100kb';
const ALLOWED_KEYS = ['provider', 'specification'] as const;

export interface FormsRouterDeps {
  engine: FormEngine;
  getSession: (req: Request) => Promise<SessionUser | null>;
  env: NodeJS.ProcessEnv;
  log?: FormLogger;
}

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_$-]/g, '_').slice(0, 40) || '_';
}

/**
 * POST /api/forms  { provider, specification }  -> create a form in the user's connected account
 * GET  /api/forms                                -> the signed-in user's recent forms
 *
 * The Intake user comes from the session and nowhere else. The request may not name a token, a
 * provider account, a connection or a user: any property other than `provider` and `specification`
 * is rejected, so a client cannot even attempt to supply one.
 */
export function createFormsRouter(deps: FormsRouterDeps): Router {
  const router = Router();
  const log = deps.log ?? createFormLogger();

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  // Identify the request and the user before anything else, so an unauthenticated caller never gets as far as body parsing.
  router.use(async (req, res, next) => {
    const requestId = newRequestId();
    res.locals.requestId = requestId;
    res.set('X-Request-Id', requestId);
    try {
      const user = await deps.getSession(req);
      if (!user) return send(res, { code: 'not_authenticated', message: 'You are not signed in. Sign in, then try again.' }, requestId);
      res.locals.user = user;
      return next();
    } catch (error) {
      logSafe('Forms session lookup failed', error);
      return send(res, { code: 'storage_unavailable', message: 'Intake is temporarily unavailable. Please try again later.', retryable: true }, requestId);
    }
  });

  router.get('/', async (_req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    const outcome = await deps.engine.listForms(user.id);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, forms: outcome.forms });
  });

  // Cross-site requests are refused before the body is read.
  router.post(
    '/',
    (req, res, next) => {
      const requestId = res.locals.requestId as string;
      const user = res.locals.user as SessionUser;
      if (!trustedMutation(req, deps.env)) {
        log('form.create.rejected', { requestId, userId: user.id, reason: 'untrusted_origin', code: 'forbidden' });
        return send(res, { code: 'forbidden', message: 'This request did not come from the Intake app, so it was rejected. Nothing was created.' }, requestId);
      }
      return next();
    },
    express.json({ limit: MAX_BODY, strict: true }),
    async (req, res) => {
      const requestId = res.locals.requestId as string;
      const user = res.locals.user as SessionUser;
      const body: unknown = req.body;

      if (!body || typeof body !== 'object' || Array.isArray(body)) {
        return send(res, { code: 'invalid_request', message: 'Send a JSON object with "provider" and "specification". Use Content-Type: application/json.', outcome: 'not_created' }, requestId);
      }
      const record = body as Record<string, unknown>;
      const issues: ValidationIssue[] = [];
      const unexpected = Object.keys(record).filter(key => !(ALLOWED_KEYS as readonly string[]).includes(key));
      for (const key of unexpected.slice(0, 10)) {
        issues.push({
          code: 'unknown_property',
          path: safeKey(key),
          message: `Unexpected property "${safeKey(key)}". Only "provider" and "specification" are accepted. Intake decides which account to use from your signed-in session, so tokens and account ids cannot be supplied.`,
        });
      }
      if (record.provider === undefined) issues.push({ code: 'invalid_type', path: 'provider', message: '"provider" is required. Use "google".' });
      if (record.specification === undefined) issues.push({ code: 'invalid_type', path: 'specification', message: '"specification" is required.' });
      if (issues.length > 0) {
        // Property names only, never values.
        log('form.create.rejected', { requestId, userId: user.id, reason: 'invalid_request', code: 'invalid_request', properties: unexpected.slice(0, 10).map(safeKey) });
        return send(res, { code: 'invalid_request', message: 'The request was not accepted. Nothing was created.', issues, outcome: 'not_created' }, requestId);
      }

      const outcome = await deps.engine.createForm({ userId: user.id, provider: record.provider, specification: record.specification, requestId });
      if (outcome.ok) return sendJson(res, 201, { requestId, form: outcome.form, warnings: outcome.warnings });
      return send(res, outcome.error, requestId);
    },
  );

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found', code: 'invalid_request', requestId: (res.locals.requestId as string | undefined) ?? '' });
  });

  // Body-parser failures and anything unexpected leave as JSON with the same shape as every other failure.
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    const requestId = (res.locals.requestId as string | undefined) ?? newRequestId();
    const type = typeof error === 'object' && error !== null ? (error as { type?: unknown }).type : undefined;
    if (type === 'entity.too.large') return send(res, { code: 'invalid_request', message: 'The request is too large. Nothing was created.', outcome: 'not_created' }, requestId, 413);
    if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') {
      return send(res, { code: 'invalid_request', message: 'The request body is not valid JSON. Nothing was created.', outcome: 'not_created' }, requestId);
    }
    logSafe('Forms route failed unexpectedly', error);
    return send(res, { code: 'internal_error', message: 'Something went wrong inside Intake. Use the request id if you need help.' }, requestId);
  });

  return router;
}

function send(res: Response, info: FormErrorInfo, requestId: string, status?: number): void {
  sendJson(res, status ?? statusFor(info.code), toFailureBody(info, requestId));
}

function sendJson(res: Response, status: number, body: unknown): void {
  try {
    assertPublic(body);
  } catch (error) {
    logSafe('Blocked a forms response', error);
    res.status(500).json({ error: 'Something went wrong.', code: 'internal_error', requestId: (res.locals.requestId as string | undefined) ?? '' });
    return;
  }
  res.status(status).json(body);
}
