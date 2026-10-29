/**
 * AI-written questions for a form Intake hosts itself.
 *
 * The rules this file exists to keep:
 *
 * - **The model only writes words.** It cannot create a form, publish one, or reach the database.
 *   It returns a proposal; the server turns that proposal into a definition, validates it, and
 *   creates a draft form through the ordinary service.
 * - **One prompt, one honest capability list.** The hosted form has no branching, no uploads, no
 *   payments and no scoring. The prompt says so, so the model never promises a form
 *   Intake cannot render.
 * - **The provider machinery is not reused.** The form the developer gets here is served from
 *   Intake's own domain, not Google Forms, so the prompt and the schema describe hosted fields.
 * - **A failure is a failure.** Provider errors, invalid output and "I need one more detail" all
 *   arrive as typed errors, and the caller charges nothing for them.
 */

import { recordModelCall } from '../ai/usage-scope';
import type { AiFailureCode } from '../ai/provider';
import { DEFAULT_GROQ_MODEL } from '../forms/interpretation/provider-config';
import { DEV_FIELD_TYPES, type DevField, type DevFieldType } from './contracts';
import { slugify } from './validation';

/** The model service used for structured output. Server-side key only. */
const ENDPOINT = 'https://api.groq.com/openai/v1/chat/completions';

/** How much of the developer's sentence goes to the model. */
export const MAX_PROPOSAL_REQUEST = 2000;
export const MAX_PROPOSAL_CLARIFICATION = 1000;

/** A form is small. The model is asked for at most this many questions. */
const MAX_PROPOSED_FIELDS = 20;

const FIELD_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    label: { type: 'string' },
    description: { type: 'string' },
    type: { type: 'string', enum: [...DEV_FIELD_TYPES] },
    required: { type: 'boolean' },
    options: { type: 'array', items: { type: 'string' } },
  },
  required: ['label', 'description', 'type', 'required', 'options'],
};

/**
 * `strict: true` structured output needs every key present, so absent text is an empty string and
 * an absent list is an empty array. The server reads the status, not the emptiness of the rest.
 */
export const PROPOSAL_SCHEMA = {
  type: 'object',
  additionalProperties: false,
  properties: {
    status: { type: 'string', enum: ['ready', 'needs_clarification', 'unsupported'] },
    title: { type: 'string' },
    description: { type: 'string' },
    fields: { type: 'array', items: FIELD_SCHEMA, maxItems: MAX_PROPOSED_FIELDS },
    question: { type: 'string' },
    explanation: { type: 'string' },
    reply: { type: 'string' },
  },
  required: ['status', 'title', 'description', 'fields', 'question', 'explanation', 'reply'],
};

const SYSTEM = `You write the questions for a form that Intake hosts on its own address and serves to the visitor's browser. Return ONLY the structured result. You write words; you cannot create, publish or store anything.

The form is one page of fields. It has no branching, no conditional questions, no file upload, no payment, no quiz and no scoring. Every field is shown to every visitor; only optional ones may be skipped.

The form collects answers; it does not authenticate anybody and holds no session. So a sign-in form is fine as a pair of questions — an email address and a one-time code — but never a password, and never anything that claims to log somebody in.

Field types:
- short_text: one line of writing (a name, a company, a phone number)
- long_text: a paragraph of writing
- email: an email address on one line
- number: a number
- date: a date
- dropdown: pick ONE from a list, shown as a menu
- single_choice: pick ONE from a list, shown as options
- multiple_choice: pick ANY NUMBER from a list, shown as ticks
- checkbox: ONE yes/no tick

Rules:
- Use at most ${MAX_PROPOSED_FIELDS} fields. Prefer the fewest questions that collect what was asked for.
- A label is what the visitor reads. Write it plainly, in the visitor's words, under 120 characters. Do not number them and do not ask "question one".
- description is one short line of help text, or an empty string when the label says everything.
- dropdown, single_choice and multiple_choice need options: between two and eight short choices. Every other type has an empty options list.
- Preserve the choices the developer named. If a choice list cannot be responsibly guessed — a team list, a set of departments, a price list — ask ONE focused question about it rather than inventing entries.
- Never ask for a password, card or bank details, a government or national id number, health information, or anything the developer did not ask for. Do not add a consent checkbox the developer did not ask for.
- The title is the form's name, under 60 characters, in the developer's words. The description is one sentence about the form, or an empty string.
- If the request is missing something that would change the form materially, ask ONE question, not a questionnaire.
- If the request needs something this kind of form cannot do — branching, uploads, payments, scoring, remembering who answered — return status=unsupported with an honest, specific explanation of what is not possible. Never quietly drop it and never pretend.
- When status=ready, question and explanation are empty strings. When status=needs_clarification, title, description and fields are empty and explanation is empty. When status=unsupported, title, description and fields are empty and question is empty.
- reply is one short sentence for the developer, in plain language, saying what the form now asks. It is empty when there is nothing ready to say.`;

export interface DevProposalField {
  label: string;
  description: string;
  type: DevFieldType;
  required: boolean;
  options: string[];
}

export type DevProposal =
  | { status: 'ready'; title: string; description: string; fields: DevProposalField[]; reply: string }
  | { status: 'needs_clarification'; question: string }
  | { status: 'unsupported'; explanation: string };

export interface DevProposalInput {
  /** What the developer said. */
  request: string;
  /** The developer's answer to an earlier clarification question. */
  clarification?: string;
}

/** An error the route turns into an honest answer. Nothing was charged. */
export class DevProposalError extends Error {
  constructor(
    public readonly code: AiFailureCode | 'model_not_configured' | 'model_invalid_output',
    message: string,
  ) {
    super(message);
    this.name = 'DevProposalError';
  }
}

export interface DevFormComposerOptions {
  env: NodeJS.ProcessEnv;
  fetchImpl?: (input: string, init: RequestInit) => Promise<Response>;
  timeoutMs?: number;
  model?: string;
}

export interface DevFormComposer {
  propose(input: DevProposalInput): Promise<DevProposal>;
}

function tokens(value: unknown): number | null {
  return Number.isSafeInteger(value) && (value as number) >= 0 ? (value as number) : null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/** Reads the model's proposal. Anything that does not fit the contract fails closed. */
export function readProposal(value: unknown): DevProposal {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Record<string, unknown>;
  const status = text(raw.status);
  if (status === 'needs_clarification') {
    const question = text(raw.question);
    if (!question) throw new DevProposalError('model_invalid_output', 'Intake could not read the model’s answer.');
    return { status: 'needs_clarification', question };
  }
  if (status === 'unsupported') {
    const explanation = text(raw.explanation);
    if (!explanation) throw new DevProposalError('model_invalid_output', 'Intake could not read the model’s answer.');
    return { status: 'unsupported', explanation };
  }
  if (status !== 'ready') throw new DevProposalError('model_invalid_output', 'Intake could not read the model’s answer.');

  const title = text(raw.title);
  if (!title) throw new DevProposalError('model_invalid_output', 'Intake could not read the model’s answer.');
  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  const fields: DevProposalField[] = rawFields.map(entry => {
    const field = (typeof entry === 'object' && entry !== null ? entry : {}) as Record<string, unknown>;
    const type = text(field.type) as DevFieldType;
    const options = Array.isArray(field.options)
      ? field.options.filter(option => typeof option === 'string').map(option => option.trim()).filter(Boolean)
      : [];
    return {
      label: text(field.label),
      description: text(field.description),
      type: DEV_FIELD_TYPES.includes(type) ? type : 'short_text',
      required: field.required === true,
      options,
    };
  });
  if (fields.length === 0) throw new DevProposalError('model_invalid_output', 'Intake could not read the model’s answer.');
  return { status: 'ready', title, description: text(raw.description), fields, reply: text(raw.reply) };
}

/**
 * The proposal's words become real fields. Identifiers are made here, not by the model, so a
 * field can never be addressed by something the browser controls.
 */
export function proposalToFields(fields: DevProposalField[]): DevField[] {
  const used = new Set<string>();
  return fields.map((field, index) => {
    const base = slugify(field.label) || `question_${index + 1}`;
    let id = base.slice(0, 40);
    let suffix = 2;
    while (used.has(id)) {
      id = `${base.slice(0, 36)}_${suffix}`;
      suffix += 1;
    }
    used.add(id);
    return {
      id,
      type: field.type,
      label: field.label,
      description: field.description || null,
      required: field.required,
      options: field.options,
      placeholder: null,
    };
  });
}

export function createDevFormComposer(options: DevFormComposerOptions): DevFormComposer {
  const model = options.model ?? DEFAULT_GROQ_MODEL;
  const fetchImpl = options.fetchImpl ?? fetch;

  return {
    async propose(input: DevProposalInput): Promise<DevProposal> {
      const apiKey = options.env.GROQ_API_KEY?.trim();
      if (!apiKey) {
        throw new DevProposalError('model_not_configured', 'Writing questions is not configured on this Intake server. No credits were spent.');
      }
      const user = input.clarification
        ? `${input.request}\n\nThe developer answered a question about that request: ${input.clarification}`
        : input.request;
      const started = performance.now();
      let response: Response;
      let body: string;
      try {
        response = await fetchImpl(ENDPOINT, {
          method: 'POST',
          headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json', accept: 'application/json' },
          body: JSON.stringify({
            model,
            messages: [{ role: 'system', content: SYSTEM }, { role: 'user', content: user }],
            response_format: { type: 'json_schema', json_schema: { name: 'hosted_form_proposal', strict: true, schema: PROPOSAL_SCHEMA } },
            max_completion_tokens: 2400,
          }),
          redirect: 'error',
          signal: AbortSignal.timeout(options.timeoutMs ?? 30_000),
        });
        body = await response.text();
      } catch {
        recordModelCall({
          provider: 'groq', model, schemaName: 'hosted_form_proposal', inputTokens: null, outputTokens: null,
          totalTokens: null, latencyMs: Math.round(performance.now() - started), ok: false, errorCategory: 'model_unavailable',
        });
        throw new DevProposalError('model_unavailable', 'The model did not answer. No credits were spent.');
      }

      const latencyMs = Math.round(performance.now() - started);
      let decoded: {
        choices?: { message?: { content?: unknown } }[];
        usage?: { prompt_tokens?: unknown; completion_tokens?: unknown; input_tokens?: unknown; output_tokens?: unknown };
      } = {};
      try {
        decoded = JSON.parse(body) as typeof decoded;
      } catch {
        decoded = {};
      }
      const inputTokens = tokens(decoded.usage?.prompt_tokens ?? decoded.usage?.input_tokens);
      const outputTokens = tokens(decoded.usage?.completion_tokens ?? decoded.usage?.output_tokens);
      const totalTokens = inputTokens !== null && outputTokens !== null ? inputTokens + outputTokens : null;

      if (!response.ok) {
        const category: AiFailureCode = response.status === 429
          ? 'model_rate_limited'
          : response.status === 401 || response.status === 403 ? 'model_not_configured' : 'model_provider_error';
        recordModelCall({
          provider: 'groq', model, schemaName: 'hosted_form_proposal', inputTokens, outputTokens, totalTokens,
          latencyMs, ok: false, errorCategory: category,
        });
        if (category === 'model_not_configured') {
          throw new DevProposalError('model_not_configured', 'The model service rejected Intake’s credentials. An operator needs to check GROQ_API_KEY. No credits were spent.');
        }
        throw new DevProposalError(category, 'The model did not answer. No credits were spent.');
      }

      const content = decoded.choices?.[0]?.message?.content;
      let proposal: DevProposal;
      try {
        const raw = typeof content === 'string' ? JSON.parse(content) as Record<string, unknown> : null;
        proposal = readProposal(raw);
      } catch {
        recordModelCall({
          provider: 'groq', model, schemaName: 'hosted_form_proposal', inputTokens, outputTokens, totalTokens,
          latencyMs, ok: false, errorCategory: 'model_invalid_output',
        });
        throw new DevProposalError('model_invalid_output', 'Intake could not read the model’s answer. No credits were spent.');
      }

      recordModelCall({
        provider: 'groq', model, schemaName: 'hosted_form_proposal', inputTokens, outputTokens, totalTokens,
        latencyMs, ok: true, errorCategory: null,
      });
      return proposal;
    },
  };
}
