import { useEffect, useState } from 'react';

function hasAuthenticatedUser(value: unknown): boolean {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const user = (value as Record<string, unknown>).user;
  if (typeof user !== 'object' || user === null || Array.isArray(user)) return false;
  const id = (user as Record<string, unknown>).id;
  return typeof id === 'string' && id.length > 0;
}

/**
 * Read only the server's existing session endpoint to choose a sensible public-page CTA.
 * This is a presentation hint, not a second auth store; /app continues to enforce the session.
 */
export function usePublicSession(): boolean {
  const [authenticated, setAuthenticated] = useState(false);

  useEffect(() => {
    const controller = new AbortController();
    let mounted = true;

    async function checkSession() {
      try {
        const response = await fetch('/api/me', {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
          signal: controller.signal,
        });
        if (!response.ok) return;
        const payload: unknown = await response.json();
        if (mounted) setAuthenticated(hasAuthenticatedUser(payload));
      } catch {
        // An unavailable session check leaves the public page usable as a signed-out visitor.
      }
    }

    void checkSession();
    return () => {
      mounted = false;
      controller.abort();
    };
  }, []);

  return authenticated;
}
