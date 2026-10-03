import { createChatCompletionsProvider, type ChatCompletionsOptions } from './chat-completions';
import type { AiProvider } from './provider';

/**
 * Groq is Intake's primary AI provider.
 *
 * `openai/gpt-oss-120b` is the default because Groq documents **strict** JSON-schema constrained
 * decoding for it, which is what Intake's validator-first pipeline needs; it is also a production
 * model with a large context window. `llama-3.3-70b-versatile` is deliberately not the default: it
 * has been withdrawn from Groq's self-serve tiers and only offers JSON object mode.
 *
 * The model is never hardcoded for deployment: `GROQ_MODEL` overrides it without a code change.
 * `GROQ_REASONING_EFFORT` optionally sets the reasoning budget for slower/cheaper calls.
 */
export const GROQ_ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';
export const DEFAULT_GROQ_MODEL = 'openai/gpt-oss-120b';
const REASONING_EFFORTS = ['low', 'medium', 'high'] as const;

export interface GroqProviderOptions {
  env: NodeJS.ProcessEnv;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  /** Overrides `GROQ_ENDPOINT`. Tests use it; production leaves it unset. */
  endpoint?: string;
}

export function readGroqModel(env: NodeJS.ProcessEnv): string {
  return env.GROQ_MODEL?.trim() || DEFAULT_GROQ_MODEL;
}

function readReasoningEffort(env: NodeJS.ProcessEnv): string | null {
  const value = env.GROQ_REASONING_EFFORT?.trim().toLowerCase();
  if (!value) return null;
  if (!(REASONING_EFFORTS as readonly string[]).includes(value)) {
    throw new Error('GROQ_REASONING_EFFORT must be low, medium, high, or unset.');
  }
  return value;
}

export function createGroqProvider(options: GroqProviderOptions): AiProvider {
  const effort = readReasoningEffort(options.env);
  const transport: ChatCompletionsOptions = {
    id: 'groq',
    endpoint: options.endpoint ?? GROQ_ENDPOINT,
    apiKeyEnv: 'GROQ_API_KEY',
    modelEnv: 'GROQ_MODEL',
    apiKey: options.env.GROQ_API_KEY,
    fetchImpl: options.fetchImpl,
    model: readGroqModel(options.env),
    timeoutMs: options.timeoutMs,
    maxCompletionTokens: options.maxCompletionTokens,
    // Only sent when an operator asks for it, so an unsupported parameter can never break the call.
    ...(effort ? { extraBody: { reasoning_effort: effort } } : {}),
  };
  return createChatCompletionsProvider(transport);
}
