import { createChatCompletionsProvider } from './chat-completions';
import type { AiProvider } from './provider';

/**
 * OpenAI is kept as an optional, explicitly selectable provider. It is not used unless
 * `AI_PROVIDER=openai` or (for backward compatibility with an existing deployment) it is the only
 * credential present. Groq is the primary provider.
 */
export const OPENAI_ENDPOINT = 'https://api.openai.com/v1/chat/completions';
export const DEFAULT_OPENAI_MODEL = 'gpt-4o-mini';

export interface OpenAiProviderOptions {
  env: NodeJS.ProcessEnv;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  endpoint?: string;
}

export function readOpenAiModel(env: NodeJS.ProcessEnv): string {
  return env.OPENAI_MODEL?.trim() || DEFAULT_OPENAI_MODEL;
}

export function createOpenAiProvider(options: OpenAiProviderOptions): AiProvider {
  return createChatCompletionsProvider({
    id: 'openai',
    endpoint: options.endpoint ?? OPENAI_ENDPOINT,
    apiKeyEnv: 'OPENAI_API_KEY',
    modelEnv: 'OPENAI_MODEL',
    apiKey: options.env.OPENAI_API_KEY,
    fetchImpl: options.fetchImpl,
    model: readOpenAiModel(options.env),
    timeoutMs: options.timeoutMs,
    maxCompletionTokens: options.maxCompletionTokens,
  });
}
