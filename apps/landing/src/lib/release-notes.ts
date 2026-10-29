/**
 * Release notes, parsed.
 *
 * Release notes are written in a small, fixed subset of Markdown: `##` headings, paragraphs, `-`
 * bullet lists, `**bold**`, `` `code` `` and `[label](url)` links.
 *
 * The parsing lives here, apart from React, so the page and the static document that a crawler
 * reads are built from the same structure: the same sections, in the same order, with the same
 * addresses. A link to a section cannot reach an anchor the page does not have.
 */

/** A section of a release note. */
export interface ReleaseSection {
  id: string;
  title: string;
  level: 2 | 3;
}

/** The blocks a release note is made of. */
export type ReleaseBlock =
  | { kind: 'heading'; level: 2 | 3; id: string; text: string }
  | { kind: 'paragraph'; text: string }
  | { kind: 'list'; items: string[] };

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

/** Parse a release note into its blocks. */
export function parseReleaseBody(body: string): ReleaseBlock[] {
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  const sections = releaseSections(body);
  const blocks: ReleaseBlock[] = [];
  let sectionIndex = 0;
  let paragraph: string[] = [];
  let list: string[] = [];

  const flushParagraph = () => {
    if (paragraph.length === 0) return;
    const text = paragraph.join(' ').trim();
    paragraph = [];
    if (text) blocks.push({ kind: 'paragraph', text });
  };

  const flushList = () => {
    if (list.length === 0) return;
    const items = list;
    list = [];
    blocks.push({ kind: 'list', items });
  };

  for (const line of lines) {
    const heading = line.match(/^#{2,3}\s+(.+)$/);
    if (heading) {
      flushParagraph();
      flushList();
      const level: 2 | 3 = line.startsWith('###') ? 3 : 2;
      const section = sections[sectionIndex];
      sectionIndex += 1;
      blocks.push({ kind: 'heading', level, id: section?.id ?? '', text: heading[1].trim() });
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
  return blocks;
}

/** Only these targets are turned into links. Anything else is shown as plain text. */
export function isSafeHref(href: string): boolean {
  if (href.startsWith('/') && !href.startsWith('//')) return true;
  try {
    const url = new URL(href);
    return url.protocol === 'https:' || url.protocol === 'http:' || url.protocol === 'mailto:';
  } catch {
    return false;
  }
}

/** Escape a string for HTML text or an attribute value. */
export function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]!);
}

const INLINE_PATTERN = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;

/**
 * Render the inline markup of a note as HTML.
 *
 * The same rules as the React renderer: emphasis, code and links, and nothing else. A link to an
 * address that is not http, https, mailto or a same-origin path is written as plain text rather
 * than as a target somebody could be sent to.
 */
export function inlineHtml(text: string): string {
  let output = '';
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  INLINE_PATTERN.lastIndex = 0;
  while ((match = INLINE_PATTERN.exec(text)) !== null) {
    if (match.index > lastIndex) output += escapeHtml(text.slice(lastIndex, match.index));
    const token = match[0];
    if (token.startsWith('**')) {
      output += `<strong>${escapeHtml(token.slice(2, -2))}</strong>`;
    } else if (token.startsWith('`')) {
      output += `<code>${escapeHtml(token.slice(1, -1))}</code>`;
    } else {
      const linkMatch = token.match(/^\[([^\]]+)\]\(([^)\s]+)\)$/);
      const label = linkMatch?.[1] ?? '';
      const href = linkMatch?.[2] ?? '';
      if (href && isSafeHref(href)) {
        const external = !href.startsWith('/');
        const attributes = external ? ' target="_blank" rel="noreferrer noopener"' : '';
        output += `<a href="${escapeHtml(href)}"${attributes}>${escapeHtml(label)}</a>`;
      } else {
        output += escapeHtml(label);
      }
    }
    lastIndex = match.index + token.length;
  }
  if (lastIndex < text.length) output += escapeHtml(text.slice(lastIndex));
  return output;
}

/** Render a release note as HTML, for the document a crawler reads. */
export function releaseBodyHtml(body: string): string {
  const blocks = parseReleaseBody(body);
  const html: string[] = [];
  for (const block of blocks) {
    if (block.kind === 'heading') {
      const tag = block.level === 3 ? 'h3' : 'h2';
      html.push(`<${tag} id="${escapeHtml(block.id)}">${inlineHtml(block.text)}</${tag}>`);
    } else if (block.kind === 'paragraph') {
      html.push(`<p>${inlineHtml(block.text)}</p>`);
    } else {
      html.push(`<ul>${block.items.map(item => `<li>${inlineHtml(item)}</li>`).join('')}</ul>`);
    }
  }
  return html.join('\n');
}
