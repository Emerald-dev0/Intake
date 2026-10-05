export type User = { id: string; name: string; email: string; image?: string | null };
export type AuthenticationMethod = 'email_password' | 'google';
export type AuthenticationMethodSummary = { available: boolean; methods: AuthenticationMethod[] };

export function parseAuthenticationMethodSummary(value: unknown): AuthenticationMethodSummary | null {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (typeof row.available !== 'boolean' || !Array.isArray(row.methods) || row.methods.length > 10 ||
      !row.methods.every(method => method === 'email_password' || method === 'google')) return null;
  return { available: row.available, methods: [...new Set(row.methods)] as AuthenticationMethod[] };
}

export class ApiError extends Error {
  constructor(public status: number) { super(`API request failed (${status})`); }
}

/** Same-origin only: Vite locally and Vercel in production proxy to Express. */
export async function api<T>(path: `/api/${string}`, init?: RequestInit): Promise<T> {
  const response = await fetch(path, { ...init, credentials: 'same-origin', cache: 'no-store' });
  if (!response.ok) throw new ApiError(response.status);
  return response.json() as Promise<T>;
}
