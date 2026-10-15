import { type QuestionSpecification, type FormSpecification } from '../../lib/specification';
import { editTypeLabel } from '../../lib/form-edit';

interface PreviewProps {
  spec: FormSpecification;
  onClose: () => void;
  onEdit: () => void;
}

export function Preview({ spec, onClose, onEdit }: PreviewProps) {
  const controllers = new Map(spec.questions.map(q => [q.id, q.title]));

  return (
    <section className="form-preview" aria-labelledby="preview-title">
      <div className="preview-header">
        <div>
          <span className="forms-legend">PREVIEW MODE</span>
          <h2 id="preview-title">{spec.title}</h2>
          {spec.description && <p className="preview-description">{spec.description}</p>}
        </div>
        <div className="preview-header-actions">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Exit preview</button>
          <button type="button" className="btn btn-accent" onClick={onEdit}>Edit questions</button>
        </div>
      </div>

      <div className="preview-form">
        <form className="preview-form-inner" onSubmit={e => e.preventDefault()}>
          {spec.questions.map((question, index) => {
            const condition = question.visibility?.when;
            const previous = spec.questions[index - 1]?.visibility?.when;
            const beginsSection = condition && (condition.question !== previous?.question || condition.equals !== previous?.equals);
            const resumes = !condition && !!previous;

            return (
              <div key={question.id} className="preview-question-wrapper">
                {(beginsSection || resumes) && (
                  <div className="preview-section-marker">
                    {beginsSection
                      ? `📋 Section — Show if “${controllers.get(condition.question) ?? condition.question}” = “${condition.equals}”`
                      : '📋 Next section — Everyone continues'}
                  </div>
                )}
                <PreviewQuestion question={question} index={index} controllers={controllers} />
              </div>
            );
          })}
          <div className="preview-submit">
            <button type="submit" className="btn btn-accent preview-submit-btn" disabled>Submit</button>
            <p className="preview-notice">This is a preview. The form is not live yet.</p>
          </div>
        </form>
      </div>
    </section>
  );
}

interface PreviewQuestionProps {
  question: QuestionSpecification;
  index: number;
}

function PreviewQuestion({ question, index, controllers }: PreviewQuestionProps & { controllers: Map<string, string> }) {
  const isRequired = question.required;
  const showRequired = isRequired ? <span className="required-mark" aria-hidden="true">*</span> : null;

  const renderOptions = () => {
    if (!question.options || question.options.length === 0) return null;

    if (question.type === 'multiple_choice') {
      return (
        <fieldset className="radio-group">
          {question.options.map((option, optIndex) => (
            <label key={optIndex} className="radio-option">
              <input type="radio" name={`preview-${question.id}`} disabled />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      );
    }

    if (question.type === 'dropdown') {
      return (
        <select className="dropdown-select" disabled>
          <option value="" disabled>Select an option</option>
          {question.options.map((option, optIndex) => (
            <option key={optIndex} value={option}>{option}</option>
          ))}
        </select>
      );
    }

    if (question.type === 'checkboxes') {
      return (
        <fieldset className="checkbox-group">
          {question.options.map((option, optIndex) => (
            <label key={optIndex} className="checkbox-option">
              <input type="checkbox" disabled />
              <span>{option}</span>
            </label>
          ))}
        </fieldset>
      );
    }

    return null;
  };

  return (
    <div className="preview-question">
      <div className="question-header">
        <label className="question-label">
          <span className="question-number">{index + 1}.</span>
          <span className="question-text">{question.title}</span>
          {showRequired}
        </label>
        <span className={`question-type-tag ${question.type}`}>{editTypeLabel(question.type)}</span>
      </div>
      {question.description && <p className="question-help">{question.description}</p>}
      <div className="question-input">{renderOptions() || renderTextInput(question.type)}</div>
      {question.visibility && (
        <p className="question-visibility">
          Shown when “{controllers.get(question.visibility.when.question) ?? question.visibility.when.question}” is “{question.visibility.when.equals}”
        </p>
      )}
    </div>
  );
}

function renderTextInput(type: string) {
  if (type === 'long_text') {
    return <textarea className="text-input long" disabled placeholder="Your answer..." rows={4} />;
  }
  if (type === 'email') {
    return <input type="email" className="text-input" disabled placeholder="name@example.com" />;
  }
  return <input type="text" className="text-input" disabled placeholder="Your answer..." />;
}