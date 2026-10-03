export type FieldType = 'short_text' | 'long_text' | 'email' | 'multiple_choice' | 'dropdown' | 'checkboxes';

export type Cond = { field: string; op: 'eq'; value: string };

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

export type AnswerValue = string | string[];
export type Answers = Record<string, AnswerValue | undefined>;

export function isVisible(f: Field, answers: Answers): boolean {
  if (!f.when) return true;
  const a = answers[f.when.field];
  if (a === undefined || a === '') return false;
  return a === f.when.value;
}

export function condLabel(c: Cond, fields: Field[]): string {
  const parent = fields.find((f) => f.id === c.field);
  const name = parent ? shortLabel(parent.label) : c.field;
  return `“${name}” is answered “${c.value}”`;
}

export function shortLabel(label: string): string {
  const l = label.replace(/\?$/, '');
  return l.length > 26 ? l.slice(0, 24).trimEnd() + '…' : l;
}

export const TYPE_LABEL: Record<FieldType, string> = {
  short_text: 'Short answer',
  long_text: 'Paragraph',
  email: 'Short answer · email text',
  multiple_choice: 'Multiple choice · one answer',
  dropdown: 'Dropdown · one answer',
  checkboxes: 'Checkboxes · several answers',
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
        if (f.when) o.visibility = { when: { question: f.when.field, equals: f.when.value } };
        return o;
      }),
    },
    null,
    2,
  );
}
