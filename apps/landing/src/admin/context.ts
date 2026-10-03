import { createContext, useContext } from 'react';

export interface AdminIdentity {
  id: string;
  name: string;
  email: string;
}

export const AdminContext = createContext<AdminIdentity | null>(null);

export function useAdminIdentity(): AdminIdentity {
  const identity = useContext(AdminContext);
  if (!identity) throw new Error('useAdminIdentity requires the server-authorized admin layout');
  return identity;
}
