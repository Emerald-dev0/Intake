import { useEffect, useState, type FormEvent } from 'react';
import { ProviderMark } from './components/ProviderBadge';
import { PageHeader, Section, EmptyState, ErrorState, Skeleton, Note } from './components/PagePrimitives';
import {
  isProviderId,
  isResultCode,
  isRevocationOutcome,
  parseProviderList,
  resultMessage,
  type PublicProvider,
  type ResultCode,
  type RevocationOutcome,
} from '../lib/connections';

export type ProviderLoad = { status: 'loading' | 'error' | 'ready'; providers?: PublicProvider[] };

export function useProviders(enabled: boolean) {
  const [state, setState] = useState<ProviderLoad>({ status: 'loading' });
  async function load() {
    setState({ status: 'loading' });
    try {
      const response = await fetch('/api/providers', { credentials: 'same-origin', cache: 'no-store', headers: { accept: 'application/json' } });
      if (response.status === 401) {
        window.location.replace('/auth/sign-in');
        return;
      }
      if (!response.ok) throw new Error('unavailable');
      const parsed = parseProviderList(await response.json());
      if (!parsed) throw new Error('invalid');
      setState({ status: 'ready', providers: parsed });
    } catch {
      setState({ status: 'error' });
    }
  }
  useEffect(() => {
    if (enabled) void load();
  }, [enabled]);
  return { state, load };
}

function initialNotice(): { result: ResultCode; provider: PublicProvider['id'] | null; revocation: RevocationOutcome | null } | null {
  const params = new URLSearchParams(location.search);
  const result = params.get('result');
  if (!isResultCode(result)) return null;
  const provider = params.get('provider');
  const revocation = params.get('revocation');
  return {
    result,
    provider: isProviderId(provider) ? provider : null,
    revocation: isRevocationOutcome(revocation) ? revocation : null,
  };
}

export function Connections({ load, reload }: { load: ProviderLoad; reload: () => void }) {
  const [notice, setNotice] = useState(initialNotice);
  const message = notice ? resultMessage(notice.result, notice.provider, notice.revocation) : null;
  return (
    <>
      <PageHeader
        kicker="ACCOUNTS"
        title="Connections"
        description="Intake creates forms in an account you control. Connecting is separate from signing in — Intake only gets access when you connect a provider here."
      />
      {message && <div className={`form-banner ${message.tone}`} role="status">{message.text}</div>}
      {load.status === 'loading' && <Skeleton variant="rows" lines={2} label="Checking your connections" />}
      {load.status === 'error' && (
        <ErrorState
          title="Connections could not be loaded"
          detail="Intake couldn’t reach its own records. This does not mean your accounts are disconnected."
          onRetry={() => void reload()}
        />
      )}
      <Section
        eyebrow="FORM PROVIDERS"
        title="Where Intake creates forms"
        description="One account per provider. Connecting is a separate permission from signing in, and Intake only uses it for the workflows you explicitly confirm."
        actions={<a className="btn btn-ghost btn-sm" href="/app/library">Your forms ↗</a>}
      >
        {load.status === 'ready' && load.providers && (load.providers.length > 0
          ? <div className="provider-list">
            {load.providers.map(provider => <ProviderRow key={provider.id} provider={provider} onChange={result => { setNotice(result); void reload(); }} />)}
          </div>
          : <EmptyState
            title="No providers are configured on this server"
            detail="An operator turns these on. Your saved forms stay in the Library either way."
          />)}
      </Section>
      <Note>Disconnecting stops Intake from using that account. It does not delete forms that already exist. One account per provider — disconnect before switching.</Note>
    </>
  );
}

function ProviderRow({ provider, onChange }: { provider: PublicProvider; onChange: (result: { result: ResultCode; provider: PublicProvider['id']; revocation: RevocationOutcome | null }) => void }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [disconnecting, setDisconnecting] = useState(false);
  const [error, setError] = useState('');
  const needsSetup = !provider.configured && provider.status === 'not_connected';
  const status = statusLabel(provider);

  async function disconnect(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (disconnecting) return;
    setDisconnecting(true);
    setError('');
    try {
      const response = await fetch(`/api/providers/${provider.id}/disconnect`, {
        method: 'POST',
        credentials: 'same-origin',
        headers: { accept: 'application/json' },
      });
      if (response.status === 401) {
        window.location.replace('/auth/sign-in');
        return;
      }
      const body = await response.json().catch(() => null) as { result?: string; revocation?: string } | null;
      if (!response.ok || !body || !isResultCode(body.result)) {
        setError('Could not disconnect. The connection is still active here.');
        setDisconnecting(false);
        return;
      }
      onChange({ result: body.result, provider: provider.id, revocation: isRevocationOutcome(body.revocation) ? body.revocation : null });
      setConfirming(false);
    } catch {
      setError('Could not reach Intake. The connection was not changed.');
    } finally {
      setDisconnecting(false);
    }
  }

  return (
    <article className="provider-row">
      <ProviderMark provider={provider.id} />
      <div className="provider-main">
        <div className="provider-title">
          <h2>{provider.name}</h2>
          <span className={`status-pill ${status.tone}`}>{status.label}</span>
        </div>
        <p>{provider.description}</p>
        {provider.accountEmail && <p className="provider-account">{provider.accountEmail}{provider.accountLabel ? ` · ${provider.accountLabel}` : ''}</p>}
        {!provider.accountEmail && provider.accountLabel && <p className="provider-account">{provider.accountLabel}</p>}
        <p className="provider-note">{provider.formsNote}</p>
        {needsSetup && <p className="provider-note">This server is missing {joinList(provider.setupEnv)}. No connection can be created until that is set.</p>}
        {provider.status === 'connected' && !provider.configured && <p className="provider-note">OAuth credentials are missing on this server, so Intake cannot refresh this connection until setup is finished.</p>}
        {provider.status === 'expired' && <p className="provider-note">This authorization has expired. Connect again to keep using it. Nothing is using it now.</p>}
        {provider.status === 'reauthorization_required' && <p className="provider-note">Intake needs you to authorize {provider.accountName} again. The previous grant is not usable.</p>}
        {provider.status === 'connected' && !provider.canRefresh && <p className="provider-note">This connection cannot be renewed automatically. Reconnect when it expires.</p>}
        {open && (
          <div className="manage-panel">
            <span className="info-index">AUTHORIZED ACCESS</span>
            {provider.scopeLabels.length ? <ul className="scope-list">{provider.scopeLabels.map(label => <li key={label}>{label}</li>)}</ul> : <p className="provider-note">No scopes are stored for this connection.</p>}
            {provider.connectedAt && <p className="provider-note">Last authorized {formatWhen(provider.connectedAt)}.</p>}
            {provider.permissionLinks.length > 0 && (
              <p className="provider-links">{provider.permissionLinks.map(link => <a key={link.href} href={link.href} target="_blank" rel="noreferrer">{link.label} ↗</a>)}</p>
            )}
          </div>
        )}
        {confirming && (
          <form className="confirm-panel" method="POST" action={`/api/providers/${provider.id}/disconnect`} onSubmit={event => void disconnect(event)}>
            <p>Disconnect {provider.accountName}? Intake will stop using this account. Forms already there are not deleted.</p>
            {provider.revocation === 'unsupported' && <p>{provider.accountName} does not let Intake revoke the consent grant. You can also remove Intake from your {provider.accountName} account permissions.</p>}
            {error && <p role="alert">{error}</p>}
            <div className="confirm-actions">
              <button className="btn btn-accent btn-sm" type="submit" disabled={disconnecting}>{disconnecting ? 'Disconnecting…' : 'Disconnect'}</button>
              <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirming(false)} disabled={disconnecting}>Keep connected</button>
            </div>
          </form>
        )}
      </div>
      <div className="provider-actions">
        {provider.configured && provider.status === 'not_connected' && (
          <form method="POST" action={`/api/providers/${provider.id}/connect`}><button className="btn btn-accent btn-sm" type="submit">Connect {provider.accountName}</button></form>
        )}
        {provider.configured && (provider.status === 'expired' || provider.status === 'reauthorization_required') && (
          <form method="POST" action={`/api/providers/${provider.id}/connect`}><button className="btn btn-accent btn-sm" type="submit">Reconnect</button></form>
        )}
        {provider.status !== 'not_connected' && (
          <>
            <button className="btn btn-ghost btn-sm" type="button" aria-expanded={open} onClick={() => setOpen(value => !value)}>{open ? 'Hide' : 'Manage'}</button>
            {!confirming && <button className="btn btn-ghost btn-sm" type="button" onClick={() => setConfirming(true)}>Disconnect</button>}
          </>
        )}
      </div>
    </article>
  );
}

function statusLabel(provider: PublicProvider): { label: string; tone: 'ok' | 'warn' | 'muted' } {
  if (!provider.configured && provider.status === 'not_connected') return { label: 'Setup required', tone: 'warn' };
  if (provider.status === 'connected') return { label: 'Connected', tone: 'ok' };
  if (provider.status === 'expired') return { label: 'Expired', tone: 'warn' };
  if (provider.status === 'reauthorization_required') return { label: 'Reconnect required', tone: 'warn' };
  return { label: 'Not connected', tone: 'muted' };
}

function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? 'provider configuration';
  if (items.length === 2) return `${items[0]} and ${items[1]}`;
  return `${items.slice(0, -1).join(', ')}, and ${items[items.length - 1]}`;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return 'recently';
  return date.toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

export function connectionSummary(providers: PublicProvider[] | null | undefined): string {
  if (!providers) return 'View connections';
  const connected = providers.filter(provider => provider.status === 'connected');
  if (!connected.length) return 'No providers connected';
  return connected.map(provider => provider.accountName).join(' and ') + ' connected';
}
