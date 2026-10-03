import { Router, type NextFunction, type Request, type Response } from 'express';
import { assertPublic } from '../providers/routes';
import { logSafe } from '../providers/oauth';
import type { SessionUser } from '../providers/service';
import type { CreditService } from './service';

export interface CreditRouterDeps {
  credits: CreditService;
  getSession: (req: Request) => Promise<SessionUser | null>;
}

const asyncRoute = (handler: (req: Request, res: Response) => Promise<void>) =>
  (req: Request, res: Response, next: NextFunction) => { Promise.resolve(handler(req, res)).catch(next); };

/**
 * The only credit information the browser may read: how much is left, on which plan, and when the
 * daily and monthly allowances reset. Internal token economics, ledger rows and pricing rules stay
 * server-side, and this route accepts no body — there is nothing a client may submit.
 */
export function createCreditRouter(deps: CreditRouterDeps): Router {
  const router = Router();

  router.get('/', asyncRoute(async (req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    let session: SessionUser | null = null;
    try {
      session = await deps.getSession(req);
    } catch (error) {
      logSafe('Credit balance session lookup failed', error);
      return send(res, 503, { error: 'Intake could not check your session. Try again later.', code: 'storage_unavailable', retryable: true });
    }
    if (!session) return send(res, 401, { error: 'Sign in to Intake to see AI credits.', code: 'not_authenticated', retryable: false });
    try {
      return send(res, 200, { credits: await deps.credits.balance(session.id) });
    } catch {
      return send(res, 503, { error: 'Intake cannot read AI credits right now. Try again shortly.', code: 'storage_unavailable', retryable: true });
    }
  }));

  return router;
}

function send(res: Response, status: number, body: unknown): void {
  try {
    assertPublic(body);
  } catch {
    res.status(500).json({ error: 'Something went wrong.' });
    return;
  }
  res.status(status).json(body);
}
