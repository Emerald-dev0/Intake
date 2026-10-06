import { useEffect, useRef, useState, type RefObject } from 'react';

/**
 * Scroll-reveal primitive.
 *
 * Everything animated on the public page is driven by adding a class once an element enters the
 * viewport, never by a scroll listener. That keeps the page cheap on phones and means the content is
 * present in the DOM (and readable) long before the animation runs.
 *
 * `prefers-reduced-motion` is honoured by CSS: elements still become visible, they just do not move.
 */
export function useInView<T extends HTMLElement>(options: { threshold?: number; rootMargin?: string; once?: boolean } = {}): [RefObject<T | null>, boolean] {
  const { threshold = 0.16, rootMargin = '0px 0px -8% 0px', once = true } = options;
  const ref = useRef<T | null>(null);
  const [inView, setInView] = useState(false);

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    // Without IntersectionObserver (older browsers, some test environments) show the content.
    if (typeof IntersectionObserver === 'undefined') {
      setInView(true);
      return;
    }
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setInView(true);
          if (once) observer.unobserve(entry.target);
        } else if (!once) {
          setInView(false);
        }
      }
    }, { threshold, rootMargin });
    observer.observe(element);
    return () => observer.disconnect();
  }, [once, rootMargin, threshold]);

  return [ref, inView];
}

export type ViewState = 'before' | 'in' | 'after';

/**
 * Three-state scroll position, for entrances *and* exits.
 *
 * `before` — the element is below the fold and has not been reached yet.
 * `in`     — it is on screen.
 * `after`  — it has been read and scrolled past.
 *
 * The exit state is what lets an element fade out rather than sit at full strength for the rest of
 * the page. It is driven by one IntersectionObserver with two margins, not by a scroll listener, so
 * it costs nothing while the page is still.
 */
export function useViewState<T extends HTMLElement>(
  options: { rootMargin?: string; once?: boolean } = {},
): [RefObject<T | null>, ViewState] {
  const { rootMargin = '-12% 0px -12% 0px', once = false } = options;
  const ref = useRef<T | null>(null);
  const [state, setState] = useState<ViewState>('before');

  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    if (typeof IntersectionObserver === 'undefined') {
      setState('in');
      return;
    }

    let settled = false;
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) {
          setState('in');
          settled = true;
          if (once) observer.unobserve(entry.target);
          continue;
        }
        if (once && settled) continue;
        // Which side of the viewport the element left decides whether it was reached at all.
        const leavingUpwards = entry.boundingClientRect.top < (entry.rootBounds?.top ?? 0);
        setState(leavingUpwards ? 'after' : 'before');
      }
    }, { threshold: 0, rootMargin });

    observer.observe(element);
    return () => observer.disconnect();
  }, [once, rootMargin]);

  return [ref, state];
}

/** True once the window has scrolled past `offset`. Used for the header and scroll progress bar. */
export function useScrolled(offset = 12): boolean {
  const [scrolled, setScrolled] = useState(false);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      setScrolled(window.scrollY > offset);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      window.removeEventListener('scroll', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, [offset]);
  return scrolled;
}

/** 0 → 1 page scroll progress, written to CSS custom properties by the progress bar component. */
export function useScrollProgress(): number {
  const [progress, setProgress] = useState(0);
  useEffect(() => {
    let frame = 0;
    const read = () => {
      frame = 0;
      const scrollable = document.documentElement.scrollHeight - window.innerHeight;
      setProgress(scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 0);
    };
    const onScroll = () => { if (!frame) frame = window.requestAnimationFrame(read); };
    read();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      if (frame) window.cancelAnimationFrame(frame);
    };
  }, []);
  return progress;
}

/** True on pointer devices that can hover, so hover-only flourishes never fire on touch. */
export function useCanHover(): boolean {
  const [canHover, setCanHover] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(hover: hover) and (pointer: fine)');
    setCanHover(query.matches);
    const listener = (event: MediaQueryListEvent) => setCanHover(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return canHover;
}

/** True when the visitor asked for less motion. Animations are skipped rather than slowed down. */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(false);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    setReduced(query.matches);
    const listener = (event: MediaQueryListEvent) => setReduced(event.matches);
    query.addEventListener('change', listener);
    return () => query.removeEventListener('change', listener);
  }, []);
  return reduced;
}

/**
 * Tracks a gently animated in-view counter for the small proof points on the page. Returns the final
 * value immediately when motion is reduced or the element is not visible yet.
 */
export function useCountUp(target: number, active: boolean, durationMs = 900): number {
  const reduced = usePrefersReducedMotion();
  const [value, setValue] = useState(0);
  useEffect(() => {
    if (!active || reduced) { setValue(active ? target : 0); return; }
    let frame = 0;
    const started = performance.now();
    const tick = (now: number) => {
      const elapsed = Math.min(1, (now - started) / durationMs);
      // Ease-out cubic so the number settles instead of stopping abruptly.
      setValue(Math.round(target * (1 - (1 - elapsed) ** 3)));
      if (elapsed < 1) frame = window.requestAnimationFrame(tick);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [active, durationMs, reduced, target]);
  return value;
}

/** Pointer position within an element, as percentages, for the soft highlight that follows the cursor. */
export function usePointerGlow<T extends HTMLElement>(enabled: boolean): { ref: RefObject<T | null>; onPointerMove: (event: { clientX: number; clientY: number }) => void } {
  const ref = useRef<T | null>(null);
  const frame = useRef(0);
  const point = useRef({ x: 0, y: 0 });
  const onPointerMove = (event: { clientX: number; clientY: number }) => {
    if (!enabled) return;
    point.current = { x: event.clientX, y: event.clientY };
    if (frame.current) return;
    frame.current = window.requestAnimationFrame(() => {
      frame.current = 0;
      const element = ref.current;
      if (!element) return;
      const rect = element.getBoundingClientRect();
      element.style.setProperty('--glow-x', `${(((point.current.x - rect.left) / rect.width) * 100).toFixed(2)}%`);
      element.style.setProperty('--glow-y', `${(((point.current.y - rect.top) / rect.height) * 100).toFixed(2)}%`);
    });
  };
  return { ref, onPointerMove };
}
