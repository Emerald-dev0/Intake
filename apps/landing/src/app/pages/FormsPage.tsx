import { Forms } from '../Forms';
import { useWorkspace } from '../hooks/useWorkspace';

export function FormsPage() {
  const { providers, reloadProviders, newChatNonce } = useWorkspace();
  return <Forms providers={providers} reloadProviders={reloadProviders} newChatNonce={newChatNonce} />;
}
