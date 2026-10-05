import { Router, type NextFunction, type Request, type Response } from 'express';
import type { RateLimitStore } from '../security/rate-limit';
import type { AdminOperation, AdminOperationStatus, AdminRange, AdminStore } from './contracts';
import { boundedText, parseAdminPage, parseRange, positiveId, rangeBounds } from './ranges';
import type { SessionUser } from '../providers/service';

const RANGE_DEFAULT: AdminRange = '7d';
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]+$/;
const RATE_RULES = {
  read: { limit: 120, windowSeconds: 60 },
  search: { limit: 60, windowSeconds: 60 },
  analytics: { limit: 30, windowSeconds: 60 },
} as const;

type Quota = keyof typeof RATE_RULES;
type AdminHandler = (req: Request, res: Response, next: NextFunction) => Promise<unknown>;

export interface AdminRouterDeps {
  store: AdminStore;
  getSession: (req: Request) => Promise<SessionUser | null>;
  rateLimiter: RateLimitStore;
  env: NodeJS.ProcessEnv;
  now?: () => Date;
}

function asyncRoute(handler: AdminHandler) {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(handler(req, res, next)).catch(next);
  };
}

function parseAdminEmails(raw: string | undefined): Set<string> {
  const emails = (raw ?? '').split(',').map(value => value.trim().toLowerCase()).filter(value => EMAIL.test(value));
  return new Set(emails);
}

function invalid(res: Response, message = 'Invalid admin query parameters.') {
  res.status(400).json({ error: message });
}

function queryValue(req: Request, name: string): string | undefined {
  const value = req.query[name];
  return typeof value === 'string' ? value : value === undefined ? undefined : '\u0000';
}

function readRange(req: Request): AdminRange | null {
  const raw = queryValue(req, 'range');
  if (raw === undefined) return RANGE_DEFAULT;
  return parseRange(raw);
}

function readPage(req: Request) {
  return parseAdminPage(req.query as unknown as Record<string, unknown>);
}

function optionalId(raw: string | undefined): string | null | undefined {
  if (raw === undefined || raw === '') return '';
  return positiveId(raw);
}

function optionalEnum<T extends string>(value: string | undefined, values: readonly T[]): T | null | undefined {
  if (value === undefined || value === '') return null;
  return values.includes(value as T) ? value as T : undefined;
}

export function createAdminRouter(deps: AdminRouterDeps): Router {
  const router = Router();
  const allowlist = parseAdminEmails(deps.env.ADMIN_EMAILS);
  const now = deps.now ?? (() => new Date());

  router.use((_req, res, next) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    res.set('X-Robots-Tag', 'noindex, nofollow, noarchive');
    res.set('X-Content-Type-Options', 'nosniff');
    next();
  });

  // This runs for every request under /api/admin, including /access. The session id is produced by
  // Better Auth; the current email is re-read from the database before it is compared to the
  // server-only allowlist. Request bodies, query strings and browser state never grant admin access.
  router.use((req, res, next) => {
    void (async () => {
      let session: SessionUser | null;
      try {
        session = await deps.getSession(req);
      } catch {
        res.status(503).json({ error: 'Session verification is temporarily unavailable.' });
        return;
      }
      if (!session?.id) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      let identity;
      try {
        identity = await deps.store.getIdentity(session.id);
      } catch {
        res.status(503).json({ error: 'Administrator access could not be verified.' });
        return;
      }
      if (!identity) {
        res.status(401).json({ error: 'Authentication required.' });
        return;
      }
      if (!allowlist.has(identity.email.trim().toLowerCase()) || !identity.emailVerified) {
        res.status(403).json({ error: 'Administrator access requires a verified allowlisted account.' });
        return;
      }
      res.locals.admin = identity;
      next();
    })().catch(next);
  });

  async function allowRequest(_req: Request, res: Response, quota: Quota): Promise<boolean> {
    const admin = res.locals.admin as { id: string } | undefined;
    if (!admin) return false;
    try {
      const decision = await deps.rateLimiter.consume(`admin.${quota}`, `admin:${admin.id}`, RATE_RULES[quota]);
      if (decision.allowed) return true;
      res.set('Retry-After', String(Math.max(1, Math.ceil(decision.retryAfterSeconds))));
      res.status(429).json({ error: 'Too many admin requests. Wait briefly and try again.' });
      return false;
    } catch {
      res.status(503).json({ error: 'Admin rate-limit storage is temporarily unavailable.' });
      return false;
    }
  }

  router.get('/access', asyncRoute(async (_req, res) => {
    if (!await allowRequest(_req, res, 'read')) return;
    const identity = res.locals.admin as { id: string; name: string; email: string };
    res.json({ admin: { id: identity.id, name: identity.name, email: identity.email }, readOnly: true });
  }));

  router.get('/overview', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'analytics')) return;
    const range = readRange(req);
    if (!range) return invalid(res, 'Choose today, 7d, or 30d for the reporting range.');
    res.json(await deps.store.getOverview(rangeBounds(range, now())));
  }));

  router.get('/users', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'search')) return;
    const page = readPage(req);
    const search = boundedText(queryValue(req, 'q'), 120);
    if (!page || search === null) return invalid(res, 'Use a search up to 120 characters and a valid page/limit.');
    res.json(await deps.store.listUsers({ ...page, search }));
  }));

  router.get('/users/:userId', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'read')) return;
    const userId = positiveId(req.params.userId);
    if (!userId) return invalid(res, 'Invalid user identifier.');
    const user = await deps.store.getUserDetail(userId);
    if (!user) return res.status(404).json({ error: 'User not found.' });
    res.json(user);
  }));

  router.get('/ai', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'analytics')) return;
    const page = readPage(req);
    const range = readRange(req);
    const operation = optionalEnum(queryValue(req, 'operation'), ['form_create', 'form_revise', 'form_edit'] as const) as AdminOperation | null | undefined;
    const status = optionalEnum(queryValue(req, 'status'), ['succeeded', 'failed', 'no_result'] as const) as AdminOperationStatus | null | undefined;
    const model = boundedText(queryValue(req, 'model'), 200);
    const userId = optionalId(queryValue(req, 'userId'));
    if (!page || !range || operation === undefined || status === undefined || model === null || userId === null) return invalid(res);
    res.json(await deps.store.listAi({ ...page, bounds: rangeBounds(range, now()), operation, status, model, userId: userId || '' }));
  }));

  router.get('/credits', asyncRoute(async (_req, res) => {
    if (!await allowRequest(_req, res, 'read')) return;
    res.json(deps.store.getCredits());
  }));

  router.get('/forms', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'search')) return;
    const page = readPage(req);
    const query = boundedText(queryValue(req, 'q'), 120);
    const userId = optionalId(queryValue(req, 'userId'));
    const provider = optionalEnum(queryValue(req, 'provider'), ['google', 'microsoft'] as const);
    const status = optionalEnum(queryValue(req, 'status'), ['created', 'incomplete'] as const);
    const archivedRaw = queryValue(req, 'archived');
    const archived = archivedRaw === undefined ? 'all' : archivedRaw;
    if (!page || query === null || userId === null || provider === undefined || status === undefined || !['active', 'archived', 'all'].includes(archived)) return invalid(res);
    res.json(await deps.store.listForms({
      ...page, query, userId: userId || '', provider, status,
      archived: archived as 'active' | 'archived' | 'all',
    }));
  }));

  router.get('/providers', asyncRoute(async (_req, res) => {
    if (!await allowRequest(_req, res, 'read')) return;
    res.json(await deps.store.getProviders());
  }));

  router.get('/system', asyncRoute(async (_req, res) => {
    if (!await allowRequest(_req, res, 'read')) return;
    res.json(await deps.store.getSystem());
  }));

  router.get('/activity', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'read')) return;
    const page = readPage(req);
    const range = readRange(req);
    const type = boundedText(queryValue(req, 'type'), 80);
    const userId = optionalId(queryValue(req, 'userId'));
    if (!page || !range || type === null || userId === null) return invalid(res);
    res.json(await deps.store.listActivity({ ...page, bounds: rangeBounds(range, now()), type, userId: userId || '' }));
  }));

  router.get('/errors', asyncRoute(async (req, res) => {
    if (!await allowRequest(req, res, 'read')) return;
    const page = readPage(req);
    const range = readRange(req);
    const userId = optionalId(queryValue(req, 'userId'));
    if (!page || !range || userId === null) return invalid(res);
    res.json(await deps.store.listErrors({ ...page, bounds: rangeBounds(range, now()), userId: userId || '' }));
  }));

  router.use((_req, res) => res.status(404).json({ error: 'Admin API route not found.' }));
  return router;
}

export { parseAdminEmails };
