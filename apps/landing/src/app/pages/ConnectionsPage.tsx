import { Connections } from '../Connections';
import { useWorkspace } from '../hooks/useWorkspace';

export function ConnectionsPage() {
  const { providers, reloadProviders } = useWorkspace();
  return <Connections load={providers} reload={reloadProviders} />;
}
