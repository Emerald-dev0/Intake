export class AdminApiError extends Error {
  constructor(
    readonly status: number,
    message = 'Admin request failed.',
    /** Machine-readable code the server attached, e.g. `recipient_count_changed`. */
    readonly code: string | null = null,
    /** Per-field validation messages, when the server rejected a form rather than a session. */
    readonly fieldErrors: Record<string, string> = {},
  ) {
    super(message);
    this.name = 'AdminApiError';
  }
}

interface ErrorBody {
  error?: unknown;
  message?: unknown;
  fieldErrors?: unknown;
}

function fieldErrorsOf(value: unknown): Record<string, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {};
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === 'string'),
  );
}

async function failure(response: Response, fallback: string): Promise<AdminApiError> {
  const body = await response.json().catch(() => null) as ErrorBody | null;
  const message = typeof body?.message === 'string'
    ? body.message
    : typeof body?.error === 'string' ? body.error : fallback;
  const code = typeof body?.error === 'string' ? body.error : null;
  return new AdminApiError(response.status, message, code, fieldErrorsOf(body?.fieldErrors));
}

export async function adminApi<T>(path: `/api/admin${string}`): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) throw await failure(response, 'The admin service could not complete this request.');
  return response.json() as Promise<T>;
}

/**
 * A write from the operator console.
 *
 * Every admin write is still a POST with a JSON body that the server validates from scratch; nothing
 * here is trusted because it came from the dashboard. Errors keep the server's code and field
 * messages so the form can point at the field that was actually refused.
 */
export async function adminPost<T>(path: `/api/admin${string}`, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'POST',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response, 'The admin service could not complete this request.');
  return response.json() as Promise<T>;
}

/**
 * An update.
 *
 * A few admin resources are updated rather than replaced, and the server exposes those as PUT.
 * The body is validated from scratch exactly as a POST body is — the method says what the request
 * means, not how much the server trusts it.
 */
export async function adminPut<T>(path: `/api/admin${string}`, body: unknown): Promise<T> {
  const response = await fetch(path, {
    method: 'PUT',
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json', 'content-type': 'application/json' },
    body: JSON.stringify(body),
  });
  if (!response.ok) throw await failure(response, 'The admin service could not complete this request.');
  return response.json() as Promise<T>;
}
