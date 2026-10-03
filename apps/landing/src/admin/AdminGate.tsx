import { useCallback, useEffect, useRef, useState } from 'react';
import { Navigate, Outlet } from 'react-router-dom';
import { AdminApiError, adminApi } from './api';
import { AdminContext, type AdminIdentity } from './context';

export function AdminGate() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'signed-out' }
    | { status: 'forbidden' }
    | { status: 'error' }
    | { status: 'ready'; admin: AdminIdentity }
  >({ status: 'loading' });
  const generation = useRef(0);

  const load = useCallback(async () => {
    const current = ++generation.current;
    setState({ status: 'loading' });
    try {
      const response = await adminApi<{ admin: AdminIdentity }>('/api/admin/access');
      if (current === generation.current) setState({ status: 'ready', admin: response.admin });
    } catch (error) {
      if (current !== generation.current) return;
      if (error instanceof AdminApiError && error.status === 401) setState({ status: 'signed-out' });
      else if (error instanceof AdminApiError && error.status === 403) setState({ status: 'forbidden' });
      else setState({ status: 'error' });
    }
  }, []);

  useEffect(() => {
    const originalTitle = document.title;
    document.title = 'Internal operations · Intake';
    let robots = document.querySelector<HTMLMetaElement>('meta[name="robots"]');
    const insertedRobots = !robots;
    if (!robots) {
      robots = document.createElement('meta');
      robots.name = 'robots';
      document.head.append(robots);
    }
    const previousRobots = robots.content;
    robots.content = 'noindex, nofollow, noarchive';
    void load();
    const refresh = () => { void load(); };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    return () => {
      generation.current++;
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.title = originalTitle;
      if (insertedRobots) robots?.remove();
      else if (robots) robots.content = previousRobots;
    };
  }, [load]);

  if (state.status === 'signed-out') return <Navigate to="/auth/sign-in?redirect=%2Fadmin" replace />;
  if (state.status === 'loading') return <AdminGateState title="Verifying administrator access" detail="Intake checks your current session and server-side admin allowlist." />;
  if (state.status === 'forbidden') return <AdminGateState title="Administrator access required" detail="This account is not authorized to use Intake’s internal operations area." />;
  if (state.status === 'error') return <AdminGateState title="Couldn’t verify access" detail="The administrator check is temporarily unavailable. No admin data was loaded." retry={() => void load()} />;
  return <AdminContext.Provider value={state.admin}><Outlet /></AdminContext.Provider>;
}

function AdminGateState({ title, detail, retry }: { title: string; detail: string; retry?: () => void }) {
  return (
    <main className="admin-gate-state">
      <span className="admin-overline">INTAKE / INTERNAL</span>
      <h1>{title}</h1>
      <p>{detail}</p>
      {retry && <button className="admin-button primary" onClick={retry}>Try again</button>}
      <a href="/">Return to Intake</a>
    </main>
  );
}
