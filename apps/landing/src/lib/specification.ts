/**
 * Provider-independent form specification.
 *
 * This describes what the user wants to collect. It is not Google's schema and it is not
 * Microsoft's. Provider adapters translate it; nothing outside an adapter sees provider payloads,
 * and nothing that has not passed validation.ts reaches an adapter.
 *
 * Vocabulary note: `multiple_choice` means ONE answer from a list (Google Forms calls this
 * "Multiple choice"). Several answers is `checkboxes`. The browser-only landing preview mirrors
 * these question type names, but it is not this server specification and never calls the provider.
 */

export const QUESTION_TYPES = ['short_text', 'long_text', 'email', 'multiple_choice', 'dropdown', 'checkboxes'] as const;
export type QuestionType = (typeof QUESTION_TYPES)[number];

/** Question types that offer a fixed list of options. */
export const CHOICE_TYPES: readonly QuestionType[] = ['multiple_choice', 'dropdown', 'checkboxes'];

/**
 * Choice types with exactly one answer. Only these can control whether other questions appear:
 * "equals" is only meaningful for a single answer, and no supported provider can route on several.
 */
export const SINGLE_ANSWER_CHOICE_TYPES: readonly QuestionType[] = ['multiple_choice', 'dropdown'];

/** Show a question only when an earlier single-answer question was answered with an exact option. */
export interface VisibilityRule {
  when: { question: string; equals: string };
}

export interface QuestionSpecification {
  /** Stable reference used by visibility rules. Letters, digits, underscores and hyphens. */
  id: string;
  /** The question as respondents read it. */
  title: string;
  description?: string;
  type: QuestionType;
  required?: boolean;
  /** Required for choice types. Not allowed for the others. */
  options?: string[];
  visibility?: VisibilityRule;
}

export interface FormSpecification {
  title: string;
  description?: string;
  /** Questions in the order respondents see them. */
  questions: QuestionSpecification[];
}

/** Intake's own limits. They are deliberately conservative and are not Google's published limits. */
export const SPEC_LIMITS = {
  maxQuestions: 100,
  maxFormTitle: 200,
  maxFormDescription: 2000,
  maxQuestionTitle: 500,
  maxQuestionDescription: 1000,
  maxOptions: 100,
  maxOptionLength: 200,
  maxIdLength: 64,
} as const;

/** Stored with each form record so the specification stays interpretable if the schema changes. */
export const SPEC_VERSION = 1;
