import { useOutletContext } from 'react-router-dom';
import type { User } from '../../lib/api';

export function AccountPage() {
  const user = useOutletContext<User>();
  return <><div className="page-heading"><div className="eyebrow">03 / PROFILE</div><h1>Your <em>account.</em></h1><div className="heading-description">Your Intake identity. Provider accounts will be managed separately once connections are available.</div></div><div className="profile-card"><div className="avatar large">{user.name.slice(0, 1).toUpperCase()}</div><div><span>NAME</span><strong>{user.name}</strong><span>EMAIL</span><strong>{user.email}</strong></div></div></>;
}
