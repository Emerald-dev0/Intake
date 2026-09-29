import type { ProviderId } from '../../src/lib/connections';
import { publicOrigin } from './oauth';

export interface ProviderDefinition {
  id: ProviderId;
  name: string;
  accountName: string;
  description: string;
  /** Scopes requested on the consent screen. Identity scopes plus the least Forms access that exists. */
  scopes: string[];
  /** Scopes that must actually be granted before a connection is stored. */
  requiredScopes: string[];
  authorizationEndpoint: string;
  tokenEndpoint: string;
  extraAuthParams: Record<string, string>;
  clientIdEnv: string;
  clientSecretEnv: string;
  identity: { type: 'google-userinfo'; url: string } | { type: 'microsoft-id-token'; jwksUrl: string; tenant: string };
  revocation: { type: 'google'; url: string } | { type: 'unsupported' };
  formsApi: 'supported' | 'unsupported';
  formsNote: string;
  scopeLabels: Record<string, string>;
  permissionLinks: { label: string; href: string }[];
  /** Include the original scopes when refreshing. Microsoft requires this; Google does not. */
  sendScopesOnRefresh: boolean;
  /** Set when env is present but unusable. The provider stays visible and unconfigured. */
  configurationError?: string;
}

const PLACEHOLDER = /^(your[-_ ]|changeme|change-me|placeholder|todo\b|<)/i;

export function isConfiguredValue(value: string | undefined): boolean {
  if (!value) return false;
  const trimmed = value.trim();
  if (trimmed.length < 8) return false;
  if (PLACEHOLDER.test(trimmed)) return false;
  if (['changeme', 'placeholder', 'example', 'todo', 'xxx', 'xxxxxxxx'].includes(trimmed.toLowerCase())) return false;
  return true;
}

export function microsoftTenant(env: NodeJS.ProcessEnv): { tenant: string; valid: boolean } {
  const raw = env.MICROSOFT_OAUTH_TENANT?.trim() || 'common';
  if (/^(common|organizations|consumers)$/i.test(raw)) return { tenant: raw.toLowerCase(), valid: true };
  if (/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(raw)) return { tenant: raw.toLowerCase(), valid: true };
  return { tenant: 'common', valid: false };
}

export function providerDefinition(id: ProviderId, env: NodeJS.ProcessEnv): ProviderDefinition {
  if (id === 'google') return googleDefinition();
  const tenant = microsoftTenant(env);
  const definition = microsoftDefinition(tenant.tenant);
  if (!tenant.valid) definition.configurationError = 'MICROSOFT_OAUTH_TENANT is not common, organizations, consumers, or a tenant GUID.';
  return definition;
}

export function supportedProviders(env: NodeJS.ProcessEnv): ProviderDefinition[] {
  return (['google', 'microsoft'] as const).map(id => providerDefinition(id, env));
}

export function isProviderConfigured(definition: ProviderDefinition, env: NodeJS.ProcessEnv): boolean {
  return missingProviderEnv(definition, env).length === 0;
}

export function missingProviderEnv(definition: ProviderDefinition, env: NodeJS.ProcessEnv): string[] {
  const missing: string[] = [];
  if (definition.configurationError) missing.push('MICROSOFT_OAUTH_TENANT');
  if (!publicOrigin(env.BETTER_AUTH_URL)) missing.push('BETTER_AUTH_URL');
  if (!isConfiguredValue(env[definition.clientIdEnv])) missing.push(definition.clientIdEnv);
  if (!isConfiguredValue(env[definition.clientSecretEnv])) missing.push(definition.clientSecretEnv);
  return missing;
}

function googleDefinition(): ProviderDefinition {
  return {
    id: 'google',
    name: 'Google Forms',
    accountName: 'Google',
    description: 'Connect your Google account so Intake can create Google Forms there. Signing in to Intake does not do this.',
    scopes: ['openid', 'email', 'https://www.googleapis.com/auth/forms.body'],
    requiredScopes: ['https://www.googleapis.com/auth/forms.body'],
    authorizationEndpoint: 'https://accounts.google.com/o/oauth2/v2/auth',
    tokenEndpoint: 'https://oauth2.googleapis.com/token',
    extraAuthParams: {
      access_type: 'offline',
      include_granted_scopes: 'true',
      prompt: 'consent select_account',
    },
    clientIdEnv: 'GOOGLE_OAUTH_CLIENT_ID',
    clientSecretEnv: 'GOOGLE_OAUTH_CLIENT_SECRET',
    identity: { type: 'google-userinfo', url: 'https://openidconnect.googleapis.com/v1/userinfo' },
    revocation: { type: 'google', url: 'https://oauth2.googleapis.com/revoke' },
    formsApi: 'supported',
    formsNote: 'Intake uses the Google Forms API to create forms in this account. It cannot read responses or your Drive files.',
    scopeLabels: {
      openid: 'Confirm the Google account you connect',
      email: 'See the email address of that Google account',
      'https://www.googleapis.com/auth/forms.body': 'Create and edit your Google Forms',
    },
    permissionLinks: [{ label: 'Google account permissions', href: 'https://myaccount.google.com/permissions' }],
    sendScopesOnRefresh: false,
  };
}

function microsoftDefinition(tenant: string): ProviderDefinition {
  const base = `https://login.microsoftonline.com/${tenant}/oauth2/v2.0`;
  return {
    id: 'microsoft',
    name: 'Microsoft Forms',
    accountName: 'Microsoft',
    description: 'Connect your Microsoft account to authorize it explicitly. Microsoft does not publish a supported API for creating or editing Forms, so this does not let Intake create forms.',
    // Identity + refresh only. There is no supported Microsoft Forms create/edit scope to request.
    scopes: ['openid', 'profile', 'email', 'offline_access'],
    requiredScopes: [],
    authorizationEndpoint: `${base}/authorize`,
    tokenEndpoint: `${base}/token`,
    extraAuthParams: {
      prompt: 'select_account consent',
      response_mode: 'query',
    },
    clientIdEnv: 'MICROSOFT_OAUTH_CLIENT_ID',
    clientSecretEnv: 'MICROSOFT_OAUTH_CLIENT_SECRET',
    identity: { type: 'microsoft-id-token', jwksUrl: `https://login.microsoftonline.com/${tenant}/discovery/v2.0/keys`, tenant },
    revocation: { type: 'unsupported' },
    formsApi: 'unsupported',
    formsNote: 'Microsoft Graph has no supported Forms create or edit API. OrgSettings-Forms only changes organization settings, so Intake does not request it. This connection cannot create forms.',
    scopeLabels: {
      openid: 'Confirm the Microsoft account you connect',
      profile: 'See the name of that Microsoft account',
      email: 'See the email address of that Microsoft account',
      offline_access: 'Stay connected until you disconnect',
    },
    permissionLinks: [
      { label: 'Personal Microsoft account permissions', href: 'https://account.live.com/consent/Manage' },
      { label: 'Work or school account apps', href: 'https://myapplications.microsoft.com/' },
      { label: 'Microsoft account app permissions', href: 'https://myaccount.microsoft.com/' },
    ],
    sendScopesOnRefresh: true,
  };
}

export const FORBIDDEN_SCOPE_MARKERS = [
  'gmail',
  'drive',
  'calendar',
  'contacts',
  'spreadsheets',
  'mail.',
  'files.',
  'calendars.',
  'contacts.',
  'user.read',
  'directory.',
  'orgsettings-forms',
  '.default',
];
