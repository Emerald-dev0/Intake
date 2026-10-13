import { useState } from 'react';
import { useAdminQuery } from './useAdminQuery';

type WaitlistData = {
  items: Array<{
    id: string; email: string; createdAt: string;
    welcomeStatus: 'pending' | 'sending' | 'accepted' | 'suppressed' | 'blocked';
    welcomeAttempts: number; welcomeAcceptedAt: string | null; welcomeErrorCode: string | null;
  }>;
  page: number; pageSize: number; total: number; totalPages: number;
};

export default function AdminWaitlistPage() {
  const [page, setPage] = useState(1);
  const { state, refresh } = useAdminQuery<WaitlistData>(`/api/admin/waitlist?page=${page}&limit=25`);
  return <>
    <div className="admin-page-heading"><div><span className="admin-overline">EARLY ACCESS</span><h1>Wait-list subscribers</h1><p>Saved signups and their welcome-mail queue. Accepted means the provider queued the message; delivery is confirmed in Email.</p></div><button type="button" className="admin-button" onClick={refresh}>Refresh</button></div>
    {state.status === 'loading' && <div className="admin-loading" role="status"><i className="admin-spinner" />Loading subscribers…</div>}
    {state.status === 'error' && <div className="admin-state-card error" role="alert"><strong>Wait-list unavailable</strong><p>{state.message}</p><button type="button" className="admin-button" onClick={refresh}>Retry</button></div>}
    {state.status === 'ready' && <section className="admin-panel" aria-label="Wait-list subscribers">
      <header className="admin-panel-header"><div><span className="admin-overline">EARLY COMMUNITY</span><h2>Total subscribers: {state.data.total.toLocaleString()}</h2><p>Unique email addresses across all pages.</p></div></header>
      {state.data.items.length === 0 ? <div className="admin-empty"><strong>No subscribers on this page.</strong><p>New wait-list signups appear here after they are saved.</p></div> : <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Email</th><th>Joined · UTC</th><th>Welcome</th><th>Attempts</th><th>Last issue</th></tr></thead><tbody>
        {state.data.items.map(item => <tr key={item.id}><td>{item.email}</td><td>{new Date(item.createdAt).toLocaleString('en-GB', { timeZone: 'UTC' })}</td><td><span className={`admin-pill ${item.welcomeStatus === 'accepted' ? 'ok' : item.welcomeStatus === 'blocked' ? 'bad' : 'muted'}`}>{item.welcomeStatus}</span></td><td>{item.welcomeAttempts}</td><td>{item.welcomeErrorCode ?? '—'}</td></tr>)}
      </tbody></table></div>}
      <div className="admin-pagination"><span>{state.data.total} records · page {page} of {Math.max(1, state.data.totalPages)}</span><div><button type="button" className="admin-button" disabled={page <= 1} onClick={() => setPage(value => value - 1)}>Previous</button><button type="button" className="admin-button" disabled={page >= state.data.totalPages} onClick={() => setPage(value => value + 1)}>Next</button></div></div>
    </section>}
  </>;
}
