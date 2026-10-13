import type { RequestHandler } from 'express';
import { chromium } from 'playwright';

export const getOGPNG: RequestHandler = async (req, res) => {
  const pagePath = req.query.path || '/';
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext({
    viewport: { width: 1200, height: 630 },
    userAgent: 'Intake Share Preview',
  });
  const page = await context.newPage();
  const base = process.env.VITE_SITE_URL || 'https://intake.calder.click';
  await page.goto(base + pagePath, { waitUntil: 'networkidle' });

  // Wait a moment for any dynamic content (e.g. hero text) to settle
  await page.waitForTimeout(300);

  const buffer = await page.screenshot({ type: 'png' });
  await browser.close();
  res.set('Content-Type', 'image/png');
  res.send(buffer);
};