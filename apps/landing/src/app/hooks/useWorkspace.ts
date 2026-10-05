import { useOutletContext } from 'react-router-dom';
import type { User } from '../../lib/api';
import type { PublicCreditCostGuide, PublicCredits } from '../../lib/credits';
import type { ProviderLoad } from '../Connections';

export type CreditLoad =
  | { status: 'loading' | 'error'; credits: null; costGuide: null }
  | { status: 'ready'; credits: PublicCredits; costGuide: PublicCreditCostGuide | null };

export type WorkspaceOutlet = {
  user: User;
  providers: ProviderLoad;
  reloadProviders: () => void;
  credits: CreditLoad;
  reloadCredits: () => void;
  /** Adopt the authoritative balance returned by a successful AI operation. */
  noteCredits: (value: unknown) => void;
};
export function useWorkspace(): WorkspaceOutlet {
  return useOutletContext<WorkspaceOutlet>();
}
