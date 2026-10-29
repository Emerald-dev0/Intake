/**
 * Public release API.
 *
 * Only published releases are visible here. A draft, a release awaiting review and a cancelled
 * release are all answered with 404 — not 403 — so an unpublished slug cannot be probed to find out
 * whether it exists.
 */

import { Router, type Request, type Response } from 'express';
import type { ReleaseStore } from './contracts.ts';

const MAX_BODY_BYTES = 16 * 1024;

export interface PublicReleaseRouterDeps {
  store: ReleaseStore;
}

export function createPublicReleaseRouter(deps: PublicReleaseRouterDeps): Router {
  const router = Router();

  router.get('/api/releases', async (_req: Request, res: Response) => {
    try {
      const result = await deps.store.listPublished({ limit: 200, offset: 0 });
      res.json({ releases: result.items, total: result.total });
    } catch {
      res.status(503).json({ error: 'releases_unavailable', message: 'The changelog is temporarily unavailable.' });
    }
  });

  router.get('/api/releases/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? '').slice(0, 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      return res.status(404).json({ error: 'not_found', message: 'No such release.' });
    }
    try {
      const release = await deps.store.getPublishedBySlug(slug);
      if (!release) return res.status(404).json({ error: 'not_found', message: 'No such release.' });
      res.json({ release });
    } catch {
      res.status(503).json({ error: 'releases_unavailable', message: 'The changelog is temporarily unavailable.' });
    }
  });

  return router;
}

/** Shared body cap for the release endpoints. */
export const RELEASE_BODY_LIMIT = MAX_BODY_BYTES;
