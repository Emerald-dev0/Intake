import { useEffect, useMemo, useRef, useState } from 'react';

/**
 * The hosted form.
 *
 * Two things render this: the permanent page at `/forms/<project>/<form>` and the bare version at
 * `/embed/forms/<project>/<form>` that goes in an iframe. The form itself is the same either way.
 *
 * The rules that matter:
 *
 * - The definition comes from the server, and the server is what decides whether an answer is good.
 *   The checks here are a courtesy that saves a round trip, not the boundary.
 * - A retry must not send the same person twice, so one idempotency key is made when the form
 *   loads and reused for every attempt.
 * - A cross-origin iframe cannot inherit the host page's CSS, so the theme is applied here as
 *   variables on this component's own root. That is the whole reason the theme is configuration.
 * - Every failure has its own state. An embedded form never shows an empty box.
 */

export interface HostedField {
  id: string;
  type: string;
  label: string;
  description: string | null;
  required: boolean;
  options: string[];
  placeholder: string | null;
}

export interface HostedDefinition {
  fields: HostedField[];
  theme: {
    mode: 'light' | 'dark' | 'system';
    primary: string;
    background: string;
    text: string;
    border: string;
    fontFamily: string | null;
    radius: number;
    transparentBackground: boolean;
  };
  submitLabel: string | null;
  successMessage: string | null;
}

type Answers = Record<string, string | string[] | boolean>;

interface HostedFormPayload {
  form: { name: string; slug: string; projectSlug: string; version: number };
  definition: HostedDefinition;
}

const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;

function newIdempotencyKey(): string {
  const random = typeof crypto !== 'undefined' && 'randomUUID' in crypto
    ? crypto.randomUUID()
    : `${Date.now()}-${Math.random().toString(36).slice(2)}`;
  return `hf-${random}`;
}

export function HostedFormPage({
  projectSlug,
  formSlug,
  variant = 'page',
}: {
  projectSlug: string;
  formSlug: string;
  variant?: 'page' | 'embed';
}) {
  const [payload, setPayload] = useState<HostedFormPayload | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'missing' | 'unavailable'>('loading');
  const [answers, setAnswers] = useState<Answers>({});
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [submitting, setSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState('');
  const [done, setDone] = useState(false);
  const idempotencyKey = useRef(newIdempotencyKey());

  // The title of a hosted form is the form's own name, and the embed is kept out of search results
  // because it is a fragment of somebody else's page, not a page of its own.
  useEffect(() => {
    if (variant !== 'embed') return;
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex, nofollow';
    document.head.appendChild(meta);
    return () => { meta.remove(); };
  }, [variant]);

  useEffect(() => {
    if (!payload || variant !== 'page') return;
    const previous = document.title;
    document.title = `${payload.form.name} · Intake`;
    return () => { document.title = previous; };
  }, [payload, variant]);

  useEffect(() => {
    let active = true;
    setState('loading');
    void fetch(`/api/dev/public/forms/${encodeURIComponent(projectSlug)}/${encodeURIComponent(formSlug)}`, {
      headers: { accept: 'application/json' },
      cache: 'no-store',
    })
      .then(async response => {
        if (response.status === 404) {
          if (active) setState('missing');
          return;
        }
        if (!response.ok) {
          if (active) setState('unavailable');
          return;
        }
        const body = await response.json() as HostedFormPayload;
        if (!active) return;
        setPayload(body);
        setState('ready');
      })
      .catch(() => {
        if (active) setState('unavailable');
      });
    return () => { active = false; };
  }, [projectSlug, formSlug]);

  const themeStyle = useMemo(() => {
    const theme = payload?.definition.theme;
    if (!theme) return undefined;
    return {
      '--hf-primary': theme.primary,
      '--hf-background': theme.background,
      '--hf-text': theme.text,
      '--hf-border': theme.border,
      '--hf-radius': `${theme.radius}px`,
      '--hf-font': theme.fontFamily ?? 'inherit',
      colorScheme: theme.mode === 'system' ? 'light dark' : theme.mode,
    } as React.CSSProperties;
  }, [payload]);

  function setAnswer(id: string, value: string | string[] | boolean) {
    setAnswers(current => ({ ...current, [id]: value }));
    setErrors(current => {
      if (!current[id]) return current;
      const next = { ...current };
      delete next[id];
      return next;
    });
  }

  /** The same checks the server makes, so an obvious mistake never costs a round trip. */
  function check(): Record<string, string> {
    const found: Record<string, string> = {};
    for (const field of payload?.definition.fields ?? []) {
      const value = answers[field.id];
      const empty = value === undefined || value === '' || (Array.isArray(value) && value.length === 0) || value === false;
      if (field.required) {
        if (field.type === 'checkbox') {
          if (value !== true) found[field.id] = 'This box has to be ticked.';
        } else if (empty) {
          found[field.id] = 'This question needs an answer.';
        }
      }
      if (!empty && field.type === 'email' && typeof value === 'string' && !EMAIL.test(value.trim())) {
        found[field.id] = 'That does not look like an email address.';
      }
      if (!empty && field.type === 'number' && typeof value === 'string' && !Number.isFinite(Number(value))) {
        found[field.id] = 'That has to be a number.';
      }
    }
    return found;
  }

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!payload) return;
    const found = check();
    setErrors(found);
    setSubmitError('');
    if (Object.keys(found).length) {
      const first = document.getElementById(`hf-field-${Object.keys(found)[0]}`);
      first?.focus();
      return;
    }
    setSubmitting(true);
    try {
      const response = await fetch(`/api/dev/public/forms/${encodeURIComponent(projectSlug)}/${encodeURIComponent(formSlug)}/submissions`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Idempotency-Key': idempotencyKey.current },
        body: JSON.stringify({ answers }),
      });
      if (response.status === 400) {
        const body = await response.json().catch(() => ({}) as { fieldErrors?: Array<{ field: string; message: string }> });
        const next: Record<string, string> = {};
        for (const error of body.fieldErrors ?? []) next[error.field] = error.message;
        setErrors(next);
        setSubmitError('Some answers need another look.');
        return;
      }
      if (response.status === 404) {
        setState('missing');
        return;
      }
      if (!response.ok) {
        setSubmitError('That could not be sent. Try again in a moment.');
        return;
      }
      setDone(true);
    } catch {
      setSubmitError('That could not be sent — the connection dropped. Try again; it will not send twice.');
    } finally {
      setSubmitting(false);
    }
  }

  if (state === 'loading') {
    return (
      <div className={`hf hf--${variant} hf--loading`} style={themeStyle}>
        <p className="hf__status">Loading the form…</p>
      </div>
    );
  }

  if (state === 'missing') {
    return (
      <div className={`hf hf--${variant} hf--message`} style={themeStyle}>
        <h1 className="hf__message-title">There is no form at this address.</h1>
        <p className="hf__status">
          It may have been closed, or the address may have a typo in it. If you expected a form here,
          check the link you followed.
        </p>
      </div>
    );
  }

  if (state === 'unavailable' || !payload) {
    return (
      <div className={`hf hf--${variant} hf--message`} style={themeStyle}>
        <h1 className="hf__message-title">The form is having a moment.</h1>
        <p className="hf__status">It could not be loaded just now. Try again in a minute.</p>
      </div>
    );
  }

  const { form, definition } = payload;

  if (done) {
    return (
      <div className={`hf hf--${variant} hf--done`} style={themeStyle}>
        <h1 className="hf__message-title">Thank you.</h1>
        <p className="hf__status">{definition.successMessage ?? 'Your answer has been sent.'}</p>
      </div>
    );
  }

  return (
    <div className={`hf hf--${variant}`} style={themeStyle}>
      <h1 className="hf__title">{form.name}</h1>
      {variant === 'page' && (
        <p className="hf__byline">Hosted by Intake</p>
      )}
      <form className="hf__form" onSubmit={submit} noValidate>
        {definition.fields.map(field => (
          <Field
            key={field.id}
            field={field}
            value={answers[field.id]}
            error={errors[field.id]}
            onChange={value => setAnswer(field.id, value)}
          />
        ))}

        {submitError && (
          <p className="hf__error-summary" role="alert">
            {submitError}
          </p>
        )}

        <button type="submit" className="hf__submit" disabled={submitting}>
          {submitting ? 'Sending…' : (definition.submitLabel ?? 'Send')}
        </button>
      </form>
      {variant === 'page' && (
        <p className="hf__footnote">
          Powered by <a href="/" rel="nofollow">Intake</a>. Your answer goes straight to the person who made this form.
        </p>
      )}
    </div>
  );
}

function Field({
  field,
  value,
  error,
  onChange,
}: {
  field: HostedField;
  value: string | string[] | boolean | undefined;
  error?: string;
  onChange: (value: string | string[] | boolean) => void;
}) {
  const inputId = `hf-field-${field.id}`;
  const errorId = `${inputId}-error`;
  const describedBy = [field.description ? `${inputId}-hint` : '', error ? errorId : ''].filter(Boolean).join(' ') || undefined;

  return (
    <div className={`hf__field${error ? ' has-error' : ''}`}>
      {field.type === 'single_choice' || field.type === 'multiple_choice' ? (
        <fieldset className="hf__fieldset">
          <legend className="hf__label">
            {field.label}
            {field.required && <span className="hf__required" aria-hidden> *</span>}
          </legend>
          {field.description && <p className="hf__hint" id={`${inputId}-hint`}>{field.description}</p>}
          <div className="hf__choices">
            {field.options.map(option => {
              const checked = field.type === 'multiple_choice'
                ? Array.isArray(value) && value.includes(option)
                : value === option;
              return (
                <label className="hf__choice" key={option}>
                  <input
                    type={field.type === 'multiple_choice' ? 'checkbox' : 'radio'}
                    name={field.id}
                    value={option}
                    checked={checked}
                    aria-describedby={describedBy}
                    onChange={event => {
                      if (field.type === 'multiple_choice') {
                        const list = Array.isArray(value) ? value : [];
                        onChange(event.target.checked ? [...list, option] : list.filter(entry => entry !== option));
                      } else {
                        onChange(option);
                      }
                    }}
                  />
                  <span>{option}</span>
                </label>
              );
            })}
          </div>
        </fieldset>
      ) : field.type === 'checkbox' ? (
        <div className="hf__field">
          <label className="hf__choice" htmlFor={inputId}>
            <input
              id={inputId}
              type="checkbox"
              checked={value === true}
              aria-describedby={describedBy}
              onChange={event => onChange(event.target.checked)}
            />
            <span>
              {field.label}
              {field.required && <span className="hf__required" aria-hidden> *</span>}
            </span>
          </label>
        </div>
      ) : (
        <>
          <label className="hf__label" htmlFor={inputId}>
            {field.label}
            {field.required && <span className="hf__required" aria-hidden> *</span>}
          </label>
          {field.description && <p className="hf__hint" id={`${inputId}-hint`}>{field.description}</p>}
          {field.type === 'long_text' ? (
            <textarea
              id={inputId}
              className="hf__input hf__input--long"
              rows={4}
              placeholder={field.placeholder ?? undefined}
              value={typeof value === 'string' ? value : ''}
              aria-describedby={describedBy}
              onChange={event => onChange(event.target.value)}
            />
          ) : field.type === 'dropdown' ? (
            <select
              id={inputId}
              className="hf__input"
              value={typeof value === 'string' ? value : ''}
              aria-describedby={describedBy}
              onChange={event => onChange(event.target.value)}
            >
              <option value="">Choose…</option>
              {field.options.map(option => <option key={option} value={option}>{option}</option>)}
            </select>
          ) : (
            <input
              id={inputId}
              className="hf__input"
              type={field.type === 'email' ? 'email' : field.type === 'number' ? 'number' : field.type === 'date' ? 'date' : 'text'}
              placeholder={field.placeholder ?? undefined}
              value={typeof value === 'string' ? value : ''}
              aria-describedby={describedBy}
              onChange={event => onChange(event.target.value)}
            />
          )}
        </>
      )}
      {error && <p className="hf__error" id={errorId} role="alert">{error}</p>}
    </div>
  );
}
