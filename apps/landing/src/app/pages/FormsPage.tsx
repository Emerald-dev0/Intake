import { Forms } from '../Forms';
import { useWorkspace } from '../hooks/useWorkspace';

export function FormsPage() {
  const { providers, reloadProviders } = useWorkspace();
  return <Forms providers={providers} reloadProviders={reloadProviders} />;
}
