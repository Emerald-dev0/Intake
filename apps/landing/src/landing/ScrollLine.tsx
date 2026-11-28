/**
 * The line: one continuous stroke that starts at Tick's pencil and ends in the footer.
 *
 * It is not decoration painted on top of the page — it is generated from the page. Each section
 * publishes an anchor (`data-line="hero"` etc.), the component measures those anchors after layout
 * and on resize, and threads a single smoothed path through them with a natural loop between every
 * pair. Scrolling then pulls the pen along it: the dash offset is a function of scroll progress, so
 * the line draws itself exactly as far as the reader has travelled.
 *
 * On a phone the same idea collapses to a single vertical run down the left edge, because a
 * sideways loop on a 375px screen is just noise.
 */

import { useEffect, useMemo, useRef, useState } from 'react';
import { raf, cancelRaf } from './frame.ts';

export interface ScrollLineProps {
  /** Reduced motion draws the whole line immediately. */
  still?: boolean;
}

interface Point { x: number; y: number }

/** Catmull-Rom through the anchors, expressed as cubic beziers. */
function smoothPath(points: Point[], loop = 46): string {
  if (points.length < 2) return '';
  const at = (index: number) => points[Math.max(0, Math.min(points.length - 1, index))];
  let d = `M ${points[0].x.toFixed(1)} ${points[0].y.toFixed(1)}`;

  for (let index = 0; index < points.length - 1; index += 1) {
    const p0 = at(index - 1);
    const p1 = at(index);
    const p2 = at(index + 1);
    const p3 = at(index + 2);

    // The straight-line midpoint, pushed sideways so the stroke bows like a pen stroke rather than
    // a diagram. The push alternates direction so consecutive sections loop opposite ways.
    const midX = (p1.x + p2.x) / 2;
    const midY = (p1.y + p2.y) / 2;
    const dx = p2.x - p1.x;
    const dy = p2.y - p1.y;
    const length = Math.hypot(dx, dy) || 1;
    const bow = loop * (index % 2 === 0 ? 1 : -1) * Math.min(1, length / 420);
    const bowX = (-dy / length) * bow;
    const bowY = (dx / length) * bow;

    // Control points lean toward the bowed midpoint, which keeps the joins smooth.
    const c1x = p1.x + (midX + bowX - p1.x) * 0.55 + (p2.x - p0.x) * 0.06;
    const c1y = p1.y + (midY + bowY - p1.y) * 0.55 + (p2.y - p0.y) * 0.06;
    const c2x = p2.x + (midX + bowX - p2.x) * 0.55 - (p3.x - p1.x) * 0.06;
    const c2y = p2.y + (midY + bowY - p2.y) * 0.55 - (p3.y - p1.y) * 0.06;

    d += ` C ${c1x.toFixed(1)} ${c1y.toFixed(1)}, ${c2x.toFixed(1)} ${c2y.toFixed(1)}, ${p2.x.toFixed(1)} ${p2.y.toFixed(1)}`;
  }
  return d;
}

export function ScrollLine({ still = false }: ScrollLineProps) {
  const pathRef = useRef<SVGPathElement | null>(null);
  const [path, setPath] = useState('');
  const [length, setLength] = useState(0);
  const progress = useRef(0);
  const [drawn, setDrawn] = useState(still ? 1 : 0);
  const [size, setSize] = useState({ width: 0, height: 0 });

  /** Measure the anchors the sections left in the document. */
  const measure = useMemo(() => () => {
    const anchors = [...document.querySelectorAll<HTMLElement>('[data-line]')]
      .map(node => {
        const box = node.getBoundingClientRect();
        const narrow = window.innerWidth < 720;
        return {
          x: narrow ? 18 : box.left + box.width * (node.dataset.lineX ? Number(node.dataset.lineX) : 0.5),
          y: box.top + window.scrollY + box.height * (node.dataset.lineY ? Number(node.dataset.lineY) : 0.5),
          order: node.dataset.line ?? '',
        };
      })
      .sort((a, b) => a.y - b.y);
    return anchors;
  }, []);

  useEffect(() => {
    let frame = 0;
    const rebuild = () => {
      const anchors = measure();
      setSize({ width: window.innerWidth, height: document.documentElement.scrollHeight });
      if (anchors.length < 2) return;
      const points = anchors.map(anchor => ({ x: anchor.x, y: anchor.y }));
      const next = smoothPath(points, window.innerWidth < 720 ? 18 : 46);
      setPath(next);
      const node = pathRef.current;
      // `getTotalLength` is SVG geometry, which not every environment implements (jsdom does not).
      // Where it is missing the line is still drawn — only the scrubbed reveal is skipped.
      const total = node && typeof node.getTotalLength === 'function' ? node.getTotalLength() : 0;
      if (node && total) {
        setLength(total);
        node.style.strokeDasharray = `${total}`;
        node.style.strokeDashoffset = still ? '0' : `${total * (1 - progress.current)}`;
      } else if (node) {
        node.style.strokeDasharray = '';
        node.style.strokeDashoffset = '';
      }
      setDrawn(progress.current);
    };

    const onScroll = () => {
      if (still) return;
      if (frame) return;
      frame = raf(() => {
        frame = 0;
        const scrollable = document.documentElement.scrollHeight - window.innerHeight;
        const next = scrollable > 0 ? Math.min(1, Math.max(0, window.scrollY / scrollable)) : 1;
        progress.current = next;
        const node = pathRef.current;
        if (node && length) node.style.strokeDashoffset = `${length * (1 - next)}`;
        setDrawn(next);
      });
    };

    const onResize = () => {
      frame = raf(() => {
        frame = 0;
        progress.current = 0;
        rebuild();
        onScroll();
      });
    };

    rebuild();
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onResize);
    // Fonts and images settle after first paint and move the anchors; measure once more.
    const settle = window.setTimeout(rebuild, 400);
    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onResize);
      window.clearTimeout(settle);
      if (frame) cancelRaf(frame);
    };
  }, [measure, still, length]);

  return (
    <div className="land-line" aria-hidden data-drawn={drawn.toFixed(3)} style={size.height ? { height: size.height } : undefined}>
      <svg
        className="land-line__svg"
        viewBox={`0 0 ${Math.max(1, size.width)} ${Math.max(1, size.height)}`}
        width={size.width || '100%'}
        height={size.height || '100%'}
        preserveAspectRatio="none"
      >
        {/* Two copies: a faint full path, and the drawn stroke that scrolls into view over it. */}
        <path ref={pathRef} className="land-line__path" d={path} fill="none" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    </div>
  );
}
