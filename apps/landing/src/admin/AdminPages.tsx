import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useAdminQuery, type QueryState } from './useAdminQuery';
import type {
  ActivityItem, AdminRange, AiData, AiOperation, ErrorsData, ErrorItem, FormItem, FormsData,
  OverviewData, ProviderData, SystemData, UserDetail, UserSummary,
} from './types';

const RANGE_OPTIONS: { value: AdminRange; label: string }[] = [
  { value: 'today', label: 'Today · UTC' },
  { value: '7d', label: 'Last 7 days' },
  { value: '30d', label: 'Last 30 days' },
];

function dateTime(value: string | null | undefined): string {
  if (!value) return 'Not recorded';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'Not recorded';
  return new Intl.DateTimeFormat('en', {
    timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false,
  }).format(date) + ' UTC';
}

function dateOnly(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return new Intl.DateTimeFormat('en', { timeZone: 'UTC', year: 'numeric', month: 'short', day: '2-digit' }).format(date);
}

function number(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat('en').format(value);
}

function compactNumber(value: number | null | undefined): string {
  return value === null || value === undefined ? 'Unavailable' : new Intl.NumberFormat('en', { notation: 'compact', maximumFractionDigits: 1 }).format(value);
}

function rangeName(range: AdminRange): string {
  return RANGE_OPTIONS.find(option => option.value === range)?.label ?? 'Last 7 days';
}

function Heading({ kicker, title, description, action }: { kicker: string; title: string; description: string; action?: ReactNode }) {
  return <div className="admin-page-heading"><div><span className="admin-overline">{kicker}</span><h1>{title}</h1><p>{description}</p></div>{action && <div className="admin-heading-action">{action}</div>}</div>;
}

function Panel({ title, eyebrow, description, action, children, className = '' }: {
  title: string; eyebrow?: string; description?: string; action?: ReactNode; children: ReactNode; className?: string;
}) {
  return (
    <section className={`admin-panel ${className}`}>
      <header className="admin-panel-header">
        <div>{eyebrow && <span className="admin-overline">{eyebrow}</span>}<h2>{title}</h2>{description && <p>{description}</p>}</div>
        {action && <div>{action}</div>}
      </header>
      {children}
    </section>
  );
}

function Metric({ label, value, note, tone = 'neutral' }: { label: string; value: string; note?: string; tone?: 'neutral' | 'orange' | 'green' | 'red' }) {
  return <article className={`admin-metric tone-${tone}`}><span>{label}</span><strong>{value}</strong>{note && <small>{note}</small>}</article>;
}

function QueryLoading({ label = 'Loading operational data…' }: { label?: string }) {
  return <div className="admin-loading" role="status"><i className="admin-spinner" />{label}</div>;
}

function QueryError({ state, retry }: { state: Extract<QueryState<unknown>, { status: 'error' }>; retry: () => void }) {
  const denied = state.statusCode === 403;
  return (
    <div className="admin-state-card error" role="alert">
      <strong>{denied ? 'Administrator access required' : state.statusCode === 429 ? 'Rate limit reached' : 'Data unavailable'}</strong>
      <p>{state.message}</p>
      <button className="admin-button" onClick={retry}>Retry</button>
    </div>
  );
}

function Unavailable({ children }: { children: ReactNode }) {
  return <span className="admin-unavailable">{children}</span>;
}

function EmptyState({ title, detail }: { title: string; detail: string }) {
  return <div className="admin-empty"><strong>{title}</strong><p>{detail}</p></div>;
}

function Pagination({ page, totalPages, total, onPage }: { page: number; totalPages: number; total: number; onPage: (page: number) => void }) {
  if (total === 0) return null;
  return (
    <div className="admin-pagination">
      <span>{number(total)} records · page {page} of {Math.max(totalPages, 1)}</span>
      <div><button className="admin-button" disabled={page <= 1} onClick={() => onPage(page - 1)}>Previous</button><button className="admin-button" disabled={page >= totalPages} onClick={() => onPage(page + 1)}>Next</button></div>
    </div>
  );
}

function RangeSelect({ value, onChange, id = 'admin-range' }: { value: AdminRange; onChange: (value: AdminRange) => void; id?: string }) {
  return <label className="admin-field compact" htmlFor={id}><span>Range</span><select id={id} value={value} onChange={event => onChange(event.target.value as AdminRange)}>{RANGE_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}</select></label>;
}

function StatusPill({ label, tone = 'muted' }: { label: string; tone?: 'ok' | 'warn' | 'bad' | 'muted' }) {
  return <span className={`admin-pill ${tone}`}>{label}</span>;
}

function statusTone(status: string): 'ok' | 'warn' | 'bad' | 'muted' {
  if (status === 'healthy' || status === 'ready' || status === 'configured' || status === 'recent_success' || status === 'connected' || status === 'succeeded') return 'ok';
  if (status === 'unavailable' || status === 'not_ready' || status === 'not_configured' || status === 'failed' || status === 'error') return 'bad';
  if (status === 'expired' || status === 'reauthorization_required' || status === 'configured_unverified') return 'warn';
  return 'muted';
}

function SystemPreview() {
  const { state, refresh } = useAdminQuery<SystemData>('/api/admin/system');
  if (state.status === 'loading') return <Panel title="Service evidence"><QueryLoading label="Checking backend, database and configuration…" /></Panel>;
  if (state.status === 'error') return <Panel title="Service evidence"><QueryError state={state} retry={refresh} /></Panel>;
  const data = state.data;
  const rows = [
    ['Backend', data.backend.status, data.backend.evidence],
    ['Database', data.database.status, data.database.evidence],
    ['AI provider', data.aiProvider.status, data.aiProvider.evidence],
    ['Google integration', data.googleIntegration.status, data.googleIntegration.evidence],
    ['Rate limiting', data.rateLimiting.status, data.rateLimiting.evidence],
  ];
  return <Panel title="Service evidence" description="Configured is not the same as live provider health; only the database receives a direct readiness query."><div className="admin-health-list">{rows.map(([label, stateName, evidence]) => <div className="admin-health-row" key={label}><span>{label}</span><StatusPill label={stateName.replaceAll('_', ' ')} tone={statusTone(stateName)} /><small>{evidence}</small></div>)}</div></Panel>;
}

function ActivityPreview() {
  const { state, refresh } = useAdminQuery<{ items: ActivityItem[]; total: number; sources: { users: boolean; forms: boolean; providers: boolean; ai: boolean; credits: false } }>('/api/admin/activity?range=7d&limit=10');
  return (
    <Panel title="Recent activity" eyebrow="LAST 7 DAYS" action={<Link className="admin-text-link" to="/admin/activity">All activity →</Link>}>
      {state.status === 'loading' && <QueryLoading />}
      {state.status === 'error' && <QueryError state={state} retry={refresh} />}
      {state.status === 'ready' && (state.data.items.length ? <ActivityList items={state.data.items} /> : <EmptyState title="No activity recorded in this period" detail={state.data.sources.forms && state.data.sources.providers && state.data.sources.ai ? 'No account, form, provider-authorization or AI-operation records matched.' : 'Some activity sources are unavailable. Check System migrations and provider/form storage before treating this as a complete zero-activity period.'} />)}
    </Panel>
  );
}

export function AdminOverviewPage() {
  const [range, setRange] = useState<AdminRange>('7d');
  const path = `/api/admin/overview?range=${range}`;
  const { state, refresh } = useAdminQuery<OverviewData>(path);
  return (
    <>
      <Heading kicker="OPERATIONS / OVERVIEW" title="The operational picture." description="A live read-only view of records Intake actually stores. Counts use UTC; missing product systems are called out rather than inferred." action={<RangeSelect value={range} onChange={setRange} />} />
      {state.status === 'loading' && <QueryLoading />}
      {state.status === 'error' && <QueryError state={state} retry={refresh} />}
      {state.status === 'ready' && <OverviewContent data={state.data} />}
    </>
  );
}

function OverviewContent({ data }: { data: OverviewData }) {
  return (
    <>
      <div className="admin-section-label">USERS <span>BETTER AUTH RECORDS</span></div>
      <div className="admin-metric-grid four">
        <Metric label="Total users" value={number(data.users.total)} note="All Better Auth user records" />
        <Metric label="New today" value={number(data.users.newToday)} note="Since 00:00 UTC" tone="orange" />
        <Metric label="New this week" value={number(data.users.newThisWeek)} note="UTC week · Monday start" />
        <Metric label="New this month" value={number(data.users.newThisMonth)} note="Calendar month · UTC" />
      </div>
      <div className="admin-metric-grid two compact-grid">
        <Metric label={`Session activity · ${rangeName(data.range)}`} value={number(data.users.activeSessionsInRange)} note={data.users.activeDefinition} />
        <Metric label="Plans / entitlements" value="Unavailable" note={data.plans.reason} />
      </div>

      <div className="admin-overview-columns">
        <Panel title="Forms" eyebrow={`RECORDS · ${rangeName(data.range)}`} description="Stored Intake form records, not a count of every provider-side form.">
          {data.forms.available ? <>
            <div className="admin-metric-grid two inside-grid">
              <Metric label="All form records" value={number(data.forms.totalRecords)} />
              <Metric label="Created records" value={number(data.forms.createdRecords)} tone="green" />
              <Metric label="Created in range" value={number(data.forms.createdInRange)} />
              <Metric label="Incomplete records" value={number(data.forms.incompleteRecords)} tone={data.forms.incompleteRecords ? 'red' : 'neutral'} />
            </div>
            <div className="admin-inline-facts"><span>Incomplete in range <b>{number(data.forms.incompleteInRange)}</b></span><span>Updated records <b>{number(data.forms.updatedRecordsInRange)}</b></span></div>
            <p className="admin-footnote">Partial failures are measurable when an incomplete form record was saved. Attempts that failed before a form record existed are not retained, and individual edit counts are not tracked.</p>
          </> : <Unavailable>{data.forms.reason}</Unavailable>}
        </Panel>
        <Panel title="AI & model usage" eyebrow={`RECORDED OPERATIONS · ${rangeName(data.range)}`} description="Groq interpreter operations at the server boundary. Failed preflight checks may happen before an external call." >
          {data.ai.available ? <>
            <div className="admin-metric-grid two inside-grid">
              <Metric label="Operations" value={number(data.ai.operations)} />
              <Metric label="Succeeded" value={number(data.ai.succeeded)} tone="green" />
              <Metric label="Failed" value={number(data.ai.failed)} tone={data.ai.failed ? 'red' : 'neutral'} />
              <Metric label="Total tokens" value={compactNumber(data.ai.totalTokens)} note={data.ai.totalTokens === null ? 'Provider did not return complete token totals' : 'Input + output, as reported by Groq'} />
            </div>
            <div className="admin-inline-facts"><span>Input tokens <b>{number(data.ai.inputTokens)}</b></span><span>Output tokens <b>{number(data.ai.outputTokens)}</b></span></div>
            <p className="admin-footnote">Metadata tracking was enabled after migration 007 was applied {dateOnly(data.ai.trackingSince)}; earlier operations are unavailable. Estimated cost and credits are unavailable: no pricing configuration or credit ledger is present.</p>
          </> : <Unavailable>{data.ai.reason}</Unavailable>}
        </Panel>
      </div>

      <div className="admin-overview-columns">
        <Panel title="Plans & credits" eyebrow="NOT IMPLEMENTED IN THIS CHECKOUT">
          <div className="admin-unavailable-block"><strong>Plan counts unavailable</strong><p>{data.plans.reason}</p></div>
          <div className="admin-unavailable-block"><strong>Credit balances unavailable</strong><p>{data.credits.reason}</p></div>
        </Panel>
        <SystemPreview />
      </div>
      <ActivityPreview />
    </>
  );
}

function providerLabel(provider: string): string {
  return provider === 'google' ? 'Google' : provider === 'microsoft' ? 'Microsoft' : provider;
}

function connectionLabels(user: UserSummary): ReactNode {
  if (!user.providersAvailable) return <Unavailable>Not available</Unavailable>;
  if (!user.providers.length) return <span className="admin-muted">None connected</span>;
  return <div className="admin-pills">{user.providers.map(item => <StatusPill key={item.provider} label={`${providerLabel(item.provider)} · ${item.status.replaceAll('_', ' ')}`} tone={statusTone(item.status)} />)}</div>;
}

export function AdminUsersPage() {
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const params = new URLSearchParams({ page: String(page), limit: '25' });
  if (search) params.set('q', search);
  const { state, refresh } = useAdminQuery<{ items: UserSummary[]; page: number; pageSize: number; total: number; totalPages: number }>(`/api/admin/users?${params.toString()}`);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSearch(searchInput.trim());
    setPage(1);
  }

  return (
    <>
      <Heading kicker="DIRECTORY / USERS" title="Accounts, not secrets." description="Search Better Auth users on the server. Authentication material, provider tokens and encrypted credentials are never returned." />
      <Panel title="User directory" description="Name, email, or user ID prefix. Results are paginated; no full-table download is sent to the browser." action={state.status === 'ready' ? <span className="admin-count">{number(state.data.total)} users</span> : null}>
        <form className="admin-filter-row" onSubmit={submit}>
          <label className="admin-field search-field"><span>Search users</span><input value={searchInput} onChange={event => setSearchInput(event.target.value)} maxLength={120} placeholder="Name, email or user ID prefix" /></label>
          <button className="admin-button primary" type="submit">Search</button>
          {search && <button className="admin-button" type="button" onClick={() => { setSearchInput(''); setSearch(''); setPage(1); }}>Clear</button>}
        </form>
        {state.status === 'loading' && <QueryLoading label="Searching users…" />}
        {state.status === 'error' && <QueryError state={state} retry={refresh} />}
        {state.status === 'ready' && (state.data.items.length ? <>
          <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>User</th><th>Joined</th><th>Last session update</th><th>Plan</th><th>Forms</th><th>AI operations</th><th>Credits</th><th>Providers</th></tr></thead><tbody>
            {state.data.items.map(user => <tr key={user.id}>
              <td><Link className="admin-user-link" to={`/admin/users/${encodeURIComponent(user.id)}`}><strong>{user.name || 'Unnamed account'}</strong><span>{user.email}</span><code>{user.id}</code></Link></td>
              <td>{dateOnly(user.createdAt)}</td>
              <td>{dateTime(user.lastSessionUpdate)}</td>
              <td><Unavailable>Unavailable</Unavailable></td>
              <td>{number(user.formsCount)}<small>{user.archivedFormsCount !== null ? `${number(user.archivedFormsCount)} archived` : 'archive count unavailable'}</small></td>
              <td>{user.aiAvailable ? number(user.aiOperations) : <Unavailable>Unavailable</Unavailable>}{user.aiAvailable && user.aiOperationsFailed !== null && <small>{number(user.aiOperationsFailed)} failed</small>}</td>
              <td><Unavailable>Unavailable</Unavailable><small>Daily / monthly</small></td>
              <td>{connectionLabels(user)}</td>
            </tr>)}
          </tbody></table></div>
          <Pagination page={state.data.page} totalPages={state.data.totalPages} total={state.data.total} onPage={setPage} />
        </> : <EmptyState title={search ? 'No matching users' : 'No users yet'} detail={search ? 'Try a shorter name, email, or ID prefix.' : 'User accounts will appear here after sign-up.'} />)}
      </Panel>
    </>
  );
}

export function AdminUserDetailPage() {
  const { userId = '' } = useParams();
  const encodedId = encodeURIComponent(userId || 'invalid');
  const { state, refresh } = useAdminQuery<UserDetail>(`/api/admin/users/${encodedId}`);
  const aiPath = `/api/admin/ai?range=30d&userId=${encodeURIComponent(userId)}&limit=10`;
  const { state: aiState } = useAdminQuery<AiData>(aiPath);
  const formsPath = `/api/admin/forms?userId=${encodeURIComponent(userId)}&archived=all&limit=10`;
  const { state: formsState } = useAdminQuery<FormsData>(formsPath);

  return <>
    <Heading kicker="DIRECTORY / ACCOUNT DETAIL" title={state.status === 'ready' ? state.data.name || state.data.email : 'User detail'} description="A restricted operational view. Password hashes, OAuth tokens, account credentials, and provider ciphertext are excluded." action={<Link className="admin-button" to="/admin/users">← All users</Link>} />
    {state.status === 'loading' && <QueryLoading />}
    {state.status === 'error' && <QueryError state={state} retry={refresh} />}
    {state.status === 'ready' && <UserDetailContent user={state.data} aiState={aiState} formsState={formsState} />}
  </>;
}

function UserDetailContent({ user, aiState, formsState }: { user: UserDetail; aiState: QueryState<AiData>; formsState: QueryState<FormsData> }) {
  return <>
    <div className="admin-detail-grid">
      <Panel title="Account" eyebrow="BETTER AUTH IDENTITY">
        <dl className="admin-definition-list">
          <div><dt>Name</dt><dd>{user.name || 'Unnamed account'}</dd></div>
          <div><dt>Email</dt><dd>{user.email}</dd></div>
          <div><dt>User ID</dt><dd><code>{user.id}</code></dd></div>
          <div><dt>Created</dt><dd>{dateTime(user.createdAt)}</dd></div>
          <div><dt>Last session update</dt><dd>{dateTime(user.lastSessionUpdate)}</dd></div>
          <div><dt>Authentication methods</dt><dd>{user.authenticationMethods.length ? user.authenticationMethods.join(', ') : 'No account method recorded'}</dd></div>
        </dl>
      </Panel>
      <Panel title="Plan & entitlement" eyebrow="NOT IMPLEMENTED">
        <div className="admin-unavailable-block"><strong>Plan data unavailable</strong><p>{user.planUnavailableReason}</p></div>
        <div className="admin-unavailable-block"><strong>Subscription state unavailable</strong><p>No subscription provider or entitlement records are present. No Free/Pro state is inferred.</p></div>
      </Panel>
    </div>
    <div className="admin-detail-grid">
      <Panel title="Credits" eyebrow="BALANCES & LEDGER"><div className="admin-unavailable-block"><strong>Not available</strong><p>{user.credits.reason}</p></div><p className="admin-footnote">No manual adjustment controls are exposed. Historical credit events are not editable here.</p></Panel>
      <Panel title="AI usage" eyebrow="RECORDED OPERATIONS">
        {user.ai.available ? <div className="admin-metric-grid two inside-grid">
          <Metric label="Operations" value={number(user.ai.operations)} />
          <Metric label="Succeeded" value={number(user.ai.succeeded)} tone="green" />
          <Metric label="Failed" value={number(user.ai.failed)} tone={user.ai.failed ? 'red' : 'neutral'} />
          <Metric label="Tokens" value={compactNumber(user.ai.totalTokens)} />
        </div> : <Unavailable>{user.ai.reason}</Unavailable>}
        <p className="admin-footnote">Token estimates from the provider response only; cost and credits are not configured.</p>
      </Panel>
    </div>
    <div className="admin-detail-grid">
      <Panel title="Forms" eyebrow="INTAKE RECORDS">
        {user.forms.available ? <div className="admin-metric-grid two inside-grid">
          <Metric label="Total records" value={number(user.forms.total)} />
          <Metric label="Created status" value={number(user.forms.created)} />
          <Metric label="Incomplete" value={number(user.forms.incomplete)} tone={user.forms.incomplete ? 'red' : 'neutral'} />
          <Metric label="Archived" value={number(user.forms.archived)} />
        </div> : <Unavailable>{user.forms.reason}</Unavailable>}
        <p className="admin-footnote">Updated records are not a count of edit actions.</p>
      </Panel>
      <Panel title="Provider connections" eyebrow="STATUS ONLY">
        {user.providers.available ? user.providers.connections.length ? <div className="admin-health-list">{user.providers.connections.map(connection => <div className="admin-health-row" key={connection.provider}><span>{providerLabel(connection.provider)}</span><StatusPill label={connection.status.replaceAll('_', ' ')} tone={statusTone(connection.status)} /><small>Last authorized {dateTime(connection.lastAuthorizedAt)}</small></div>)}</div> : <EmptyState title="No connection records" detail="This user has no saved Intake provider connection." /> : <Unavailable>{user.providers.reason}</Unavailable>}
        <p className="admin-footnote">Provider tokens, account identifiers and encrypted credential fields are never selected.</p>
      </Panel>
    </div>
    <Panel title="Recent forms" eyebrow="LATEST 10 RECORDS" action={<Link className="admin-text-link" to={`/admin/forms?userId=${encodeURIComponent(user.id)}`}>All forms →</Link>}>
      {formsState.status === 'loading' && <QueryLoading />}
      {formsState.status === 'error' && <p className="admin-inline-error">Forms could not be loaded separately.</p>}
      {formsState.status === 'ready' && (!formsState.data.available ? <Unavailable>{formsState.data.reason}</Unavailable> : formsState.data.items.length ? <FormTable items={formsState.data.items} /> : <EmptyState title="No form records" detail="No Intake-owned form records are associated with this account." />)}
    </Panel>
    <Panel title="Recent AI operations" eyebrow="LAST 30 DAYS" action={<Link className="admin-text-link" to={`/admin/ai?userId=${encodeURIComponent(user.id)}`}>AI usage →</Link>}>
      {aiState.status === 'loading' && <QueryLoading />}
      {aiState.status === 'error' && <p className="admin-inline-error">AI usage could not be loaded separately.</p>}
      {aiState.status === 'ready' && (!aiState.data.available ? <Unavailable>{aiState.data.reason}</Unavailable> : aiState.data.items.length ? <AiTable items={aiState.data.items} /> : <EmptyState title="No AI operations recorded" detail="No interpreter operations were recorded for this user in the last 30 days." />)}
    </Panel>
  </>;
}

interface AiFilters {
  range: AdminRange;
  operation: string;
  status: string;
  model: string;
  userId: string;
  page: number;
}

const EMPTY_AI_FILTERS: AiFilters = { range: '7d', operation: '', status: '', model: '', userId: '', page: 1 };

export function AdminAiPage() {
  const [draft, setDraft] = useState<AiFilters>(EMPTY_AI_FILTERS);
  const [filters, setFilters] = useState<AiFilters>(EMPTY_AI_FILTERS);
  const params = new URLSearchParams({ range: filters.range, page: String(filters.page), limit: '25' });
  if (filters.operation) params.set('operation', filters.operation);
  if (filters.status) params.set('status', filters.status);
  if (filters.model) params.set('model', filters.model);
  if (filters.userId) params.set('userId', filters.userId);
  const { state, refresh } = useAdminQuery<AiData>(`/api/admin/ai?${params.toString()}`);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...draft, model: draft.model.trim(), userId: draft.userId.trim(), page: 1 });
  }

  return <>
    <Heading kicker="MODEL OPERATIONS / GROQ" title="Recorded model operations." description="Provider, model, latency, outcome and provider-reported token counts. Prompts and response content are not stored; tracking starts after migration 007." />
    <Panel title="Filter operations" eyebrow="SERVER-SIDE FILTERING">
      <form className="admin-filter-row multi" onSubmit={submit}>
        <RangeSelect value={draft.range} onChange={range => setDraft(current => ({ ...current, range }))} id="ai-range" />
        <label className="admin-field compact"><span>Operation</span><select value={draft.operation} onChange={event => setDraft(current => ({ ...current, operation: event.target.value }))}><option value="">All operations</option><option value="form_interpretation">Form interpretation</option><option value="form_edit_interpretation">Form edit interpretation</option></select></label>
        <label className="admin-field compact"><span>Outcome</span><select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}><option value="">All outcomes</option><option value="succeeded">Succeeded</option><option value="failed">Failed</option></select></label>
        <label className="admin-field compact"><span>Model name</span><input value={draft.model} onChange={event => setDraft(current => ({ ...current, model: event.target.value }))} maxLength={200} placeholder="Exact model" /></label>
        <label className="admin-field compact"><span>User ID</span><input value={draft.userId} onChange={event => setDraft(current => ({ ...current, userId: event.target.value }))} maxLength={255} placeholder="Exact user ID" /></label>
        <button className="admin-button primary" type="submit">Apply filters</button>
      </form>
    </Panel>
    {state.status === 'loading' && <QueryLoading />}
    {state.status === 'error' && <QueryError state={state} retry={refresh} />}
    {state.status === 'ready' && <AiPageContent data={state.data} onPage={page => setFilters(current => ({ ...current, page }))} />}
  </>;
}

function AiPageContent({ data, onPage }: { data: AiData; onPage: (page: number) => void }) {
  return <>
    {data.available && data.summary ? <>
      <div className="admin-metric-grid four">
        <Metric label="Operations" value={number(data.summary.operations)} />
        <Metric label="Succeeded" value={number(data.summary.succeeded)} tone="green" />
        <Metric label="Failed" value={number(data.summary.failed)} tone={data.summary.failed ? 'red' : 'neutral'} />
        <Metric label="Total tokens" value={compactNumber(data.summary.totalTokens)} />
      </div>
      <Panel title="Token totals" eyebrow={rangeNameFromState(data)}><div className="admin-inline-facts wide"><span>Input tokens <b>{number(data.summary.inputTokens)}</b></span><span>Output tokens <b>{number(data.summary.outputTokens)}</b></span><span>Estimated cost <b>Unavailable</b></span><span>Credits consumed <b>Unavailable</b></span></div><p className="admin-footnote">No pricing schedule or credit ledger is configured. Cost is intentionally not estimated from hard-coded public prices.</p></Panel>
      <Panel title="Operation history" description={data.trackingSince ? `Migration 007 was applied ${dateTime(data.trackingSince)}; this marks tracking availability, not the first recorded operation.` : 'Usage becomes available after the tracking migration is applied.'}>
        {data.items.length ? <><AiTable items={data.items} /><Pagination page={data.page} totalPages={data.totalPages} total={data.total} onPage={onPage} /></> : <EmptyState title="No matching AI operations" detail="No recorded operations match the selected range and filters." />}
      </Panel>
    </> : <Panel title="AI usage not available" eyebrow="NO HISTORICAL DATA FABRICATED"><Unavailable>{data.reason || 'No AI operation records are available.'}</Unavailable><p className="admin-footnote">Apply migration 007_ai_operations.sql to begin recording Groq operations. Earlier operation history cannot be reconstructed.</p></Panel>}
  </>;
}

function rangeNameFromState(data: AiData): string {
  if (data.trackingSince) return `Migration 007 applied ${dateOnly(data.trackingSince)}`;
  return 'Filtered range';
}

function AiTable({ items }: { items: AiOperation[] }) {
  return <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Started · UTC</th><th>User</th><th>Operation</th><th>Provider / model</th><th>Outcome</th><th>Latency</th><th>Tokens in / out</th><th>Request ID</th></tr></thead><tbody>
    {items.map(item => <tr key={item.id}>
      <td>{dateTime(item.timestamp)}</td>
      <td><Link className="admin-user-link compact-user" to={`/admin/users/${encodeURIComponent(item.userId)}`}><strong>{item.userName}</strong><span>{item.userEmail}</span></Link></td>
      <td>{item.operation === 'form_interpretation' ? 'Form interpretation' : 'Form edit interpretation'}<small>{item.route}</small></td>
      <td>Groq<small>{item.model}</small></td>
      <td><StatusPill label={item.status} tone={statusTone(item.status)} />{item.failureCode && <small>{item.failureCode}</small>}</td>
      <td>{number(item.latencyMs)} ms</td>
      <td>{number(item.inputTokens)} / {number(item.outputTokens)}</td>
      <td><code>{item.requestId}</code></td>
    </tr>)}
  </tbody></table></div>;
}

export function AdminCreditsPage() {
  const { state, refresh } = useAdminQuery<{ available: false; reason: string; summary: null; items: [] }>('/api/admin/credits');
  return <>
    <Heading kicker="CREDITS / BALANCES" title="An honest empty surface." description="No credit ledger or entitlement source exists in this checkout, so balances and events remain unavailable. No credit mutations are exposed." />
    {state.status === 'loading' && <QueryLoading />}
    {state.status === 'error' && <QueryError state={state} retry={refresh} />}
    {state.status === 'ready' && <Panel title="Credit accounting unavailable" eyebrow="NO LEDGER IN THIS CHECKOUT"><div className="admin-unavailable-block prominent"><strong>Not enough data yet</strong><p>{state.data.reason}</p></div><p className="admin-footnote">No granted, consumed, expired, failed, or rolled-back totals are inferred. Manual adjustments remain deferred until an immutable ledger and authorization policy exist.</p></Panel>}
  </>;
}

interface FormFilters { q: string; provider: string; status: string; archived: string; userId: string; page: number }
const EMPTY_FORM_FILTERS: FormFilters = { q: '', provider: '', status: '', archived: 'all', userId: '', page: 1 };

export function AdminFormsPage() {
  const [draft, setDraft] = useState<FormFilters>(EMPTY_FORM_FILTERS);
  const [filters, setFilters] = useState<FormFilters>(EMPTY_FORM_FILTERS);
  const params = new URLSearchParams({ page: String(filters.page), limit: '25', archived: filters.archived });
  if (filters.q) params.set('q', filters.q);
  if (filters.provider) params.set('provider', filters.provider);
  if (filters.status) params.set('status', filters.status);
  if (filters.userId) params.set('userId', filters.userId);
  const { state, refresh } = useAdminQuery<FormsData>(`/api/admin/forms?${params.toString()}`);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ ...draft, q: draft.q.trim(), userId: draft.userId.trim(), page: 1 });
  }

  return <>
    <Heading kicker="FORM LIBRARY / INTAKE RECORDS" title="Forms across accounts." description="Metadata stored by Intake only. Form titles and content are excluded; this view does not open, impersonate, edit or change a provider form." />
    <Panel title="Filter form records" eyebrow="SEARCH & STATUS">
      <form className="admin-filter-row multi" onSubmit={submit}>
        <label className="admin-field search-field"><span>Owner or form ID</span><input value={draft.q} onChange={event => setDraft(current => ({ ...current, q: event.target.value }))} maxLength={120} placeholder="Search prefix" /></label>
        <label className="admin-field compact"><span>Provider</span><select value={draft.provider} onChange={event => setDraft(current => ({ ...current, provider: event.target.value }))}><option value="">All providers</option><option value="google">Google</option><option value="microsoft">Microsoft</option></select></label>
        <label className="admin-field compact"><span>Record status</span><select value={draft.status} onChange={event => setDraft(current => ({ ...current, status: event.target.value }))}><option value="">All statuses</option><option value="created">Created</option><option value="incomplete">Incomplete</option></select></label>
        <label className="admin-field compact"><span>Archive</span><select value={draft.archived} onChange={event => setDraft(current => ({ ...current, archived: event.target.value }))}><option value="all">All records</option><option value="active">Active</option><option value="archived">Archived</option></select></label>
        <label className="admin-field compact"><span>Owner user ID</span><input value={draft.userId} onChange={event => setDraft(current => ({ ...current, userId: event.target.value }))} maxLength={255} placeholder="Exact user ID" /></label>
        <button className="admin-button primary" type="submit">Apply filters</button>
      </form>
    </Panel>
    <Panel title="Form records" action={state.status === 'ready' && state.data.available ? <span className="admin-count">{number(state.data.total)} records</span> : null}>
      {state.status === 'loading' && <QueryLoading />}
      {state.status === 'error' && <QueryError state={state} retry={refresh} />}
      {state.status === 'ready' && (!state.data.available ? <Unavailable>{state.data.reason}</Unavailable> : state.data.items.length ? <><FormTable items={state.data.items} /><Pagination page={state.data.page} totalPages={state.data.totalPages} total={state.data.total} onPage={page => setFilters(current => ({ ...current, page }))} /></> : <EmptyState title="No matching form records" detail="There are no stored form records for this filter. Intake records do not represent forms created outside Intake." />)}
    </Panel>
  </>;
}

function FormTable({ items }: { items: FormItem[] }) {
  return <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Intake record ID</th><th>Owner</th><th>Provider</th><th>Provider form ID</th><th>Status</th><th>Created</th><th>Updated / synced</th><th>Archived</th></tr></thead><tbody>
    {items.map(item => <tr key={item.id}>
      <td><code>{item.id}</code></td>
      <td><Link className="admin-user-link compact-user" to={`/admin/users/${encodeURIComponent(item.ownerId)}`}><strong>{item.ownerName}</strong><span>{item.ownerEmail}</span></Link></td>
      <td>{providerLabel(item.provider)}</td>
      <td><code>{item.providerFormId}</code></td>
      <td><StatusPill label={item.status} tone={item.status === 'created' ? 'ok' : 'warn'} /></td>
      <td>{dateTime(item.createdAt)}</td>
      <td>{dateTime(item.lastSyncedAt || item.updatedAt)}<small>{item.lastSyncedAt ? 'Last provider sync' : 'Record update'}</small></td>
      <td>{item.archivedAt ? <StatusPill label={`Yes · ${dateOnly(item.archivedAt)}`} tone="muted" /> : 'No'}</td>
    </tr>)}
  </tbody></table></div>;
}

export function AdminProvidersPage() {
  const { state, refresh } = useAdminQuery<ProviderData>('/api/admin/providers');
  return <>
    <Heading kicker="INTEGRATIONS / PROVIDER STATUS" title="Connections without credentials." description="Aggregate connection state and server configuration only. No tokens, OAuth codes, encrypted values or API keys are exposed." />
    {state.status === 'loading' && <QueryLoading />}
    {state.status === 'error' && <QueryError state={state} retry={refresh} />}
    {state.status === 'ready' && <ProviderContent data={state.data} />}
  </>;
}

function ProviderContent({ data }: { data: ProviderData }) {
  return <>
    {!data.connectionsAvailable && <div className="admin-callout warning">{data.connectionsUnavailableReason}</div>}
    <div className="admin-detail-grid">
      <ProviderCard title="Google Forms" configured={data.google.configured} connections={data.google} note="Connection counts reflect stored OAuth status. No Google API health probe is performed." />
      <ProviderCard title="Microsoft" configured={data.microsoft.configured} connections={data.microsoft} note="OAuth connection visibility only; Microsoft Forms creation is not implemented." />
    </div>
    <Panel title="AI provider" eyebrow="GROQ · STRICT JSON SCHEMA">
      <div className="admin-provider-overview">
        <div><span>Configuration</span><StatusPill label={data.ai.configured ? 'API key configured' : 'Not configured'} tone={data.ai.configured ? 'ok' : 'bad'} /></div>
        <div><span>Model</span><strong>{data.ai.model}</strong></div>
        <div><span>Observed status</span><StatusPill label={data.ai.connectivity.replaceAll('_', ' ')} tone={statusTone(data.ai.connectivity)} /></div>
        <div><span>Last recorded success</span><strong>{dateTime(data.ai.lastSuccessAt)}</strong></div>
        <div><span>Operation failures · last 24 hours</span><strong>{number(data.ai.failuresIn24Hours)}</strong></div>
      </div>
      <p className="admin-footnote">“Recent success” means the server recorded a successful call; it is not a continuous availability guarantee. Provider error history before usage tracking is unavailable.</p>
    </Panel>
  </>;
}

function ProviderCard({ title, configured, connections, note }: { title: string; configured: boolean; connections: ProviderData['google']; note: string }) {
  return <Panel title={title} eyebrow="OAUTH CONNECTIONS">
    <div className="admin-provider-overview">
      <div><span>OAuth configuration</span><StatusPill label={configured ? 'Configured' : 'Not configured'} tone={configured ? 'ok' : 'warn'} /></div>
      <div><span>Records marked connected</span><strong>{number(connections.activeConnections)}</strong></div>
      <div><span>Reauthorization required</span><strong>{number(connections.reauthorizationRequired)}</strong></div>
      <div><span>Expired</span><strong>{number(connections.expired)}</strong></div>
      <div><span>Provider connectivity</span><StatusPill label="Not probed" tone="muted" /></div>
    </div>
    <p className="admin-footnote">{note} Recent provider failures are not persisted in this checkout.</p>
  </Panel>;
}

export function AdminSystemPage() {
  const { state, refresh } = useAdminQuery<SystemData>('/api/admin/system');
  const { state: errorState, refresh: refreshErrors } = useAdminQuery<ErrorsData>('/api/admin/errors?range=30d&limit=25');
  return <>
    <Heading kicker="OPERATIONS / HEALTH" title="Evidence, not green dots." description="A service is marked healthy only when Intake has direct evidence. Configuration is kept separate from live reachability." />
    {state.status === 'loading' && <QueryLoading label="Checking system and database readiness…" />}
    {state.status === 'error' && <QueryError state={state} retry={refresh} />}
    {state.status === 'ready' && <SystemContent data={state.data} errorState={errorState} refreshErrors={refreshErrors} />}
  </>;
}

function SystemContent({ data, errorState, refreshErrors }: { data: SystemData; errorState: QueryState<ErrorsData>; refreshErrors: () => void }) {
  const migrationTrackingLabel = data.database.status === 'unavailable'
    ? 'Unknown'
    : data.migrations.trackingAvailable ? 'Available' : 'Missing';
  const healthRows = [
    ['Backend process', data.backend.status, data.backend.evidence],
    ['Database', data.database.status, data.database.evidence],
    ['AI provider', data.aiProvider.status, `${data.aiProvider.evidence} Current model: ${data.aiProvider.model}.`],
    ['Google integration', data.googleIntegration.status, data.googleIntegration.evidence],
    ['Rate limiting', data.rateLimiting.status, data.rateLimiting.evidence],
  ];
  return <>
    <Panel title="System evidence" eyebrow={`CHECKED ${dateTime(data.generatedAt)}`}><div className="admin-health-list detailed">{healthRows.map(([label, status, evidence]) => <div className="admin-health-row" key={label}><span>{label}</span><StatusPill label={status.replaceAll('_', ' ')} tone={statusTone(status)} /><small>{evidence}</small></div>)}</div></Panel>
    <Panel title="Intake migrations" eyebrow="DATABASE VERSION" description="The application does not apply migrations at startup. Pending entries require an operator-led migration run.">
      <div className="admin-migration-summary"><span>Tracking table</span><StatusPill label={migrationTrackingLabel} tone={migrationTrackingLabel === 'Available' ? 'ok' : migrationTrackingLabel === 'Missing' ? 'bad' : 'muted'} /><span>Latest applied</span><strong>{dateTime(data.migrations.latestAppliedAt)}</strong></div>
      {data.migrations.pending === null
        ? <div className="admin-callout warning"><strong>Migration status unknown</strong><p>{data.database.status === 'unavailable' ? 'The database could not be reached, so applied and pending migrations were not inferred.' : 'The migration tracking table is missing, so applied and pending migrations cannot be confirmed.'}</p></div>
        : data.migrations.pending.length
          ? <div className="admin-callout warning"><strong>{data.migrations.pending.length} migration(s) pending</strong><p>{data.migrations.pending.join(', ')}</p></div>
          : <div className="admin-callout success">All tracked Intake migrations in this release are applied.</div>}
      {data.migrations.applied !== null && <details className="admin-details"><summary>Applied migration IDs</summary>{data.migrations.applied.length ? <ul>{data.migrations.applied.map(id => <li key={id}><code>{id}</code></li>)}</ul> : <p>No applied migration IDs are available.</p>}</details>}
    </Panel>
    <Panel title="Recent recorded failures" eyebrow="LAST 30 DAYS" description="This view is intentionally limited to structured AI failures and incomplete form records. Generic route/provider failures are not currently persisted.">
      {errorState.status === 'loading' && <QueryLoading />}
      {errorState.status === 'error' && <QueryError state={errorState} retry={refreshErrors} />}
      {errorState.status === 'ready' && (errorState.data.items.length ? <>
        <ErrorTable items={errorState.data.items} />
        <div className="admin-footnote">Sources available: AI failures {errorState.data.sources.aiFailures ? 'yes' : 'no'}, incomplete form records {errorState.data.sources.incompleteForms ? 'yes' : 'no'}. Generic API/provider errors and resolution state are not stored.</div>
      </> : <>
        {errorState.data.sources.aiFailures || errorState.data.sources.incompleteForms
          ? <EmptyState title="No recorded failures in this range" detail="This does not include generic API errors or provider failures, which are not persisted." />
          : <Unavailable>Failure history is unavailable until the relevant data migrations are applied.</Unavailable>}
      </>)}
    </Panel>
  </>;
}

export function AdminActivityPage() {
  const [range, setRange] = useState<AdminRange>('7d');
  const [type, setType] = useState('');
  const [userInput, setUserInput] = useState('');
  const [filters, setFilters] = useState({ range, type, userId: '', page: 1 });
  const params = new URLSearchParams({ range: filters.range, page: String(filters.page), limit: '50' });
  if (filters.type) params.set('type', filters.type);
  if (filters.userId) params.set('userId', filters.userId);
  const { state, refresh } = useAdminQuery<{ items: ActivityItem[]; page: number; pageSize: number; total: number; totalPages: number; sources: { users: boolean; forms: boolean; providers: boolean; ai: boolean; credits: false } }>(`/api/admin/activity?${params.toString()}`);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setFilters({ range, type, userId: userInput.trim(), page: 1 });
  }
  return <>
    <Heading kicker="EVENTS / PRODUCT ACTIVITY" title="What Intake recorded." description="A lightweight event feed derived from account, form, provider-authorization and AI-operation rows. No duplicate analytics event table is introduced." />
    <Panel title="Filter activity" eyebrow="SERVER-SIDE RANGE & FILTERS">
      <form className="admin-filter-row multi" onSubmit={submit}>
        <RangeSelect value={range} onChange={setRange} id="activity-range" />
        <label className="admin-field compact"><span>Event type</span><select value={type} onChange={event => setType(event.target.value)}><option value="">All recorded events</option><option value="user.signup">New user</option><option value="provider.connected">Provider authorized</option><option value="provider.reauthorization_required">Reauthorization required</option><option value="form.created">Form created</option><option value="form.incomplete">Incomplete form</option><option value="form.record_updated">Form record updated</option><option value="ai.operation.succeeded">AI succeeded</option><option value="ai.operation.failed">AI failed</option></select></label>
        <label className="admin-field compact"><span>User ID</span><input value={userInput} onChange={event => setUserInput(event.target.value)} maxLength={255} placeholder="Exact user ID" /></label>
        <button className="admin-button primary" type="submit">Apply filters</button>
      </form>
    </Panel>
    <Panel title="Activity stream" action={state.status === 'ready' ? <span className="admin-count">{number(state.data.total)} events</span> : null}>
      {state.status === 'loading' && <QueryLoading />}
      {state.status === 'error' && <QueryError state={state} retry={refresh} />}
      {state.status === 'ready' && (state.data.items.length ? <><ActivityList items={state.data.items} /><Pagination page={state.data.page} totalPages={state.data.totalPages} total={state.data.total} onPage={page => setFilters(current => ({ ...current, page }))} />
        <p className="admin-footnote">Coverage: users {state.data.sources.users ? 'yes' : 'no'}, forms {state.data.sources.forms ? 'yes' : 'no'}, provider authorization {state.data.sources.providers ? 'yes' : 'no'}, AI {state.data.sources.ai ? 'yes' : 'no'}. Form metadata updates are not individual edit actions. Disconnects and credit events are not retained.</p>
      </> : <EmptyState title="No activity in this range" detail={state.data.sources.forms && state.data.sources.providers && state.data.sources.ai ? 'No matching events were found in the records Intake currently stores.' : 'Some activity sources are unavailable. Verify migrations/storage before treating this as a complete zero-activity period.'} />)}
    </Panel>
  </>;
}

function ActivityList({ items }: { items: ActivityItem[] }) {
  return <div className="admin-activity-list">{items.map(item => <article className="admin-activity-item" key={item.id}>
    <span className={`admin-activity-mark ${item.severity}`} />
    <div><strong>{item.description}</strong><span>{item.userName ? <Link to={`/admin/users/${encodeURIComponent(item.userId || '')}`}>{item.userName} · {item.userEmail}</Link> : 'System event'}{item.provider ? ` · ${providerLabel(item.provider)}` : ''}</span></div>
    <time>{dateTime(item.timestamp)}</time>
    {item.requestId && <code>{item.requestId}</code>}
  </article>)}</div>;
}

function ErrorTable({ items }: { items: ErrorItem[] }) {
  return <div className="admin-table-scroll"><table className="admin-table"><thead><tr><th>Timestamp</th><th>Severity</th><th>Route / operation</th><th>Category</th><th>User</th><th>Request ID</th><th>Resolution</th></tr></thead><tbody>{items.map(item => <tr key={item.id}>
    <td>{dateTime(item.timestamp)}</td><td><StatusPill label={item.severity} tone={statusTone(item.severity)} /></td>
    <td><code>{item.route}</code><small>{item.operation}{item.provider ? ` · ${item.provider}` : ''}</small></td>
    <td>{item.category}</td><td>{item.userId ? <Link to={`/admin/users/${encodeURIComponent(item.userId)}`}>{item.userName || item.userEmail}</Link> : '—'}</td>
    <td><code>{item.requestId || '—'}</code></td><td><StatusPill label="Unknown" tone="muted" /></td>
  </tr>)}</tbody></table></div>;
}
