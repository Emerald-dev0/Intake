import { Router } from 'express';
import type { Request, Response } from 'express';
import { renderChangelogCard, renderChangelogIndexCard, type CardRelease } from './changelog-card.ts';
import { BUNDLED_RELEASES } from '../../src/content/changelog.ts';

/**
 * Share cards for the changelog.
 *
 * A link to a release is often pasted somewhere that shows a preview. The preview should show
 * the release, not the product's homepage — so the card is drawn from the release's own title,
 * date and summary.
 *
 * The card is found in the database first, so a release published after the last build gets one
 * too, and from the bundled notes when the database cannot be reached: a card is a nicety, and
 * it must never be the reason a page fails.
 */

export interface ChangelogCardDeps {
  /** The published releases, newest first. May throw; the bundled notes are the fallback. */
  listPublished: () => Promise<CardRelease[]>;
}

function toCard(release: {
  slug: string;
  title: string;
  summary: string;
  releaseDate?: string | null;
  categories?: string[];
}): CardRelease {
  return {
    slug: release.slug,
    title: release.title,
    summary: release.summary,
    releaseDate: release.releaseDate ?? new Date().toISOString().slice(0, 10),
    categories: release.categories ?? [],
  };
}

/** The bundled notes, as cards. They are the shipped history, so they are always available. */
function bundledCards(): CardRelease[] {
  return BUNDLED_RELEASES.map(release => toCard({
    slug: release.slug,
    title: release.title,
    summary: release.summary,
    releaseDate: release.releaseDate,
    categories: release.categories,
  }));
}

export function createChangelogCardRouter(deps: ChangelogCardDeps): Router {
  const router = Router();

  /** The card for one release. */
  router.get('/api/og/changelog/:slug', async (req: Request, res: Response) => {
    const slug = String(req.params.slug ?? '').slice(0, 80);
    if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
      res.status(404).json({ error: 'not_found', message: 'No such release.' });
      return;
    }

    let release: CardRelease | undefined;
    try {
      const releases = await deps.listPublished();
      release = releases.find(entry => entry.slug === slug);
    } catch {
      release = undefined;
    }
    if (!release) release = bundledCards().find(entry => entry.slug === slug);

    if (!release) {
      res.status(404).json({ error: 'not_found', message: 'No such release.' });
      return;
    }

    send(res, renderChangelogCard(release));
  });

  /** The card for the changelog itself. */
  router.get('/api/og/changelog', async (_req: Request, res: Response) => {
    let releases: CardRelease[] = [];
    try {
      releases = await deps.listPublished();
    } catch {
      releases = [];
    }
    if (!releases.length) releases = bundledCards();
    send(res, renderChangelogIndexCard(releases));
  });

  return router;
}

function send(res: Response, png: Buffer): void {
  res.type('png');
  // The card changes when a release changes, and not before. It is safe to cache for a day.
  res.set('Cache-Control', 'public, max-age=86400, stale-while-revalidate=604800');
  res.set('Content-Length', String(png.length));
  res.send(png);
}
