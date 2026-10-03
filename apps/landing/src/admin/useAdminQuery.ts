import { useCallback, useEffect, useState } from 'react';
import { adminApi, AdminApiError } from './api';

export type QueryState<T> =
  | { status: 'loading' }
  | { status: 'error'; message: string; statusCode: number | null }
  | { status: 'ready'; data: T };

export function useAdminQuery<T>(path: string) {
  const [state, setState] = useState<QueryState<T>>({ status: 'loading' });
  const [version, setVersion] = useState(0);
  const refresh = useCallback(() => setVersion(current => current + 1), []);

  useEffect(() => {
    let active = true;
    setState({ status: 'loading' });
    adminApi<T>(path as `/api/admin${string}`).then(data => {
      if (active) setState({ status: 'ready', data });
    }).catch(error => {
      if (!active) return;
      if (error instanceof AdminApiError) {
        if (error.status === 401) {
          window.location.replace('/auth/sign-in?redirect=%2Fadmin');
          return;
        }
        setState({ status: 'error', message: error.status === 403 ? 'Administrator access is no longer available to this session.' : error.message, statusCode: error.status });
      } else {
        setState({ status: 'error', message: 'The admin service could not be reached. No empty-state data is being shown.', statusCode: null });
      }
    });
    return () => { active = false; };
  }, [path, version]);

  return { state, refresh };
}
