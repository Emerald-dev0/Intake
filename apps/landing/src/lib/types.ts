export type FieldType =
  | 'short_text'
  | 'long_text'
  | 'email'
  | 'phone'
  | 'number'
  | 'single_choice'
  | 'multiple_choice'
  | 'dropdown'
  | 'date'
  | 'time'
  | 'rating';

export type Cond = { field: string; op: 'eq' | 'lt' | 'has'; value: string | number };

export interface Field {
  id: string;
  label: string;
  type: FieldType;
  required: boolean;
  options?: string[];
  when?: Cond;
  description?: string;
}

export interface FormSpec {
  title: string;
  description: string;
  fields: Field[];
}

export type HLKind = 'field' | 'logic' | 'rule' | 'meta';

export interface Highlight {
  text: string;
  kind: HLKind;
  tag: string;
}

export type AnswerValue = string | number | string[];
export type Answers = Record<string, AnswerValue | undefined>;

export function isVisible(f: Field, answers: Answers): boolean {
  if (!f.when) return true;
  const a = answers[f.when.field];
  if (a === undefined || a === '') return false;
  switch (f.when.op) {
    case 'eq':
      return a === f.when.value;
    case 'lt':
      return typeof a === 'number' && a > 0 && a < Number(f.when.value);
    case 'has':
      return Array.isArray(a) && a.includes(String(f.when.value));
  }
}

export function condLabel(c: Cond, fields: Field[]): string {
  const parent = fields.find((f) => f.id === c.field);
  const name = parent ? shortLabel(parent.label) : c.field;
  if (c.op === 'lt') return `“${name}” is below ${c.value}`;
  if (c.op === 'has') return `they tick “${c.value}”`;
  return `they answer “${c.value}”`;
}

export function shortLabel(label: string): string {
  const l = label.replace(/\?$/, '');
  return l.length > 26 ? l.slice(0, 24).trimEnd() + '…' : l;
}

export const TYPE_LABEL: Record<FieldType, string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  email: 'Email',
  phone: 'Phone',
  number: 'Number',
  single_choice: 'Choice',
  multiple_choice: 'Checkboxes',
  dropdown: 'Dropdown',
  date: 'Date',
  time: 'Time',
  rating: 'Rating',
};

/** Pretty JSON-ish lines for the spec panel, one block per field. */
export function specToJson(spec: FormSpec): string {
  return JSON.stringify(
    {
      title: spec.title,
      description: spec.description,
      questions: spec.fields.map((f) => {
        const o: Record<string, unknown> = { id: f.id, type: f.type, label: f.label, required: f.required };
        if (f.options) o.options = f.options;
        if (f.when) o.visibility = { when: { question: f.when.field, [f.when.op === 'eq' ? 'equals' : f.when.op === 'lt' ? 'lessThan' : 'includes']: f.when.value } };
        return o;
      }),
    },
    null,
    2,
  );
}
