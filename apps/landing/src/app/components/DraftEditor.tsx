import { useState, type ChangeEvent } from 'react';
import { QUESTION_TYPES, type QuestionType, type QuestionSpecification, type FormSpecification } from '../../lib/specification';

const TYPE_LABELS: Record<QuestionType, string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  email: 'Email',
  multiple_choice: 'Multiple choice',
  dropdown: 'Dropdown',
  checkboxes: 'Checkboxes',
};

interface DraftEditorProps {
  draft: FormSpecification;
  onUpdate: (spec: FormSpecification) => void;
  onCancel: () => void;
  disabled?: boolean;
}

function generateId(): string {
  return `q_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
}

function getDefaultOptions(type: QuestionType): string[] {
  if (type === 'multiple_choice' || type === 'dropdown' || type === 'checkboxes') {
    return ['Option 1', 'Option 2'];
  }
  return [];
}

function validateQuestion(question: QuestionSpecification, allQuestions: QuestionSpecification[]): string | null {
  if (!question.title.trim()) return 'Question title is required';
  if (QUESTION_TYPES.includes(question.type)) {
    if ((question.type === 'multiple_choice' || question.type === 'dropdown' || question.type === 'checkboxes')) {
      if (!question.options || question.options.length === 0) return 'At least one option is required';
      if (question.options.some(opt => !opt.trim())) return 'All options must have text';
    }
  }
  const idCount = allQuestions.filter(q => q.id === question.id).length;
  if (idCount > 1) return 'Duplicate question ID';
  return null;
}

export function DraftEditor({ draft, onUpdate, onCancel, disabled }: DraftEditorProps) {
  const [questions, setQuestions] = useState<QuestionSpecification[]>(draft.questions.map(q => ({ ...q })));
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [errors, setErrors] = useState<Record<number, string>>({});
  const [showAddDialog, setShowAddDialog] = useState(false);
  const [newQuestionType, setNewQuestionType] = useState<QuestionType>('short_text');

  const updateQuestion = (index: number, updates: Partial<QuestionSpecification>) => {
    const updated = [...questions];
    updated[index] = { ...updated[index], ...updates };
    setQuestions(updated);
    const error = validateQuestion(updated[index], updated);
    setErrors(prev => ({ ...prev, [index]: error ?? '' }));
    if (!error) {
      const spec = { ...draft, questions: updated };
      onUpdate(spec);
    }
  };

  const addQuestion = () => {
    const newQuestion: QuestionSpecification = {
      id: generateId(),
      title: '',
      type: newQuestionType,
      required: false,
      options: getDefaultOptions(newQuestionType),
    };
    const updated = [...questions, newQuestion];
    setQuestions(updated);
    setShowAddDialog(false);
    setEditingIndex(updated.length - 1);
  };

  const removeQuestion = (index: number) => {
    const updated = questions.filter((_, i) => i !== index);
    setQuestions(updated);
    setErrors(prev => {
      const next = { ...prev };
      delete next[index];
      return next;
    });
    onUpdate({ ...draft, questions: updated });
  };

  const moveQuestion = (fromIndex: number, toIndex: number) => {
    const updated = [...questions];
    const [item] = updated.splice(fromIndex, 1);
    updated.splice(toIndex, 0, item);
    setQuestions(updated);
    onUpdate({ ...draft, questions: updated });
  };

  const duplicateQuestion = (index: number) => {
    const original = questions[index];
    const duplicated: QuestionSpecification = {
      ...original,
      id: generateId(),
      title: original.title + ' (copy)',
    };
    const updated = [...questions];
    updated.splice(index + 1, 0, duplicated);
    setQuestions(updated);
    onUpdate({ ...draft, questions: updated });
  };

  const handleTitleChange = (e: ChangeEvent<HTMLInputElement>) => {
    const spec = { ...draft, title: e.target.value };
    onUpdate(spec);
  };

  const handleDescriptionChange = (e: ChangeEvent<HTMLTextAreaElement>) => {
    const spec = { ...draft, description: e.target.value };
    onUpdate(spec);
  };

  return (
    <section className="draft-editor" aria-labelledby="editor-title">
      <div className="draft-editor-header">
        <div>
          <span className="forms-legend">02 / EDIT QUESTIONS DIRECTLY</span>
          <h2 id="editor-title">Review and refine your form</h2>
          <p className="draft-editor-hint">Click any question to edit. Drag to reorder. Changes save automatically.</p>
        </div>
        <div className="draft-editor-actions">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={disabled}>
            Back to chat
          </button>
        </div>
      </div>

      <div className="draft-editor-form">
        <div className="form-meta">
          <label htmlFor="form-title">Form title</label>
          <input
            id="form-title"
            type="text"
            value={draft.title}
            onChange={handleTitleChange}
            maxLength={200}
            disabled={disabled}
            required
          />
          <label htmlFor="form-description">Description (optional)</label>
          <textarea
            id="form-description"
            value={draft.description ?? ''}
            onChange={handleDescriptionChange}
            maxLength={2000}
            rows={2}
            disabled={disabled}
          />
        </div>

        <div className="questions-list" role="list" aria-label="Form questions">
          {questions.length === 0 ? (
            <div className="questions-empty">
              <p>No questions yet. Add your first question to get started.</p>
              <button type="button" className="btn btn-accent" onClick={() => setShowAddDialog(true)} disabled={disabled}>
                Add question
              </button>
            </div>
          ) : (
            questions.map((question, index) => (
              <QuestionItem
                key={question.id}
                index={index}
                question={question}
                isEditing={editingIndex === index}
                onEdit={() => setEditingIndex(index)}
                onClose={() => setEditingIndex(null)}
                onUpdate={updates => updateQuestion(index, updates)}
                onRemove={() => removeQuestion(index)}
                onDuplicate={() => duplicateQuestion(index)}
                onMoveUp={() => index > 0 && moveQuestion(index, index - 1)}
                onMoveDown={() => index < questions.length - 1 && moveQuestion(index, index + 1)}
                error={errors[index]}
                disabled={disabled}
                totalQuestions={questions.length}
              />
            ))
          )}
        </div>

        {questions.length > 0 && (
          <div className="questions-footer">
            <button type="button" className="btn btn-ghost" onClick={() => setShowAddDialog(true)} disabled={disabled}>
              + Add question
            </button>
            <span className="question-count">{questions.length} question{questions.length !== 1 ? 's' : ''}</span>
          </div>
        )}
      </div>

      {showAddDialog && (
        <div className="modal-backdrop" onClick={() => setShowAddDialog(false)} role="dialog" aria-modal="true" aria-labelledby="add-question-title">
          <div className="modal" onClick={e => e.stopPropagation()}>
            <h3 id="add-question-title">Add a new question</h3>
            <p>Choose the question type, then customize it in the editor.</p>
            <div className="question-type-grid">
              {QUESTION_TYPES.map(type => (
                <button
                  key={type}
                  type="button"
                  className={`question-type-option ${newQuestionType === type ? 'selected' : ''}`}
                  onClick={() => setNewQuestionType(type)}
                  disabled={disabled}
                >
                  <span className="type-icon">{type === 'short_text' ? '✏️' : type === 'long_text' ? '📝' : type === 'email' ? '📧' : type === 'multiple_choice' ? '⭕' : type === 'dropdown' ? '🔽' : '☑️'}</span>
                  <span className="type-label">{TYPE_LABELS[type]}</span>
                </button>
              ))}
            </div>
            <div className="modal-actions">
              <button type="button" className="btn btn-ghost" onClick={() => setShowAddDialog(false)}>Cancel</button>
              <button type="button" className="btn btn-accent" onClick={addQuestion} disabled={disabled}>Add</button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

interface QuestionItemProps {
  index: number;
  question: QuestionSpecification;
  isEditing: boolean;
  onEdit: () => void;
  onClose: () => void;
  onUpdate: (updates: Partial<QuestionSpecification>) => void;
  onRemove: () => void;
  onDuplicate: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  error?: string;
  disabled?: boolean;
  totalQuestions: number;
}

function QuestionItem({
  index,
  question,
  isEditing,
  onEdit,
  onClose,
  onUpdate,
  onRemove,
  onDuplicate,
  onMoveUp,
  onMoveDown,
  error,
  disabled,
  totalQuestions,
}: QuestionItemProps) {
  const isChoiceType = question.type === 'multiple_choice' || question.type === 'dropdown' || question.type === 'checkboxes';
  const [localOptions, setLocalOptions] = useState<string[]>(question.options ?? []);

  const handleOptionChange = (optIndex: number, value: string) => {
    const updated = [...localOptions];
    updated[optIndex] = value;
    setLocalOptions(updated);
    onUpdate({ options: updated });
  };

  const handleOptionRemove = (optIndex: number) => {
    if (localOptions.length <= 1) return;
    const updated = localOptions.filter((_, i) => i !== optIndex);
    setLocalOptions(updated);
    onUpdate({ options: updated });
  };

  const handleOptionAdd = () => {
    setLocalOptions([...localOptions, '']);
  };

  const handleTypeChange = (newType: QuestionType) => {
    const newOptions = (newType === 'multiple_choice' || newType === 'dropdown' || newType === 'checkboxes')
      ? getDefaultOptions(newType)
      : undefined;
    onUpdate({ type: newType, options: newOptions });
    if (newOptions) setLocalOptions(newOptions);
  };

  return (
    <article className={`question-item ${isEditing ? 'editing' : ''} ${error ? 'has-error' : ''}`} role="listitem">
      <div className="question-handle" aria-hidden="true">
        <span className="drag-handle" title="Drag to reorder">⋮⋮</span>
        <span className="question-number">{index + 1}</span>
      </div>

      {!isEditing ? (
        <div className="question-preview" onClick={onEdit}>
          <div className="question-preview-main">
            <h3>{question.title || '<em>Untitled question</em>'}</h3>
            <div className="question-preview-meta">
              <span className={`question-type-badge ${question.type}`}>{TYPE_LABELS[question.type]}</span>
              <span className={question.required ? 'required-badge' : 'optional-badge'}>
                {question.required ? 'Required' : 'Optional'}
              </span>
            </div>
          </div>
          <div className="question-preview-actions">
            <button type="button" className="icon-btn" onClick={e => { e.stopPropagation(); onDuplicate(); }} title="Duplicate" disabled={disabled}>⧉</button>
            <button type="button" className="icon-btn" onClick={e => { e.stopPropagation(); onRemove(); }} title="Delete" disabled={disabled}>🗑</button>
          </div>
        </div>
      ) : (
        <div className="question-editor">
          <div className="editor-header">
            <select
              value={question.type}
              onChange={e => handleTypeChange(e.target.value as QuestionType)}
              disabled={disabled}
              aria-label="Question type"
            >
              {QUESTION_TYPES.map(type => <option key={type} value={type}>{TYPE_LABELS[type]}</option>)}
            </select>
            <div className="editor-header-actions">
              <label className="required-toggle">
                <input
                  type="checkbox"
                  checked={question.required}
                  onChange={e => onUpdate({ required: e.target.checked })}
                  disabled={disabled}
                />
                <span>Required</span>
              </label>
              <button type="button" className="icon-btn" onClick={onClose} title="Done editing" disabled={disabled}>✕</button>
            </div>
          </div>

          <label htmlFor={`question-title-${question.id}`} className="sr-only">Question text</label>
          <input
            id={`question-title-${question.id}`}
            type="text"
            value={question.title}
            onChange={e => onUpdate({ title: e.target.value })}
            placeholder="Enter your question"
            maxLength={500}
            disabled={disabled}
            autoFocus
          />
          {question.description !== undefined && (
            <label htmlFor={`question-desc-${question.id}`} className="sr-only">Help text (optional)</label>
          )}
          <textarea
            id={`question-desc-${question.id}`}
            value={question.description ?? ''}
            onChange={e => onUpdate({ description: e.target.value })}
            placeholder="Help text (optional)"
            maxLength={1000}
            rows={2}
            disabled={disabled}
          />

          {isChoiceType && (
            <div className="options-editor">
              <label className="forms-legend">Answer options</label>
              {localOptions.map((option, optIndex) => (
                <div key={optIndex} className="option-row">
                  <input
                    type="text"
                    value={option}
                    onChange={e => handleOptionChange(optIndex, e.target.value)}
                    placeholder={`Option ${optIndex + 1}`}
                    maxLength={200}
                    disabled={disabled}
                  />
                  <button
                    type="button"
                    className="icon-btn option-remove"
                    onClick={() => handleOptionRemove(optIndex)}
                    disabled={disabled || localOptions.length <= 1}
                    aria-label="Remove option"
                  >
                    ✕
                  </button>
                </div>
              ))}
              <button type="button" className="btn btn-ghost btn-sm add-option" onClick={handleOptionAdd} disabled={disabled}>
                + Add option
              </button>
              <p className="options-hint">
                {question.type === 'multiple_choice' ? 'One answer' : question.type === 'dropdown' ? 'One answer' : 'Multiple answers'}
              </p>
            </div>
          )}

          {error && <p className="field-error" role="alert">{error}</p>}

          <div className="editor-footer">
            <div className="move-controls">
              <button type="button" className="icon-btn" onClick={onMoveUp} disabled={disabled || index === 0} title="Move up">↑</button>
              <button type="button" className="icon-btn" onClick={onMoveDown} disabled={disabled || index === totalQuestions - 1} title="Move down">↓</button>
            </div>
          </div>
        </div>
      )}
    </article>
  );
}