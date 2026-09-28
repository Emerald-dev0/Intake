import { connectionSummary } from '../Connections';
import { useWorkspace } from '../hooks/useWorkspace';

export function AccountPage() {
  const { user, providers } = useWorkspace();
  return <><div className="page-heading"><div className="eyebrow">03 / PROFILE</div><h1>Your <em>account.</em></h1><div className="heading-description">This is your Intake identity. Connected providers are separate accounts you have explicitly authorized.</div></div><div className="profile-card"><div className="avatar large">{user.name.slice(0, 1).toUpperCase()}</div><div><span>INTAKE ACCOUNT</span><strong>{user.name}</strong><span>EMAIL</span><strong>{user.email}</strong></div></div><section className="account-connections"><span className="info-index">CONNECTED PROVIDERS</span><p>{providers.status === 'loading' ? 'Checking connections…' : providers.status === 'error' ? 'Provider connections could not be loaded.' : `${connectionSummary(providers.providers)}.`}</p><a href="/app/connections">Manage connections <span>↗</span></a></section></>;
}
