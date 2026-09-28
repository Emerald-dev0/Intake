export const clamp = (v: number, a = 0, b = 1) => Math.min(b, Math.max(a, v));
export const prog = (t: number, start: number, dur: number) => clamp((t - start) / Math.max(dur, 0.0001));
export const easeOut = (x: number) => 1 - Math.pow(1 - x, 3);
export const easeInOut = (x: number) => (x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2);
export const lerp = (a: number, b: number, p: number) => a + (b - a) * p;

function mulberry32(seed: number) {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Deterministic, human-feeling typing schedule. Returns the time each char lands. */
export function typingTimes(text: string, start: number, cps = 42, seed = 7): number[] {
  const rnd = mulberry32(seed + text.length);
  const base = 1 / cps;
  const out: number[] = [];
  let t = start;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    const prev = text[i - 1];
    let d = base * (0.55 + rnd() * 0.9);
    if (prev === ',' || prev === '—') d += 0.1;
    if (prev === '.' || prev === '?') d += 0.26;
    if (ch === ' ' && rnd() > 0.93) d += 0.12; // thinking pause
    t += d;
    out.push(t);
  }
  return out;
}

export function countBefore(times: number[], t: number): number {
  // times sorted ascending
  let lo = 0,
    hi = times.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (times[mid] <= t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

export function fmtTime(s: number) {
  const m = Math.floor(s / 60);
  const ss = Math.floor(s % 60);
  return `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`;
}
