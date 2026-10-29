import { type ReactNode } from 'react';
import { isSafeHref, parseReleaseBody, releaseSectionId, releaseSections } from './release-notes';

/**
 * The renderer for release notes.
 *
 * Release notes are written in a small, fixed subset of Markdown: `##` headings, paragraphs, `-`
 * bullet lists, `**bold**`, `` `code` `` and `[label](url)` links. Rendering them into React
 * elements rather than into an HTML string means a release can never inject markup: there is no
 * `dangerouslySetInnerHTML` anywhere near the changelog, and a link that is not http, https,
 * mailto or a same-origin path is shown as plain text instead of being turned into a clickable
 * target.
 *
 * The parsing itself lives in `release-notes.ts`, so the document a crawler reads is built from
 * the same structure as this page.
 */

export { releaseSectionId, releaseSections };

function renderInline(text: string, keyPrefix: string): ReactNode[] {
  const nodes: ReactNode[] = [];
  const pattern = /(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\([^)\s]+\))/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;
  let index = 0;
  while ((match = pattern.exec(text)) !== null) {
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

export interface ReleaseMarkdownProps {
  body: string;
  className?: string;
}

/** Render release notes into semantic HTML: headings, lists, paragraphs and inline emphasis. */
export function ReleaseMarkdown({ body, className }: ReleaseMarkdownProps) {
  const blocks = parseReleaseBody(body);
  const nodes: ReactNode[] = [];

  blocks.forEach((block, position) => {
    if (block.kind === 'heading') {
      const Tag = block.level === 3 ? 'h3' : 'h2';
      nodes.push(
        <Tag key={`b${position}`} id={block.id}>
          {renderInline(block.text, `h${position}`)}
        </Tag>,
      );
    } else if (block.kind === 'paragraph') {
      nodes.push(<p key={`b${position}`}>{renderInline(block.text, `p${position}`)}</p>);
    } else {
      nodes.push(
        <ul key={`b${position}`}>
          {block.items.map((item, itemPosition) => (
            <li key={`li${itemPosition}`}>{renderInline(item, `li${position}-${itemPosition}`)}</li>
          ))}
        </ul>,
      );
    }
  });

  return <div className={className}>{nodes}</div>;
}
