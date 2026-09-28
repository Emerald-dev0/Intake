import type { Field, FormSpec, Highlight } from '../lib/types';
import { typingTimes } from './engine';
import type { Provider } from '../lib/providers';

export type RespondAction =
  | { kind: 'click'; field: string; option: string }
  | { kind: 'star'; field: string; value: number }
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
  url: string;
  editUrl: string;
  provider: Provider;
  account: string;
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
  url: string;
  editUrl: string;
  provider: Provider;
  account: string;
  commands: EditCommand[];
}

export type Scene = CreateScene | EditScene;

const yesNo = ['Yes', 'No'];

/* ───────────────────────── Scenes ───────────────────────── */

export const conference: CreateScene = {
  kind: 'create',
  id: 'conference',
  name: 'Youth conference',
  blurb: 'Registration with a clarifying question and a conditional pickup field.',
  cps: 52,
  prompt:
    'I need a registration form for our youth conference. Ask for their name, phone number, age group, church, whether they need transportation, and if they need transportation ask where they want to be picked up. Make name and phone required.',
  highlights: [
    { text: 'registration form', kind: 'meta', tag: 'registration' },
    { text: 'youth conference', kind: 'meta', tag: 'title' },
    { text: 'name', kind: 'field', tag: 'name' },
    { text: 'phone number', kind: 'field', tag: 'phone' },
    { text: 'age group', kind: 'field', tag: 'age group' },
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
    description: 'Register for this year’s youth conference. Takes about a minute.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'phone', label: 'Phone number', type: 'phone', required: true },
      { id: 'age_group', label: 'Age group', type: 'single_choice', required: false, options: ['13–17', '18–24', '25+'] },
      { id: 'church', label: 'Church', type: 'short_text', required: false },
      { id: 'needs_transport', label: 'Do you need transportation?', type: 'single_choice', required: false, options: yesNo },
      {
        id: 'pickup_location',
        label: 'Where do you want to be picked up?',
        type: 'short_text',
        required: true,
        when: { field: 'needs_transport', op: 'eq', value: 'Yes' },
      },
    ],
  },
  url: 'forms.gle/yc26-register',
  editUrl: 'docs.google.com/forms/d/1Yc26…/edit',
  provider: 'google',
  account: 'ada.okafor@gmail.com',
  respond: [
    { kind: 'click', field: 'needs_transport', option: 'Yes' },
    { kind: 'type', field: 'pickup_location', text: 'Main gate, Allen Avenue' },
  ],
};

export const feedback: CreateScene = {
  kind: 'create',
  id: 'feedback',
  name: 'Restaurant feedback',
  blurb: 'Star ratings, no names, and a follow-up that only shows up after a bad score.',
  cps: 56,
  prompt:
    'Customer feedback form for Mama Put Kitchen. Ask them to rate the food and the service out of 5, how they found us, what they ordered, and anything we could improve. If they rate the service below 3, ask what went wrong. Keep it anonymous.',
  highlights: [
    { text: 'Customer feedback form', kind: 'meta', tag: 'feedback' },
    { text: 'Mama Put Kitchen', kind: 'meta', tag: 'title' },
    { text: 'rate the food', kind: 'field', tag: 'rating' },
    { text: 'the service out of 5', kind: 'field', tag: 'rating /5' },
    { text: 'how they found us', kind: 'field', tag: 'choice' },
    { text: 'what they ordered', kind: 'field', tag: 'short text' },
    { text: 'anything we could improve', kind: 'field', tag: 'paragraph' },
    { text: 'If they rate the service below 3', kind: 'logic', tag: 'if < 3 →' },
    { text: 'ask what went wrong', kind: 'field', tag: 'follow-up' },
    { text: 'Keep it anonymous', kind: 'rule', tag: 'no PII' },
  ],
  spec: {
    title: 'Mama Put Kitchen — Feedback',
    description: 'Tell us how we did. Anonymous — we never ask for your name.',
    fields: [
      { id: 'food_rating', label: 'How was the food?', type: 'rating', required: true },
      { id: 'service_rating', label: 'How was the service?', type: 'rating', required: true },
      { id: 'found_us', label: 'How did you find us?', type: 'single_choice', required: false, options: ['Walked past', 'Instagram', 'A friend', 'Google Maps'] },
      { id: 'ordered', label: 'What did you order?', type: 'short_text', required: false },
      { id: 'service_issue', label: 'Sorry about that — what went wrong?', type: 'long_text', required: false, when: { field: 'service_rating', op: 'lt', value: 3 } },
      { id: 'improve', label: 'Anything we could improve?', type: 'long_text', required: false },
    ],
  },
  url: 'forms.office.com/r/MamaPut5',
  editUrl: 'forms.office.com/Pages/DesignPage…',
  provider: 'microsoft',
  account: 'hello@mamaputkitchen.ng',
  respond: [
    { kind: 'star', field: 'service_rating', value: 2 },
    { kind: 'type', field: 'service_issue', text: 'Waited 40 mins for jollof' },
  ],
};

export const football: CreateScene = {
  kind: 'create',
  id: 'football',
  name: 'Football tournament',
  blurb: '“Make everything required except…” and it does exactly that.',
  cps: 56,
  prompt:
    'Create a registration form for a 5-a-side football tournament. I need the player’s full name, phone number, age, team name and position. Ask whether they have played professionally before — if yes, ask which club. Make everything required except the professional question.',
  highlights: [
    { text: 'registration form', kind: 'meta', tag: 'registration' },
    { text: '5-a-side football tournament', kind: 'meta', tag: 'title' },
    { text: 'full name', kind: 'field', tag: 'name' },
    { text: 'phone number', kind: 'field', tag: 'phone' },
    { text: 'age', kind: 'field', tag: 'number' },
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
      { id: 'phone', label: 'Phone number', type: 'phone', required: true },
      { id: 'age', label: 'Age', type: 'number', required: true },
      { id: 'team', label: 'Team name', type: 'short_text', required: true },
      { id: 'position', label: 'Playing position', type: 'dropdown', required: true, options: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] },
      { id: 'played_pro', label: 'Have you played professionally before?', type: 'single_choice', required: false, options: yesNo },
      { id: 'club', label: 'Which club?', type: 'short_text', required: true, when: { field: 'played_pro', op: 'eq', value: 'Yes' } },
    ],
  },
  url: 'forms.gle/5aside-reg',
  editUrl: 'docs.google.com/forms/d/15as…/edit',
  provider: 'google',
  account: 'coach.tunde@gmail.com',
  respond: [
    { kind: 'click', field: 'played_pro', option: 'Yes' },
    { kind: 'type', field: 'club', text: 'Shooting Stars FC' },
  ],
};

export const volunteers: CreateScene = {
  kind: 'create',
  id: 'volunteers',
  name: 'Volunteer signup',
  blurb: 'Tick “Media” and a question just for media people pops up.',
  cps: 58,
  prompt:
    'Volunteer signup for Saturday’s cleanup. Ask for full name, email, phone and area of interest (media, ushering, welfare, technical). Ask whether they’ve volunteered before. If they pick media, ask what kind of media work they do. Name, email and interest are required.',
  highlights: [
    { text: 'Volunteer signup', kind: 'meta', tag: 'signup' },
    { text: 'Saturday’s cleanup', kind: 'meta', tag: 'title' },
    { text: 'full name', kind: 'field', tag: 'name' },
    { text: 'email', kind: 'field', tag: 'email' },
    { text: 'phone', kind: 'field', tag: 'phone' },
    { text: 'area of interest (media, ushering, welfare, technical)', kind: 'field', tag: 'checkboxes ×4' },
    { text: 'whether they’ve volunteered before', kind: 'field', tag: 'yes / no' },
    { text: 'If they pick media', kind: 'logic', tag: 'if media →' },
    { text: 'ask what kind of media work they do', kind: 'field', tag: 'follow-up' },
    { text: 'Name, email and interest are required', kind: 'rule', tag: 'required ×3' },
  ],
  spec: {
    title: 'Saturday Cleanup — Volunteers',
    description: 'Thanks for stepping up. We’ll message you the meeting point on Friday.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'phone', label: 'Phone', type: 'phone', required: false },
      { id: 'interest', label: 'Area of interest', type: 'multiple_choice', required: true, options: ['Media', 'Ushering', 'Welfare', 'Technical'] },
      { id: 'media_work', label: 'What kind of media work do you do?', type: 'multiple_choice', required: false, options: ['Photography', 'Video', 'Design', 'Social'], when: { field: 'interest', op: 'has', value: 'Media' } },
      { id: 'volunteered', label: 'Have you volunteered before?', type: 'single_choice', required: false, options: yesNo },
    ],
  },
  url: 'forms.office.com/r/CleanupCrew',
  editUrl: 'forms.office.com/Pages/DesignPage…',
  provider: 'microsoft',
  account: 'volunteers@greenlagos.org',
  respond: [
    { kind: 'click', field: 'interest', option: 'Media' },
    { kind: 'click', field: 'media_work', option: 'Video' },
  ],
};

export const edits: EditScene = {
  kind: 'edit',
  id: 'edits',
  name: 'Editing a live form',
  blurb: 'Every message becomes a change on the real form.',
  url: 'forms.gle/rooftop-rsvp',
  editUrl: 'docs.google.com/forms/d/1Rtp…/edit',
  provider: 'google',
  account: 'kemi.events@gmail.com',
  base: {
    title: 'Rooftop Launch — RSVP',
    description: 'Friday, 7pm. Tell us you’re coming.',
    fields: [
      { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
      { id: 'email', label: 'Email', type: 'email', required: true },
      { id: 'age', label: 'Age', type: 'number', required: false },
      { id: 'attending', label: 'Will you attend?', type: 'single_choice', required: true, options: yesNo },
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
        { id: 'heard_about', label: 'How did you hear about the event?', type: 'single_choice', required: false, options: ['Instagram', 'WhatsApp', 'A friend', 'Other'] },
      ],
    },
    {
      text: 'Move age before email.',
      op: 'Moved “Age” above “Email”',
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
  const pname = s.provider === 'google' ? 'Google' : 'Microsoft';
  const ops = [
    `Signed in to ${pname} as ${s.account}`,
    `Created a new form in your account`,
    `Added ${s.spec.fields.length} questions`,
    conds ? `Set up the follow-up question` : 'Turned on the right settings',
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

  const pn = s.provider === 'google' ? 'Google Forms' : 'Microsoft Forms';
  const chapters: Chapter[] = [
    { label: 'Say it', start: 0, caption: 'Type it the way you’d explain it to a friend.' },
    { label: 'Understand', start: send, caption: s.clarify ? 'Intake gets what you mean, and only asks when it has to.' : 'Intake picks out the questions, rules and follow-ups.' },
    { label: 'Draft', start: planStart, caption: 'The questions come together one by one.' },
    { label: 'Check', start: validateStart, caption: 'A quick check so nothing breaks.' },
    { label: 'Create', start: createStart, caption: `It builds the form in your own ${pn}.` },
    { label: 'Try it', start: previewAt, caption: 'It’s live and the follow-up works. Share the link.' },
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
    'Ask for a change and it happens on the live form.',
    'New questions come with sensible options.',
    'Reordering takes one sentence.',
    'Follow-ups added later, no settings to dig through.',
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
