/**
 * Release Manager input validation.
 *
 * Everything a browser sends is treated as hostile until it has been through here. The rules are
 * deliberately boring and total: a rejected value produces a field error, never a 500, and no
 * value is ever trimmed into a shape the caller did not ask for beyond plain whitespace.
 */

import {
  RELEASE_CATEGORIES, RELEASE_LINK_LABEL_LIMIT, RELEASE_LINK_URL_LIMIT, RELEASE_SOURCE_KINDS, RELEASE_STATUSES,
  type ReleaseCategory, type ReleaseLink, type ReleaseSourceKind, type ReleaseStatus,
} from './contracts.ts';

export const SLUG_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
export const SLUG_MIN = 3;
export const SLUG_MAX = 80;
export const TITLE_MAX = 140;
export const SUMMARY_MAX = 320;
export const BODY_MAX = 20_000;
export const SHARE_TEXT_MAX = 600;
export const NOTE_MAX = 400;

export interface FieldErrors {
  [field: string]: string;
}

export type ParseResult<T> = { ok: true; value: T } | { ok: false; errors: FieldErrors };

function text(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.replace(/\r\n/g, '\n').trim();
  if (trimmed.length > max) return null;
  return trimmed;
}

export function parseSlug(raw: unknown): ParseResult<string> {
  const value = text(raw, SLUG_MAX);
  if (value === null) return { ok: false, errors: { slug: `Use a slug of at most ${SLUG_MAX} characters.` } };
  if (value.length < SLUG_MIN) return { ok: false, errors: { slug: `Use a slug of at least ${SLUG_MIN} characters.` } };
  if (!SLUG_PATTERN.test(value)) return { ok: false, errors: { slug: 'Use lowercase letters, numbers and single hyphens.' } };
  return { ok: true, value };
}

export function parseTitle(raw: unknown): ParseResult<string> {
  const value = text(raw, TITLE_MAX);
  if (value === null) return { ok: false, errors: { title: `Keep the title under ${TITLE_MAX} characters.` } };
  if (value.length < 3) return { ok: false, errors: { title: 'Give the release a title of at least 3 characters.' } };
  return { ok: true, value };
}

export function parseSummary(raw: unknown): ParseResult<string> {
  const value = text(raw, SUMMARY_MAX);
  if (value === null) return { ok: false, errors: { summary: `Keep the summary under ${SUMMARY_MAX} characters.` } };
  if (value.length < 10) return { ok: false, errors: { summary: 'Write a summary of at least 10 characters.' } };
  return { ok: true, value };
}

export function parseBody(raw: unknown): ParseResult<string> {
  if (typeof raw !== 'string') return { ok: false, errors: { body: 'Release notes must be text.' } };
  const value = raw.replace(/\r\n/g, '\n').trim();
  if (value.length > BODY_MAX) return { ok: false, errors: { body: `Keep the release notes under ${BODY_MAX} characters.` } };
  return { ok: true, value };
}

export function parseCategories(raw: unknown): ParseResult<ReleaseCategory[]> {
  if (!Array.isArray(raw)) return { ok: false, errors: { categories: 'Choose at least one category.' } };
  const unique: ReleaseCategory[] = [];
  for (const entry of raw) {
    if (typeof entry !== 'string' || !RELEASE_CATEGORIES.includes(entry as ReleaseCategory)) {
      return { ok: false, errors: { categories: 'Categories must be feature, improvement, fix or security.' } };
    }
    if (!unique.includes(entry as ReleaseCategory)) unique.push(entry as ReleaseCategory);
  }
  if (unique.length === 0) return { ok: false, errors: { categories: 'Choose at least one category.' } };
  return { ok: true, value: unique };
}

export function parseReleaseDate(raw: unknown): ParseResult<string | null> {
  if (raw === null || raw === undefined || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, errors: { releaseDate: 'Use a date in YYYY-MM-DD form.' } };
  const value = raw.trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return { ok: false, errors: { releaseDate: 'Use a date in YYYY-MM-DD form.' } };
  const parsed = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime())) return { ok: false, errors: { releaseDate: 'That date does not exist.' } };
  return { ok: true, value };
}

export function parseLinks(raw: unknown): ParseResult<ReleaseLink[]> {
  if (raw === undefined || raw === null) return { ok: true, value: [] };
  if (!Array.isArray(raw)) return { ok: false, errors: { links: 'Links must be a list.' } };
  if (raw.length > 12) return { ok: false, errors: { links: 'Use at most 12 links.' } };
  const links: ReleaseLink[] = [];
  for (const entry of raw) {
    if (!entry || typeof entry !== 'object') return { ok: false, errors: { links: 'Each link needs a label and a URL.' } };
    const row = entry as Record<string, unknown>;
    const label = text(row.label, RELEASE_LINK_LABEL_LIMIT);
    const url = text(row.url, RELEASE_LINK_URL_LIMIT);
    if (!label || !url) return { ok: false, errors: { links: 'Each link needs a label and a URL.' } };
    if (!isSafeLink(url)) return { ok: false, errors: { links: `“${label}” does not use an http, https or mailto URL.` } };
    links.push({ label, url });
  }
  return { ok: true, value: links };
}

/** Only absolute http(s) and mailto links are ever rendered, so a link cannot carry `javascript:`. */
export function isSafeLink(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' || parsed.protocol === 'http:' || parsed.protocol === 'mailto:';
  } catch {
    return false;
  }
}

export function parseHeroImageUrl(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, errors: { heroImageUrl: 'Use an absolute https image URL.' } };
  const value = raw.trim();
  if (value.length > 500) return { ok: false, errors: { heroImageUrl: 'Keep the image URL under 500 characters.' } };
  try {
    const parsed = new URL(value);
    if (parsed.protocol !== 'https:') return { ok: false, errors: { heroImageUrl: 'Use an absolute https image URL.' } };
  } catch {
    return { ok: false, errors: { heroImageUrl: 'Use an absolute https image URL.' } };
  }
  return { ok: true, value };
}

export function parseShareText(raw: unknown): ParseResult<string | null> {
  if (raw === undefined || raw === null || raw === '') return { ok: true, value: null };
  if (typeof raw !== 'string') return { ok: false, errors: { shareText: 'Share text must be text.' } };
  const value = raw.replace(/\r\n/g, '\n').trim();
  if (value.length > SHARE_TEXT_MAX) return { ok: false, errors: { shareText: `Keep the share text under ${SHARE_TEXT_MAX} characters.` } };
  return { ok: true, value };
}

export function parseStatus(raw: unknown): ReleaseStatus | null {
  return typeof raw === 'string' && RELEASE_STATUSES.includes(raw as ReleaseStatus) ? (raw as ReleaseStatus) : null;
}

export function parseSourceKind(raw: unknown): ReleaseSourceKind | null {
  return typeof raw === 'string' && RELEASE_SOURCE_KINDS.includes(raw as ReleaseSourceKind) ? (raw as ReleaseSourceKind) : null;
}

export function parseNote(raw: unknown): string | null {
  if (raw === undefined || raw === null || raw === '') return null;
  const value = text(raw, NOTE_MAX);
  return value === null ? null : value;
}

/**
 * Placeholder marker left in a generated draft. A release that still contains it is not ready to
 * publish, and the server refuses rather than shipping an unfinished announcement.
 */
export const TODO_MARKER = 'TODO';

export function hasTodoMarker(body: string): boolean {
  return new RegExp(`\\b${TODO_MARKER}\\b`).test(body);
}
