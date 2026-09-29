import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { api, ApiError, type User } from '../../lib/api';
import { SessionContext } from '../hooks/useSession';
import { LogoMark } from '../../reel/parts';

type State = { status: 'loading' | 'error' | 'signed-out' } | { status: 'ready'; user: User };
export function ProtectedLayout() {
  const [state, setState] = useState<State>({ status: 'loading' });
  const generation = useRef(0);
  const clearSession = useCallback(() => {
    generation.current++;
    setState({ status: 'signed-out' });
  }, []);
  const load = useCallback(async () => {
    const current = ++generation.current;
    setState({ status: 'loading' });
    try {
      const { user } = await api<{ user: User }>('/api/me');
      if (current === generation.current) setState({ status: 'ready', user });
    } catch (error) {
      if (current === generation.current) setState({ status: error instanceof ApiError && error.status === 401 ? 'signed-out' : 'error' });
    }
  }, []);
  useEffect(() => {
    void load();
    // Revalidate when returning from another tab or browser back/forward cache.
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
    };
  }, [load]);
  if (state.status === 'signed-out') return <Navigate to="/auth/sign-in" replace />;
  if (state.status !== 'ready') return <div className="workspace-status"><a href="/" className="app-logo"><LogoMark size={28} /><span>intake</span></a>{state.status === 'loading' ? <p role="status">Opening your workspace…</p> : <div role="alert"><p>We couldn’t verify your session right now.</p><button className="btn btn-accent" onClick={() => void load()}>Try again</button></div>}</div>;
  return <SessionContext.Provider value={{ user: state.user, clearSession }}><Outlet /></SessionContext.Provider>;
}
