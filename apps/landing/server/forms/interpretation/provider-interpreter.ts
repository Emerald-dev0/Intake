import { AiProviderError, type AiModelRequest, type AiProvider } from '../../ai/provider';
import { runWithModelCallCollector, type ModelCallCollector } from '../../ai/usage-scope';
import type { FormEditInterpreter, FormEditInterpretationInput } from './edit-interpreter';
import { InterpretationError, isRepairablePlacement, placementIssues, type FormInterpreter, type InterpretationInput } from './interpreter';
import { FORM_EDIT_INTERPRETATION_SCHEMA, INTERPRETATION_SCHEMA, creationSystem, editSystem } from './prompts';
import { voiceFeedback, voiceIssues } from './voice';

/**
 * The interpretation layer, built on the provider abstraction.
 *
 * The routes, drafts, validators and the Google Forms engine depend on `FormInterpreter`, not on the
 * vendor. Swapping Groq for another provider is a composition change in `server/index.ts`.
 */
export interface InterpreterOptions {
  provider: AiProvider;
  /** Optional ceiling override; the provider already enforces its own timeout and default budget. */
  maxCompletionTokens?: number;
  /** Optional per-operation collector so usage accounting can see every model call. */
  collector?: ModelCallCollector;
}

/** Provider failures become application failures with the same stable codes the browser knows. */
async function generate(options: InterpreterOptions, request: AiModelRequest): Promise<unknown> {
  const call: AiModelRequest = { ...request, maxCompletionTokens: request.maxCompletionTokens ?? options.maxCompletionTokens };
  const invoke = (modelCall: AiModelRequest): Promise<unknown> => options.collector
    ? runWithModelCallCollector(options.collector, () => options.provider.generate(modelCall))
    : options.provider.generate(modelCall);
  try {
    const raw = await invoke(call);
    const target = typeof request.input === 'object' && request.input !== null
      ? (request.input as { target?: unknown }).target
      : undefined;
    const issues = placementIssues(raw, target === 'typeform' ? 'typeform' : 'google');
    const voice = voiceIssues(raw);
    // The model arranged the questions in a way the target cannot lay out, or wrote in a voice the
    // product does not use. Adapt, don't refuse: give it one guided chance to produce a WORKING
    // arrangement in the right voice. The goal is an output, not an apology. Only fall back to
    // needs_clarification when adaptation would distort the request's meaning, and to unsupported
    // when nothing preserves it. The retry costs operator tokens only: users are charged per
    // validated proposal, and a failed arrangement is never a proposal.
    //
    // A layout the planner will reject anyway is not worth a second call, so the retry is skipped
    // when the placement problems are the unrepairable kind — the request becomes an honest
    // unsupported answer and the voice issue never reaches a person.
    const placementBlocks = issues.length > 0 && !isRepairablePlacement(issues);
    const wantsRetry = !placementBlocks && (isRepairablePlacement(issues) || voice.length > 0);
    if (wantsRetry && typeof request.input === 'object' && request.input !== null) {
      const feedback = (request.input as { request?: unknown }).request;
      const parts: string[] = [];
      if (isRepairablePlacement(issues)) {
        parts.push(`[Intake planner feedback on your previous arrangement, which was rejected: ${issues.map(issue => issue.hint ?? issue.message).join(' ')} Produce a working arrangement that collects the same information. Preferred fixes, in order: (1) insert a bridging Yes/No question after the controller and hang ONE conditional group off it (e.g. "Would you like to tell us more?" then the follow-ups under Yes); (2) merge the follow-ups into a single group under one shared condition; (3) make at most one follow-up unconditional and note it in assumptions. Only return needs_clarification if every adaptation would distort what was asked, and unsupported as a last resort. Never drop a requested question, never emit the rejected layout again.]`);
      }
      if (voice.length > 0) {
        parts.push(`[Intake voice feedback on the message you wrote. Rewrite the spoken field(s) — reply, question, explanation — in Intake's voice, keeping the status and the specification exactly as they are: ${voiceFeedback(voice)} Nothing else may change. Do not mention this feedback.]`);
      }
      return invoke({
        ...call,
        input: { ...(request.input as Record<string, unknown>), request: `${typeof feedback === 'string' ? feedback : ''}\n\n${parts.join('\n\n')}` },
      });
    }
    return raw;
  } catch (error) {
    if (error instanceof InterpretationError) throw error;
    if (error instanceof AiProviderError) throw new InterpretationError(error.code, error.message);
    throw new InterpretationError('model_unavailable', 'Intake could not reach the interpretation service. No changes were made. Try again later.');
  }
}

export function createFormInterpreter(options: InterpreterOptions): FormInterpreter {
  return {
    interpret(input: InterpretationInput): Promise<unknown> {
      return generate(options, {
        schemaName: 'intake_form_interpretation',
        schema: INTERPRETATION_SCHEMA,
        system: creationSystem(input.provider),
        input: {
          task: input.mode,
          target: input.provider,
          request: input.request,
          ...(input.clarification ? { clarification: input.clarification } : {}),
          ...(input.specification ? { currentSpecification: input.specification } : {}),
        },
      });
    },
  };
}

export function createFormEditInterpreter(options: InterpreterOptions): FormEditInterpreter {
  return {
    interpret(input: FormEditInterpretationInput): Promise<unknown> {
      return generate(options, {
        schemaName: 'intake_form_edit_interpretation',
        schema: FORM_EDIT_INTERPRETATION_SCHEMA,
        system: editSystem(input.provider === 'typeform' ? 'typeform' : 'google'),
        input: {
          request: input.request,
          target: input.provider === 'typeform' ? 'typeform' : 'google',
          ...(input.clarification ? { clarification: input.clarification } : {}),
          currentForm: {
            formId: input.current.providerFormId,
            title: input.current.title,
            description: input.current.description ?? '',
            hasSections: input.current.hasSections,
            hasBranching: input.current.hasBranching,
            items: input.current.items.map(item => ({
              index: item.index, questionId: item.questionId ?? null, kind: item.kind,
              title: item.title, description: item.description ?? '', questionType: item.questionType ?? null,
              required: item.required ?? null, options: item.options ?? [], hasRouting: item.hasRouting ?? false,
              sectionIndex: item.sectionIndex, capabilities: item.capabilities,
            })),
          },
          ...(input.existingPlan ? { currentProposedSummary: input.existingPlan.summary, currentProposedOperations: input.existingPlan.operations } : {}),
        },
      });
    },
  };
}
