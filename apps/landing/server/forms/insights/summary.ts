/**
 * Response summaries, computed and never stored.
 *
 * The summarizer is pure: normalized question definitions plus normalized
 * answers in, counts and phrases out. Raw respondent answers never reach a
 * database, a log, or the AI provider — aggregation happens here, locally.
 */

export type InsightQuestionKind = 'choice' | 'scale' | 'text' | 'other';

export interface InsightQuestion {
  id: string;
  title: string;
  kind: InsightQuestionKind;
  options?: string[];
}

export interface ChoiceCount {
  label: string;
  count: number;
}

export interface PhraseCount {
  phrase: string;
  count: number;
}

export interface QuestionSummary {
  id: string;
  title: string;
  kind: InsightQuestionKind;
  /** Responses that answered this question out of all responses read. */
  answered: number;
  choices?: ChoiceCount[];
  /** Mean of numeric scale answers, when at least one exists. */
  average?: number;
  topPhrases?: PhraseCount[];
}

export interface FormInsights {
  totalResponses: number;
  truncated: boolean;
  questions: QuestionSummary[];
}

const STOPWORDS = new Set([
  'the', 'and', 'for', 'with', 'that', 'this', 'from', 'have', 'has', 'had', 'was', 'were',
  'are', 'but', 'not', 'you', 'your', 'our', 'very', 'much', 'more', 'most', 'will', 'would',
  'can', 'could', 'should', 'about', 'into', 'than', 'then', 'them', 'they', 'there', 'their',
  'what', 'when', 'where', 'which', 'while', 'fait', 'pour', 'les', 'des', 'une', 'dans', 'est',
]);

/** Most-repeated unigrams across short free-text answers. Floor of 2 mentions; nothing identifying. */
export function topPhrases(texts: string[], limit = 5): PhraseCount[] {
  const counts = new Map<string, number>();
  for (const text of texts) {
    const words = text
      .toLowerCase()
      .split(/[^a-zà-ÿ0-9']+/u)
      .map(word => word.replace(/^'+|'+$/g, ''))
      .filter(word => word.length >= 3 && !STOPWORDS.has(word) && !/^\d+$/.test(word));
    for (const word of new Set(words)) counts.set(word, (counts.get(word) ?? 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count >= 2)
    .sort((a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1))
    .slice(0, Math.max(0, Math.min(limit, 10)))
    .map(([phrase, count]) => ({ phrase, count }));
}

/**
 * Tallies normalized answers against the question definitions. Unknown question
 * ids and empty values are ignored; option labels outside the definition are
 * grouped under their own label rather than dropped.
 */
export function summarizeResponses(
  questions: InsightQuestion[],
  answers: Array<Record<string, string[]>>,
): FormInsights {
  const byId = new Map(questions.map(question => [question.id, question]));
  const tallies = new Map<string, Map<string, number>>();
  const scales = new Map<string, number[]>();
  const texts = new Map<string, string[]>();
  const answered = new Map<string, number>();

  for (const response of answers) {
    for (const [questionId, values] of Object.entries(response)) {
      const question = byId.get(questionId);
      if (!question) continue;
      const clean = values.map(value => value.trim()).filter(Boolean);
      if (!clean.length) continue;
      answered.set(questionId, (answered.get(questionId) ?? 0) + 1);
      if (question.kind === 'scale') {
        const bucket = scales.get(questionId) ?? [];
        for (const value of clean) {
          const numeric = Number(value);
          if (Number.isFinite(numeric)) bucket.push(numeric);
        }
        scales.set(questionId, bucket);
      } else if (question.kind === 'text') {
        const bucket = texts.get(questionId) ?? [];
        for (const value of clean.slice(0, 3)) {
          if (value.length <= 500) bucket.push(value);
        }
        texts.set(questionId, bucket);
      } else {
        const bucket = tallies.get(questionId) ?? new Map<string, number>();
        for (const value of clean) bucket.set(value, (bucket.get(value) ?? 0) + 1);
        tallies.set(questionId, bucket);
      }
    }
  }

  return {
    totalResponses: answers.length,
    truncated: false,
    questions: questions.map(question => {
      const summary: QuestionSummary = {
        id: question.id,
        title: question.title,
        kind: question.kind,
        answered: answered.get(question.id) ?? 0,
      };
      if (question.kind === 'scale') {
        const values = scales.get(question.id) ?? [];
        if (values.length) summary.average = values.reduce((a, b) => a + b, 0) / values.length;
      } else if (question.kind === 'text') {
        summary.topPhrases = topPhrases(texts.get(question.id) ?? []);
      } else {
        const counts = tallies.get(question.id) ?? new Map<string, number>();
        const ordered = [...(question.options ?? [])];
        for (const label of counts.keys()) {
          if (!ordered.includes(label)) ordered.push(label);
        }
        summary.choices = ordered.map(label => ({ label, count: counts.get(label) ?? 0 }));
      }
      return summary;
    }),
  };
}
