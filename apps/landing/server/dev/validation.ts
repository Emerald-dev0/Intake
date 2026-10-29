/**
 * Validation for the developer workspace.
 *
 * Everything here is deterministic and runs on the server: a definition is checked before it is
 * stored, and a published definition is checked again before it is served. The browser is never
 * trusted to have done it.
 *
 * Errors come back as a list of `{ path, message }` so the console can point at the field that is
 * wrong, and the API can answer with a machine-readable body instead of a sentence.
 */

import {
  CHOICE_FIELD_TYPES,
  DEV_FIELD_LIMIT,
  DEV_FIELD_TYPES,
  DEV_OPTION_LIMIT,
  type DevField,
  type DevFieldType,
  type DevFormDefinition,
  type DevTheme,
} from './contracts.js';

export interface DevFieldError {
  path: string;
  message: string;
}

export type DevValidation<T> = { ok: true; value: T } | { ok: false; errors: DevFieldError[] };

const HEX_COLOUR = /^#(?:[0-9a-f]{3}|[0-9a-f]{6})$/i;
const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/** Turns a name into a readable slug. Non-latin characters are dropped rather than transliterated. */
export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFKD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export function validateProjectName(value: unknown): DevValidation<string> {
  if (typeof value !== 'string') return { ok: false, errors: [{ path: 'name', message: 'Give the project a name.' }] };
  const name = value.trim();
  if (name.length < 1) return { ok: false, errors: [{ path: 'name', message: 'Give the project a name.' }] };
  if (name.length > 80) return { ok: false, errors: [{ path: 'name', message: 'Keep the name under 80 characters.' }] };
  return { ok: true, value: name };
}

export function validateFormName(value: unknown): DevValidation<string> {
  if (typeof value !== 'string') return { ok: false, errors: [{ path: 'name', message: 'Give the form a name.' }] };
  const name = value.trim();
  if (name.length < 1) return { ok: false, errors: [{ path: 'name', message: 'Give the form a name.' }] };
  if (name.length > 120) return { ok: false, errors: [{ path: 'name', message: 'Keep the name under 120 characters.' }] };
  return { ok: true, value: name };
}

/** A slug is either supplied and well formed, or derived from the name. */
export function validateSlug(value: unknown, fallback: string): DevValidation<string> {
  if (value === undefined || value === null || value === '') {
    const derived = slugify(fallback);
    if (derived.length < 3) return { ok: false, errors: [{ path: 'slug', message: 'Add a few letters so the address has something to read.' }] };
    return { ok: true, value: derived };
  }
  if (typeof value !== 'string') return { ok: false, errors: [{ path: 'slug', message: 'The address has to be text.' }] };
  const slug = value.trim().toLowerCase();
  if (slug.length < 3 || slug.length > 60) {
    return { ok: false, errors: [{ path: 'slug', message: 'The address has to be between 3 and 60 characters.' }] };
  }
  if (!SLUG.test(slug)) {
    return { ok: false, errors: [{ path: 'slug', message: 'Use lowercase letters, numbers and single dashes.' }] };
  }
  return { ok: true, value: slug };
}

function validateTheme(value: unknown, path: string, errors: DevFieldError[]): DevTheme {
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<DevTheme>;
  const colour = (key: keyof DevTheme, fallback: string): string => {
    const candidate = raw[key];
    if (candidate === undefined || candidate === null || candidate === '') return fallback;
    if (typeof candidate !== 'string' || !HEX_COLOUR.test(candidate.trim())) {
      errors.push({ path: `${path}.${key}`, message: 'Use a hex colour, for example #1a1b18.' });
      return fallback;
    }
    return candidate.trim().toLowerCase();
  };
  const mode = raw.mode ?? 'system';
  if (mode !== 'light' && mode !== 'dark' && mode !== 'system') {
    errors.push({ path: `${path}.mode`, message: 'The theme is light, dark or system.' });
  }
  let radius = typeof raw.radius === 'number' ? raw.radius : 8;
  if (!Number.isFinite(radius) || radius < 0 || radius > 32) {
    errors.push({ path: `${path}.radius`, message: 'The corner radius goes from 0 to 32.' });
    radius = 8;
  }
  let fontFamily: string | null = null;
  if (raw.fontFamily !== undefined && raw.fontFamily !== null && raw.fontFamily !== '') {
    if (typeof raw.fontFamily !== 'string' || raw.fontFamily.length > 120) {
      errors.push({ path: `${path}.fontFamily`, message: 'The typeface name is too long.' });
    } else {
      fontFamily = raw.fontFamily.trim();
    }
  }
  return {
    mode: (mode === 'light' || mode === 'dark' || mode === 'system') ? mode : 'system',
    primary: colour('primary', '#ff5a1f'),
    background: colour('background', '#ffffff'),
    text: colour('text', '#1a1b18'),
    border: colour('border', '#d8d4cc'),
    fontFamily,
    radius,
    transparentBackground: raw.transparentBackground === true,
  };
}

function validateField(value: unknown, index: number, errors: DevFieldError[]): DevField | null {
  const path = `fields.${index}`;
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<DevField>;
  const type = raw.type;
  if (typeof type !== 'string' || !DEV_FIELD_TYPES.includes(type as DevFieldType)) {
    errors.push({ path: `${path}.type`, message: 'That is not a field type we render.' });
    return null;
  }
  const label = typeof raw.label === 'string' ? raw.label.trim() : '';
  if (label.length < 1) errors.push({ path: `${path}.label`, message: 'Every field needs a label.' });
  else if (label.length > 120) errors.push({ path: `${path}.label`, message: 'Keep the label under 120 characters.' });

  const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id.trim() : '';
  if (!id) errors.push({ path: `${path}.id`, message: 'Every field needs an identifier.' });
  else if (!/^[a-z0-9_-]{1,40}$/i.test(id)) errors.push({ path: `${path}.id`, message: 'Field identifiers use letters, numbers, dashes and underscores.' });

  let description: string | null = null;
  if (raw.description !== undefined && raw.description !== null && raw.description !== '') {
    if (typeof raw.description !== 'string' || raw.description.length > 200) {
      errors.push({ path: `${path}.description`, message: 'Keep the description under 200 characters.' });
    } else {
      description = raw.description.trim();
    }
  }

  let placeholder: string | null = null;
  if (raw.placeholder !== undefined && raw.placeholder !== null && raw.placeholder !== '') {
    if (typeof raw.placeholder !== 'string' || raw.placeholder.length > 80) {
      errors.push({ path: `${path}.placeholder`, message: 'Keep the placeholder under 80 characters.' });
    } else {
      placeholder = raw.placeholder.trim();
    }
  }

  let options: string[] = [];
  if (CHOICE_FIELD_TYPES.includes(type as DevFieldType)) {
    const rawOptions = Array.isArray(raw.options) ? raw.options : [];
    if (rawOptions.length < 1) errors.push({ path: `${path}.options`, message: 'Give this field at least one option.' });
    if (rawOptions.length > DEV_OPTION_LIMIT) {
      errors.push({ path: `${path}.options`, message: `A field can have up to ${DEV_OPTION_LIMIT} options.` });
    }
    const seen = new Set<string>();
    for (const [optionIndex, option] of rawOptions.entries()) {
      if (typeof option !== 'string' || option.trim().length < 1) {
        errors.push({ path: `${path}.options.${optionIndex}`, message: 'An option cannot be empty.' });
        continue;
      }
      if (option.trim().length > 60) {
        errors.push({ path: `${path}.options.${optionIndex}`, message: 'Keep an option under 60 characters.' });
        continue;
      }
      const value = option.trim();
      if (seen.has(value.toLowerCase())) {
        errors.push({ path: `${path}.options.${optionIndex}`, message: 'Two options cannot read the same.' });
        continue;
      }
      seen.add(value.toLowerCase());
      options.push(value);
    }
  }

  return {
    id,
    type: type as DevFieldType,
    label,
    description,
    required: raw.required === true,
    options,
    placeholder,
  };
}

/** Checks a whole definition. An empty field list is allowed in a draft, but not in a published form. */
export function validateDefinition(value: unknown, { requireFields = false } = {}): DevValidation<DevFormDefinition> {
  const errors: DevFieldError[] = [];
  const raw = (typeof value === 'object' && value !== null ? value : {}) as Partial<DevFormDefinition>;

  const rawFields = Array.isArray(raw.fields) ? raw.fields : [];
  if (rawFields.length > DEV_FIELD_LIMIT) {
    errors.push({ path: 'fields', message: `A form can have up to ${DEV_FIELD_LIMIT} fields.` });
  }
  if (requireFields && rawFields.length < 1) {
    errors.push({ path: 'fields', message: 'A published form needs at least one field.' });
  }
  const fields: DevField[] = [];
  const ids = new Set<string>();
  rawFields.forEach((field, index) => {
    const parsed = validateField(field, index, errors);
    if (!parsed) return;
    if (parsed.id) {
      if (ids.has(parsed.id)) errors.push({ path: `fields.${index}.id`, message: 'Two fields cannot share an identifier.' });
      ids.add(parsed.id);
    }
    fields.push(parsed);
  });

  const theme = validateTheme(raw.theme, 'theme', errors);

  let submitLabel: string | null = null;
  if (raw.submitLabel !== undefined && raw.submitLabel !== null && raw.submitLabel !== '') {
    if (typeof raw.submitLabel !== 'string' || raw.submitLabel.length > 40) {
      errors.push({ path: 'submitLabel', message: 'Keep the button text under 40 characters.' });
    } else {
      submitLabel = raw.submitLabel.trim();
    }
  }
  let successMessage: string | null = null;
  if (raw.successMessage !== undefined && raw.successMessage !== null && raw.successMessage !== '') {
    if (typeof raw.successMessage !== 'string' || raw.successMessage.length > 200) {
      errors.push({ path: 'successMessage', message: 'Keep the thank-you text under 200 characters.' });
    } else {
      successMessage = raw.successMessage.trim();
    }
  }

  if (errors.length) return { ok: false, errors };
  return { ok: true, value: { fields, theme, submitLabel, successMessage } };
}

/** The definition a brand new form starts from. */
export function emptyDefinition(): DevFormDefinition {
  return {
    fields: [],
    theme: {
      mode: 'system',
      primary: '#ff5a1f',
      background: '#ffffff',
      text: '#1a1b18',
      border: '#d8d4cc',
      fontFamily: null,
      radius: 8,
      transparentBackground: false,
    },
    submitLabel: null,
    successMessage: null,
  };
}
