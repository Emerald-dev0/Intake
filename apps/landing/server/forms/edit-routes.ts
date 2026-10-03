import express, { Router, type NextFunction, type Request, type Response } from 'express';
import { assertPublic, trustedMutation } from '../providers/routes';
import { logSafe } from '../providers/oauth';
import type { SessionUser } from '../providers/service';
import { createFormLogger, newRequestId } from './logging';
import { FormEditError, toFormEditFailure } from './edit-errors';
import { createFormEditEngine, type FormEditEngineDeps, type FormEditTarget } from './edit-engine';
import { createInterpretationLimiter } from './interpretation/routes';
import { toFormEditView } from '../../src/lib/form-edit';
import { consumeRequestLimit, setRateLimitHeaders, type AbuseScope, type RateLimitStore } from '../security/rate-limit';

const MAX_BODY = '64kb';
const MAX_REQUEST = 3000;
const MAX_CLARIFICATION = 1000;
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const RECORD_ID = /^[A-Za-z0-9_-]{1,80}$/;
type Handler = (req: Request, res: Response) => Promise<void>;
const asyncRoute = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

export interface FormEditRouterDeps extends FormEditEngineDeps {
  getSession: (req: Request) => Promise<SessionUser | null>;
  env: NodeJS.ProcessEnv;
  limiter?: ReturnType<typeof createInterpretationLimiter>;
  abuseLimiter?: RateLimitStore;
}

function isRecord(value: unknown): value is Record<string, unknown> { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function bodyWithKeys(body: unknown, keys: readonly string[]): Record<string, unknown> | null {
  return isRecord(body) && Object.keys(body).every(key => keys.includes(key)) ? body : null;
}
function phrase(value: unknown, limit: number): value is string { return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit; }
function version(value: unknown): value is number { return typeof value === 'number' && Number.isSafeInteger(value) && value > 0; }
function requestId(res: Response): string { return res.locals.requestId as string; }
function user(res: Response): SessionUser { return res.locals.user as SessionUser; }
/**
 * A selection is either one owned form record or one strictly parsed Google Forms URL.
 *
 * The workspace sends the discriminator it keeps in its own state (`kind`); older clients send only
 * the id or URL. Both are accepted, but the discriminator must agree with the payload and no other
 * key may ride along, so the server still decides what the target means.
 */
function target(value: unknown): FormEditTarget | null {
  const row = isRecord(value) ? value : null;
  if (!row) return null;
  const kind = row.kind === undefined || row.kind === 'record' || row.kind === 'url' ? row.kind : null;
  if (kind === null) return null;
  const keys = Object.keys(row);
  const only = (...allowed: string[]) => keys.every(key => key === 'kind' || allowed.includes(key));
  if (typeof row.formRecordId === 'string' && RECORD_ID.test(row.formRecordId) && (kind === undefined || kind === 'record') && only('formRecordId')) {
    return { kind: 'record', formRecordId: row.formRecordId };
  }
  if (typeof row.formUrl === 'string' && row.formUrl.length <= 2048 && (kind === undefined || kind === 'url') && only('formUrl')) {
    return { kind: 'url', formUrl: row.formUrl };
  }
  return null;
}

const STATUS: Record<string, number> = {
  not_authenticated: 401, forbidden: 403, invalid_request: 400, unsupported_provider: 400,
  provider_not_configured: 503, provider_not_connected: 409, provider_reauthorization_required: 409,
  provider_unavailable: 503, provider_permission_denied: 502, provider_rate_limited: 429, provider_rejected: 502,
  provider_error: 502, storage_unavailable: 503, rate_limited: 429, model_not_configured: 503,
  model_timeout: 504, model_unavailable: 503, model_rate_limited: 429, model_provider_error: 502,
  model_invalid_output: 502, insufficient_credits: 402, form_not_found: 404,
  form_not_editable: 403, invalid_form_url: 400, edit_unsupported: 422, edit_plan_invalid: 422,
  edit_stale: 409, edit_draft_not_found: 404, edit_draft_conflict: 409, edit_draft_locked: 409, internal_error: 500,
};

/** Routes for existing-form editing. The request body never contains the user's id, token, or plan. */
export function createFormEditRouter(deps: FormEditRouterDeps): Router {
  const router = Router();
  const log = deps.log ?? createFormLogger();
  const now = deps.now ?? (() => new Date());
  const limiter = deps.limiter ?? createInterpretationLimiter();
  const engine = createFormEditEngine(deps);

  const auth = (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.locals.requestId = newRequestId();
    res.set('X-Request-Id', requestId(res));
    void deps.getSession(req).then(session => {
      if (!session) return send(res, new FormEditError({ code: 'not_authenticated', message: 'Sign in to Intake before editing a form.', outcome: 'not_applied', retryable: false }));
      res.locals.user = session;
      next();
    }).catch(error => {
      logSafe('Form editing session lookup failed', error);
      send(res, new FormEditError({ code: 'storage_unavailable', message: 'Intake could not check your session. Try again later.', outcome: 'not_applied', retryable: true }));
    });
  };
  const mutation = (req: Request, res: Response, next: NextFunction) => {
    if (!trustedMutation(req, deps.env)) {
      log('form.edit.request_rejected', { requestId: requestId(res), userId: user(res).id, reason: 'untrusted_origin' });
      return send(res, new FormEditError({ code: 'forbidden', message: 'This request did not come from Intake, so it was rejected. No changes were made.', outcome: 'not_applied', retryable: false }));
    }
    next();
  };
  const jsonMutation = [auth, mutation, express.json({ limit: MAX_BODY, strict: true })] as const;

  async function allowExpensive(req: Request, res: Response, scope: AbuseScope, action: string): Promise<boolean> {
    const decision = await consumeRequestLimit(deps.abuseLimiter, scope, user(res).id, req);
    if (decision.ok) return true;
    if (decision.reason === 'rate_limited') {
      setRateLimitHeaders(res, decision.retryAfterSeconds);
      send(res, new FormEditError({ code: 'rate_limited', message: `Too many ${action} requests were made in a short time. Wait before trying again.`, outcome: 'not_applied', retryable: true }));
    } else {
      send(res, new FormEditError({ code: 'storage_unavailable', message: `Intake cannot safely start ${action} right now. No provider or model request was sent. Try again later.`, outcome: 'not_applied', retryable: true }));
    }
    return false;
  }

  router.post('/edit/inspect', auth, mutation, express.json({ limit: MAX_BODY, strict: true }), asyncRoute(async (req, res) => {
    const body = bodyWithKeys(req.body, ['target']);
    const selection = body && target(body.target);
    if (!selection) return send(res, new FormEditError({ code: 'invalid_request', message: 'Select one of your Intake forms or provide a Google Forms edit URL. No changes were made.', outcome: 'not_applied', retryable: false }));
    if (!await allowExpensive(req, res, 'forms.provider_read', 'provider form inspection')) return;
    const found = await engine.inspect(user(res).id, selection, requestId(res));
    return sendJson(res, 200, { requestId: requestId(res), form: toFormEditView(found.loaded.current) });
  }));

  router.post('/edit/interpret', ...jsonMutation, asyncRoute(async (req, res) => {
    const body = bodyWithKeys(req.body, ['target', 'request', 'clarification', 'operationId']);
    const selection = body && target(body.target);
    if (!body || !selection || !phrase(body.request, MAX_REQUEST) || (body.clarification !== undefined && !phrase(body.clarification, MAX_CLARIFICATION))) {
      return send(res, new FormEditError({ code: 'invalid_request', message: `Describe the form changes in up to ${MAX_REQUEST} characters and select a current form. No changes were made.`, outcome: 'not_applied', retryable: false }));
    }
    if (!await allowExpensive(req, res, 'ai.interpret', 'edit interpretation')) return;
    const slot = limiter.acquire(user(res).id, now().getTime());
    if (!slot.ok) return send(res, new FormEditError({ code: 'rate_limited', message: slot.reason === 'in_progress' ? 'Intake is already interpreting an edit for your account. Wait for it to finish.' : 'Too many interpretations in a short time. Wait a few minutes and try again.', outcome: 'not_applied', retryable: true }));
    try {
      const result = await engine.interpret(user(res).id, { target: selection, request: body.request.trim(),
        ...(body.clarification ? { clarification: (body.clarification as string).trim() } : {}),
        ...(typeof body.operationId === 'string' ? { operationId: body.operationId } : {}) }, requestId(res));
      return sendJson(res, result.status === 'ready' ? 201 : 200, { requestId: requestId(res), ...result });
    } finally { slot.release(); }
  }));

  router.post('/edit/revise', ...jsonMutation, asyncRoute(async (req, res) => {
    const body = bodyWithKeys(req.body, ['draftId', 'version', 'request', 'clarification', 'operationId']);
    if (!body || typeof body.draftId !== 'string' || !DRAFT_ID.test(body.draftId) || !version(body.version) || !phrase(body.request, MAX_REQUEST) ||
        (body.clarification !== undefined && !phrase(body.clarification, MAX_CLARIFICATION))) {
      return send(res, new FormEditError({ code: 'invalid_request', message: 'Send a current edit proposal and a change request of up to 3,000 characters. No changes were made.', outcome: 'not_applied', retryable: false }));
    }
    if (!await allowExpensive(req, res, 'ai.interpret', 'edit interpretation')) return;
    const slot = limiter.acquire(user(res).id, now().getTime());
    if (!slot.ok) return send(res, new FormEditError({ code: 'rate_limited', message: slot.reason === 'in_progress' ? 'Intake is already interpreting an edit for your account. Wait for it to finish.' : 'Too many interpretations in a short time. Wait a few minutes and try again.', outcome: 'not_applied', retryable: true }));
    try {
      const result = await engine.revise(user(res).id, { draftId: body.draftId, version: body.version, request: body.request.trim(),
        ...(body.clarification ? { clarification: (body.clarification as string).trim() } : {}),
        ...(typeof body.operationId === 'string' ? { operationId: body.operationId } : {}) }, requestId(res));
      return sendJson(res, 200, { requestId: requestId(res), ...result });
    } finally { slot.release(); }
  }));

  router.get('/edit/draft/:id', auth, asyncRoute(async (req, res) => {
    const draft = await engine.getDraft(user(res).id, req.params.id);
    if (!draft) return send(res, new FormEditError({ code: 'edit_draft_not_found', message: 'This edit proposal is not available in your Intake account.', outcome: 'not_applied', retryable: false }));
    return sendJson(res, 200, { requestId: requestId(res), draft });
  }));

  router.delete('/edit/draft/:id', auth, mutation, asyncRoute(async (req, res) => {
    const draft = await engine.getDraft(user(res).id, req.params.id);
    if (!draft) return send(res, new FormEditError({ code: 'edit_draft_not_found', message: 'This edit proposal is not available in your Intake account.', outcome: 'not_applied', retryable: false }));
    if (draft.status !== 'ready') return send(res, new FormEditError({ code: 'edit_draft_locked', message: 'Only an unconfirmed proposal can be cancelled.', outcome: draft.status === 'stale' ? 'stale' : 'unknown', retryable: false }));
    if (!await engine.discard(user(res).id, req.params.id)) return send(res, new FormEditError({ code: 'edit_draft_conflict', message: 'This proposal changed before it could be cancelled. Reload it first.', outcome: 'not_applied', retryable: false }));
    res.status(204).end();
  }));

  router.post('/edit/confirm', ...jsonMutation, asyncRoute(async (req, res) => {
    const body = bodyWithKeys(req.body, ['draftId', 'version', 'confirm']);
    if (!body || typeof body.draftId !== 'string' || !DRAFT_ID.test(body.draftId) || !version(body.version) || body.confirm !== true) {
      return send(res, new FormEditError({ code: 'invalid_request', message: 'Review the edit proposal and explicitly confirm applying it to the existing Google Form.', outcome: 'not_applied', retryable: false }));
    }
    try {
      // Replays of an already-applied/blocked proposal are reads and do not consume provider-write
      // capacity. A ready proposal is limited before its one-shot claim and any Google request.
      const currentDraft = await engine.getDraft(user(res).id, body.draftId);
      if (currentDraft?.status === 'ready' && !await allowExpensive(req, res, 'forms.edit', 'provider form edit')) return;
      const result = await engine.confirm(user(res).id, { draftId: body.draftId, version: body.version, confirm: true }, requestId(res));
      const draft = await engine.getDraft(user(res).id, body.draftId);
      return sendJson(res, 200, { requestId: requestId(res), result, ...(draft ? { draft } : {}) });
    } catch (error) {
      const draft = await engine.getDraft(user(res).id, body.draftId).catch(() => null);
      const failure = error instanceof FormEditError ? error : new FormEditError({ code: 'internal_error', message: 'Intake could not confirm the edit result. Check the original Google Form before taking further action.', outcome: 'unknown', retryable: false });
      if (failure.info.retryAfterSeconds) setRateLimitHeaders(res, failure.info.retryAfterSeconds);
      return sendJson(res, STATUS[failure.info.code] ?? 500, { requestId: requestId(res), failure: toFormEditFailure(failure.info, requestId(res)), ...(draft ? { draft } : {}) });
    }
  }));

  router.use('/edit', (_req, res) => sendJson(res, 404, { requestId: requestId(res), error: 'Not found', code: 'invalid_request' }));
  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const type = isRecord(error) ? error.type : undefined;
    if (type === 'entity.too.large') return send(res, new FormEditError({ code: 'invalid_request', message: 'The edit request is too large. No changes were made.', outcome: 'not_applied', retryable: false }), 413);
    if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') return send(res, new FormEditError({ code: 'invalid_request', message: 'Send a valid JSON object. No changes were made.', outcome: 'not_applied', retryable: false }));
    if (error instanceof FormEditError) return send(res, error);
    logSafe('Form edit route failed unexpectedly', error);
    return send(res, new FormEditError({ code: 'internal_error', message: 'Something went wrong inside Intake. The current Google Form was not replaced. Check its status before trying again.', outcome: 'unknown', retryable: false }));
  });
  return router;
}

function send(res: Response, error: FormEditError, status?: number): void {
  if (error.info.retryAfterSeconds) setRateLimitHeaders(res, error.info.retryAfterSeconds);
  sendJson(res, status ?? STATUS[error.info.code] ?? 500, { ...toFormEditFailure(error.info, requestId(res)) });
}
function sendJson(res: Response, status: number, body: unknown): void {
  try { assertPublic(body); }
  catch (error) {
    logSafe('Blocked an unsafe form edit response', error);
    res.status(500).json({ error: 'Something went wrong.', code: 'internal_error', requestId: requestId(res) });
    return;
  }
  res.status(status).json(body);
}
