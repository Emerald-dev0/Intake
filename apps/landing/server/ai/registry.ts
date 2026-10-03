import { createGroqProvider, readGroqModel } from './groq';
import { createOpenAiProvider, readOpenAiModel } from './openai';
import { createUnconfiguredProvider, isAiProviderId, type AiProvider, type AiProviderStatus } from './provider';

/**
 * Chooses the deployment's AI provider. Order is deliberate and deterministic:
 *
 * 1. `AI_PROVIDER=groq|openai` — an explicit operator choice. A missing credential for the chosen
 *    provider is a startup error: a deployment that says "groq" and has no key must not silently
 *    fall back to a different vendor.
 * 2. `GROQ_API_KEY` present — Groq, the primary provider.
 * 3. `OPENAI_API_KEY` present — OpenAI, so existing deployments keep working unchanged.
 * 4. Neither — a stand-in provider that fails with `model_not_configured` on use, so every
 *    non-AI route still works and no fake specification is ever produced.
 *
 * There is no automatic provider fallback at request time: a failed call is reported to the user
 * instead of being re-sent to another vendor.
 */
export interface AiProviderOptions {
  env: NodeJS.ProcessEnv;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  groqEndpoint?: string;
  openAiEndpoint?: string;
}

const NOT_CONFIGURED_MESSAGE = 'Live interpretation is not configured on this Intake server (GROQ_API_KEY is missing). No changes were made.';

export function readMaxCompletionTokens(env: NodeJS.ProcessEnv): number | undefined {
  const raw = env.AI_MAX_COMPLETION_TOKENS?.trim();
  if (!raw) return undefined;
  if (!/^\d+$/.test(raw)) throw new Error('AI_MAX_COMPLETION_TOKENS must be an integer between 256 and 32768.');
  const value = Number(raw);
  if (!Number.isSafeInteger(value) || value < 256 || value > 32_768) throw new Error('AI_MAX_COMPLETION_TOKENS must be an integer between 256 and 32768.');
  return value;
}

export function resolveAiProvider(options: AiProviderOptions): AiProvider {
  const env = options.env;
  const maxCompletionTokens = options.maxCompletionTokens ?? readMaxCompletionTokens(env);
  const common = { env, fetchImpl: options.fetchImpl, timeoutMs: options.timeoutMs, maxCompletionTokens };
  const explicit = env.AI_PROVIDER?.trim().toLowerCase();
  if (explicit) {
    if (!isAiProviderId(explicit)) throw new Error('AI_PROVIDER must be groq or openai.');
    if (explicit === 'groq') {
      if (!env.GROQ_API_KEY?.trim()) throw new Error('AI_PROVIDER=groq requires GROQ_API_KEY.');
      return createGroqProvider({ ...common, endpoint: options.groqEndpoint });
    }
    if (!env.OPENAI_API_KEY?.trim()) throw new Error('AI_PROVIDER=openai requires OPENAI_API_KEY.');
    return createOpenAiProvider({ ...common, endpoint: options.openAiEndpoint });
  }
  if (env.GROQ_API_KEY?.trim()) return createGroqProvider({ ...common, endpoint: options.groqEndpoint });
  if (env.OPENAI_API_KEY?.trim()) return createOpenAiProvider({ ...common, endpoint: options.openAiEndpoint });
  return createUnconfiguredProvider(NOT_CONFIGURED_MESSAGE);
}

/** Safe for startup logs and status output: no key, no endpoint credentials, no prompt. */
export function describeAiProvider(provider: AiProvider): AiProviderStatus {
  return provider.id === 'none'
    ? { configured: false, provider: null, model: null }
    : { configured: true, provider: provider.id, model: provider.model };
}

/** Startup log line, e.g. `groq/openai/gpt-oss-120b` or `not configured`. */
export function aiProviderLabel(env: NodeJS.ProcessEnv): string {
  const provider = resolveAiProvider({ env });
  if (provider.id === 'none') return 'not configured (no GROQ_API_KEY or OPENAI_API_KEY)';
  if (provider.id === 'groq') return `groq/${readGroqModel(env)}`;
  return `openai/${readOpenAiModel(env)}`;
}
