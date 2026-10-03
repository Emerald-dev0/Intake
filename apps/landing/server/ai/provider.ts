/**
 * Provider-independent AI boundary.
 *
 * Intake's interpretation pipeline only ever sees this interface. Whether the structured output comes
 * from Groq, OpenAI, or a future provider is a deployment decision, not an application one: the
 * routes, draft storage, validators and the Google Forms engine are provider-agnostic.
 *
 * Two rules hold for every implementation:
 * 1. A provider call happens server-side only. Keys never reach the browser.
 * 2. A provider call is attempted **once**. Retrying here could duplicate a downstream action, so
 *    retry policy lives with the caller and with the user.
 */

export const AI_PROVIDER_IDS = ['groq', 'openai'] as const;
export type AiProviderId = (typeof AI_PROVIDER_IDS)[number];

/**
 * Application-level failure taxonomy. Provider HTTP details are mapped into these codes and never
 * exposed: the browser receives a stable Intake code, a safe message, and no raw provider payload.
 */
export const AI_FAILURE_CODES = [
  'model_not_configured',
  'model_timeout',
  'model_unavailable',
  'model_rate_limited',
  'model_provider_error',
  'model_invalid_output',
] as const;
export type AiFailureCode = (typeof AI_FAILURE_CODES)[number];

export function isAiProviderId(value: string): value is AiProviderId {
  return (AI_PROVIDER_IDS as readonly string[]).includes(value);
}

/** Thrown by providers. The message is written for a user or operator; it never quotes a payload. */
export class AiProviderError extends Error {
  constructor(readonly code: AiFailureCode, message: string) {
    super(message);
    this.name = 'AiProviderError';
  }
}

export interface AiModelRequest {
  /** Stable name for the provider's structured-output field, e.g. `intake_form_interpretation`. */
  schemaName: string;
  /** JSON Schema the model output must satisfy. Validated again by Intake after parsing. */
  schema: object;
  /** Server-owned instructions. Never assembled from user input. */
  system: string;
  /** Structured task input. Never contains credentials, tokens or a user id. */
  input: unknown;
  maxCompletionTokens?: number;
}

export interface AiProvider {
  /** `none` marks the fail-closed stand-in used when no credential is configured. */
  readonly id: AiProviderId | 'none';
  readonly model: string;
  /** One structured-output model call. Throws {@link AiProviderError}. */
  generate(request: AiModelRequest): Promise<unknown>;
}

/** Safe, loggable description of the configured provider. Contains no credential. */
export interface AiProviderStatus {
  configured: boolean;
  provider: AiProviderId | null;
  model: string | null;
}

/**
 * Stands in when no provider credential exists. It fails on use rather than at startup so the API
 * can still serve every non-AI route, and it fails with the same stable code the browser already
 * understands.
 */
export function createUnconfiguredProvider(message: string, model = 'none'): AiProvider {
  return {
    id: 'none',
    model,
    async generate(): Promise<unknown> {
      throw new AiProviderError('model_not_configured', message);
    },
  };
}
