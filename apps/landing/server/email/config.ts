import { isPlaceholderValue } from '../config';

/**
 * Email configuration.
 *
 * Every value here is server-only. A `CALDER_*` variable must never carry a `VITE_` prefix: the
 * preflight check fails the deployment if one does (see server/preflight.ts).
 *
 * Naming follows Calder's own conventions (`CALDER_BASE_URL`, `CALDER_API_KEY`) so an operator
 * moving between Calder's docs and Intake's environment sees the same variable names.
 */

export interface EmailConfig {
  /** `calder` (default, and the only production provider), `memory` (tests/local), or `none`. */
  provider: 'calder' | 'memory' | 'none';
  baseUrl: string;
  apiKey: string;
  fromEmail: string;
  fromName: string;
  replyTo: string | null;
  /** Optional Calder sender identity (`sender_…`). When set, Calder resolves address + display name. */
  senderId: string | null;
  /** Per-attempt timeout. Bounded so an email can never hang an Intake request (mission §7). */
  timeoutMs: number;
  /** Total attempts including the first one. Bounded: 3 (mission §7). */
  maxAttempts: number;
  /** Signing secret for Calder delivery webhooks (`whsec_…`). */
  webhookSecret: string;
  /** Optional per-template Calder aliases. Empty means Intake renders every email itself. */
  templateAliases: Record<string, string>;
  /** Absolute origins used inside emails. Never a Calder URL: links always point at Intake. */
  appOrigin: string;
  marketingOrigin: string;
  configured: boolean;
}

const DEFAULT_BASE_URL = 'https://api.calder.click';
const EMAIL = /^[^\s@,]+@[^\s@,]+\.[^\s@,]{2,}$/;
const ALIAS = /^[a-z0-9-]{1,100}$/;

function integer(value: string | undefined, fallback: number, min: number, max: number, name: string): number {
  if (!value?.trim()) return fallback;
  if (!/^\d+$/.test(value.trim())) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  const parsed = Number(value);
  if (!Number.isSafeInteger(parsed) || parsed < min || parsed > max) throw new Error(`${name} must be an integer between ${min} and ${max}.`);
  return parsed;
}

function httpsUrl(value: string, name: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${name} must be an absolute https URL.`);
  }
  if (url.protocol !== 'https:' && !(url.protocol === 'http:' && (url.hostname === 'localhost' || url.hostname === '127.0.0.1'))) {
    throw new Error(`${name} must use https.`);
  }
  return url.origin;
}

function origin(value: string | undefined, fallback: string, name: string): string {
  const raw = value?.trim() || fallback;
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    throw new Error(`${name} must be an absolute origin.`);
  }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error(`${name} must be an http(s) origin.`);
  return url.origin;
}

/** Reads aliases of the form `CALDER_TEMPLATE_OTP=intake-otp`. Unknown keys are ignored. */
function readTemplateAliases(env: NodeJS.ProcessEnv): Record<string, string> {
  const aliases: Record<string, string> = {};
  for (const [key, value] of Object.entries(env)) {
    if (!key.startsWith('CALDER_TEMPLATE_') || !value?.trim()) continue;
    const name = key.slice('CALDER_TEMPLATE_'.length).toLowerCase().replace(/_/g, '-');
    if (!ALIAS.test(value.trim())) throw new Error(`${key} must be a lowercase Calder template alias (a-z, 0-9 and hyphens).`);
    aliases[name] = value.trim();
  }
  return aliases;
}

/**
 * Validates the email environment without ever returning or logging a secret value.
 *
 * `configured` is deliberately strict: a placeholder key or a missing sender identity means
 * Intake reports `email_provider_not_configured` instead of silently pretending to send.
 */
export function readEmailConfig(env: NodeJS.ProcessEnv = process.env): EmailConfig {
  const providerRaw = (env.EMAIL_PROVIDER ?? '').trim().toLowerCase() || 'calder';
  if (!['calder', 'memory', 'none'].includes(providerRaw)) {
    throw new Error('EMAIL_PROVIDER must be calder, memory, or none.');
  }
  const provider = providerRaw as EmailConfig['provider'];

  const apiKey = (env.CALDER_API_KEY ?? '').trim();
  const fromEmail = (env.CALDER_FROM_EMAIL ?? '').trim().toLowerCase();
  const fromName = (env.CALDER_FROM_NAME ?? '').trim() || 'Intake';
  const replyTo = (env.CALDER_REPLY_TO ?? '').trim().toLowerCase() || null;
  const baseUrl = (env.CALDER_BASE_URL ?? '').trim() || DEFAULT_BASE_URL;
  const senderIdRaw = (env.CALDER_SENDER_ID ?? '').trim();

  if (provider === 'calder') {
    if (apiKey && isPlaceholderValue(apiKey)) throw new Error('CALDER_API_KEY is a placeholder value.');
    if (apiKey.startsWith('whsec_')) {
      // A webhook signing secret pasted into the API-key slot never sends mail; fail loudly instead
      // of producing authentication errors on every send.
      throw new Error('CALDER_API_KEY holds a webhook signing secret. Use a calder_sk_… API key.');
    }
    if (fromEmail && !EMAIL.test(fromEmail)) throw new Error('CALDER_FROM_EMAIL must be a valid email address.');
    if (replyTo && !EMAIL.test(replyTo)) throw new Error('CALDER_REPLY_TO must be a valid email address.');
    if (fromEmail && apiKey) httpsUrl(baseUrl, 'CALDER_BASE_URL');
  }

  // A sender identity id is a complete sender on its own; otherwise the address is required.
  const configured = provider === 'calder' && Boolean(apiKey) && (Boolean(fromEmail) || Boolean(senderIdRaw));

  return {
    provider,
    baseUrl: provider === 'calder' && configured ? httpsUrl(baseUrl, 'CALDER_BASE_URL') : baseUrl,
    apiKey,
    fromEmail,
    fromName,
    replyTo,
    senderId: senderIdRaw || null,
    timeoutMs: integer(env.EMAIL_TIMEOUT_MS, 10_000, 1_000, 30_000, 'EMAIL_TIMEOUT_MS'),
    maxAttempts: integer(env.EMAIL_MAX_ATTEMPTS, 3, 1, 5, 'EMAIL_MAX_ATTEMPTS'),
    webhookSecret: (env.CALDER_WEBHOOK_SECRET ?? '').trim(),
    templateAliases: readTemplateAliases(env),
    appOrigin: origin(env.BETTER_AUTH_URL, 'http://localhost:5173', 'BETTER_AUTH_URL'),
    marketingOrigin: origin(env.VITE_SITE_URL, env.BETTER_AUTH_URL ?? 'http://localhost:5173', 'VITE_SITE_URL'),
    configured,
  };
}

/** True when the deployment can verify webhook signatures. Unverified payloads are never trusted. */
export function webhooksEnabled(config: EmailConfig): boolean {
  return Boolean(config.webhookSecret) && config.provider === 'calder';
}

/** Test keys never reach a real mailbox. Surfaced in preflight and the admin console. */
export function isTestCredential(config: EmailConfig): boolean {
  return /_test_/.test(config.apiKey);
}
