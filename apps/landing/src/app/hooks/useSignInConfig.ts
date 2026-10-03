import { useEffect, useState } from 'react';

export type GoogleSignInState =
  | { status: 'loading' }
  | { status: 'available' }
  | { status: 'unavailable'; reason: 'not_configured' | 'unreachable' };

/**
 * Asks the server whether Google sign-in is configured before rendering a button that could not
 * complete. Nothing here is a credential: the endpoint returns a boolean.
 */
export function useSignInConfig(): GoogleSignInState {
  const [state, setState] = useState<GoogleSignInState>({ status: 'loading' });
  useEffect(() => {
    const controller = new AbortController();
    void (async () => {
      try {
        const response = await fetch('/api/sign-in/config', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' }, signal: controller.signal });
        const body = await response.json().catch(() => null) as unknown;
        const configured = response.ok && typeof body === 'object' && body !== null && (body as { providers?: { google?: unknown } }).providers?.google === true;
        if (!controller.signal.aborted) setState(configured ? { status: 'available' } : { status: 'unavailable', reason: 'not_configured' });
      } catch {
        if (!controller.signal.aborted) setState({ status: 'unavailable', reason: 'unreachable' });
      }
    })();
    return () => controller.abort();
  }, []);
  return state;
}
