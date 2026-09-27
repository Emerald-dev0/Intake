/**
 * Records a reel from /capture.html frame-by-frame with a virtual clock,
 * so the output is perfectly smooth no matter how slow screenshots are.
 *
 *   node tools/record-demo.mjs <scene> <outDir> [fps=30] [width=1280] [from=0] [to=end]
 *
 * Needs: the dev server on :5173, `puppeteer-core`, and a Chrome binary in
 * CHROME_PATH (or @sparticuz/chromium). Writes PNG frames to <outDir>/frames.
 */
import fs from 'node:fs';
import path from 'node:path';

const [scene = 'conference', outDir = './out', fpsArg = '30', widthArg = '1280', fromArg = '0', toArg] = process.argv.slice(2);
const fps = Number(fpsArg);
const width = Number(widthArg);
const base = process.env.CAPTURE_URL ?? 'http://localhost:5173';

let puppeteer, executablePath, extraArgs = [];
puppeteer = (await import('puppeteer-core')).default;
if (process.env.CHROME_PATH) executablePath = process.env.CHROME_PATH;
else {
  const c = (await import('@sparticuz/chromium')).default;
  executablePath = await c.executablePath();
  extraArgs = c.args;
}

const framesDir = path.join(outDir, 'frames');
fs.rmSync(framesDir, { recursive: true, force: true });
fs.mkdirSync(framesDir, { recursive: true });

const browser = await puppeteer.launch({ executablePath, args: [...extraArgs, '--no-sandbox'], headless: true });
const page = await browser.newPage();
await page.setViewport({ width, height: 1400, deviceScaleFactor: 1 });
page.on('pageerror', (e) => console.log('PAGEERR', e.message));

// Virtual clock: rAF, timers, performance.now and Date.now only move when we say so.
await page.evaluateOnNewDocument(() => {
  delete Element.prototype.animate; // force motion to use rAF-driven JS animations
  let now = 0;
  const epoch = Date.now();
  let rafs = [];
  let timers = [];
  let id = 1;
  const realST = window.setTimeout.bind(window);
  window.__realTimeout = realST;
  performance.now = () => now;
  const RealDate = Date;
  Date.now = () => epoch + now;
  window.requestAnimationFrame = (cb) => {
    const i = id++;
    rafs.push([i, cb]);
    return i;
  };
  window.cancelAnimationFrame = (i) => {
    rafs = rafs.filter((r) => r[0] !== i);
  };
  window.setTimeout = (cb, ms = 0, ...a) => {
    const i = id++;
    timers.push({ i, at: now + Math.max(0, ms || 0), cb: () => (typeof cb === 'function' ? cb(...a) : null) });
    return i;
  };
  window.clearTimeout = (i) => {
    timers = timers.filter((t) => t.i !== i);
  };
  window.setInterval = (cb, ms = 0, ...a) => {
    const i = id++;
    const tick = () => {
      timers.push({ i, at: now + Math.max(1, ms || 0), cb: () => (cb(...a), tick()) });
    };
    tick();
    return i;
  };
  window.clearInterval = window.clearTimeout;
  const starts = new WeakMap();
  window.__syncCss = () => {
    for (const a of document.getAnimations()) {
      if (!starts.has(a)) starts.set(a, now);
      a.pause();
      a.currentTime = now - starts.get(a);
    }
  };
  window.__advance = (ms) => {
    const target = now + ms;
    for (;;) {
      timers.sort((x, y) => x.at - y.at);
      const t = timers[0];
      if (!t || t.at > target) break;
      timers.shift();
      now = t.at;
      try { t.cb(); } catch (e) { console.error(e); }
    }
    now = target;
    const cbs = rafs;
    rafs = [];
    for (const [, cb] of cbs) {
      try { cb(now); } catch (e) { console.error(e); }
    }
  };
  void RealDate;
});

await page.goto(`${base}/capture.html?scene=${scene}&w=${width}`, { waitUntil: 'networkidle0', timeout: 60000 });
await page.evaluate(() => document.fonts.ready);
await new Promise((r) => setTimeout(r, 800));
const settle = () => page.evaluate(() => new Promise((r) => window.__realTimeout(() => window.__realTimeout(r, 0), 0)));
for (let i = 0; i < 5; i++) {
  await page.evaluate(() => window.__advance(16));
  await settle();
}

const end = await page.evaluate(() => window.__reelEnd);
const from = Number(fromArg);
const to = toArg ? Number(toArg) : end;
const el = await page.$('.reel-screen');
const box = await el.boundingBox();
const clip = { x: Math.round(box.x), y: Math.round(box.y), width: Math.round(box.width), height: Math.round(box.height) };
console.log('scene', scene, 'end', end.toFixed(2), 'clip', clip);

// fast-forward to `from`
const dt = 1000 / fps;
let t = 0;
while (t < from) {
  await page.evaluate((d) => window.__advance(d), dt);
  await settle();
  t += dt / 1000;
}
let n = 0;
const total = Math.ceil((to - from) * fps);
for (let i = 0; i < total; i++) {
  await page.evaluate((d) => window.__advance(d), dt);
  await settle();
  await settle();
  await page.evaluate(() => window.__syncCss());
  await page.screenshot({ path: path.join(framesDir, `f${String(n++).padStart(5, '0')}.png`), clip });
  if (i % 60 === 0) console.log(`frame ${i}/${total}`);
}
await browser.close();
console.log('done', n, 'frames');
