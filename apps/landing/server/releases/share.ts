/**
 * Share copy for a published release.
 *
 * The composer is deliberately dull: it takes what the administrator already wrote, states the
 * benefit in one sentence, and appends the permanent changelog URL. It never invents a claim, never
 * adds a hashtag the product does not use, and never claims something shipped that the release
 * notes do not say. The result is editable before it is copied, and the copy action only reports
 * success when the clipboard actually accepted the text.
 */

/** Longest single post we will produce without truncating the link. */
export const SHARE_MAX_LENGTH = 280;

export interface ShareCopyInput {
  title: string;
  summary: string;
  /** The permanent changelog URL. It is never shortened or wrapped. */
  url: string;
}

export interface ShareCopy {
  text: string;
  /** True when the copy fits a single post without being cut. */
  withinLimit: boolean;
  length: number;
}

/** Sentence-ending punctuation is kept; a trailing period is not doubled. */
function firstSentence(value: string): string {
  const cleaned = value.replace(/\s+/g, ' ').trim();
  const match = cleaned.match(/^(.+?[.!?])(\s|$)/);
  if (match) return match[1].trim();
  return cleaned;
}

export function buildShareCopy(input: ShareCopyInput): ShareCopy {
  const title = input.title.replace(/\s+/g, ' ').trim();
  const benefit = firstSentence(input.summary);
  const url = input.url.trim();

  const parts = [title];
  if (benefit && benefit.toLowerCase() !== title.toLowerCase()) parts.push(benefit);
  parts.push(url);
  const text = parts.join('\n\n');

  return { text, withinLimit: text.length <= SHARE_MAX_LENGTH, length: text.length };
}

/**
 * Shorten the copy so it fits a single post. The URL is never touched; only the benefit sentence
 * is trimmed, and only at a word boundary.
 */
export function buildShareCopyWithinLimit(input: ShareCopyInput): ShareCopy {
  const copy = buildShareCopy(input);
  if (copy.withinLimit) return copy;
  const suffix = `\n\n${input.url.trim()}`;
  const title = input.title.replace(/\s+/g, ' ').trim();
  const benefit = firstSentence(input.summary);
  const budget = SHARE_MAX_LENGTH - suffix.length - title.length - 2;
  if (budget <= 0) {
    const trimmed = `${title}${suffix}`;
    return { text: trimmed, withinLimit: trimmed.length <= SHARE_MAX_LENGTH, length: trimmed.length };
  }
  const words = benefit.split(' ');
  let kept = '';
  for (const word of words) {
    const candidate = kept ? `${kept} ${word}` : word;
    if (candidate.length > budget) break;
    kept = candidate;
  }
  const trimmed = kept ? `${title}\n\n${kept}${suffix}` : `${title}${suffix}`;
  return { text: trimmed, withinLimit: trimmed.length <= SHARE_MAX_LENGTH, length: trimmed.length };
}
