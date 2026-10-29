/**
 * Turning real pull-request context into a changelog draft.
 *
 * The draft is assembled from what GitHub already knows — the title, the description, the labels
 * and the files that changed — and nothing else. It never invents a benefit, a metric or a
 * feature. Where the pull request does not say something, the draft says `TODO` and the server
 * refuses to publish until a person writes the real sentence.
 */

import { RELEASE_LABEL_PREFIX, type ReleaseCategory } from './contracts.ts';
import type { GitHubPullRequest } from './github.ts';

export interface DraftResult {
  title: string;
  summary: string;
  body: string;
  categories: ReleaseCategory[];
  /** Plain explanation of how the categories were chosen, shown to the administrator. */
  classification: string;
  /** Every source line the draft used, so the administrator can check it against the pull request. */
  context: string[];
}

const SECTION_ORDER = ['What changed', 'Why it matters', 'How to use it', 'Limitations and availability'];

const LABEL_TO_CATEGORY: Record<string, ReleaseCategory> = {
  'release:feature': 'feature',
  'release:improvement': 'improvement',
  'release:fix': 'fix',
  'release:security': 'security',
};

export function categoriesFromLabels(labels: string[]): { categories: ReleaseCategory[]; note: string } {
  const matched: ReleaseCategory[] = [];
  for (const label of labels) {
    const category = LABEL_TO_CATEGORY[label.trim().toLowerCase()];
    if (category && !matched.includes(category)) matched.push(category);
  }
  if (matched.length > 0) {
    const names = matched.map(category => `release:${category}`).join(', ');
    return { categories: matched, note: `Classified from the pull request labels (${names}).` };
  }
  return {
    categories: ['improvement'],
    note: `No ${RELEASE_LABEL_PREFIX}* label was on the pull request, so this draft is marked as an improvement. Change the category if that is wrong.`,
  };
}

/** The first paragraph of the pull request body, or the title when there is no body. */
export function summaryFromPullRequest(pull: GitHubPullRequest): string {
  const body = pull.body.replace(/\r\n/g, '\n').trim();
  if (!body) return `${pull.title}.`;
  const paragraph = body.split(/\n\s*\n/).map(part => part.trim()).find(part => part && !part.startsWith('#') && !part.startsWith('```'));
  const candidate = (paragraph ?? body).replace(/^#+\s*/gm, '').replace(/\s+/g, ' ').trim();
  if (!candidate) return `${pull.title}.`;
  return candidate.length > 320 ? `${candidate.slice(0, 317).trimEnd()}…` : candidate;
}

function splitSections(body: string): Map<string, string> {
  const sections = new Map<string, string>();
  const lines = body.replace(/\r\n/g, '\n').split('\n');
  let current: string | null = null;
  let buffer: string[] = [];
  const flush = () => {
    if (current) sections.set(current, buffer.join('\n').trim());
    buffer = [];
  };
  for (const line of lines) {
    const heading = line.match(/^#{1,6}\s+(.+?)\s*$/);
    if (heading) {
      flush();
      current = heading[1].replace(/[:*_`]+$/g, '').trim();
      continue;
    }
    buffer.push(line);
  }
  flush();
  return sections;
}

/** A readable section name for a heading that is close to one of ours. */
function matchSection(heading: string): string | null {
  const value = heading.toLowerCase();
  for (const section of SECTION_ORDER) {
    const target = section.toLowerCase();
    if (value === target || value.startsWith(`${target} `) || value.startsWith(`${target}:`)) return section;
  }
  if (value.startsWith('what')) return 'What changed';
  if (value.startsWith('why')) return 'Why it matters';
  if (value.startsWith('how')) return 'How to use it';
  if (value.startsWith('limit') || value.startsWith('availab')) return 'Limitations and availability';
  return null;
}

export function buildDraft(pull: GitHubPullRequest): DraftResult {
  const { categories, note } = categoriesFromLabels(pull.labels);
  const sections = splitSections(pull.body);
  const mapped = new Map<string, string>();
  for (const [heading, content] of sections) {
    const match = matchSection(heading);
    if (match && !mapped.has(match)) mapped.set(match, content);
  }

  const parts: string[] = [];
  for (const section of SECTION_ORDER) {
    const existing = mapped.get(section);
    const content = existing && existing.trim() ? existing.trim() : 'TODO — write this section before publishing.';
    parts.push(`## ${section}\n${content}`);
  }

  const context: string[] = [
    `Pull request #${pull.number}${pull.merged ? ' (merged)' : ` (${pull.state})`}`,
    `Author: ${pull.author || 'unknown'}`,
    `${pull.changedFiles} file(s) changed, +${pull.additions}/-${pull.deletions}`,
  ];
  if (pull.labels.length > 0) context.push(`Labels: ${pull.labels.join(', ')}`);
  if (pull.files.length > 0) context.push(`Files: ${pull.files.slice(0, 12).join(', ')}${pull.files.length > 12 ? `, +${pull.files.length - 12} more` : ''}`);

  return {
    title: pull.title.trim() || 'Untitled release',
    summary: summaryFromPullRequest(pull),
    body: parts.join('\n\n'),
    categories,
    classification: note,
    context,
  };
}

/** A draft written by hand from a title alone, for the case where no pull request exists. */
export function buildManualDraft(title: string, summary: string): DraftResult {
  const body = SECTION_ORDER
    .map(section => `## ${section}\n${section === 'What changed' ? 'TODO — describe the change.' : 'TODO — write this section before publishing.'}`)
    .join('\n\n');
  return {
    title: title.trim(),
    summary: summary.trim(),
    body,
    categories: ['improvement'],
    classification: 'Written by hand. Choose the category that matches the change.',
    context: ['No pull request is linked to this release.'],
  };
}
