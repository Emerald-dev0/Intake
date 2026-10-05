import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { parseCreditCostGuide, parseCredits, type PublicCreditCostGuide, type PublicCredits } from '../../lib/credits';

type State =
  | { status: 'loading' | 'error'; credits: null; costGuide: null }
  | { status: 'ready'; credits: PublicCredits; costGuide: PublicCreditCostGuide | null };

const CreditsContext = createContext<{ state: State; reload: () => void; note: (value: unknown) => void } | null>(null);

export function useCredits() {
  const value = useContext(CreditsContext);
  if (!value) throw new Error('useCredits requires CreditsProvider');
  return value;
}

/**
 * Credit state for the workspace. Balances and public cost guidance come from the server. This
 * provider adopts the authoritative balance returned with AI operations and never computes a charge.
 */
export function useCreditsSource(): { state: State; reload: () => void; note: (value: unknown) => void } {
  const [state, setState] = useState<State>({ status: 'loading', credits: null, costGuide: null });
  const generation = useRef(0);

  const reload = useCallback(() => {
    const current = ++generation.current;
    void (async () => {
      try {
        const response = await fetch('/api/credits', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
        const payload = await response.json().catch(() => null);
        if (current !== generation.current) return;
        const credits = response.ok ? parseCredits(payload) : null;
        const costGuide = response.ok ? parseCreditCostGuide(payload) : null;
        setState(credits ? { status: 'ready', credits, costGuide } : { status: 'error', credits: null, costGuide: null });
      } catch {
        if (current === generation.current) setState({ status: 'error', credits: null, costGuide: null });
      }
    })();
  }, []);

  const note = useCallback((value: unknown) => {
    const parsed = parseCredits(value);
    // A server-provided balance is authoritative; ignore anything unreadable.
    if (parsed) setState(current => ({
      status: 'ready',
      credits: parsed,
      costGuide: current.status === 'ready' ? current.costGuide : null,
    }));
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
