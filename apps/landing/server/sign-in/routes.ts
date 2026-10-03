import { Router, type Request, type Response } from 'express';
import { assertPublic } from '../providers/routes';
import { publicSignInConfig } from './google';

export interface SignInRouterDeps {
  env: NodeJS.ProcessEnv;
}

/**
 * Public sign-in capabilities for the browser.
 *
 * The landing page needs to know whether "Continue with Google" can work *before* it renders a
 * button that would only fail at the callback. This route exposes booleans only: no client ids,
 * no secrets, no callback URLs, and no hint of whether Google Forms is connected.
 */
export function createSignInRouter(deps: SignInRouterDeps): Router {
  const router = Router();
  router.get('/config', (_req: Request, res: Response) => {
    res.set('Cache-Control', 'no-store');
    res.set('Referrer-Policy', 'no-referrer');
    const body = publicSignInConfig(deps.env);
    try {
      assertPublic(body);
    } catch {
      return res.status(500).json({ error: 'Something went wrong.' });
    }
    return res.json(body);
  });
  return router;
}
