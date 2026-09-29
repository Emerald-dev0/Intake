export type User = { id: string; name: string; email: string; image?: string | null };

export class ApiError extends Error {
  constructor(public status: number) { super(`API request failed (${status})`); }
}

/** Same-origin only: Vite locally and Vercel in production proxy to Express. */
export async function api<T>(path: `/api/${string}`, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
