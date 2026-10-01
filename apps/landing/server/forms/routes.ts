import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { ValidationIssue } from '../../src/lib/forms';
import { logSafe } from '../providers/oauth';
import { assertPublic, trustedMutation } from '../providers/routes';
import type { SessionUser } from '../providers/service';
import type { FormEngine } from './engine';
import { statusFor, toFailureBody, type FormErrorInfo } from './errors';
import { createFormLogger, newRequestId, type FormLogger } from './logging';
import { consumeRequestLimit, setRateLimitHeaders, type AbuseScope, type RateLimitStore } from '../security/rate-limit';
import type { FormLibraryFilter } from './store';
import { extractGoogleFormId } from './edit-engine';

const MAX_BODY = '100kb';
const ALLOWED_KEYS = ['provider', 'specification'] as const;
const RECORD_ID = /^[A-Za-z0-9_-]{1,80}$/;

export interface FormsRouterDeps {
  engine: FormEngine;
  getSession: (req: Request) => Promise<SessionUser | null>;
  env: NodeJS.ProcessEnv;
  log?: FormLogger;
  abuseLimiter?: RateLimitStore;
  /** The production UI must use reviewed drafts. Kept injectable only for engine/legacy route tests. */
  allowDirectCreation?: boolean;
}

function safeKey(key: string): string {
  return key.replace(/[^A-Za-z0-9_$-]/g, '_').slice(0, 40) || '_';
}

const LIBRARY_QUERY_KEYS = new Set(['query', 'provider', 'source', 'archived', 'sort', 'limit', 'mode']);

type FilterParse = { ok: true; filter: FormLibraryFilter } | { ok: false; message: string };

/** Invalid filters are rejected rather than silently changing the requested result set. */
function parseLibraryFilter(query: Request['query']): FilterParse {
  const unknown = Object.keys(query).filter(key => !LIBRARY_QUERY_KEYS.has(key));
  if (unknown.length) return { ok: false, message: 'The form-library query contains an unsupported parameter.' };
  if (Object.values(query).some(value => typeof value !== 'string')) {
    return { ok: false, message: 'Each form-library filter must be supplied exactly once as text.' };
  }
  const filter: FormLibraryFilter = {};
  if (typeof query.query === 'string') {
    const value = query.query.trim();
    if (value.length > 100) return { ok: false, message: 'Search text must be at most 100 characters.' };
    if (value) filter.query = value;
  }
  if (query.provider !== undefined) {
    if (query.provider !== 'google' && query.provider !== 'microsoft' && query.provider !== 'all') return { ok: false, message: 'Provider must be google, microsoft, or all.' };
    filter.provider = query.provider;
  }
  if (query.source !== undefined) {
    if (query.source !== 'created' && query.source !== 'imported' && query.source !== 'all') return { ok: false, message: 'Source must be created, imported, or all.' };
    filter.source = query.source;
  }
  if (query.archived !== undefined) {
    if (query.archived === 'true') filter.archived = true;
    else if (query.archived === 'false') filter.archived = false;
    else if (query.archived === 'all') filter.archived = 'all';
    else return { ok: false, message: 'Archived must be true, false, or all.' };
  }
  if (query.sort !== undefined) {
    if (!['newest', 'oldest', 'title_asc', 'title_desc', 'updated', 'synced'].includes(query.sort as string)) return { ok: false, message: 'The requested sort order is not supported.' };
    filter.sort = query.sort as NonNullable<FormLibraryFilter['sort']>;
  }
  if (query.limit !== undefined) {
    if (!/^[1-9][0-9]{0,2}$/.test(query.limit as string) || Number(query.limit) > 100) return { ok: false, message: 'Limit must be an integer from 1 to 100.' };
    filter.limit = Number(query.limit);
  }
  if (query.mode !== undefined && query.mode !== 'library') return { ok: false, message: 'Mode must be library when supplied.' };
  return { ok: true, filter };
}

/**
 * Forms router:
 * POST /api/forms                 -> create a form in the user's connected account
 * GET  /api/forms                 -> recent forms (or filtered library if requested)
 * GET  /api/forms/library         -> rich library list with search, filter, and sort
 * GET  /api/forms/library/:id     -> inspect an individual form record
 * POST /api/forms/library/import  -> import an existing Google Form by URL
 * POST /api/forms/library/:id/refresh   -> live status verification & metadata refresh
 * POST /api/forms/library/:id/archive   -> archive a form record
 * POST /api/forms/library/:id/unarchive -> restore an archived form record
 * DELETE /api/forms/library/:id         -> remove reference from Intake (never deletes provider form)
 */
export function createFormsRouter(deps: FormsRouterDeps): Router {
  const router = Router();
  const log = deps.log ?? createFormLogger();

  async function allowExpensive(req: Request, res: Response, scope: AbuseScope, action: string): Promise<boolean> {
    const requestId = res.locals.requestId as string;
    const currentUser = res.locals.user as SessionUser;
    const decision = await consumeRequestLimit(deps.abuseLimiter, scope, currentUser.id, req);
    if (decision.ok) return true;
    if (decision.reason === 'rate_limited') {
      setRateLimitHeaders(res, decision.retryAfterSeconds);
      send(res, { code: 'rate_limited', message: `Too many ${action} requests were made in a short time. Wait before trying again.`, retryable: true, outcome: 'not_created' }, requestId);
    } else {
      send(res, { code: 'storage_unavailable', message: `Intake cannot safely start ${action} right now. No provider request was sent. Try again later.`, retryable: true, outcome: 'not_created' }, requestId);
    }
    return false;
  }

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

  // Recent forms list (or library search when query params provided)
  router.get('/', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;

    const hasFilterParams = Object.keys(req.query).length > 0;

    if (hasFilterParams) {
      const parsed = parseLibraryFilter(req.query);
      if (!parsed.ok) return send(res, { code: 'invalid_request', message: parsed.message, retryable: false }, requestId);
      const outcome = await deps.engine.listLibrary(user.id, parsed.filter);
      if (!outcome.ok) return send(res, outcome.error, requestId);
      return sendJson(res, 200, { requestId, forms: outcome.forms });
    }

    const outcome = await deps.engine.listForms(user.id);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, forms: outcome.forms });
  });

  // Dedicated Form Library list endpoint
  router.get('/library', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    const parsed = parseLibraryFilter(req.query);
    if (!parsed.ok) return send(res, { code: 'invalid_request', message: parsed.message, retryable: false }, requestId);
    const outcome = await deps.engine.listLibrary(user.id, parsed.filter);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, forms: outcome.forms });
  });

  // Import existing Google Form by URL into library
  router.post(
    '/library/import',
    (req, res, next) => {
      const requestId = res.locals.requestId as string;
      const user = res.locals.user as SessionUser;
      if (!trustedMutation(req, deps.env)) {
        log('form.library.import_rejected', { requestId, userId: user.id, reason: 'untrusted_origin' });
        return send(res, { code: 'forbidden', message: 'This request did not come from Intake, so it was rejected. No form was imported.' }, requestId);
      }
      return next();
    },
    express.json({ limit: MAX_BODY, strict: true }),
    async (req, res) => {
      const requestId = res.locals.requestId as string;
      const user = res.locals.user as SessionUser;
      const body = req.body;
      if (!body || typeof body !== 'object' || Array.isArray(body) || Object.keys(body).some(key => key !== 'url') || typeof body.url !== 'string' || !body.url.trim() || body.url.length > 2048 || !extractGoogleFormId(body.url.trim())) {
        return send(res, { code: 'invalid_request', message: 'Provide only one valid Google Forms edit URL (up to 2,048 characters). Short links and other hosts are rejected.' }, requestId);
      }
      if (!await allowExpensive(req, res, 'forms.provider_read', 'provider form import')) return;
      const outcome = await deps.engine.importForm(user.id, body.url.trim(), requestId);
      if (!outcome.ok) return send(res, outcome.error, requestId);
      return sendJson(res, outcome.alreadyExists ? 200 : 201, { requestId, form: outcome.form, alreadyExists: outcome.alreadyExists });
    },
  );

  // Retrieve individual form record by ID
  router.get('/library/:id', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return send(res, { code: 'invalid_request', message: 'Invalid form ID.' }, requestId, 404);
    }
    const outcome = await deps.engine.getForm(user.id, id);
    if (!outcome.ok) return send(res, outcome.error, requestId, 404);
    return sendJson(res, 200, { requestId, form: outcome.form });
  });

  // Live status verification & metadata refresh
  router.post('/library/:id/refresh', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    if (!trustedMutation(req, deps.env)) {
      return send(res, { code: 'forbidden', message: 'This request did not come from Intake. Request rejected.' }, requestId);
    }
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return send(res, { code: 'invalid_request', message: 'Invalid form ID.' }, requestId, 404);
    }
    if (!await allowExpensive(req, res, 'forms.provider_read', 'provider synchronization')) return;
    const outcome = await deps.engine.refreshForm(user.id, id, requestId);
    return sendJson(res, 200, { requestId, ...outcome });
  });

  // Archive a form in library
  router.post('/library/:id/archive', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    if (!trustedMutation(req, deps.env)) {
      return send(res, { code: 'forbidden', message: 'This request did not come from Intake. Request rejected.' }, requestId);
    }
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return send(res, { code: 'invalid_request', message: 'Invalid form ID.' }, requestId, 404);
    }
    const outcome = await deps.engine.archiveForm(user.id, id, true);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, ok: true, archived: true });
  });

  // Unarchive a form in library
  router.post('/library/:id/unarchive', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    if (!trustedMutation(req, deps.env)) {
      return send(res, { code: 'forbidden', message: 'This request did not come from Intake. Request rejected.' }, requestId);
    }
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return send(res, { code: 'invalid_request', message: 'Invalid form ID.' }, requestId, 404);
    }
    const outcome = await deps.engine.archiveForm(user.id, id, false);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, ok: true, archived: false });
  });

  // Remove a form reference from Intake library (never deletes provider form)
  router.delete('/library/:id', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    if (!trustedMutation(req, deps.env)) {
      return send(res, { code: 'forbidden', message: 'This request did not come from Intake. Request rejected.' }, requestId);
    }
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return send(res, { code: 'invalid_request', message: 'Invalid form ID.' }, requestId, 404);
    }
    const outcome = await deps.engine.removeForm(user.id, id);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, ok: true, removed: true, message: outcome.message });
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
      if (deps.allowDirectCreation === false) {
        return send(res, {
          code: 'invalid_request',
          message: 'Direct form creation is disabled. Describe the form, review the server-owned draft, and explicitly confirm it before Intake contacts Google.',
          outcome: 'not_created',
          retryable: false,
        }, requestId, 405);
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

      if (!await allowExpensive(req, res, 'forms.create', 'form creation')) return;
      const outcome = await deps.engine.createForm({ userId: user.id, provider: record.provider, specification: record.specification, requestId });
      if (outcome.ok) return sendJson(res, 201, { requestId, form: outcome.form, warnings: outcome.warnings });
      return send(res, outcome.error, requestId);
    },
  );

  // Single record direct access: GET /:id and DELETE /:id
  router.get('/:id', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return res.status(404).json({ error: 'Not found', code: 'invalid_request', requestId });
    }
    const outcome = await deps.engine.getForm(user.id, id);
    if (!outcome.ok) {
      return res.status(404).json({ error: outcome.error.message, code: 'invalid_request', requestId });
    }
    return sendJson(res, 200, { requestId, form: outcome.form });
  });

  router.delete('/:id', async (req, res) => {
    const requestId = res.locals.requestId as string;
    const user = res.locals.user as SessionUser;
    if (!trustedMutation(req, deps.env)) {
      return send(res, { code: 'forbidden', message: 'This request did not come from Intake. Request rejected.' }, requestId);
    }
    const id = req.params.id;
    if (!RECORD_ID.test(id)) {
      return res.status(404).json({ error: 'Not found', code: 'invalid_request', requestId });
    }
    const outcome = await deps.engine.removeForm(user.id, id);
    if (!outcome.ok) return send(res, outcome.error, requestId);
    return sendJson(res, 200, { requestId, ok: true, removed: true, message: outcome.message });
  });

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
  if (info.retryAfterSeconds) setRateLimitHeaders(res, info.retryAfterSeconds);
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
