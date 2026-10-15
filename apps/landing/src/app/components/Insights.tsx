import { useEffect, useState } from 'react';
import type { PublicLibraryForm } from '../../lib/forms';

interface InsightQuestionSummary {
  id: string;
  title: string;
  kind: 'choice' | 'scale' | 'text' | 'other';
  answered: number;
  choices?: { label: string; count: number }[];
  average?: number;
  topPhrases?: { phrase: string; count: number }[];
}

interface FormInsightsData {
  totalResponses: number;
  truncated: boolean;
  questions: InsightQuestionSummary[];
}

interface InsightsProps {
  form: PublicLibraryForm;
  onClose: () => void;
  isPro: boolean;
  hasResponsesScope: boolean;
}

function formatNumber(num: number): string {
  return new Intl.NumberFormat().format(num);
}

function formatPercent(value: number, total: number): string {
  if (total === 0) return '0%';
  return `${((value / total) * 100).toFixed(1)}%`;
}

export function Insights({ form, onClose, isPro, hasResponsesScope }: InsightsProps) {
  const [data, setData] = useState<FormInsightsData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let mounted = true;
    async function load() {
      try {
        const response = await fetch(`/api/forms/${encodeURIComponent(form.id)}/insights`, {
          credentials: 'same-origin',
          cache: 'no-store',
          headers: { accept: 'application/json' },
        });
        if (!mounted) return;
        if (response.status === 401) {
          window.location.replace('/auth/sign-in?reason=session_expired');
          return;
        }
        if (response.status === 403) {
          const body = await response.json().catch(() => ({}));
          const msg = body.error || 'Unable to load insights.';
          setError(msg);
          setLoading(false);
          return;
        }
        if (response.status === 404) {
          setError('Form not found.');
          setLoading(false);
          return;
        }
        if (!response.ok) {
          setError('Failed to load insights. Please try again.');
          setLoading(false);
          return;
        }
        const body = await response.json();
        if (body.status === 'ready') {
          setData(body.insights);
        } else {
          setError('Insights not ready.');
        }
      } catch {
        if (mounted) setError('Network error. Please try again.');
      } finally {
        if (mounted) setLoading(false);
      }
    }
    load();
    return () => { mounted = false; };
  }, [form.id]);

  if (!isPro) {
    return (
      <div className="insights-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="insights-title">
        <div className="insights-modal" onClick={e => e.stopPropagation()}>
          <button className="insights-modal-close" onClick={onClose} aria-label="Close insights">✕</button>
          <div className="insights-pro-required">
            <h2 id="insights-title">Response Insights</h2>
            <p>Response insights are a Pro feature. Upgrade your plan to view answer summaries and analysis.</p>
            <a href="/app/billing" className="btn btn-accent">View Plans</a>
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  if (!hasResponsesScope) {
    return (
      <div className="insights-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="insights-title">
        <div className="insights-modal" onClick={e => e.stopPropagation()}>
          <button className="insights-modal-close" onClick={onClose} aria-label="Close insights">✕</button>
          <div className="insights-pro-required">
            <h2 id="insights-title">Response Insights</h2>
            <p>To view response summaries, you need to grant Intake access to form responses.</p>
            <a href="/app/connections" className="btn btn-accent">Reconnect Google & Enable Summaries</a>
            <button className="btn btn-ghost btn-sm" onClick={onClose} style={{ marginTop: 12 }}>Close</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="insights-modal-backdrop" onClick={onClose} role="dialog" aria-modal="true" aria-labelledby="insights-title">
      <div className="insights-modal" onClick={e => e.stopPropagation()}>
        <button className="insights-modal-close" onClick={onClose} aria-label="Close insights">✕</button>
        <div className="insights-header">
          <h2 id="insights-title">{form.title}</h2>
          <span className="insights-meta">
            {data ? `${formatNumber(data.totalResponses)} response${data.totalResponses !== 1 ? 's' : ''}` : 'Loading…'}
            {data?.truncated && <span className="truncated-badge">Truncated (first 1,000 responses)</span>}
          </span>
        </div>

        {loading && <div className="insights-loading" role="status"><span className="spin" /> Loading response summaries…</div>}

        {error && !loading && (
          <div className="form-banner bad" role="alert">
            <p>{error}</p>
            <button className="btn btn-ghost btn-sm" onClick={() => window.location.reload()}>Retry</button>
          </div>
        )}

        {data && !loading && data.questions.length === 0 && (
          <div className="insights-empty">
            <p>No responses yet. Share your form to start collecting answers.</p>
          </div>
        )}

        {data && !loading && data.questions.length > 0 && (
          <div className="insights-questions">
            {data.questions.map((question, index) => (
              <InsightQuestionCard key={question.id} question={question} index={index} totalResponses={data.totalResponses} />
            ))}
          </div>
        )}

        <div className="insights-footer">
          <button className="btn btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  );
}

interface InsightQuestionCardProps {
  question: InsightQuestionSummary;
  index: number;
  totalResponses: number;
}

function InsightQuestionCard({ question, index, totalResponses }: InsightQuestionCardProps) {
  const unanswered = totalResponses - question.answered;

  return (
    <section className="insight-question" aria-labelledby={`q-${question.id}`}>
      <header className="insight-question-header">
        <h3 id={`q-${question.id}`}>
          <span className="question-index">{index + 1}.</span>
          {question.title}
        </h3>
        <div className="insight-question-meta">
          <span className={`kind-badge ${question.kind}`}>{question.kind}</span>
          <span className="answered-count">{question.answered} / {totalResponses} answered</span>
          {unanswered > 0 && <span className="unanswered-count">{unanswered} skipped</span>}
        </div>
      </header>

      {question.kind === 'choice' && question.choices && (
        <div className="insight-choice-chart">
          {question.choices.map(choice => (
            <div key={choice.label} className="choice-bar-row">
              <div className="choice-bar-label">
                <span className="choice-label">{choice.label}</span>
                <span className="choice-count">{choice.count} ({formatPercent(choice.count, question.answered)})</span>
              </div>
              <div className="choice-bar-track">
                <div
                  className="choice-bar"
                  style={{ width: `${question.answered > 0 ? (choice.count / question.answered) * 100 : 0}%` }}
                  role="img"
                  aria-label={`${choice.label}: ${choice.count} responses`}
                />
              </div>
            </div>
          ))}
        </div>
      )}

      {question.kind === 'scale' && question.average !== undefined && (
        <div className="insight-scale-summary">
          <div className="scale-average">
            <span className="average-label">Average</span>
            <span className="average-value">{question.average.toFixed(2)}</span>
            <span className="scale-range">/ 5</span>
          </div>
          <div className="scale-visual">
            <div className="scale-track">
              <div
                className="scale-marker"
                style={{ left: `${((question.average - 1) / 4) * 100}%` }}
              />
            </div>
            <div className="scale-labels">
              <span>1</span><span>2</span><span>3</span><span>4</span><span>5</span>
            </div>
          </div>
        </div>
      )}

      {question.kind === 'text' && question.topPhrases && question.topPhrases.length > 0 && (
        <div className="insight-text-phrases">
          <span className="forms-legend">TOP PHRASES</span>
          <ul className="phrase-list">
            {question.topPhrases.map((p, i) => (
              <li key={i}><span className="phrase-text">{p.phrase}</span><span className="phrase-count">{p.count}</span></li>
            ))}
          </ul>
        </div>
      )}

      {(question.kind === 'text' && (!question.topPhrases || question.topPhrases.length === 0)) && (
        <p className="insight-text-none">No common phrases found (minimum 2 mentions required).</p>
      )}

      {(question.kind === 'choice' && (!question.choices || question.choices.every(c => c.count === 0))) && (
        <p className="insight-text-none">No answers for this question.</p>
      )}
    </section>
  );
}