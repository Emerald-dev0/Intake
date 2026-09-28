import type { Highlight } from '../lib/types';

export interface Span {
  start: number;
  end: number;
  h: Highlight;
  i: number;
}

/** Locate highlight substrings sequentially inside text (case-insensitive). */
export function locate(text: string, hls: Highlight[]): Span[] {
  const lower = text.toLowerCase();
  const out: Span[] = [];
  let cursor = 0;
  hls.forEach((h, i) => {
    const needle = h.text.toLowerCase();
    let at = lower.indexOf(needle, cursor);
    if (at === -1) at = lower.indexOf(needle);
    if (at === -1) return;
    if (out.some((s) => at < s.end && at + needle.length > s.start)) return;
    out.push({ start: at, end: at + needle.length, h, i });
    cursor = at + needle.length;
  });
  return out.sort((a, b) => a.start - b.start);
}

export function Highlighted({
  text,
  highlights,
  active,
  showTags = false,
}: {
  text: string;
  highlights: Highlight[];
  /** index-based activation; if omitted all are active */
  active?: (i: number) => boolean;
  showTags?: boolean;
}) {
  const spans = locate(text, highlights);
  const parts: React.ReactNode[] = [];
  let pos = 0;
  spans.forEach((s, k) => {
    if (s.start > pos) parts.push(<span key={`t${k}`}>{text.slice(pos, s.start)}</span>);
    const on = active ? active(s.i) : true;
    parts.push(
      <mark key={`h${k}`} className={`hl hl-${s.h.kind} ${on ? 'is-on' : ''}`}>
        {showTags && <span className="hl-tag">{s.h.tag}</span>}
        {text.slice(s.start, s.end)}
      </mark>,
    );
    pos = s.end;
  });
  if (pos < text.length) parts.push(<span key="end">{text.slice(pos)}</span>);
  return <>{parts}</>;
}
