/** Public provider-connection contract. Safe to import from the browser. No tokens. */

export const PROVIDER_IDS = ['google', 'microsoft'] as const;
export type ProviderId = (typeof PROVIDER_IDS)[number];

export const RESULT_CODES = [
  'connected',
  'disconnected',
  'cancelled',
  'denied',
  'invalid_callback',
  'invalid_state',
  'expired_state',
  'session_expired',
  'exchange_failed',
  'expired_code',
  'provider_unavailable',
  'not_configured',
  'unsupported_provider',
  'connection_conflict',
  'insufficient_permissions',
  'storage_failed',
  'storage_unavailable',
  'rate_limited',
] as const;
export type ResultCode = (typeof RESULT_CODES)[number];

export const CONNECTION_STATUSES = ['not_connected', 'connected', 'expired', 'reauthorization_required'] as const;
export type ConnectionStatus = (typeof CONNECTION_STATUSES)[number];

export const REVOCATION_OUTCOMES = ['revoked', 'failed', 'unsupported', 'not_attempted'] as const;
export type RevocationOutcome = (typeof REVOCATION_OUTCOMES)[number];

export interface PermissionLink {
  label: string;
  href: string;
}

export interface PublicProvider {
  id: ProviderId;
  name: string;
  accountName: string;
  description: string;
  configured: boolean;
  setupEnv: string[];
  status: ConnectionStatus;
  accountEmail: string | null;
  accountLabel: string | null;
  scopes: string[];
  scopeLabels: string[];
  connectedAt: string | null;
  canRefresh: boolean;
  revocation: 'supported' | 'unsupported';
  formsApi: 'supported' | 'unsupported';
  formsNote: string;
  permissionLinks: PermissionLink[];
}

export function isProviderId(value: string | null | undefined): value is ProviderId {
  return value === 'google' || value === 'microsoft';
}

export function isResultCode(value: string | null | undefined): value is ResultCode {
  return !!value && (RESULT_CODES as readonly string[]).includes(value);
}

export function isRevocationOutcome(value: string | null | undefined): value is RevocationOutcome {
  return !!value && (REVOCATION_OUTCOMES as readonly string[]).includes(value);
}

const PERMISSION_HOSTS = new Set([
  'myaccount.google.com',
  'account.live.com',
  'myaccount.microsoft.com',
  'myapplications.microsoft.com',
]);

export function safePermissionLinks(links: unknown): PermissionLink[] {
  if (!Array.isArray(links)) return [];
  const safe: PermissionLink[] = [];
  for (const link of links) {
    if (!link || typeof link !== 'object') continue;
    const label = (link as { label?: unknown }).label;
    const href = (link as { href?: unknown }).href;
    if (typeof label !== 'string' || typeof href !== 'string' || label.length > 80) continue;
    try {
      const url = new URL(href);
      if (url.protocol !== 'https:' || !PERMISSION_HOSTS.has(url.hostname) || url.username || url.password) continue;
      safe.push({ label, href: url.toString() });
    } catch {
      continue;
    }
  }
  return safe;
}

function cleanText(value: unknown, max: number): string | null {
  if (typeof value !== 'string') return null;
  const text = value.replace(/[\u0000-\u001f]/g, '').trim();
  if (!text) return null;
  return text.slice(0, max);
}

export function parseProviderList(data: unknown): PublicProvider[] | null {
  if (!data || typeof data !== 'object' || !Array.isArray((data as { providers?: unknown }).providers)) return null;
  const providers: PublicProvider[] = [];
  for (const item of (data as { providers: unknown[] }).providers) {
    if (!item || typeof item !== 'object') return null;
    const row = item as Record<string, unknown>;
    const id = typeof row.id === 'string' ? row.id : null;
    if (!isProviderId(id)) return null;
    if (typeof row.name !== 'string' || typeof row.accountName !== 'string' || typeof row.description !== 'string') return null;
    if (typeof row.configured !== 'boolean' || typeof row.canRefresh !== 'boolean') return null;
    if (typeof row.status !== 'string' || !(CONNECTION_STATUSES as readonly string[]).includes(row.status)) return null;
    if (row.revocation !== 'supported' && row.revocation !== 'unsupported') return null;
    if (row.formsApi !== 'supported' && row.formsApi !== 'unsupported') return null;
    if (typeof row.formsNote !== 'string') return null;
    if (!Array.isArray(row.scopes) || !row.scopes.every((scope): scope is string => typeof scope === 'string' && scope.length < 200)) return null;
    if (!Array.isArray(row.scopeLabels) || !row.scopeLabels.every((label): label is string => typeof label === 'string')) return null;
    if (!Array.isArray(row.setupEnv) || !row.setupEnv.every((name): name is string => typeof name === 'string' && /^[A-Z0-9_]+$/.test(name))) return null;
    providers.push({
      id,
      name: row.name,
      accountName: row.accountName,
      description: row.description,
      configured: row.configured,
      setupEnv: row.setupEnv,
      status: row.status as ConnectionStatus,
      accountEmail: cleanText(row.accountEmail, 320),
      accountLabel: cleanText(row.accountLabel, 120),
      scopes: row.scopes,
      scopeLabels: row.scopeLabels.map(label => label.slice(0, 160)),
      connectedAt: typeof row.connectedAt === 'string' ? row.connectedAt : null,
      canRefresh: row.canRefresh,
      revocation: row.revocation,
      formsApi: row.formsApi,
      formsNote: row.formsNote,
      permissionLinks: safePermissionLinks(row.permissionLinks),
    });
  }
  return providers;
}

export function providerAccountName(id: ProviderId | null): string {
  if (id === 'google') return 'Google';
  if (id === 'microsoft') return 'Microsoft';
  return 'Provider';
}

export function resultMessage(code: ResultCode, provider: ProviderId | null, revocation?: RevocationOutcome | null): { tone: 'ok' | 'warn' | 'bad'; text: string } {
  const name = providerAccountName(provider);
  switch (code) {
    case 'connected':
      return { tone: 'ok', text: `${name} is connected to this Intake account. No form was created.` };
    case 'disconnected':
      if (revocation === 'failed') return { tone: 'warn', text: `${name} is disconnected in Intake, but the provider did not confirm that its permission was revoked. Remove Intake from your ${name} account permissions if you want that gone too.` };
      if (revocation === 'unsupported') return { tone: 'ok', text: `${name} is disconnected in Intake. Intake will not use that account. ${name} does not let Intake revoke the consent grant itself — you can remove it from your ${name} account permissions.` };
      if (revocation === 'not_attempted') return { tone: 'ok', text: `${name} is already disconnected.` };
      return { tone: 'ok', text: `${name} is disconnected. Intake will not use that account, and the provider permission was revoked. Forms already in the account were not deleted.` };
    case 'cancelled':
      return { tone: 'warn', text: `You closed ${name} authorization before it finished. Nothing was connected.` };
    case 'denied':
      return { tone: 'warn', text: `${name} did not grant access. Nothing was connected.` };
    case 'invalid_callback':
      return { tone: 'bad', text: 'The authorization response was incomplete. Nothing was connected. Try again.' };
    case 'invalid_state':
      return { tone: 'bad', text: 'Intake could not match this authorization to your account. Nothing was connected. Start the connection again.' };
    case 'expired_state':
      return { tone: 'warn', text: 'That authorization took too long and was discarded. Nothing was connected. Try again.' };
    case 'session_expired':
      return { tone: 'warn', text: 'Your Intake session ended before authorization finished. Sign in, then connect again.' };
    case 'exchange_failed':
      return { tone: 'bad', text: `${name} accepted the redirect, but Intake could not finish the connection. Nothing was saved. Try again.` };
    case 'expired_code':
      return { tone: 'warn', text: 'That authorization expired before Intake could finish. Nothing was connected. Try again.' };
    case 'provider_unavailable':
      return { tone: 'bad', text: `${name} could not be reached. Nothing was changed. Try again in a moment.` };
    case 'not_configured':
      return { tone: 'warn', text: `${name} is not set up on this Intake server yet. No connection was created.` };
    case 'unsupported_provider':
      return { tone: 'bad', text: 'That provider is not supported.' };
    case 'connection_conflict':
      return { tone: 'warn', text: `This Intake account is already connected to a different ${name} account. Disconnect it first if you want to switch.` };
    case 'insufficient_permissions':
      return { tone: 'warn', text: `${name} did not grant the permissions Intake needs. Nothing was saved. Connect again and allow the requested access.` };
    case 'storage_failed':
      return { tone: 'bad', text: 'Intake could not save the connection. Nothing was left active. Try again.' };
    case 'storage_unavailable':
      return { tone: 'bad', text: 'Provider storage is not ready. Nothing was changed.' };
    case 'rate_limited':
      return { tone: 'warn', text: 'Too many connection attempts. Wait a few minutes and try again.' };
  }
}
