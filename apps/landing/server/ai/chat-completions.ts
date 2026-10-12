import { AiProviderError, type AiFailureCode, type AiModelRequest, type AiProvider, type AiProviderId } from './provider';
import { recordModelCall } from './usage-scope';

/**
 * Shared OpenAI-compatible Chat Completions transport.
 *
 * Groq and OpenAI expose the same structured-output contract, so the request body, bounded response
 * reading, JSON extraction and HTTP-to-Intake error mapping live here once. There is no SDK, no
 * streaming, no tool calling, no internal retry and no browser exposure.
 */
export interface ChatCompletionsOptions {
  id: AiProviderId;
  endpoint: string;
  /** Human-readable env var names, used only in safe operator-facing messages. */
  apiKeyEnv: string;
  modelEnv: string;
  apiKey?: string;
  model: string;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  maxCompletionTokens?: number;
  /** Provider-specific body fields, e.g. Groq reasoning controls. Never user-controlled. */
  extraBody?: Record<string, unknown>;
  /** Overrideable for tests so retry backoff does not sleep for real. */
  sleepImpl?: (ms: number) => Promise<void>;
  /** Total attempts including the first. Bounded: 3 (transient provider wobbles, not outages). */
  maxAttempts?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_MAX_COMPLETION_TOKENS = 6_000;
const MAX_RESPONSE_BYTES = 120_000;

/** Bounded read: a hostile or broken response cannot exhaust memory. */
async function limitedText(response: Response): Promise<string> {
  if (!response.body) return '';
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    bytes += value.byteLength;
    if (bytes > MAX_RESPONSE_BYTES) {
      await reader.cancel();
      throw new AiProviderError('model_invalid_output', 'The model returned too much data. The form was not changed.');
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

function tokens(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 && value <= 100_000_000 ? value : null;
}

interface ChatCompletion {
  choices?: { finish_reason?: unknown; message?: { content?: unknown; refusal?: unknown } }[];
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; total_tokens?: unknown };
}

/** HTTP status to the application's stable failure taxonomy. Raw provider bodies are never surfaced. */
function classifyStatus(status: number): AiFailureCode {
  if (status === 401 || status === 403) return 'model_not_configured';
  if (status === 400 || status === 404 || status === 422) return 'model_not_configured';
  if (status === 429) return 'model_rate_limited';
  if (status >= 500) return 'model_unavailable';
  return 'model_provider_error';
}

/** Exponential backoff with jitter; honors Retry-After when sane (0–10s). */
function retryDelayMs(failedAttempt: number, retryAfter: string | null): number {
  if (retryAfter !== null) {
    const seconds = Number(retryAfter.trim());
    if (Number.isFinite(seconds) && seconds >= 0 && seconds <= 10) return Math.round(seconds * 1000);
  }
  return Math.min(8000, 800 * 2 ** Math.max(0, failedAttempt - 1)) + Math.floor(Math.random() * 250);
}

function logProviderRejection(provider: string, status: number, body: string): void {
  try {
    const detail = JSON.parse(body) as { error?: { message?: unknown; code?: unknown; type?: unknown } };
    const message = typeof detail?.error?.message === 'string' ? detail.error.message.slice(0, 300) : '';
    console.warn(JSON.stringify({
      time: new Date().toISOString(), level: 'warn', event: 'ai.provider.rejected',
      provider, providerStatus: status, providerCode: detail?.error?.code ?? null,
      providerType: detail?.error?.type ?? null, providerMessage: message || null,
    }));
  } catch {
    console.warn(JSON.stringify({
      time: new Date().toISOString(), level: 'warn', event: 'ai.provider.rejected',
      provider, providerStatus: status, providerCode: null, providerType: null, providerMessage: null,
    }));
  }
}

function messageFor(code: AiFailureCode, options: ChatCompletionsOptions): string {
  switch (code) {
    case 'model_not_configured':
      return `The model service rejected Intake's credentials or model settings. An operator needs to check ${options.apiKeyEnv} and ${options.modelEnv}. No changes were made.`;
    case 'model_rate_limited':
      return 'The interpretation service is rate limited right now. Wait a moment and try again. No changes were made.';
    case 'model_unavailable':
      return 'The interpretation service is unavailable. No changes were made. Try again later.';
    case 'model_provider_error':
      return 'The interpretation service returned an unexpected error. No changes were made. Try again later.';
    case 'model_timeout':
      return 'Understanding the request took too long. No changes were made. Try again.';
    case 'model_invalid_output':
      return 'Intake could not validate the model response. No changes were made. Try again or rephrase your request.';
  }
}

export function createChatCompletionsProvider(options: ChatCompletionsOptions): AiProvider {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const maxCompletionTokens = options.maxCompletionTokens ?? DEFAULT_MAX_COMPLETION_TOKENS;
  return {
    id: options.id,
    model: options.model,
    async generate(request: AiModelRequest): Promise<unknown> {
      const apiKey = options.apiKey?.trim();
      const started = performance.now();
      const observe = (record: { ok: boolean; errorCategory: AiFailureCode | null; inputTokens?: number | null; outputTokens?: number | null; totalTokens?: number | null }): void => {
        recordModelCall({
          provider: options.id, model: options.model, schemaName: request.schemaName,
          inputTokens: record.inputTokens ?? null, outputTokens: record.outputTokens ?? null, totalTokens: record.totalTokens ?? null,
          latencyMs: Math.round(performance.now() - started), ok: record.ok, errorCategory: record.errorCategory,
        });
      };
      if (!apiKey) {
        observe({ ok: false, errorCategory: 'model_not_configured' });
        throw new AiProviderError('model_not_configured', `Live interpretation is not configured on this Intake server (${options.apiKeyEnv} is missing). No changes were made.`);
      }
      // Bounded retry for fast transient failures (429/5xx): a provider wobble must not surface
      // as a credentials error after one attempt. Timeouts are NOT retried — one 30s wait is
      // already the whole user patience budget. 4xx (except 429) never retries: same request,
      // same rejection.
      const maxAttempts = Math.min(5, Math.max(1, options.maxAttempts ?? 3));
      const sleep = options.sleepImpl ?? (ms => new Promise(resolve => setTimeout(resolve, ms)));
      let response: Response | null = null;
      let body = '';
      let attempt = 0;
      for (;;) {
        attempt += 1;
        try {
          response = await (options.fetchImpl ?? fetch)(options.endpoint, {
            method: 'POST',
            headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
            body: JSON.stringify({
              model: options.model,
              messages: [{ role: 'system', content: request.system }, { role: 'user', content: JSON.stringify(request.input) }],
              response_format: { type: 'json_schema', json_schema: { name: request.schemaName, strict: true, schema: request.schema } },
              max_completion_tokens: request.maxCompletionTokens ?? maxCompletionTokens,
              ...(options.extraBody ?? {}),
            }),
            redirect: 'error',
            signal: AbortSignal.timeout(timeoutMs),
          });
          body = await limitedText(response);
        } catch (error) {
          if (error instanceof AiProviderError) {
            observe({ ok: false, errorCategory: error.code });
            throw error;
          }
          const name = error instanceof Error ? error.name : '';
          const code: AiFailureCode = name === 'TimeoutError' || name === 'AbortError' ? 'model_timeout' : 'model_unavailable';
          observe({ ok: false, errorCategory: code });
          throw new AiProviderError(code, messageFor(code, options));
        }
        if (response.ok) break;
        const retryable = response.status === 429 || response.status >= 500;
        if (!retryable || attempt >= maxAttempts) break;
        console.warn(JSON.stringify({
          time: new Date().toISOString(), level: 'warn', event: 'ai.provider.retry',
          provider: options.id, attempt, maxAttempts, providerStatus: response.status,
        }));
        await sleep(retryDelayMs(attempt, response.headers.get('retry-after')));
      }
      if (!response.ok) {
        // Operator diagnostics: status plus the provider's error head. The request body (user
        // words) and the key (bearer header) are never logged.
        logProviderRejection(options.id, response.status, body);
        const code = classifyStatus(response.status);
        observe({ ok: false, errorCategory: code });
        throw new AiProviderError(code, messageFor(code, options));
      }
      let parsed: ChatCompletion;
      try {
        parsed = JSON.parse(body) as ChatCompletion;
      } catch {
        observe({ ok: false, errorCategory: 'model_invalid_output' });
        throw new AiProviderError('model_invalid_output', messageFor('model_invalid_output', options));
      }
      const usage = {
        inputTokens: tokens(parsed.usage?.prompt_tokens),
        outputTokens: tokens(parsed.usage?.completion_tokens),
        totalTokens: tokens(parsed.usage?.total_tokens),
      };
      const choice = parsed?.choices?.[0];
      // JSON-looking text is not structured output: the request must have completed normally, been
      // accepted rather than refused, and parsed as an object.
      if (choice?.finish_reason !== 'stop' || choice.message?.refusal || typeof choice.message?.content !== 'string') {
        observe({ ok: false, errorCategory: 'model_invalid_output', ...usage });
        throw new AiProviderError('model_invalid_output', messageFor('model_invalid_output', options));
      }
      try {
        const output = JSON.parse(choice.message.content) as unknown;
        observe({ ok: true, errorCategory: null, ...usage });
        return output;
      } catch {
        observe({ ok: false, errorCategory: 'model_invalid_output', ...usage });
        throw new AiProviderError('model_invalid_output', messageFor('model_invalid_output', options));
      }
    },
  };
}
