/**
 * Deterministic voice checks for model output.
 *
 * The prompt asks the model for a certain voice. A prompt is a request, not a guarantee, so the
 * things that are cheap to detect are detected here and turned into one guided retry — the same
 * mechanism that already repairs an uncreatable question arrangement. This is deliberately **not** a
 * rewrite: the server never edits a sentence a model wrote, because a rule applied to half-understood
 * text produces worse prose than a second attempt with feedback does.
 *
 * Severity is split on purpose:
 *   - A voice issue never invalidates an otherwise correct specification. Losing someone's form
 *     over a stray "Certainly!" would be absurd, so a second violation is accepted and shipped.
 *   - The hard limits (length, type) are still enforced by `assessInterpretation`.
 *
 * Everything here is a pure function of the model output: no user data, no configuration, no I/O.
 */

export interface VoiceIssue {
  /** Stable code, for tests and logs. Never shown to a user. */
  code: string;
  /** Instruction appended to the retry request. Written to the model, not to a person. */
  hint: string;
}

/** The field a person reads. `question` and `explanation` are surfaced in the thread too. */
const SPOKEN_FIELDS = ['reply', 'question', 'explanation'] as const;

/**
 * Patterns that identify generic-assistant prose. Each is matched case-insensitively against every
 * spoken field. Keep this list short and certain: a false positive costs an extra model call.
 */
const PHRASES: Array<{ code: string; pattern: RegExp; hint: string }> = [
  { code: 'ai_self_reference', pattern: /\bas an ai\b|\bai language model\b|\bi am an ai\b|\bi'm an ai\b|\blarge language model\b/i, hint: 'You are Intake, a colleague. Never refer to yourself as an AI or a language model.' },
  { code: 'assistant_filler', pattern: /\bcertainly\b|\bsure thing\b|\bno problem\b|\bgreat question\b|\bhappy to help\b|\bi'?d be happy to\b|\bi would be happy to\b|\bof course\b|\babsolutely\b/i, hint: 'Cut the acknowledgement. Start with the substance: what you made or what you need.' },
  { code: 'closing_filler', pattern: /\bi hope this helps\b|\blet me know if you\b|\bfeel free to\b|\banything else i can help\b|\bdon'?t hesitate\b/i, hint: 'Drop the customer-service closing. Offer one concrete next move or nothing.' },
  { code: 'template_hedging', pattern: /\bbased on the information provided\b|\bit appears that\b|\bi have generated\b|\bi have created a\b|\bi will now\b|\bplease note that\b/i, hint: 'Say what is there, in plain speech, without the templated preamble.' },
  { code: 'internal_jargon', pattern: /\bjson\b|\bschema\b|\bprompt\b|\bsub-?prompt\b|\binterpreter\b|\bpayload\b|\bsystem message\b|\bllm\b|\btokens?\b|\bmodel\b|\bapi\b/i, hint: 'Never name internal machinery (JSON, schema, prompt, model, tokens, interpreter, API). Describe the form, not the plumbing.' },
  { code: 'self_praise', pattern: /\bseamless\b|\bpowerful\b|\brobust\b|\bcomprehensive\b|\bcutting[- ]edge\b|\btailored solution\b/i, hint: 'No marketing adjectives about your own output. Describe the form plainly.' },
];

const EMOJI = /[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2B00}-\u{2BFF}\u{FE0F}]/u;
const MARKDOWN = /[*_`#]|\[[^\]]+\]\([^)]+\)/;

function sentence(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Issues worth one retry, in priority order. Returns [] for a missing or non-string field; type
 * errors are the interpreter's business, not this function's.
 */
export function voiceIssues(result: unknown): VoiceIssue[] {
  if (typeof result !== 'object' || result === null || Array.isArray(result)) return [];
  const record = result as Record<string, unknown>;
  const issues: VoiceIssue[] = [];
  const seen = new Set<string>();
  const add = (issue: VoiceIssue) => {
    if (seen.has(issue.code)) return;
    seen.add(issue.code);
    issues.push(issue);
  };

  for (const field of SPOKEN_FIELDS) {
    const value = record[field];
    if (typeof value !== 'string' || !value.trim()) continue;
    const text = sentence(value);
    for (const { code, pattern, hint } of PHRASES) {
      if (pattern.test(text)) add({ code: `${field}_${code}`, hint: `${field}: ${hint}` });
    }
    if (text.includes('!')) add({ code: `${field}_exclamation`, hint: `${field}: no exclamation marks. End with a full stop.` });
    if (EMOJI.test(text)) add({ code: `${field}_emoji`, hint: `${field}: no emoji.` });
    if (MARKDOWN.test(text)) add({ code: `${field}_markdown`, hint: `${field}: plain text only — no asterisks, backticks, headings or links.` });
    if (/\n/.test(value.trim())) add({ code: `${field}_multiline`, hint: `${field}: one paragraph, one line.` });
    if (text.length > 400) add({ code: `${field}_too_long`, hint: `${field}: shorten to under 400 characters, ideally one or two sentences.` });
  }
  return issues;
}

/** Human-readable bundle for the retry instruction. Never shown to a user. */
export function voiceFeedback(issues: VoiceIssue[]): string {
  return issues.map(issue => `- ${issue.hint}`).join(' ');
}
