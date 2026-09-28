import { Router, type Request, type Response } from 'express';
import { isProviderId, isResultCode, isRevocationOutcome, type ProviderId, type ResultCode, type RevocationOutcome } from '../../src/lib/connections';
import { logSafe, publicOrigin } from './oauth';
import { createProviderService, storageResult, type ProviderDeps, type ProviderService, type SessionUser } from './service';

const FORBIDDEN_KEYS = new Set([
  'accessToken', 'refreshToken', 'access_token', 'refresh_token', 'idToken', 'id_token',
  'clientSecret', 'client_secret', 'codeVerifier', 'code_verifier', 'ciphertext', 'authorization',
]);

export interface ProviderRouterDeps {
  service: ProviderService;
  getSession: (req: Request) => Promise<SessionUser | null>;
  env: NodeJS.ProcessEnv;
}

export function createProviderRouter(deps: ProviderRouterDeps): Router {
  const router = Router();
  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    next();
  });

  router.get('/', async (req, res) => {
    const user = await session(deps, req, res);
    if (!user) return;
    try {
      const providers = await deps.service.list(user.id);
      sendPublic(res, 200, { providers });
    } catch (error) {
      sendResult(res, storageResult(error));
    }
  });

  router.post('/:provider/connect', async (req, res) => {
    const provider = providerParam(req);
    if (!provider) return redirect(res, null, 'unsupported_provider');
    const user = await session(deps, req, res);
    if (!user) return;
    if (!trustedMutation(req, deps.env)) return res.status(403).json({ error: 'Request was rejected.' });
    try {
      const started = await deps.service.start(user.id, provider);
      if (!started.ok) return redirect(res, provider, started.result);
      return res.redirect(303, started.url);
    } catch (error) {
      return redirect(res, provider, storageResult(error));
    }
  });

  router.get('/:provider/callback', async (req, res) => {
    const provider = providerParam(req);
    if (!provider) return redirect(res, null, 'unsupported_provider');
    const user = await session(deps, req, res);
    if (!user) return;
    const query = {
      code: stringParam(req.query.code),
      state: stringParam(req.query.state),
      error: stringParam(req.query.error),
      error_subcode: stringParam(req.query.error_subcode),
      error_description: stringParam(req.query.error_description),
    };
    try {
      const finished = await deps.service.complete(user.id, provider, query);
      if (finished.result !== 'connected' && finished.result !== 'cancelled') {
        logSafe('Provider authorization did not complete', undefined, `${provider} ${finished.result}`);
      }
      return redirect(res, provider, finished.result, finished.revocation);
    } catch (error) {
      return redirect(res, provider, storageResult(error));
    }
  });

  router.post('/:provider/disconnect', async (req, res) => {
    const provider = providerParam(req);
    if (!provider) return respond(req, res, null, 'unsupported_provider');
    const user = await session(deps, req, res);
    if (!user) return;
    if (!trustedMutation(req, deps.env)) return res.status(403).json({ error: 'Request was rejected.' });
    try {
      const removed = await deps.service.disconnect(user.id, provider);
      return respond(req, res, provider, removed.result, removed.revocation);
    } catch (error) {
      return respond(req, res, provider, storageResult(error));
    }
  });

  router.use((_req, res) => {
    res.status(404).json({ error: 'Not found' });
  });
  return router;
}

export function createProviderRouterFromDeps(deps: ProviderDeps & { getSession: (req: Request) => Promise<SessionUser | null> }): Router {
  return createProviderRouter({ service: createProviderService(deps), getSession: deps.getSession, env: deps.env });
}

async function session(deps: ProviderRouterDeps, req: Request, res: Response): Promise<SessionUser | null> {
  try {
    const user = await deps.getSession(req);
    if (!user) {
      if ((req.get('accept') || '').includes('application/json')) res.status(401).json({ error: 'Not authenticated' });
      else res.redirect(303, '/auth/sign-in?reason=session_expired');
      return null;
    }
    return user;
  } catch (error) {
    logSafe('Provider session lookup failed', error);
    res.status(503).type('text').send('Intake is temporarily unavailable. Please try again later.');
    return null;
  }
}

function providerParam(req: Request): ProviderId | null {
  const value = req.params.provider;
  return typeof value === 'string' && isProviderId(value) ? value : null;
}

function stringParam(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

export function trustedMutation(req: Request, env: NodeJS.ProcessEnv): boolean {
  const expected = publicOrigin(env.BETTER_AUTH_URL);
  if (!expected) return false;
  const origin = req.get('origin');
  if (origin) return publicOrigin(origin) === expected;
  const referer = req.get('referer');
  if (!referer) return false;
  try {
    return new URL(referer).origin === expected;
  } catch {
    return false;
  }
}

function redirect(res: Response, provider: ProviderId | null, result: ResultCode, revocation?: RevocationOutcome): void {
  const params = new URLSearchParams({ result });
  if (provider) params.set('provider', provider);
  if (revocation && isRevocationOutcome(revocation)) params.set('revocation', revocation);
  res.redirect(303, `/app/connections?${params.toString()}`);
}

function respond(req: Request, res: Response, provider: ProviderId | null, result: ResultCode, revocation?: RevocationOutcome): void {
  if ((req.get('accept') || '').includes('application/json')) {
    sendPublic(res, result === 'storage_unavailable' || result === 'storage_failed' ? 503 : 200, {
      result,
      provider,
      revocation: revocation ?? null,
    });
    return;
  }
  redirect(res, provider, result, revocation);
}

function sendResult(res: Response, result: ResultCode): void {
  const status = result === 'storage_unavailable' || result === 'storage_failed' ? 503 : 400;
  sendPublic(res, status, { error: 'Provider connections are unavailable.', result });
}

export function assertPublic(value: unknown): void {
  if (Array.isArray(value)) {
    value.forEach(assertPublic);
    return;
  }
  if (!value || typeof value !== 'object') return;
  for (const [key, child] of Object.entries(value)) {
    if (FORBIDDEN_KEYS.has(key)) throw new Error('secret key in public payload');
    assertPublic(child);
  }
}

function sendPublic(res: Response, status: number, body: unknown): void {
  try {
    assertPublic(body);
  } catch (error) {
    logSafe('Blocked a provider response', error);
    res.status(500).json({ error: 'Something went wrong.' });
    return;
  }
  if (!isResultCode((body as { result?: string }).result) && (body as { result?: string }).result !== undefined) {
    res.status(500).json({ error: 'Something went wrong.' });
    return;
  }
  res.status(status).json(body);
}
