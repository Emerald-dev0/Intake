import { useRef, useState } from 'react';
import { devApi, DevApiError, FIELD_LABEL, type DevProposalResult } from '../lib/dev-api';
import { DEV_FORM_TEMPLATES } from '../lib/dev-templates';

/**
 * Writing the questions of a hosted form from one sentence.
 *
 * The same AI the rest of Intake uses, the same credits, and the same rule: the developer is
 * shown what was written before anything is published. Nothing here reaches the network except
 * the proposal itself, and the price is whatever the server says it charged.
 */
export function DevFormComposer({
  projectId,
  onCreated,
}: {
  projectId: string;
  onCreated: (formId: string) => void;
}) {
  const [request, setRequest] = useState('');
  const [clarification, setClarification] = useState('');
  const [working, setWorking] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<DevProposalResult | null>(null);
  const inputRef = useRef<HTMLTextAreaElement | null>(null);
  // One key per sentence, so a retry of the same sentence is the same operation and is never
  // paid for twice. A different sentence is a different operation, so it gets a different key.
  const operationRef = useRef<{ sentence: string; id: string } | null>(null);

  function operationKey(sentence: string): string {
    if (operationRef.current?.sentence === sentence) return operationRef.current.id;
    const id = newOperationId();
    operationRef.current = { sentence, id };
    return id;
  }

  async function propose(answer?: string) {
    const sentence = request.trim();
    if (!sentence || working) return;
    setWorking(true);
    setError('');
    try {
      const outcome = await devApi.proposeForm(projectId, {
        request: sentence,
        operationId: operationKey(sentence),
        ...(answer && answer.trim() ? { clarification: answer.trim() } : {}),
      });
      setResult(outcome);
      if (outcome.status === 'needs_clarification') setClarification('');
    } catch (failure) {
      setError(
        failure instanceof DevApiError
          ? failure.message
          : 'The questions could not be written. Nothing was charged.',
      );
    } finally {
      setWorking(false);
    }
  }

  /** A starter sentence lands in the box, where it can be read and changed before it is sent. */
  function useTemplate(prompt: string) {
    setRequest(prompt);
    setResult(null);
    setError('');
    inputRef.current?.focus();
  }

  const form = result?.status === 'ready' ? result.form : undefined;
  const fields = form?.draftVersion?.definition.fields ?? [];

  return (
    <div className="dev-compose">
      <h3 className="dev-compose__title">Describe the form you need</h3>
      <p className="dev-note">
        One sentence is enough — “a sign-up form for a beta list” or “ask a freelancer what they
        charge per hour”. Intake writes the questions, you read them, change what you like, then
        publish. It uses the same daily credits as the rest of Intake.
      </p>

      <div className="dev-compose__templates">
        <span className="dev-compose__templates-label" id="dev-compose-templates-label">Start from</span>
        <div className="dev-compose__templates-row" role="group" aria-labelledby="dev-compose-templates-label">
          {DEV_FORM_TEMPLATES.map(template => (
            <button
              key={template.id}
              type="button"
              className="dev-compose__template"
              disabled={working}
              onClick={() => useTemplate(template.prompt)}
            >
              {template.label}
            </button>
          ))}
        </div>
      </div>

      <form
        className="dev-compose__form"
        onSubmit={event => {
          event.preventDefault();
          void propose();
        }}
      >
        <label className="dev-field">
          <span>What should this form ask?</span>
          <textarea
            ref={inputRef}
            className="dev-textarea"
            rows={3}
            value={request}
            maxLength={2000}
            placeholder="A short application for our design partners"
            onChange={event => setRequest(event.target.value)}
            disabled={working}
          />
        </label>
        <button type="submit" className="dev-button" disabled={working || !request.trim()}>
          {working ? 'Writing the questions…' : 'Write the questions'}
        </button>
      </form>

      {error && (
        <p className="dev-note dev-note--error" role="alert">
          {error}
        </p>
      )}

      {result?.status === 'needs_clarification' && (
        <div className="dev-compose__answer">
          <p className="dev-compose__question">{result.question}</p>
          <label className="dev-field">
            <span>Your answer</span>
            <textarea
              className="dev-textarea"
              rows={2}
              value={clarification}
              maxLength={1000}
              onChange={event => setClarification(event.target.value)}
              disabled={working}
            />
          </label>
          <button
            type="button"
            className="dev-button"
            disabled={working || !clarification.trim()}
            onClick={() => void propose(clarification)}
          >
            {working ? 'Writing the questions…' : 'Ask again'}
          </button>
          <p className="dev-note">Nothing was charged for the question.</p>
        </div>
      )}

      {result?.status === 'unsupported' && (
        <div className="dev-compose__answer">
          <p className="dev-compose__question">{result.explanation}</p>
          <p className="dev-note">Nothing was charged.</p>
        </div>
      )}

      {result?.status === 'ready' && form && (
        <div className="dev-compose__answer">
          {result.reply && <p className="dev-compose__reply">{result.reply}</p>}
          <ol className="dev-compose__list">
            {fields.map(field => (
              <li key={field.id}>
                <span className="dev-compose__label">{field.label}</span>
                <span className="dev-compose__type">{FIELD_LABEL[field.type] ?? field.type}</span>
                {field.required && <span className="dev-required">required</span>}
              </li>
            ))}
          </ol>
          <p className="dev-note">
            {result.cost.credits === 0
              ? 'This one was free.'
              : `This cost ${result.cost.credits} ${result.cost.credits === 1 ? 'credit' : 'credits'}.`}{' '}
            The form is a draft until you publish it.
          </p>
          <button type="button" className="dev-button" onClick={() => onCreated(form.form.id)}>
            Review the questions
          </button>
        </div>
      )}
    </div>
  );
}

/** A key the server accepts, so a repeated click is one operation and one charge. */
function newOperationId(): string {
  const random = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
  return random.replace(/[^A-Za-z0-9_-]/g, '').slice(0, 64);
}
