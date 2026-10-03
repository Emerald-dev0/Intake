import type { Field, FormSpec, Highlight } from '../lib/types';
import { typingTimes } from './engine';
import type { Provider } from '../lib/providers';

export type RespondAction =
  | { kind: 'click'; field: string; option: string }
  | { kind: 'type'; field: string; text: string };

export interface CreateScene {
  kind: 'create';
  id: string;
  name: string;
  blurb: string;
  prompt: string;
  cps?: number;
  highlights: Highlight[];
  clarify?: { question: string; options: string[]; pick: number };
  spec: FormSpec;
  provider: Provider;
  respond: RespondAction[];
}

export interface EditCommand {
  text: string;
  op: string;
  flash: string;
  apply: (fields: Field[]) => Field[];
}

export interface EditScene {
  kind: 'edit';
  id: string;
  name: string;
  blurb: string;
  base: FormSpec;
  provider: Provider;
  commands: EditCommand[];
}

export type Scene = CreateScene | EditScene;

const yesNo = ['Yes', 'No'];

/* ───────────────────────── Scenes ───────────────────────── */

export const conference: CreateScene = {
  kind: 'create',
  id: 'conference',
  name: 'Youth conference',
  blurb: 'Example Google Forms plan with a supported yes-or-no follow-up.',
  cps: 52,
  prompt:
    'I need a registration form for our youth conference. Ask for their name, phone number as a short answer, age group, church, whether they need transportation, and if yes, where they want to be picked up. Make name and phone required.',
  highlights: [
    { text: 'registration form', kind: 'meta', tag: 'registration' },
    { text: 'youth conference', kind: 'meta', tag: 'title' },
    { text: 'name', kind: 'field', tag: 'name' },
    { text: 'phone number', kind: 'field', tag: 'short answer' },
    { text: 'age group', kind: 'field', tag: 'multiple choice' },
    { text: 'church', kind: 'field', tag: 'church' },
    { text: 'whether they need transportation', kind: 'field', tag: 'yes / no' },
    { text: 'if they need transportation', kind: 'logic', tag: 'if yes →' },
    { text: 'ask where they want to be picked up', kind: 'field', tag: 'pickup' },
    { text: 'Make name and phone required', kind: 'rule', tag: 'required ×2' },
  ],
  clarify: {
    question: 'Quick one — which age groups should the form offer?',
    options: ['13–17 · 18–24 · 25+', 'Under 18 · 18+', 'I’ll type them'],
    pick: 0,
  },
  spec: {
    title: 'Youth Conference Registration',
    description: 'Register for this year’s youth conference.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'phone', label: 'Phone number', type: 'short_text', required: true },
      { id: 'age_group', label: 'Age group', type: 'multiple_choice', required: false, options: ['13–17', '18–24', '25+'] },
      { id: 'church', label: 'Church', type: 'short_text', required: false },
      { id: 'needs_transport', label: 'Do you need transportation?', type: 'multiple_choice', required: false, options: yesNo },
      {
        id: 'pickup_location',
        label: 'Where do you want to be picked up?',
        type: 'short_text',
        required: true,
        when: { field: 'needs_transport', op: 'eq', value: 'Yes' },
      },
    ],
  },
  provider: 'google',
  respond: [
    { kind: 'click', field: 'needs_transport', option: 'Yes' },
    { kind: 'type', field: 'pickup_location', text: 'Main gate, Allen Avenue' },
  ],
};

export const feedback: CreateScene = {
  kind: 'create',
  id: 'feedback',
  name: 'Restaurant feedback',
  blurb: 'Example one-answer choices and a supported section-routing follow-up.',
  cps: 56,
  prompt:
    'Create an anonymous restaurant feedback form. Ask how the meal was (Good, Okay, Needs improvement), how they found us, what they ordered, and anything else. If they choose Needs improvement, ask what we could improve. Do not ask for a name.',
  highlights: [
    { text: 'anonymous restaurant feedback form', kind: 'meta', tag: 'feedback' },
    { text: 'how the meal was', kind: 'field', tag: 'multiple choice' },
    { text: 'how they found us', kind: 'field', tag: 'multiple choice' },
    { text: 'what they ordered', kind: 'field', tag: 'short answer' },
    { text: 'anything else', kind: 'field', tag: 'paragraph' },
    { text: 'If they choose Needs improvement', kind: 'logic', tag: 'supported section route' },
    { text: 'ask what we could improve', kind: 'field', tag: 'follow-up' },
    { text: 'Do not ask for a name', kind: 'rule', tag: 'anonymous request' },
  ],
  spec: {
    title: 'Restaurant feedback · example',
    description: 'Illustrative proposal only. This preview does not collect responses.',
    fields: [
      { id: 'meal', label: 'How was your meal?', type: 'multiple_choice', required: true, options: ['Good', 'Okay', 'Needs improvement'] },
      { id: 'found_us', label: 'How did you hear about us?', type: 'multiple_choice', required: false, options: ['Social media', 'A friend', 'Other'] },
      { id: 'ordered', label: 'What did you order?', type: 'short_text', required: false },
      { id: 'improve', label: 'What could we improve?', type: 'long_text', required: false, when: { field: 'meal', op: 'eq', value: 'Needs improvement' } },
      { id: 'comments', label: 'Anything else?', type: 'long_text', required: false },
    ],
  },
  provider: 'google',
  respond: [
    { kind: 'click', field: 'meal', option: 'Needs improvement' },
    { kind: 'type', field: 'improve', text: 'Add clearer menu descriptions.' },
  ],
};

export const football: CreateScene = {
  kind: 'create',
  id: 'football',
  name: 'Football tournament',
  blurb: '“Make everything required except…” and it does exactly that.',
  cps: 56,
  prompt:
    'Create a registration form for a 5-a-side football tournament. Ask for the player’s full name, phone number as a short answer, age as text, team name, and playing position. Ask whether they have played professionally before; if yes, ask which club. Make the listed details required.',
  highlights: [
    { text: 'registration form', kind: 'meta', tag: 'registration' },
    { text: '5-a-side football tournament', kind: 'meta', tag: 'title' },
    { text: 'full name', kind: 'field', tag: 'name' },
    { text: 'phone number', kind: 'field', tag: 'short answer' },
    { text: 'age', kind: 'field', tag: 'short answer' },
    { text: 'team name', kind: 'field', tag: 'team' },
    { text: 'position', kind: 'field', tag: 'dropdown' },
    { text: 'whether they have played professionally before', kind: 'field', tag: 'yes / no' },
    { text: 'if yes, ask which club', kind: 'logic', tag: 'if yes →' },
    { text: 'Make everything required except the professional question', kind: 'rule', tag: 'required ×6' },
  ],
  spec: {
    title: '5-a-Side Tournament Registration',
    description: 'One form per player. Team captains, share the link with your squad.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'phone', label: 'Phone number · plain text', type: 'short_text', required: true },
      { id: 'age', label: 'Age · plain text', type: 'short_text', required: true },
      { id: 'team', label: 'Team name', type: 'short_text', required: true },
      { id: 'position', label: 'Playing position', type: 'dropdown', required: true, options: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] },
      { id: 'played_pro', label: 'Have you played professionally before?', type: 'multiple_choice', required: false, options: yesNo },
      { id: 'club', label: 'Which club?', type: 'short_text', required: true, when: { field: 'played_pro', op: 'eq', value: 'Yes' } },
    ],
  },
  provider: 'google',
  respond: [
    { kind: 'click', field: 'played_pro', option: 'Yes' },
    { kind: 'type', field: 'club', text: 'Shooting Stars FC' },
  ],
};

export const volunteers: CreateScene = {
  kind: 'create',
  id: 'volunteers',
  name: 'Volunteer signup',
  blurb: 'A supported single-answer choice routes a relevant follow-up question.',
  cps: 58,
  prompt:
    'Volunteer signup for Saturday’s cleanup. Ask for full name, email, phone as a short answer, and one area of interest (media, ushering, welfare, technical). Ask whether they have volunteered before. If they choose media, ask what kind of media work they do. Name, email, and interest are required.',
  highlights: [
    { text: 'Volunteer signup', kind: 'meta', tag: 'signup' },
    { text: 'Saturday’s cleanup', kind: 'meta', tag: 'title' },
    { text: 'full name', kind: 'field', tag: 'name' },
    { text: 'email', kind: 'field', tag: 'email' },
    { text: 'phone', kind: 'field', tag: 'short answer' },
    { text: 'one area of interest (media, ushering, welfare, technical)', kind: 'field', tag: 'multiple choice ×4' },
    { text: 'whether they’ve volunteered before', kind: 'field', tag: 'yes / no' },
    { text: 'If they pick media', kind: 'logic', tag: 'if media →' },
    { text: 'ask what kind of media work they do', kind: 'field', tag: 'follow-up' },
    { text: 'Name, email and interest are required', kind: 'rule', tag: 'required ×3' },
  ],
  spec: {
    title: 'Saturday Cleanup — Volunteers',
    description: 'Illustrative form proposal for a volunteer signup.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'phone', label: 'Phone · plain text', type: 'short_text', required: false },
      { id: 'interest', label: 'Choose one area of interest', type: 'multiple_choice', required: true, options: ['Media', 'Ushering', 'Welfare', 'Technical'] },
      { id: 'media_work', label: 'What kind of media work do you do?', type: 'short_text', required: false, when: { field: 'interest', op: 'eq', value: 'Media' } },
      { id: 'volunteered', label: 'Have you volunteered before?', type: 'multiple_choice', required: false, options: yesNo },
    ],
  },
  provider: 'google',
  respond: [
    { kind: 'click', field: 'interest', option: 'Media' },
    { kind: 'type', field: 'media_work', text: 'Photography and short videos' },
  ],
};

export const edits: EditScene = {
  kind: 'edit',
  id: 'edits',
  name: 'Edit an existing form · example',
  blurb: 'A scripted proposal shows supported edits; nothing is sent to Google here.',
  provider: 'google',
  base: {
    title: 'Sample Event RSVP · example',
    description: 'An illustrative existing-form structure for the edit preview.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'email', label: 'Email address · plain text', type: 'email', required: true },
      { id: 'age', label: 'Age group', type: 'multiple_choice', required: false, options: ['18–24', '25–34', '35+'] },
      { id: 'attending', label: 'Will you attend?', type: 'multiple_choice', required: true, options: yesNo },
    ],
  },
  commands: [
    {
      text: 'Make email optional.',
      op: 'Made “Email” optional',
      flash: 'email',
      apply: (fs) => fs.map((f) => (f.id === 'email' ? { ...f, required: false } : f)),
    },
    {
      text: 'Add a question asking how they heard about the event.',
      op: 'Added “How did you hear about the event?”',
      flash: 'heard_about',
      apply: (fs) => [
        ...fs,
        { id: 'heard_about', label: 'How did you hear about the event?', type: 'multiple_choice', required: false, options: ['Instagram', 'WhatsApp', 'A friend', 'Other'] },
      ],
    },
    {
      text: 'Move age group before email.',
      op: 'Moved “Age group” above “Email”',
      flash: 'age',
      apply: (fs) => {
        const age = fs.find((f) => f.id === 'age')!;
        const rest = fs.filter((f) => f.id !== 'age');
        const i = rest.findIndex((f) => f.id === 'email');
        return [...rest.slice(0, i), age, ...rest.slice(i)];
      },
    },
    {
      text: 'If they pick Other, ask them to explain.',
      op: 'Added a follow-up when “Other” is picked',
      flash: 'heard_other',
      apply: (fs) => [
        ...fs,
        { id: 'heard_other', label: 'Tell us where you heard about it', type: 'short_text', required: false, when: { field: 'heard_about', op: 'eq', value: 'Other' } },
      ],
    },
  ],
};

export const galleryScenes: CreateScene[] = [feedback, football, volunteers];

/* ───────────────────────── Timelines ───────────────────────── */

export interface Chapter {
  label: string;
  start: number;
  caption: string;
}

export interface ActionTiming {
  action: RespondAction;
  moveStart: number;
  arrive: number;
  click: number;
  typeTimes: number[];
  done: number;
}

export interface CreateTimeline {
  kind: 'create';
  charTimes: number[];
  typeStart: number;
  typeEnd: number;
  send: number;
  interpStart: number;
  hlTimes: number[];
  clarify: null | { ask: number; pick: number; answer: number };
  interpEnd: number;
  planStart: number;
  titleStart: number;
  titleEnd: number;
  fieldTimes: number[];
  planEnd: number;
  validateStart: number;
  checks: string[];
  checkTimes: number[];
  validateEnd: number;
  createStart: number;
  ops: string[];
  opTimes: number[];
  createEnd: number;
  ready: number;
  previewAt: number;
  actions: ActionTiming[];
  end: number;
  chapters: Chapter[];
}

export function buildCreateTimeline(s: CreateScene): CreateTimeline {
  const typeStart = 0.9;
  const charTimes = typingTimes(s.prompt, typeStart, s.cps ?? 46);
  const typeEnd = charTimes[charTimes.length - 1] ?? typeStart;
  const send = typeEnd + 0.5;
  const interpStart = send + 0.45;
  const step = Math.min(0.22, 1.9 / s.highlights.length);
  const hlTimes = s.highlights.map((_, i) => interpStart + 0.3 + i * step);
  let interpEnd = hlTimes[hlTimes.length - 1] + 0.55;
  let clarify: CreateTimeline['clarify'] = null;
  if (s.clarify) {
    const ask = interpEnd;
    const pick = ask + 1.7;
    const answer = pick + 0.35;
    clarify = { ask, pick, answer };
    interpEnd = answer + 0.55;
  }
  const planStart = interpEnd + 0.1;
  const titleStart = planStart + 0.25;
  const titleEnd = titleStart + s.spec.title.length / 55;
  const fieldTimes = s.spec.fields.map((_, i) => titleEnd + 0.3 + i * 0.42);
  const planEnd = fieldTimes[fieldTimes.length - 1] + 0.6;
  const validateStart = planEnd;
  const conds = s.spec.fields.filter((f) => f.when).length;
  const checks = [
    'Every question has the right answer type',
    'No duplicate questions',
    conds ? 'Follow-up points to the right question' : 'No loose ends',
    'Every choice question has options',
  ];
  const checkTimes = checks.map((_, i) => validateStart + 0.35 + i * 0.3);
  const validateEnd = checkTimes[checkTimes.length - 1] + 0.45;
  const createStart = validateEnd;
  const ops = [
    'Request stays in this local scripted demo',
    'Prepared an example structured proposal',
    `Included ${s.spec.fields.length} example questions`,
    'Awaiting review, Google authorization, and explicit confirmation',
  ];
  const opTimes = ops.map((_, i) => createStart + 0.25 + i * 0.32);
  const createEnd = opTimes[opTimes.length - 1] + 0.55;
  const ready = createEnd;
  const previewAt = ready + 1.3;

  let at = previewAt + 0.8;
  const actions: ActionTiming[] = s.respond.map((action) => {
    const moveStart = at;
    const arrive = at + 0.8;
    const click = arrive + 0.12;
    let typeTimes: number[] = [];
    let done = click + 0.35;
    if (action.kind === 'type') {
      typeTimes = typingTimes(action.text, click + 0.35, 20, 3);
      done = typeTimes[typeTimes.length - 1] + 0.2;
    }
    at = done + 0.4;
    return { action, moveStart, arrive, click, typeTimes, done };
  });
  const end = at + 2.4;

  const chapters: Chapter[] = [
    { label: 'Describe', start: 0, caption: 'Describe a new Google Form in your own words.' },
    { label: 'Interpret', start: send, caption: 'This is a scripted example of the request-to-plan workflow.' },
    { label: 'Draft', start: planStart, caption: 'The example becomes a structured question plan.' },
    { label: 'Check', start: validateStart, caption: 'Unsupported structures should be flagged before anything is applied.' },
    { label: 'Review', start: createStart, caption: 'Inspect and revise the proposal before authorizing and confirming.' },
    { label: 'Local preview', start: previewAt, caption: 'Try the example locally. No Google Form or responder link is created.' },
  ];

  return {
    kind: 'create', charTimes, typeStart, typeEnd, send, interpStart, hlTimes, clarify, interpEnd, planStart, titleStart, titleEnd,
    fieldTimes, planEnd, validateStart, checks, checkTimes, validateEnd, createStart, ops, opTimes, createEnd, ready, previewAt,
    actions, end, chapters,
  };
}

export interface EditCmdTiming {
  cmd: EditCommand;
  charTimes: number[];
  typeStart: number;
  send: number;
  opAt: number;
  applyAt: number;
  syncedAt: number;
}

export interface EditTimeline {
  kind: 'edit';
  cmds: EditCmdTiming[];
  end: number;
  chapters: Chapter[];
}

export function buildEditTimeline(s: EditScene): EditTimeline {
  let t = 1.2;
  const cmds: EditCmdTiming[] = s.commands.map((cmd, i) => {
    const typeStart = t;
    const charTimes = typingTimes(cmd.text, typeStart, 34, 11 + i);
    const send = charTimes[charTimes.length - 1] + 0.4;
    const opAt = send + 0.6;
    const applyAt = opAt + 0.55;
    const syncedAt = applyAt + 0.7;
    t = syncedAt + 1.1;
    return { cmd, charTimes, typeStart, send, opAt, applyAt, syncedAt };
  });
  const captions = [
    'The demo changes only its local example draft; Google Forms is not contacted.',
    'Review the proposed question and its answer choices.',
    'Describe an order change in natural language.',
    'A supported follow-up can be prepared for review before confirmation.',
  ];
  return {
    kind: 'edit',
    cmds,
    end: t + 1.8,
    chapters: cmds.map((c, i) => ({
      label: ['Optional', 'Add', 'Reorder', 'Follow-up'][i] ?? `Edit ${i + 1}`,
      start: i === 0 ? 0 : c.typeStart - 0.3,
      caption: captions[i] ?? '',
    })),
  };
}

export function fieldsAt(s: EditScene, tl: EditTimeline, t: number): { fields: Field[]; version: number } {
  let fields = s.base.fields;
  let version = 3;
  for (const c of tl.cmds) {
    if (t >= c.applyAt) {
      fields = c.cmd.apply(fields);
      version++;
    }
  }
  return { fields, version };
}
