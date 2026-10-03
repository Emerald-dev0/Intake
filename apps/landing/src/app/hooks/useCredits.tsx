import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { parseCredits, type PublicCredits } from '../../lib/credits';

type State = { status: 'loading' | 'error'; credits: null } | { status: 'ready'; credits: PublicCredits };

const CreditsContext = createContext<{ state: State; reload: () => void; note: (value: unknown) => void } | null>(null);

export function useCredits() {
  const value = useContext(CreditsContext);
  if (!value) throw new Error('useCredits requires CreditsProvider');
  return value;
}

/**
 * Credit state for the workspace. The balance always comes from the server: this provider only reads
 * it, and adopts the balance that successful AI operations return so the sidebar stays current
 * without a second round trip.
 */
export function useCreditsSource(): { state: State; reload: () => void; note: (value: unknown) => void } {
  const [state, setState] = useState<State>({ status: 'loading', credits: null });
  const generation = useRef(0);

  const reload = useCallback(() => {
    const current = ++generation.current;
    void (async () => {
      try {
        const response = await fetch('/api/credits', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
        const parsed = parseCredits(await response.json().catch(() => null));
        if (current !== generation.current) return;
        setState(parsed ? { status: 'ready', credits: parsed } : { status: 'error', credits: null });
      } catch {
        if (current === generation.current) setState({ status: 'error', credits: null });
      }
    })();
  }, []);

  const note = useCallback((value: unknown) => {
    const parsed = parseCredits(value);
    // A server-provided balance is authoritative; ignore anything unreadable.
    if (parsed) setState({ status: 'ready', credits: parsed });
  }, []);

  useEffect(() => {
    reload();
    const refresh = () => { void reload(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [reload]);

  return { state, reload, note };
}

export const CreditsProvider = CreditsContext.Provider;
