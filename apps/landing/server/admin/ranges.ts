import type { AdminRange, RangeBounds } from './contracts';

export function parseRange(value: unknown): AdminRange | null {
  return value === 'today' || value === '7d' || value === '30d' ? value : null;
}

/** All reporting cutoffs use UTC, regardless of the host/database session timezone. */
export function rangeBounds(range: AdminRange, now = new Date()): RangeBounds {
  const to = new Date(now);
  const todayStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), to.getUTCDate()));
  const weekStart = new Date(todayStart);
  const daysSinceMonday = (weekStart.getUTCDay() + 6) % 7;
  weekStart.setUTCDate(weekStart.getUTCDate() - daysSinceMonday);
  const monthStart = new Date(Date.UTC(to.getUTCFullYear(), to.getUTCMonth(), 1));
  const from = new Date(range === 'today' ? todayStart : to);
  if (range === '7d') from.setUTCDate(from.getUTCDate() - 7);
  if (range === '30d') from.setUTCDate(from.getUTCDate() - 30);
  return { range, from, to, todayStart, weekStart, monthStart };
}

export function parsePage(value: unknown, fallback = 1): number | null {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{1,6}$/.test(value)) return null;
  const page = Number(value);
  return Number.isSafeInteger(page) && page >= 1 && page <= 10_000 ? page : null;
}

export function parseLimit(value: unknown, fallback = 25): number | null {
  if (value === undefined || value === '') return fallback;
  if (typeof value !== 'string' || !/^\d{1,3}$/.test(value)) return null;
  const limit = Number(value);
  return [10, 25, 50, 100].includes(limit) ? limit : null;
}

export function parseAdminPage(query: Record<string, unknown>): { page: number; limit: number; offset: number } | null {
  const page = parsePage(query.page);
  const limit = parseLimit(query.limit);
  if (page === null || limit === null) return null;
  return { page, limit, offset: (page - 1) * limit };
}

export function boundedText(value: unknown, max: number): string | null {
  if (value === undefined) return '';
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value.trim();
}

export function positiveId(value: unknown, max = 255): string | null {
  if (typeof value !== 'string' || value.length < 1 || value.length > max || /[\u0000-\u001f\u007f]/.test(value)) return null;
  return value;
}

export function pageResult<T>(items: T[], total: number, page: number, pageSize: number) {
  return {
    items,
    page,
    pageSize,
    total,
    totalPages: Math.ceil(total / pageSize),
  };
}
