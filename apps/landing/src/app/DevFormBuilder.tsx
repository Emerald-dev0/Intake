import { useEffect, useMemo, useState } from 'react';
import { devApi, DevApiError, FIELD_LABEL, type DevField, type DevFieldType, type DevFormDefinition, type DevFormDetail } from '../lib/dev-api';

/**
 * The form builder.
 *
 * It edits the **draft** version. A published version is never rewritten, so what people are
 * answering stays exactly as it was while somebody works on the next version.
 *
 * The builder is deliberately plain: a list of questions, one of them open at a time, and a save.
 * Everything it accepts is checked again by the server, so a mistake here shows up as a message
 * against the field rather than as a broken form.
 */

const FIELD_TYPES: DevFieldType[] = [
  'short_text', 'long_text', 'email', 'number', 'dropdown', 'single_choice', 'multiple_choice', 'checkbox', 'date',
];

const CHOICE_TYPES: DevFieldType[] = ['dropdown', 'single_choice', 'multiple_choice'];

function blankField(type: DevFieldType, index: number): DevField {
  return {
    id: `field_${index + 1}`,
    type,
    label: 'New question',
    description: null,
    required: false,
    options: CHOICE_TYPES.includes(type) ? ['Option one', 'Option two'] : [],
    placeholder: null,
  };
}

export function DevFormBuilder({ detail, onSaved }: { detail: DevFormDetail; onSaved: (detail: DevFormDetail) => void }) {
  const source = detail.draftVersion?.definition ?? detail.publishedVersion?.definition ?? null;
  const [fields, setFields] = useState<DevField[]>(source?.fields ?? []);
  const [theme, setTheme] = useState(source?.theme ?? {
    mode: 'system' as const, primary: '#ff5a1f', background: '#ffffff', text: '#1a1b18', border: '#d8d4cc',
    fontFamily: null, radius: 8, transparentBackground: false,
  });
  const [submitLabel, setSubmitLabel] = useState(source?.submitLabel ?? '');
  const [successMessage, setSuccessMessage] = useState(source?.successMessage ?? '');
  const [selected, setSelected] = useState<string | null>(fields[0]?.id ?? null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});

  // A different form (or a new version) replaces what is on screen.
  useEffect(() => {
    const next = detail.draftVersion?.definition ?? detail.publishedVersion?.definition ?? null;
    setFields(next?.fields ?? []);
    setTheme(next?.theme ?? theme);
    setSubmitLabel(next?.submitLabel ?? '');
    setSuccessMessage(next?.successMessage ?? '');
    setSelected(next?.fields[0]?.id ?? null);
    setSaved(false);
    setError('');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [detail.form.id, detail.draftVersion?.id, detail.publishedVersion?.id]);

  const current = useMemo(() => fields.find(field => field.id === selected) ?? null, [fields, selected]);

  function addField(type: DevFieldType) {
    const field = blankField(type, fields.length);
    setFields(current2 => [...current2, field]);
    setSelected(field.id);
    setSaved(false);
  }

  function updateField(id: string, patch: Partial<DevField>) {
    setFields(current2 => current2.map(field => (field.id === id ? { ...field, ...patch } : field)));
    setSaved(false);
  }

  function removeField(id: string) {
    setFields(current2 => current2.filter(field => field.id !== id));
    setSelected(current2 => (current2 === id ? null : current2));
    setSaved(false);
  }

  function moveField(id: string, direction: -1 | 1) {
    setFields(current2 => {
      const index = current2.findIndex(field => field.id === id);
      const next = index + direction;
      if (index < 0 || next < 0 || next >= current2.length) return current2;
      const copy = [...current2];
      const [moved] = copy.splice(index, 1);
      copy.splice(next, 0, moved);
      return copy;
    });
    setSaved(false);
  }

  async function save() {
    setSaving(true);
    setError('');
    setFieldErrors({});
    const definition: DevFormDefinition = {
      fields,
      theme,
      submitLabel: submitLabel.trim() || null,
      successMessage: successMessage.trim() || null,
    };
    try {
      const updated = await devApi.saveDefinition(detail.form.id, definition);
      setSaved(true);
      onSaved(updated);
    } catch (caught) {
      if (caught instanceof DevApiError) {
        setError(caught.message);
        const next: Record<string, string> = {};
        for (const fieldError of caught.fieldErrors) next[fieldError.path] = fieldError.message;
        setFieldErrors(next);
      } else {
        setError('The form could not be saved.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="dev-builder">
      <div className="dev-builder__toolbar">
        <label className="dev-field">
          <span>Add a question</span>
          <select className="dev-select" value="" onChange={event => {
            const value = event.target.value as DevFieldType;
            if (value) addField(value);
          }}>
            <option value="">Choose a type…</option>
            {FIELD_TYPES.map(type => <option key={type} value={type}>{FIELD_LABEL[type]}</option>)}
          </select>
        </label>
        <button type="button" className="dev-button" onClick={() => void save()} disabled={saving}>
          {saving ? 'Saving…' : 'Save the draft'}
        </button>
        {saved && <span className="dev-saved" role="status">Saved.</span>}
      </div>

      {error && <p className="dev-note dev-note--error" role="alert">{error}</p>}

      <ul className="dev-list dev-list--builder">
        {fields.length === 0 && <li className="dev-list__empty">No questions yet. Add one above.</li>}
        {fields.map((field, index) => (
          <li key={field.id} className={selected === field.id ? 'is-selected' : ''}>
            <button type="button" className="dev-list__row dev-list__row--button" onClick={() => setSelected(field.id)}>
              <span className="dev-list__name">{field.label || 'Untitled question'}</span>
              <span className="dev-field-type">{FIELD_LABEL[field.type] ?? field.type}</span>
              {field.required && <span className="dev-required">required</span>}
            </button>
            <div className="dev-field-actions">
              <button type="button" onClick={() => moveField(field.id, -1)} disabled={index === 0} aria-label={`Move ${field.label} up`}>↑</button>
              <button type="button" onClick={() => moveField(field.id, 1)} disabled={index === fields.length - 1} aria-label={`Move ${field.label} down`}>↓</button>
              <button type="button" onClick={() => removeField(field.id)} aria-label={`Remove ${field.label}`}>Remove</button>
            </div>
            {fieldErrors[`fields.${index}.label`] && <p className="dev-field-error">{fieldErrors[`fields.${index}.label`]}</p>}
          </li>
        ))}
      </ul>

      {current && (
        <div className="dev-editor">
          <h3 className="dev-editor__title">Edit: {current.label || 'Untitled question'}</h3>
          <label className="dev-field">
            <span>Label</span>
            <input type="text" value={current.label} maxLength={120} onChange={event => updateField(current.id, { label: event.target.value })} />
          </label>
          <label className="dev-field">
            <span>Help text</span>
            <input type="text" value={current.description ?? ''} maxLength={200} onChange={event => updateField(current.id, { description: event.target.value || null })} />
          </label>
          <label className="dev-check">
            <input type="checkbox" checked={current.required} onChange={event => updateField(current.id, { required: event.target.checked })} />
            <span>Required</span>
          </label>
          {CHOICE_TYPES.includes(current.type) && (
            <label className="dev-field">
              <span>Options — one per line</span>
              <textarea
                className="dev-textarea"
                rows={4}
                value={current.options.join('\n')}
                onChange={event => updateField(current.id, { options: event.target.value.split('\n').map(entry => entry.trim()).filter(Boolean) })}
              />
            </label>
          )}
          {!CHOICE_TYPES.includes(current.type) && current.type !== 'checkbox' && (
            <label className="dev-field">
              <span>Placeholder</span>
              <input type="text" value={current.placeholder ?? ''} maxLength={80} onChange={event => updateField(current.id, { placeholder: event.target.value || null })} />
            </label>
          )}
        </div>
      )}

      <div className="dev-editor">
        <h3 className="dev-editor__title">The look of it</h3>
        <p className="dev-editor__note">
          An iframe on another site cannot read your CSS, so these are settings on the form rather
          than inherited styles. Light, dark and system are supported, and the background can be
          transparent so your page shows through.
        </p>
        <div className="dev-theme-grid">
          <label className="dev-field">
            <span>Theme</span>
            <select className="dev-select" value={theme.mode} onChange={event => setTheme({ ...theme, mode: event.target.value as 'light' | 'dark' | 'system' })}>
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </label>
          {(['primary', 'background', 'text', 'border'] as const).map(key => (
            <label className="dev-field" key={key}>
              <span>{key}</span>
              <input type="text" value={theme[key]} onChange={event => setTheme({ ...theme, [key]: event.target.value })} />
            </label>
          ))}
          <label className="dev-field">
            <span>Corner radius</span>
            <input type="number" min={0} max={32} value={theme.radius} onChange={event => setTheme({ ...theme, radius: Number(event.target.value) })} />
          </label>
          <label className="dev-field">
            <span>Typeface</span>
            <input type="text" value={theme.fontFamily ?? ''} placeholder="inherit" onChange={event => setTheme({ ...theme, fontFamily: event.target.value || null })} />
          </label>
        </div>
        <label className="dev-check">
          <input type="checkbox" checked={theme.transparentBackground} onChange={event => setTheme({ ...theme, transparentBackground: event.target.checked })} />
          <span>Transparent background</span>
        </label>
        <label className="dev-field">
          <span>Button text</span>
          <input type="text" value={submitLabel} maxLength={40} placeholder="Send" onChange={event => setSubmitLabel(event.target.value)} />
        </label>
        <label className="dev-field">
          <span>Thank-you message</span>
          <input type="text" value={successMessage} maxLength={200} placeholder="Thanks — we have it." onChange={event => setSuccessMessage(event.target.value)} />
        </label>
      </div>
    </div>
  );
}
