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
  identity: { type: 'google-userinfo'; url: string } | { type: 'microsoft-id-token'; jwksUrl: string; tenant: string } | { type: 'typeform-userinfo'; url: string };
  revocation: { type: 'google'; url: string } | { type: 'unsupported' };
  /**
   * Send PKCE (S256 challenge + verifier). Google and Microsoft accept it; Typeform's OAuth 2.0
   * server documents only the classic code exchange, so an unknown parameter there is a risk to the
   * consent screen for no security gain — Typeform's grant is a confidential client with a state,
   * nonce-less callback instead.
   */
  pkce: boolean;
  /** Send an OIDC `nonce`. Only providers that echo it back (OIDC) can bind it to anything. */
  oidcNonce: boolean;
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
  if (id === 'typeform') return typeformDefinition();
  const tenant = microsoftTenant(env);
  const definition = microsoftDefinition(tenant.tenant);
  if (!tenant.valid) definition.configurationError = 'MICROSOFT_OAUTH_TENANT is not common, organizations, consumers, or a tenant GUID.';
  return definition;
}

export function supportedProviders(env: NodeJS.ProcessEnv): ProviderDefinition[] {
  // Microsoft is still recognized for an existing grant, but it is not offered on the Connections
  // page: it has no supported Forms creation API, so a connection there only ever records identity.
  return (['google', 'typeform'] as const).map(id => providerDefinition(id, env));
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
    formsNote: 'Intake uses the Google Forms API to create forms in this account. It cannot read responses unless you separately enable response summaries.',
    scopeLabels: {
      openid: 'Confirm the Google account you connect',
      email: 'See the email address of that Google account',
      'https://www.googleapis.com/auth/forms.body': 'Create and edit your Google Forms',
      'https://www.googleapis.com/auth/forms.responses.readonly': 'Read response summaries for your forms (only if you enable them)',
    },
    permissionLinks: [{ label: 'Google account permissions', href: 'https://myaccount.google.com/permissions' }],
    pkce: true,
    oidcNonce: true,
    sendScopesOnRefresh: false,
  };
}

function typeformDefinition(): ProviderDefinition {
  return {
    id: 'typeform',
    name: 'Typeform',
    accountName: 'Typeform',
    description: 'Connect your Typeform account so Intake can create and manage Typeforms there. Signing in to Intake does not do this.',
    // `accounts:read` is what GET /me needs (connection identity), `forms:read` lets an imported
    // form be inspected, and `offline` is Typeform's documented requirement for a refresh token —
    // without it every connection dies after the one-week access-token lifetime.
    scopes: ['accounts:read', 'forms:read', 'forms:write', 'offline'],
    requiredScopes: ['forms:read', 'forms:write'],
    authorizationEndpoint: 'https://api.typeform.com/oauth/authorize',
    tokenEndpoint: 'https://api.typeform.com/oauth/token',
    extraAuthParams: {},
    clientIdEnv: 'TYPEFORM_OAUTH_CLIENT_ID',
    clientSecretEnv: 'TYPEFORM_OAUTH_CLIENT_SECRET',
    identity: { type: 'typeform-userinfo', url: 'https://api.typeform.com/me' },
    revocation: { type: 'unsupported' },
    formsApi: 'supported',
    formsNote: 'Intake creates Typeforms in this account after you confirm a reviewed draft, and can open and archive them from your library. Editing an existing Typeform inside Intake is not supported yet.',
    scopeLabels: {
      'accounts:read': 'See which Typeform account you connected',
      'forms:read': 'Read your Typeforms',
      'forms:write': 'Create your Typeforms',
      offline: 'Stay connected between visits (refresh token)',
    },
    // The documented revocation route is a REST call with the app's own token, not an endpoint a
    // third party can call for someone else's grant, and there is no per-grant admin URL.
    permissionLinks: [{ label: 'Typeform developer apps', href: 'https://www.typeform.com/developers/get-started/applications/' }],
    pkce: false,
    oidcNonce: false,
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
    pkce: true,
    oidcNonce: true,
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
