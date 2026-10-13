import { fileURLToPath } from 'node:url';
import type { RequestHandler } from 'express';

const socialImage = fileURLToPath(new URL('../public/og.png', import.meta.url));

/**
 * A share image must not require a browser binary (or a frontend network request) on the API host.
 * The branded 1200×630 card is checked in and also served by Vercel at /og.png. Retain this API URL
 * for already-shared links; historical ?path=… parameters intentionally use the same safe card.
 */
export const getOGPNG: RequestHandler = (_req, res, next) => {
  res.type('png');
  res.sendFile(socialImage, error => { if (error) next(error); });
};
