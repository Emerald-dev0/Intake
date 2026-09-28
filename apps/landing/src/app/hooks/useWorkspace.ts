import { useOutletContext } from 'react-router-dom';
import type { User } from '../../lib/api';
import type { ProviderLoad } from '../Connections';

export type WorkspaceOutlet = {
  user: User;
  providers: ProviderLoad;
  reloadProviders: () => void;
};
export function useWorkspace(): WorkspaceOutlet {
  return useOutletContext<WorkspaceOutlet>();
}
