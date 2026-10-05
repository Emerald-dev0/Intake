import { createContext, useContext } from 'react';
import type { AuthenticationMethodSummary, User } from '../../lib/api';

export const SessionContext = createContext<{ user: User; authenticationMethods: AuthenticationMethodSummary | null; clearSession: () => void } | null>(null);
export function useSession() {
  const session = useContext(SessionContext);
  if (!session) throw new Error('useSession requires ProtectedLayout');
  return session;
}
