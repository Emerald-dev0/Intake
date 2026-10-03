import { randomUUID } from 'node:crypto';
import express, { Router, type NextFunction, type Request, type Response } from 'express';
import type { CreateFormResult } from '../../../src/lib/forms';
import { assertPublic, trustedMutation } from '../../providers/routes';
import type { SessionUser } from '../../providers/service';
import type { DraftRecord, DraftStore } from '../draft-store';
import type { FormEngine } from '../engine';
import { statusFor, toFailureBody, type FormErrorInfo } from '../errors';
import { createFormLogger, newRequestId, type FormLogger } from '../logging';
import { consumeRequestLimit, setRateLimitHeaders, type RateLimitStore } from '../../security/rate-limit';
import { assessInterpretation, InterpretationError, type FormInterpreter, type InterpretationInput, type InterpretationResult } from './interpreter';

const MAX_REQUEST = 3000;
const MAX_CLARIFICATION = 1000;
const MAX_BODY = '64kb';
const DRAFT_ID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const WINDOW_MS = 10 * 60_000;
const MAX_CALLS = 8;

type Handler = (req: Request, res: Response) => Promise<void>;
const asyncRoute = (handler: Handler) => (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Per-user, per-process cost protection. Claiming a slot happens before contacting the model. */
export function createInterpretationLimiter(options: { limit?: number; windowMs?: number } = {}) {
  const hits = new Map<string, number[]>();
  const running = new Set<string>();
  return {
    acquire(userId: string, now: number): { ok: true; release(): void } | { ok: false; reason: 'in_progress' | 'rate_limited' } {
      if (running.has(userId)) return { ok: false, reason: 'in_progress' };
      const recent = (hits.get(userId) ?? []).filter(time => now - time < (options.windowMs ?? WINDOW_MS));
      if (recent.length >= (options.limit ?? MAX_CALLS)) return { ok: false, reason: 'rate_limited' };
      recent.push(now);
      hits.set(userId, recent);
      running.add(userId);
      return { ok: true, release: () => void running.delete(userId) };
    },
  };
}

type InterpretationLimiter = ReturnType<typeof createInterpretationLimiter>;

export interface DraftRouterDeps {
  store: DraftStore;
  engine: FormEngine;
  interpreter: FormInterpreter;
  getSession: (req: Request) => Promise<SessionUser | null>;
  env: NodeJS.ProcessEnv;
  log?: FormLogger;
  now?: () => Date;
  newId?: () => string;
  limiter?: InterpretationLimiter;
  /** PostgreSQL-backed in production; omitted by isolated unit tests. */
  abuseLimiter?: RateLimitStore;
}

function publicDraft(draft: DraftRecord) {
  return {
    id: draft.id, provider: draft.provider, version: draft.version, status: draft.status,
    specification: draft.specification, assumptions: draft.assumptions, warnings: draft.warnings,
    result: draft.result, createdAt: draft.createdAt.toISOString(), updatedAt: draft.updatedAt.toISOString(),
  };
}

function readInput(body: unknown, fields: readonly string[]): Record<string, unknown> | null {
  if (!isRecord(body) || Object.keys(body).some(key => !fields.includes(key))) return null;
  return body;
}

function phrase(value: unknown, limit: number): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.trim().length <= limit;
}

function version(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0;
}

function requestId(res: Response): string { return res.locals.requestId as string; }
function user(res: Response): SessionUser { return res.locals.user as SessionUser; }

const missingDraft: FormErrorInfo = { code: 'draft_not_found', message: 'This draft is not available in your Intake account. Start a new form.', outcome: 'not_created', retryable: false };
const conflict: FormErrorInfo = { code: 'draft_conflict', message: 'This draft changed in another tab. Reload it before making more changes.', outcome: 'not_created', retryable: false };
const locked: FormErrorInfo = { code: 'draft_locked', message: 'This draft has already had a creation attempt. It cannot be revised or created again. Check your recent forms and Google Forms.', outcome: 'unknown', retryable: false };
const invalidRequest = (message: string): FormErrorInfo => ({ code: 'invalid_request', message, outcome: 'not_created', retryable: false });

/** Mounted before the original forms router. The original POST /api/forms still owns execution. */
export function createFormDraftRouter(deps: DraftRouterDeps): Router {
  const router = Router();
  const log = deps.log ?? createFormLogger();
  const now = deps.now ?? (() => new Date());
  const newId = deps.newId ?? randomUUID;
  const limiter = deps.limiter ?? createInterpretationLimiter();

  const auth = (req: Request, res: Response, next: NextFunction) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.locals.requestId = newRequestId();
    res.set('X-Request-Id', requestId(res));
    void deps.getSession(req).then(session => {
      if (!session) return send(res, { code: 'not_authenticated', message: 'Sign in to Intake, then try again.' });
      res.locals.user = session;
      next(); // Only after the session is verified may the body be parsed.
    }).catch(() => {
      log('form.draft.validation_failed', { requestId: requestId(res), reason: 'session_unavailable' });
      send(res, { code: 'storage_unavailable', message: 'Intake could not check your session. Try again later.', retryable: true, outcome: 'not_created' });
    });
  };
  const mutation = (req: Request, res: Response, next: NextFunction) => {
    if (!trustedMutation(req, deps.env)) {
      log('form.draft.validation_failed', { requestId: requestId(res), userId: user(res).id, reason: 'untrusted_origin' });
      return send(res, { code: 'forbidden', message: 'This request was not sent from Intake. Nothing was created.', outcome: 'not_created' });
    }
    next();
  };

  async function infer(input: InterpretationInput, req: Request, res: Response): Promise<InterpretationResult | null> {
    const person = user(res);
    const id = requestId(res);
    const distributed = await consumeRequestLimit(deps.abuseLimiter, 'ai.interpret', person.id, req);
    if (!distributed.ok) {
      if (distributed.reason === 'rate_limited') {
        setRateLimitHeaders(res, distributed.retryAfterSeconds);
        send(res, { code: 'rate_limited', message: 'Too many interpretation requests were made in a short time. Wait before trying again.', retryable: true, outcome: 'not_created' });
      } else {
        send(res, { code: 'storage_unavailable', message: 'Intake cannot safely start an interpretation right now. No model request was sent. Try again later.', retryable: true, outcome: 'not_created' });
      }
      return null;
    }
    const slot = limiter.acquire(person.id, now().getTime());
    if (!slot.ok) {
      send(res, { code: 'rate_limited', message: slot.reason === 'in_progress' ? 'Intake is already understanding a request for your account. Wait for it to finish.' : 'Too many interpretations in a short time. Wait a few minutes and try again.', retryable: true, outcome: 'not_created' });
      return null;
    }
    const started = performance.now();
    log('form.interpret.started', { requestId: id, userId: person.id, provider: input.provider, mode: input.mode });
    try {
      const result = assessInterpretation(await deps.interpreter.interpret({
        ...input,
        telemetry: {
          userId: person.id,
          requestId: id,
          route: input.mode === 'revise' ? '/api/forms/revise' : '/api/forms/interpret',
        },
      }));
      const fields = { requestId: id, userId: person.id, mode: input.mode, durationMs: Math.round(performance.now() - started) };
      if (result.status === 'ready') log('form.interpret.completed', { ...fields, questionCount: result.specification.questions.length, assumptionCount: result.assumptions.length });
      else if (result.status === 'needs_clarification') log('form.interpret.clarification', fields);
      else log('form.interpret.unsupported', fields);
      return result;
    } catch (error) {
      const code = error instanceof InterpretationError ? error.code : 'model_unavailable';
      log('form.interpret.failed', { requestId: id, userId: person.id, mode: input.mode, code, durationMs: Math.round(performance.now() - started) });
      if (code === 'model_invalid_output') log('form.draft.validation_failed', { requestId: id, userId: person.id, reason: 'model_output_invalid' });
      const message = error instanceof InterpretationError ? error.message : 'Intake could not interpret this request right now. Your draft was not changed.';
      send(res, { code, message, retryable: code !== 'model_not_configured', outcome: 'not_created' });
      return null;
    } finally {
      slot.release();
    }
  }

  router.post('/interpret', auth, mutation, express.json({ limit: MAX_BODY, strict: true }), asyncRoute(async (req, res) => {
    const body = readInput(req.body, ['provider', 'request', 'clarification']);
    if (!body || !phrase(body.request, MAX_REQUEST) || (body.clarification !== undefined && !phrase(body.clarification, MAX_CLARIFICATION))) {
      return send(res, invalidRequest(`Describe the form in up to ${MAX_REQUEST} characters. Only provider, request and optional clarification are accepted.`));
    }
    if (body.provider !== 'google') return send(res, { code: 'provider_not_supported', message: 'Only Google Forms creation is available. Microsoft Forms creation is not supported.', outcome: 'not_created', retryable: false });
    const result = await infer({ mode: 'new', provider: 'google', request: body.request.trim(), ...(body.clarification ? { clarification: (body.clarification as string).trim() } : {}) }, req, res);
    if (!result) return;
    if (result.status !== 'ready') return sendJson(res, 200, { requestId: requestId(res), status: result.status, ...(result.status === 'needs_clarification' ? { question: result.question } : { explanation: result.explanation }) });
    const draft = await deps.store.create({ id: newId(), userId: user(res).id, provider: 'google', specification: result.specification, assumptions: result.assumptions, warnings: result.warnings }, now());
    sendJson(res, 201, { requestId: requestId(res), status: 'ready', draft: publicDraft(draft) });
  }));

  router.post('/revise', auth, mutation, express.json({ limit: MAX_BODY, strict: true }), asyncRoute(async (req, res) => {
    const body = readInput(req.body, ['draftId', 'version', 'request', 'clarification']);
    if (!body || !(typeof body.draftId === 'string' && DRAFT_ID.test(body.draftId)) || !version(body.version) || !phrase(body.request, MAX_REQUEST) ||
        (body.clarification !== undefined && !phrase(body.clarification, MAX_CLARIFICATION))) {
      return send(res, invalidRequest('Send a valid draft id, version and change request (up to 3000 characters). Nothing was changed.'));
    }
    const draft = await deps.store.get(user(res).id, body.draftId as string);
    if (!draft) return send(res, missingDraft);
    if (draft.status !== 'ready') return send(res, locked);
    if (draft.version !== body.version) return send(res, conflict);
    const result = await infer({ mode: 'revise', provider: draft.provider, request: body.request.trim(),
      ...(body.clarification ? { clarification: (body.clarification as string).trim() } : {}), specification: draft.specification }, req, res);
    if (!result) return;
    if (result.status !== 'ready') return sendJson(res, 200, { requestId: requestId(res), status: result.status, ...(result.status === 'needs_clarification' ? { question: result.question } : { explanation: result.explanation }) });
    const updated = await deps.store.revise(user(res).id, draft.id, draft.version,
      { specification: result.specification, assumptions: result.assumptions, warnings: result.warnings }, now());
    if (!updated) return send(res, conflict);
    log('form.draft.revised', { requestId: requestId(res), userId: user(res).id, draftId: draft.id, version: updated.version, questionCount: updated.specification.questions.length });
    sendJson(res, 200, { requestId: requestId(res), status: 'ready', draft: publicDraft(updated) });
  }));

  router.get('/draft/:id', auth, asyncRoute(async (req, res) => {
    if (!DRAFT_ID.test(req.params.id)) return send(res, missingDraft);
    const draft = await deps.store.get(user(res).id, req.params.id);
    if (!draft) return send(res, missingDraft);
    sendJson(res, 200, { requestId: requestId(res), draft: publicDraft(draft) });
  }));

  router.delete('/draft/:id', auth, mutation, asyncRoute(async (req, res) => {
    if (!DRAFT_ID.test(req.params.id)) return send(res, missingDraft);
    const draft = await deps.store.get(user(res).id, req.params.id);
    if (!draft) return send(res, missingDraft);
    if (draft.status !== 'ready') return send(res, locked);
    if (!await deps.store.discard(user(res).id, draft.id)) return send(res, conflict);
    res.status(204).end();
  }));

  router.post('/confirm', auth, mutation, express.json({ limit: MAX_BODY, strict: true }), asyncRoute(async (req, res) => {
    const body = readInput(req.body, ['draftId', 'version', 'confirm']);
    if (!body || !(typeof body.draftId === 'string' && DRAFT_ID.test(body.draftId)) || !version(body.version) || body.confirm !== true) {
      return send(res, invalidRequest('Confirm a current draft explicitly before creating a form. Nothing was created.'));
    }
    const draft = await deps.store.get(user(res).id, body.draftId as string);
    if (!draft) return send(res, missingDraft);
    if (draft.version !== body.version) return send(res, conflict);
    if (draft.status === 'created' || draft.status === 'blocked') {
      if (!draft.result) return send(res, locked);
      return respondResult(res, draft.result, draft, true);
    }
    if (draft.status === 'creating') return send(res, { ...locked, code: 'creation_in_progress', message: 'Creation may still be running or the result may be unknown. Do not submit this draft again. Check Recent forms and Google Forms.', outcome: 'unknown' });

    // Completed/blocked replays above never consume provider capacity. Only a ready draft is charged
    // against the technical creation ceiling before the durable claim and any Google request.
    const distributed = await consumeRequestLimit(deps.abuseLimiter, 'forms.create', user(res).id, req);
    if (!distributed.ok) {
      if (distributed.reason === 'rate_limited') {
        setRateLimitHeaders(res, distributed.retryAfterSeconds);
        return send(res, { code: 'rate_limited', message: 'Too many form creation attempts were made in a short time. Wait before trying this ready draft again.', retryable: true, outcome: 'not_created' });
      }
      return send(res, { code: 'storage_unavailable', message: 'Intake cannot safely start form creation right now. Nothing was sent to Google. Try again later.', retryable: true, outcome: 'not_created' });
    }

    // This one SQL UPDATE is the durable idempotency boundary. Model output and browser state have
    // no authority to choose a connection. The engine will validate and fetch this user's grant.
    const claimed = await deps.store.claim(user(res).id, draft.id, draft.version, now());
    if (!claimed) return send(res, conflict);
    log('form.draft.create_started', { requestId: requestId(res), userId: user(res).id, draftId: draft.id, version: draft.version, provider: draft.provider });
    let outcome: CreateFormResult;
    try {
      const created = await deps.engine.createForm({ userId: user(res).id, provider: claimed.provider, specification: claimed.specification, requestId: requestId(res) });
      outcome = created.ok
        ? { ok: true, requestId: requestId(res), form: created.form, warnings: created.warnings }
        : { ok: false, failure: toFailureBody(created.error, requestId(res)) };
    } catch {
      log('form.draft.create_failed', { requestId: requestId(res), userId: user(res).id, draftId: draft.id, reason: 'unexpected_engine_error' });
      outcome = { ok: false, failure: { code: 'internal_error', error: 'Intake could not confirm the result. Check Recent forms and Google Forms before starting a new draft.', requestId: requestId(res), outcome: 'unknown', retryable: false } };
    }
    const status = outcome.ok ? 'created' : outcome.failure.outcome === 'not_created' ? 'ready' : 'blocked';
    try {
      if (!await deps.store.finish(user(res).id, draft.id, status, outcome, now())) throw new Error('draft claim was lost');
    } catch {
      log('form.draft.create_failed', { requestId: requestId(res), userId: user(res).id, draftId: draft.id, reason: 'outcome_not_saved' });
      // The claim remains locked, even if a provider form exists. Never instruct a blind retry.
      return send(res, { code: 'storage_unavailable', message: 'Intake could not save the creation result. A form may exist. Check Recent forms and Google Forms before taking any action; this draft will not be sent again.', outcome: 'unknown', retryable: false });
    }
    log(outcome.ok ? 'form.draft.create_completed' : 'form.draft.create_failed', { requestId: requestId(res), userId: user(res).id, draftId: draft.id, status, ...(outcome.ok ? { formId: outcome.form.providerFormId } : { code: outcome.failure.code, outcome: outcome.failure.outcome }) });
    respondResult(res, outcome, { ...claimed, status, result: outcome }, false);
  }));

  router.use((error: unknown, _req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;
    const type = isRecord(error) ? error.type : undefined;
    if (type === 'entity.too.large') return send(res, invalidRequest('This request is too large. Nothing was changed.'), 413);
    if (type === 'entity.parse.failed' || type === 'encoding.unsupported' || type === 'charset.unsupported') return send(res, invalidRequest('Send a valid JSON object. Nothing was changed.'));
    log('form.draft.validation_failed', { requestId: requestId(res), userId: res.locals.user?.id, reason: 'storage_or_internal' });
    send(res, { code: 'storage_unavailable', message: 'Intake could not access your draft right now. No new provider operation was started by this request.', retryable: true, outcome: 'not_created' });
  });

  return router;
}

function respondResult(res: Response, result: CreateFormResult, draft: DraftRecord, replay: boolean): void {
  // A replay has its own trace id but always returns the exact recorded provider outcome. It NEVER
  // calls the engine again. The public draft lets the browser disable creation after uncertainty.
  const id = requestId(res);
  const latest = publicDraft(draft);
  if (result.ok) sendJson(res, replay ? 200 : 201, { requestId: id, form: result.form, warnings: result.warnings, draft: latest });
  else {
    if (result.failure.retryAfterSeconds) setRateLimitHeaders(res, result.failure.retryAfterSeconds);
    sendJson(res, statusFor(result.failure.code), { ...result.failure, requestId: id, draft: latest });
  }
}

function send(res: Response, info: FormErrorInfo, status?: number): void {
  sendJson(res, status ?? statusFor(info.code), toFailureBody(info, requestId(res)));
}

function sendJson(res: Response, status: number, body: unknown): void {
  try {
    assertPublic(body);
  } catch {
    console.error('Blocked an unsafe draft response', requestId(res));
    res.status(500).json({ error: 'Something went wrong.', code: 'internal_error', requestId: requestId(res) });
    return;
  }
  res.status(status).json(body);
}
