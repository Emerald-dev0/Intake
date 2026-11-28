/**
 * `requestAnimationFrame`, with a fallback.
 *
 * Every browser has it, but not every DOM used in tests does: a bare jsdom instance sends the page
 * straight to an error boundary. The fallback keeps the animation honest where the browser cannot
 * draw at 60fps, and costs one `setTimeout` there.
 */
export function raf(callback: (time: number) => void): number {
  if (typeof window !== 'undefined' && typeof window.requestAnimationFrame === 'function') {
    return window.requestAnimationFrame(callback);
  }
  return window.setTimeout(() => callback(typeof performance !== 'undefined' ? performance.now() : Date.now()), 16) as unknown as number;
}

export function cancelRaf(handle: number): void {
  if (!handle) return;
  if (typeof window !== 'undefined' && typeof window.cancelAnimationFrame === 'function') window.cancelAnimationFrame(handle);
  if (typeof window !== 'undefined') window.clearTimeout(handle);
}
