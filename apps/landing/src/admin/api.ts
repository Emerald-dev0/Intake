export class AdminApiError extends Error {
  constructor(readonly status: number, message = 'Admin request failed.') {
    super(message);
    this.name = 'AdminApiError';
  }
}

export async function adminApi<T>(path: `/api/admin${string}`): Promise<T> {
  const response = await fetch(path, {
    credentials: 'same-origin',
    cache: 'no-store',
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    const body = await response.json().catch(() => null) as { error?: unknown } | null;
    const message = typeof body?.error === 'string' ? body.error : 'The admin service could not complete this request.';
    throw new AdminApiError(response.status, message);
  }
  return response.json() as Promise<T>;
}
