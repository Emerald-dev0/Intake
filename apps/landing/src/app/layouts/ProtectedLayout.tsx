import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api, ApiError, parseAuthenticationMethodSummary, type AuthenticationMethodSummary, type User } from '../../lib/api';
import { SessionContext } from '../hooks/useSession';
import { IntakeLoader } from '../../components/IntakeLoader';
import { LogoMark } from '../../components/LogoMark';

type State = { status: 'loading' | 'error' | 'signed-out' } | { status: 'ready'; user: User; authenticationMethods: AuthenticationMethodSummary | null };
export function ProtectedLayout() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const generation = useRef(0);
  const clearSession = useCallback(() => {
    generation.current++;
    setState({ status: 'signed-out' });
  }, []);
  const load = useCallback(async (background = false) => {
    const current = ++generation.current;
    // Background revalidation (tab focus, back/forward cache) must never flash
    // the loader over a working workspace: the current screen stays until the
    // check either confirms it or proves the session is gone.
    if (!background) setState({ status: 'loading' });
    try {
      const payload = await api<{ user: User; authenticationMethods?: unknown }>('/api/me');
      if (current === generation.current) setState({
        status: 'ready',
        user: payload.user,
        authenticationMethods: parseAuthenticationMethodSummary(payload.authenticationMethods),
      });
    } catch (error) {
      if (current === generation.current) {
        if (error instanceof ApiError && error.status === 401) {
          setState({ status: 'signed-out' });
        } else if (!background) {
          setState({ status: 'error' });
        }
        // A background check that fails without a 401 leaves the workspace
        // alone: a blip must not log anyone out or blank their screen.
      }
    }
  }, []);
  useEffect(() => {
    void load();
    // Revalidate when returning from another tab or browser back/forward cache.
    const refresh = () => { void load(true); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [load]);
  if (state.status === 'signed-out') return <Navigate to="/auth/sign-in" replace />;
  if (state.status !== 'ready') return <div className="workspace-status"><a href="/" className="app-logo"><LogoMark size={28} /><span>intake</span></a>{state.status === 'loading' ? <IntakeLoader label="Opening your workspace…" /> : <div role="alert"><p>We couldn’t verify your session right now.</p><button className="btn btn-accent" onClick={() => void load()}>Try again</button></div>}</div>;
  return <SessionContext.Provider value={{ user: state.user, authenticationMethods: state.authenticationMethods, clearSession }}><Outlet /></SessionContext.Provider>;
}
