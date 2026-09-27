import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CreateStage } from './CreateStage';
import { EditStage } from './EditStage';
import { fmtTime } from './engine';
import { buildCreateTimeline, buildEditTimeline, type Scene } from './scenes';

const LAND = { w: 1280, h: 760 };
const PORT = { w: 440, h: 860 };

export function Reel({ scene, className = '', onEnd, loop = true }: { scene: Scene; className?: string; onEnd?: () => void; loop?: boolean }) {
  const tl = useMemo(() => (scene.kind === 'create' ? buildCreateTimeline(scene) : buildEditTimeline(scene)), [scene]);
  const reduce = useMemo(() => typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  const [t, setT] = useState(0);
  const [userPaused, setUserPaused] = useState(reduce);
  const [inView, setInView] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [width, setWidth] = useState(0);
  const [full, setFull] = useState(false);
  const wrap = useRef<HTMLDivElement>(null);
  const shell = useRef<HTMLDivElement>(null);
  const onEndRef = useRef(onEnd);
  onEndRef.current = onEnd;

  // Reset on scene change
  useEffect(() => {
    setT(reduce && tl.kind === 'create' ? tl.previewAt + 3 : 0);
  }, [tl, reduce]);

  // Size
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setWidth(e.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  // Visibility
  useEffect(() => {
    const el = shell.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.3 });
    io.observe(el);
    const vis = () => setHidden(document.hidden);
    document.addEventListener('visibilitychange', vis);
    return () => {
      io.disconnect();
      document.removeEventListener('visibilitychange', vis);
    };
  }, []);

  useEffect(() => {
    const f = () => setFull(document.fullscreenElement === shell.current);
    document.addEventListener('fullscreenchange', f);
    return () => document.removeEventListener('fullscreenchange', f);
  }, []);

  const playing = inView && !userPaused && !hidden;

  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const loopFn = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setT((prev) => {
        const n = prev + dt;
        if (n >= tl.end) {
          if (onEndRef.current) queueMicrotask(() => onEndRef.current?.());
          return loop ? 0 : tl.end;
        }
        return n;
      });
      raf = requestAnimationFrame(loopFn);
    };
    raf = requestAnimationFrame(loopFn);
    return () => cancelAnimationFrame(raf);
  }, [playing, tl.end, loop]);

  const portrait = width > 0 && width < 720;
  const D = portrait ? PORT : LAND;
  const maxH = full ? window.innerHeight - 90 : Infinity;
  const scale = width ? Math.min(width / D.w, maxH / D.h) : 0;

  const seekFromEvent = useCallback(
    (clientX: number, el: HTMLElement) => {
      const r = el.getBoundingClientRect();
      setT(Math.max(0, Math.min(tl.end - 0.01, ((clientX - r.left) / r.width) * tl.end)));
    },
    [tl.end],
  );

  const chapIdx = tl.chapters.reduce((acc, c, i) => (t >= c.start ? i : acc), 0);

  return (
    <div className={`reel ${className} ${full ? 'is-full' : ''}`} ref={shell}>
      <div className="reel-screen" ref={wrap} style={{ height: scale ? D.h * scale : undefined, aspectRatio: scale ? undefined : `${D.w} / ${D.h}` }}>
        {scale > 0 && (
          <div className="reel-stage" style={{ width: D.w, height: D.h, transform: `scale(${scale})` }}>
            {scene.kind === 'create' && tl.kind === 'create' ? (
              <CreateStage scene={scene} tl={tl} t={t} portrait={portrait} scale={scale} />
            ) : scene.kind === 'edit' && tl.kind === 'edit' ? (
              <EditStage scene={scene} tl={tl} t={t} portrait={portrait} />
            ) : null}
          </div>
        )}
        <button className="reel-hit" aria-label={playing ? 'Pause' : 'Play'} onClick={() => setUserPaused((p) => !p)} />
        {userPaused && (
          <button className="reel-bigplay" onClick={() => setUserPaused(false)} aria-label="Play">
            <svg width="26" height="26" viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>
          </button>
        )}
      </div>
      <div className="reel-bar">
        <button className="rb-btn" onClick={() => setUserPaused((p) => !p)} aria-label={userPaused ? 'Play' : 'Pause'}>
          {userPaused || !playing ? (
            <svg width="14" height="14" viewBox="0 0 24 24"><path d="M7 4.5v15l13-7.5z" fill="currentColor" /></svg>
          ) : (
            <svg width="14" height="14" viewBox="0 0 24 24"><rect x="6" y="4.5" width="4" height="15" rx="1" fill="currentColor" /><rect x="14" y="4.5" width="4" height="15" rx="1" fill="currentColor" /></svg>
          )}
        </button>
        <div
          className="rb-track"
          role="slider"
          aria-label="Seek"
          aria-valuemin={0}
          aria-valuemax={Math.round(tl.end)}
          aria-valuenow={Math.round(t)}
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === 'ArrowRight') setT((v) => Math.min(tl.end - 0.01, v + 1));
            if (e.key === 'ArrowLeft') setT((v) => Math.max(0, v - 1));
          }}
          onPointerDown={(e) => {
            const el = e.currentTarget;
            el.setPointerCapture(e.pointerId);
            seekFromEvent(e.clientX, el);
            const move = (ev: PointerEvent) => seekFromEvent(ev.clientX, el);
            const up = () => {
              el.removeEventListener('pointermove', move);
              el.removeEventListener('pointerup', up);
            };
            el.addEventListener('pointermove', move);
            el.addEventListener('pointerup', up);
          }}
        >
          {tl.chapters.map((c, i) => {
            const next = tl.chapters[i + 1]?.start ?? tl.end;
            const w = (next - c.start) / tl.end;
            const fill = Math.max(0, Math.min(1, (t - c.start) / (next - c.start)));
            return (
              <div key={c.label} className={`rb-seg ${i === chapIdx ? 'is-cur' : ''}`} style={{ flexGrow: w }}>
                <div className="rb-seg-bar">
                  <i style={{ transform: `scaleX(${fill})` }} />
                </div>
                <span className="rb-seg-label">{c.label}</span>
              </div>
            );
          })}
        </div>
        <span className="rb-time">
          {fmtTime(t)} <em>/ {fmtTime(tl.end)}</em>
        </span>
        <button
          className="rb-btn"
          aria-label="Restart"
          onClick={() => {
            setT(0);
            setUserPaused(false);
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24"><path d="M4 12a8 8 0 1 0 2.4-5.7M4 4v4.5h4.5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </button>
        <button
          className="rb-btn rb-full"
          aria-label="Fullscreen"
          onClick={() => {
            if (document.fullscreenElement) document.exitFullscreen();
            else shell.current?.requestFullscreen?.();
          }}
        >
          <svg width="14" height="14" viewBox="0 0 24 24"><path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
        </button>
      </div>
    </div>
  );
}
