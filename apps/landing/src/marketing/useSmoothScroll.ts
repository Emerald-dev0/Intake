import { useEffect } from 'react';

/**
 * Eased wheel scrolling for the homepage, on desktop only.
 *
 * Lenis is loaded on demand, after the page is interactive, so it never weighs on first paint. It
 * stays off for touch screens (native momentum is already right there), for anyone who asked the
 * system for reduced motion, and wherever `matchMedia` does not exist. Native scroll position is
 * kept in sync, so IntersectionObserver reveals and the sticky nav keep working unchanged.
 */
export function useSmoothScroll() {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(hover: hover) and (pointer: fine)').matches) return;

    let cancelled = false;
    let destroy = () => {};

    import('lenis').then(({ default: Lenis }) => {
      if (cancelled) return;
      const lenis = new Lenis({
        autoRaf: true,
        lerp: 0.11,
        wheelMultiplier: 0.95,
        anchors: { offset: -88 },
        respectReducedMotion: true,
        // Anything that scrolls on its own (the phone menu, wide tables) keeps native scrolling.
        prevent: node => Boolean(node.closest?.('.mk-sheet, .mk-compare__scroll, [data-lenis-prevent]')),
      });

      // The phone menu locks the page with overflow:hidden; pause the easing while it is open.
      const sync = () => (document.body.style.overflow === 'hidden' ? lenis.stop() : lenis.start());
      const watcher = new MutationObserver(sync);
      watcher.observe(document.body, { attributes: true, attributeFilter: ['style'] });

      destroy = () => {
        watcher.disconnect();
        lenis.destroy();
      };
    }).catch(() => {
      // Native scrolling is a perfectly good fallback.
    });

    return () => {
      cancelled = true;
      destroy();
    };
  }, []);
}
