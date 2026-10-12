import { AiProviderError, type AiModelRequest, type AiProvider } from '../../ai/provider';
import { runWithModelCallCollector, type ModelCallCollector } from '../../ai/usage-scope';
import type { FormEditInterpreter, FormEditInterpretationInput } from './edit-interpreter';
import { InterpretationError, isRepairablePlacement, placementIssues, type FormInterpreter, type InterpretationInput } from './interpreter';
import { EDIT_SYSTEM, FORM_EDIT_INTERPRETATION_SCHEMA, INTERPRETATION_SCHEMA, SYSTEM } from './prompts';

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
    const issues = placementIssues(raw);
    // The model arranged the questions in a way Google Forms cannot lay out. Rather than showing
    // engineer text, give it one guided chance to reshuffle: merge same-rule groups, reorder so
    // each conditional group directly follows its controller, make at most one follow-up
    // unconditional (noted in assumptions), or ask a clarifying question. Never silently drop a
    // requested question. The retry costs operator tokens only: users are charged per validated
    // proposal, and a failed arrangement is never a proposal.
    if (isRepairablePlacement(issues) && typeof request.input === 'object' && request.input !== null) {
      const feedback = (request.input as { request?: unknown }).request;
      return invoke({
        ...call,
        input: {
          ...(request.input as Record<string, unknown>),
          request: `${typeof feedback === 'string' ? feedback : ''}\n\n[Intake planner feedback on your previous arrangement, which was rejected: ${issues.map(issue => issue.hint ?? issue.message).join(' ')} Reshuffle the questions to satisfy it — merge, reorder, make at most one follow-up unconditional and note it in assumptions, or return needs_clarification. Never drop a requested question.]`,
        },
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
        system: SYSTEM,
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
        system: EDIT_SYSTEM,
        input: {
          request: input.request,
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
