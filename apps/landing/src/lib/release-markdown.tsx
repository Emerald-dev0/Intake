import { type ReactNode } from 'react';

/**
 * The renderer for release notes.
 *
 * Release notes are written in a small, fixed subset of Markdown: `##` headings, paragraphs, `-`
 * bullet lists, `**bold**`, `` `code` `` and `[label](url)` links. Rendering them into React
 * elements rather than into an HTML string means a release can never inject markup: there is no
 * `dangerouslySetInnerHTML` anywhere near the changelog, and a link that is not http, https,
 * mailto or a same-origin path is shown as plain text instead of being turned into a clickable
 * target.
 */

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

function isSafeHref(href: string): boolean {
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  let index = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) nodes.push(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      nodes.push(<strong key={`${keyPrefix}-b${index}`}>{token.slice(2, -2)}</strong>);
    } else if (token.startsWith('`')) {
      nodes.push(<code key={`${keyPrefix}-c${index}`}>{token.slice(1, -1)}</code>);
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const label = linkMatch?.[1] ?? '';
      const href = linkMatch?.[2] ?? '';
      if (href && isSafeHref(href)) {
        const external = !href.startsWith('/');
        nodes.push(
          <a key={`${keyPrefix}-l${index}`} href={href} {...(external ? { target: '_blank', rel: 'noreferrer noopener' } : {})}>
            {label}
          </a>,
        );
      } else {
        nodes.push(label);
      }
    }
    lastIndex = match.index + token.length;
    index += 1;
  }
  if (lastIndex < text.length) nodes.push(text.slice(lastIndex));
  return nodes;
}

/**
 * A section of a release note.
 *
 * The notes are a set of `##` sections, and a release page gives each one an address so a long
 * entry can be linked to by section and read in pieces.
 */
export interface ReleaseSection {
  id: string;
  title: string;
  level: 2 | 3;
}

/** The address of a section: a readable slug of its heading. */
export function releaseSectionId(title: string): string {
  const base = title
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[*`]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 80)
    .replace(/-+$/g, '');
  return base || 'section';
}

/**
 * The sections of a release note, in the order they appear.
 *
 * The renderer and the table of contents both read this, so an anchor and its link can never
 * disagree. A repeated heading gets a numbered address rather than a duplicate one.
 */
export function releaseSections(body: string): ReleaseSection[] {
  const seen = new Map<string, number>();
  const sections: ReleaseSection[] = [];
  for (const line of body.replace(/\r\n/g, '\n').split('\n')) {
    const heading = line.match(/^(#{2,3})\s+(.+)$/);
    if (!heading) continue;
    const title = heading[2].trim();
    const level: 2 | 3 = heading[1].length === 3 ? 3 : 2;
    const base = releaseSectionId(title);
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    sections.push({ id: count === 0 ? base : `${base}-${count + 1}`, title, level });
  }
  return sections;
}

export interface ReleaseMarkdownProps {
  body: string;
  className?: string;
}

/** Render release notes into semantic HTML: headings, lists, paragraphs and inline emphasis. */
export function ReleaseMarkdown({ body, className }: ReleaseMarkdownProps) {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const blocks: ReactNode[] = [];
  // The same source the table of contents reads, so an anchor always has a link that reaches it.
  const sections = releaseSections(body);
  let sectionIndex = 0;
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push(<p key={`p${blocks.length}`}>{renderInline(text, `p${blocks.length}`)}</p>);
  };

  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push(
      <ul key={`ul${blocks.length}`}>
        {items.map((item, position) => <li key={`li${position}`}>{renderInline(item, `li${position}`)}</li>)}
      </ul>,
    );
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level = line.startsWith('###') ? 3 : 2;
      const Tag = level === 3 ? 'h3' : 'h2';
      const section = sections[sectionIndex];
      sectionIndex += 1;
      blocks.push(
        <Tag key={`h${blocks.length}`} id={section?.id}>
          {renderInline(heading[1], `h${blocks.length}`)}
        </Tag>,
      );
      continue;
    }
    const bullet = line.match(/^[-*]\s+(.+)$/);
    if (bullet) {
      flushParagraph();
      list.push(bullet[1]);
      continue;
    }
    if (!line.trim()) {
      flushParagraph();
      flushList();
      continue;
    }
    flushList();
    paragraph.push(line.trim());
  }
  flushParagraph();
  flushList();

  return <div className={className}>{blocks}</div>;
}
