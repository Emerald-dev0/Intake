import { useNavigate } from 'react-router-dom';
import { FormLibrary } from '../FormLibrary';
import { useWorkspace } from '../hooks/useWorkspace';

export function LibraryPage() {
  const { providers, reloadProviders } = useWorkspace();
  const navigate = useNavigate();

  return (
    <FormLibrary
      providers={providers}
      reloadProviders={reloadProviders}
      onSelectMode={(mode, formRecordId) => {
        navigate('/app/forms', { state: { mode, initialRecordId: formRecordId } });
      }}
    />
  );
}
