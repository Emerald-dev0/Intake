/**
 * A tiny, deterministic, in-browser stand-in for the Intake planner.
 * It is intentionally heuristic — the real agent uses an LLM + schema validation —
 * but it follows the same contract: text in, typed form spec out, with the
 * reasoning (highlights + assumptions) surfaced to the user.
 */
import type { Cond, Field, FieldType, FormSpec, Highlight } from './types';

export interface Plan {
  spec: FormSpec;
  highlights: Highlight[];
  notes: string[];
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const titleCase = (s: string) =>
  s
    .split(/\s+/)
    .map((w, i) => (i > 0 && /^(a|an|the|of|for|and|or|to|in|on|at)$/i.test(w) ? w.toLowerCase() : cap(w)))
    .join(' ')
    .replace(/\bRsvp\b/g, 'RSVP');

function slug(label: string): string {
  const stop = new Set(['the', 'a', 'an', 'your', 'you', 'do', 'what', 'which', 'how', 'are', 'is', 'of', 'to', 'did', 'have', 'will', 'would', 'kind', 'any', 'want', 'be', 'up', 'like', 'we', 'could', 'where', 'when', 'rate', 'out', 'this', 'that', 'for', 'please']);
  const words = label
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w && !stop.has(w));
  return (words.slice(0, 3).join('_') || 'question').slice(0, 24).replace(/_$/, '');
}

/** they/their → you/your, and turn “whether they need X” into “Do you need X?” */
function toQuestion(raw: string): string {
  let s = raw.trim().replace(/[.?!,;:]+$/, '');
  s = s.replace(/^(ask\s+)?(whether|if)\s+/i, '');
  s = s
    .replace(/\bthey['’]ve\b/gi, 'they have')
    .replace(/\bthey['’]re\b/gi, 'they are')
    .replace(/\bthey['’]ll\b/gi, 'they will');
  const aux = s.match(/^(they|the (?:player|user|person|guest|attendee|customer|applicant|volunteer)s?)\s+(have|has|are|is|were|was|can|will|would|should|had)\s+(.*)$/i);
  if (aux) {
    const verb = aux[2].toLowerCase();
    const v = verb === 'has' ? 'have' : verb === 'is' ? 'are' : verb === 'was' ? 'were' : verb;
    return `${cap(v)} you ${swap(aux[3])}?`;
  }
  const main = s.match(/^(they|the (?:player|user|person|guest|attendee|customer|applicant|volunteer)s?)\s+(\w+)\s*(.*)$/i);
  if (main) {
    const verb = main[2].toLowerCase().replace(/s$/, '');
    return `Do you ${verb}${main[3] ? ' ' + swap(main[3]) : ''}?`;
  }
  return cap(swap(s)) + (/\?$/.test(s) ? '' : '?');
}

/** “where they want to be picked up” → “Where do you want to be picked up?” */
function whQuestion(raw: string): string {
  let s = raw.trim().replace(/[.?!,;:]+$/, '');
  s = s.replace(/^(ask|ask them|ask for|find out|get)\s+/i, '');
  s = s.replace(/\bthey['’]ve\b/gi, 'they have').replace(/\bthey['’]re\b/gi, 'they are');
  const m = s.match(/^(where|what|which|when|why|how|who)\b(.*)$/i);
  if (!m) return cap(swap(s));
  const rest = m[2]
    .replace(/\bthey (are|were|can|will|would|should|have|had)\b/i, '$1 you')
    .replace(/\bthey (\w+)/i, (_, v) => pastToBase(v) ?? `do you ${v}`);
  const q = `${cap(m[1].toLowerCase())}${swap(rest)}`.trim();
  return q.endsWith('?') ? q : q + '?';
}

const IRREG: Record<string, string> = { found: 'find', heard: 'hear', bought: 'buy', came: 'come', got: 'get', made: 'make', saw: 'see', went: 'go', took: 'take', did: 'do', paid: 'pay', met: 'meet', spent: 'spend', left: 'leave', ate: 'eat', had: 'have', knew: 'know', thought: 'think' };
function pastToBase(v: string): string | null {
  const w = v.toLowerCase();
  if (IRREG[w]) return `did you ${IRREG[w]}`;
  if (/ied$/.test(w)) return `did you ${w.slice(0, -3)}y`;
  if (/[^e]ed$/.test(w) && w.length > 4) {
    const stem = w.slice(0, -2);
    return `did you ${/[vzucgks]$/.test(stem) ? stem + 'e' : stem.replace(/([bdgmnprt])\1$/, '$1')}`;
  }
  return null;
}

function swap(s: string) {
  return s
    .replace(/\btheir\b/gi, 'your')
    .replace(/\bthem\b/gi, 'you')
    .replace(/\bthemselves\b/gi, 'yourself')
    .replace(/\bthey\b/gi, 'you')
    .replace(/\bthe (player|user|person|guest|attendee|customer|applicant|volunteer)['’]s\b/gi, 'your');
}

interface TypeGuess {
  type: FieldType;
  label?: string;
  options?: string[];
  required?: boolean;
  note?: string;
}

function guessType(itemRaw: string): TypeGuess {
  const it = itemRaw.toLowerCase();
  const has = (re: RegExp) => re.test(it);
  if (has(/\be-?mail/)) return { type: 'email', label: 'Email address', required: true, note: 'Google Forms will show this as a plain short answer; email-format validation is not enabled.' };
  if (has(/phone|mobile|whatsapp|contact number|telephone/))
    return { type: 'short_text', label: 'Phone number', required: true, note: 'Phone details are shown as plain short answers in this preview; there is no phone-specific validation.' };
  if (has(/date of birth|birthday|\bdob\b/))
    return { type: 'short_text', label: 'Date of birth', note: 'Date-specific controls are not available in this preview; this is plain text.' };
  if (has(/age (group|range|bracket)/)) return { type: 'multiple_choice', label: 'Age group', options: ['Under 18', '18–24', '25–34', '35+'] };
  if (has(/^(the )?age$|\bage\b(?! group)/) && it.split(/\s+/).length <= 3)
    return { type: 'short_text', label: 'Age', note: 'Numeric controls are not available in this preview; this is plain text.' };
  if (has(/\bdate\b|\bday\b/)) return { type: 'short_text', note: 'Date-specific controls are not available in this preview; this is plain text.' };
  if (has(/\btime\b|arrival|what time/)) return { type: 'short_text', note: 'Time-specific controls are not available in this preview; this is plain text.' };
  if (has(/how many|number of|quantity|guests|headcount|years of experience/))
    return { type: 'short_text', note: 'Numeric controls are not available in this preview; this is plain text.' };
  if (has(/rate|rating|stars|score|out of (5|five|10)|satisfaction/))
    return { type: 'short_text', note: 'A rating control is not supported; this preview shows a plain text answer instead.' };
  if (has(/gender|\bsex\b/)) return { type: 'multiple_choice', label: 'Gender', options: ['Male', 'Female', 'Prefer not to say'] };
  if (has(/t-?shirt|shirt size|\bsize\b/)) return { type: 'dropdown', label: 'T-shirt size', options: ['XS', 'S', 'M', 'L', 'XL', 'XXL'] };
  if (has(/\bposition\b/)) return { type: 'dropdown', label: 'Position', options: ['Goalkeeper', 'Defender', 'Midfielder', 'Forward'] };
  if (has(/dietary|diet|allerg/)) return { type: 'checkboxes', label: 'Dietary requirements', options: ['None', 'Vegetarian', 'Vegan', 'Halal', 'Gluten-free'] };
  if (has(/heard|hear about|found us|find us|referr/)) return { type: 'multiple_choice', label: 'How did you hear about us?', options: ['Social media', 'A friend', 'Flyer or poster', 'Other'] };
  if (has(/experience\b/) && has(/how was|overall/)) return { type: 'multiple_choice', label: 'How was your experience?', options: ['Excellent', 'Good', 'Average', 'Poor'] };
  if (has(/department|faculty/)) return { type: 'dropdown', options: ['Engineering', 'Design', 'Operations', 'Other'] };
  if (has(/country|state of origin/)) return { type: 'dropdown', options: ['Nigeria', 'Ghana', 'Kenya', 'South Africa', 'Other'] };
  if (has(/comment|feedback|suggest|explain|describe|why|notes?\b|message|improve|anything else|bio|about (yourself|you)|cover letter|address/))
    return { type: 'long_text' };
  if (has(/\bname\b/) && !has(/team|church|company|school|business|club|organi[sz]ation/)) return { type: 'short_text', label: 'Full name', required: true };
  return { type: 'short_text' };
}

function labelFor(item: string): string {
  let s = item
    .trim()
    .replace(/^(and|also|plus|then)\s+/i, '')
    .replace(/^(their|the|a|an|his|her|your|each)\s+/i, '')
    .replace(/^(player|user|person|guest|attendee|customer|applicant|volunteer)['’]s\s+/i, '')
    .replace(/[.;:!]+$/, '');
  if (/^(what|which|where|when|how|why|who)\b/i.test(s)) return whQuestion(s);
  s = swap(s);
  if (/^(anything|any)\b/i.test(s)) s += '?';
  return cap(s);
}

function extractOptions(item: string): { base: string; options?: string[] } {
  const paren = item.match(/^(.*?)\s*\(([^)]+)\)\s*$/);
  if (paren) {
    const opts = paren[2]
      .split(/,|\/|\bor\b|\band\b/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(cap);
    if (opts.length >= 2) return { base: paren[1], options: opts };
  }
  const between = item.match(/^(.*?)\s*(?:between|from|:)\s+(.+\s(?:or|and)\s.+)$/i);
  if (between) {
    const opts = between[2]
      .split(/,|\bor\b|\band\b/)
      .map((x) => x.trim())
      .filter(Boolean)
      .map(cap);
    if (opts.length >= 2 && opts.every((o) => o.split(' ').length <= 3)) return { base: between[1], options: opts };
  }
  return { base: item };
}

const LEAD =
  /^(?:please\s+)?(?:(?:i|we)\s+(?:need|want|would like)\s+(?:to\s+(?:collect|know|ask(?:\s+for)?|get)\s+)?|ask(?:\s+(?:them|people|users|for|about))*(?:\s+to)?\s+|collect\s+|include\s+|get\s+|capture\s+|it should (?:have|ask(?: for)?)\s+|fields?:?\s+|questions?:?\s+|we['’]ll need\s+)/i;

function splitItems(s: string): string[] {
  // protect parentheses from comma-splitting
  const prot: string[] = [];
  const t = s.replace(/\([^)]*\)/g, (m) => {
    prot.push(m);
    return `\u0000${prot.length - 1}\u0000`;
  });
  return t
    .split(/\s*,\s*(?:and\s+|or\s+)?|\s+and\s+(?=(?:their|the|a|an|his|her|whether|if|what|which|how|where|when)?\s*\w)|\n|•|\s-\s/i)
    .map((x) => x.replace(/\u0000(\d+)\u0000/g, (_, i) => prot[+i]).trim())
    .filter((x) => x && x.length < 120);
}

function templateFor(text: string): { fields: Field[]; title: string } | null {
  const tx = text.toLowerCase();
  const F = (id: string, label: string, type: FieldType, required = false, extra: Partial<Field> = {}): Field => ({ id, label, type, required, ...extra });
  if (/rsvp|wedding|party|birthday|dinner|invite/.test(tx))
    return {
      title: /wedding/.test(tx) ? 'Wedding RSVP' : 'RSVP',
      fields: [
        F('full_name', 'Full name', 'short_text', true),
        F('attending', 'Will you attend?', 'multiple_choice', true, { options: ['Joyfully accept', 'Regretfully decline'] }),
        F('guests', 'How many guests are you bringing? (enter as text)', 'short_text', false, { when: { field: 'attending', op: 'eq', value: 'Joyfully accept' } }),
        F('dietary', 'Dietary requirements', 'checkboxes', false, { options: ['None', 'Vegetarian', 'Vegan', 'Halal'] }),
        F('message', 'A note for the hosts', 'long_text'),
      ],
    };
  if (/feedback|review|restaurant|customer|satisfaction/.test(tx))
    return {
      title: 'Customer Feedback',
      fields: [
        F('experience', 'How was your experience?', 'multiple_choice', true, { options: ['Excellent', 'Good', 'Average', 'Needs improvement'] }),
        F('improve', 'What could we improve?', 'long_text', false, { when: { field: 'experience', op: 'eq', value: 'Needs improvement' } }),
        F('heard_us', 'How did you hear about us?', 'multiple_choice', false, { options: ['Social media', 'A friend', 'Other'] }),
        F('email', 'Email (if you’d like a reply)', 'email'),
      ],
    };
  if (/job|hiring|application|apply|role|candidate/.test(tx))
    return {
      title: 'Job Application',
      fields: [
        F('full_name', 'Full name', 'short_text', true),
        F('email', 'Email address', 'email', true),
        F('role', 'Which role are you applying for?', 'dropdown', true, { options: ['Engineering', 'Design', 'Operations', 'Sales'] }),
        F('years', 'Years of experience (enter as text)', 'short_text'),
        F('portfolio', 'Portfolio or LinkedIn URL', 'short_text'),
        F('why', 'Why do you want to join?', 'long_text'),
      ],
    };
  if (/contact|enquir|inquir|get in touch/.test(tx))
    return { title: 'Contact Us', fields: [F('full_name', 'Full name', 'short_text', true), F('email', 'Email address', 'email', true), F('message', 'Message', 'long_text', true)] };
  if (/order|menu|food|cake|bakery|shop/.test(tx))
    return {
      title: 'Order Form',
      fields: [
        F('full_name', 'Full name', 'short_text', true),
        F('phone', 'Phone number', 'short_text', true),
        F('item', 'What would you like to order?', 'long_text', true),
        F('delivery', 'Delivery or pickup?', 'multiple_choice', true, { options: ['Delivery', 'Pickup'] }),
        F('address', 'Delivery address', 'long_text', true, { when: { field: 'delivery', op: 'eq', value: 'Delivery' } }),
        F('date', 'When do you need it? (enter as text)', 'short_text', true),
      ],
    };
  return null;
}

function inferTitle(text: string): { title: string; src: string } | null {
  const t = text.replace(/\s+/g, ' ');
  let m = t.match(/\b(registration|feedback|signup|sign-up|sign up|rsvp|application|booking|enrol(?:l)?ment|contact|order|survey|intake|evaluation|attendance)\s+(?:form|survey|sheet)?\s*for\s+(?:a |an |the |our |my )?([^.,;]+?)(?:[.,;]|\s+ask|\s+with|\s+that|\s+where|$)/i);
  if (m) {
    const kind = m[1].toLowerCase().replace('sign up', 'signup').replace('sign-up', 'signup');
    return { title: `${titleCase(m[2].trim())} ${cap(kind === 'signup' ? 'Sign-up' : kind)}`, src: m[2].trim() };
  }
  m = t.match(/(?:create|make|build|need|want|set up|generate)\s+(?:me\s+)?(?:a|an)\s+([^.,;]+?)\s+(form|survey|questionnaire|signup|sign-up|rsvp)\b/i);
  if (m) {
    const base = titleCase(m[1].trim());
    return { title: m[2].toLowerCase() === 'form' ? base : `${base} ${cap(m[2])}`, src: `${m[1].trim()} ${m[2]}` };
  }
  m = t.match(/^([^.,;]{3,48}?)\s+(form|survey|signup|sign-up|rsvp)\b/i);
  if (m) return { title: titleCase(m[1].replace(/^(a|an|the|my|our)\s+/i, '').trim()) + (m[2].toLowerCase() === 'form' ? '' : ` ${cap(m[2])}`), src: `${m[1].trim()} ${m[2]}` };
  return null;
}

export function plan(input: string): Plan {
  const text = input.trim();
  const highlights: Highlight[] = [];
  const notes: string[] = [];
  const fields: Field[] = [];
  const reqRules: { names: string[]; value: boolean }[] = [];
  let allRequired: null | { except: string[] } = null;
  let lastYesNo: Field | null = null;

  const addField = (f: Field, src?: string, tag?: string) => {
    let id = f.id;
    let k = 2;
    while (fields.some((x) => x.id === id)) id = `${f.id}_${k++}`;
    // skip exact label duplicates
    if (fields.some((x) => x.label.toLowerCase() === f.label.toLowerCase())) return null;
    const nf = { ...f, id };
    fields.push(nf);
    if (src) highlights.push({ text: src, kind: 'field', tag: tag ?? f.type.replace('_', ' ') });
    return nf;
  };

  const handleConditional = (clause: string, raw: string) => {
    // clause: "they need transportation ask where they want to be picked up" | "yes, ask which club"
    const m = clause.match(/^(.*?)(?:,\s*|\s+then\s+|\s+)(?:ask|find out|collect|get)\s+(?:them\s+)?(?:for\s+)?(.+)$/i);
    if (!m) return false;
    const condText = m[1].trim().toLowerCase();
    const followRaw = m[2].trim();
    let parent: Field | null = null;
    let value = 'Yes';
    const op: Cond['op'] = 'eq';
    // option match: "if they pick media", "if they select Other"
    const opt = condText.match(/(?:pick|select|choose|chose|say|answer|tick)\s+["“]?([\w\s-]+?)["”]?$/i);
    if (opt && !/^yes$/i.test(opt[1])) {
      const o = opt[1].trim().toLowerCase();
      parent = [...fields].reverse().find((f) => f.options?.some((x) => x.toLowerCase() === o)) ?? null;
      if (parent) {
        value = parent.options!.find((x) => x.toLowerCase() === o)!;
      } else if (/other/.test(o)) {
        parent = [...fields].reverse().find((f) => f.options) ?? null;
        if (parent) {
          if (!parent.options!.includes('Other')) parent.options = [...parent.options!, 'Other'];
          value = 'Other';
        }
      }
    }
    if (/(?:rate|rating|score|give).*?(?:below|under|less than|lower than)\s+\d/i.test(condText)) {
      notes.push('Score-threshold follow-ups are not available in Google Forms routing. Use a supported single-answer choice and a section route instead.');
      return false;
    }
    if (!parent) {
      const words = condText.split(/\W+/).filter((w) => w.length > 3 && !/they|them|their|yes|have|will|would|answer|says?/.test(w));
      parent = [...fields].reverse().find((f) => f.options?.includes('Yes') && words.some((w) => f.label.toLowerCase().includes(w.slice(0, 5)))) ?? lastYesNo;
      if (/^(no|not)\b|say no|answer no/.test(condText) && parent) value = 'No';
    }
    if (!parent) return false;
    if (parent.type === 'checkboxes') {
      notes.push('Google Forms cannot route a section from a multi-select checkbox answer. Use a single-answer multiple-choice or dropdown question for this follow-up.');
      return false;
    }
    if (parent.type !== 'multiple_choice' && parent.type !== 'dropdown') return false;
    const label = /^(what|which|where|when|why|how|who)\b/i.test(followRaw.replace(/^(them|to)\s+/i, '')) ? whQuestion(followRaw.replace(/^(them|to)\s+/i, '')) : labelFor(followRaw.replace(/^(them\s+)?to\s+/i, ''));
    const g = guessType(followRaw);
    if (g.note) notes.push(g.note);
    const finalLabel = /explain|describe|specify/i.test(followRaw) && label.split(' ').length <= 3 ? 'Please explain' : label;
    const f = addField({ id: slug(finalLabel), label: finalLabel, type: g.type === 'short_text' && /explain|describe|why|went wrong/i.test(followRaw) ? 'long_text' : g.type, required: false, options: g.options, when: { field: parent.id, op, value } });
    if (f) highlights.push({ text: raw, kind: 'logic', tag: `if ${String(value).toLowerCase()} →` });
    return !!f;
  };

  // title
  const inferred = inferTitle(text);
  const title = inferred?.title ?? null;
  if (inferred) highlights.push({ text: inferred.src, kind: 'meta', tag: 'title' });

  // sentences
  const sentences = text
    .replace(/\s+—\s+/g, '. ')
    .split(/(?<=[.!?;])\s+|\n+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const sentenceRaw of sentences) {
    const sentence = sentenceRaw.replace(/[.!?;]+$/, '');
    const lower = sentence.toLowerCase();

    // requirement rules
    const everything = lower.match(/(?:make\s+)?(?:everything|all(?: fields| questions)?|all of them)\s+(?:is\s+|are\s+)?(?:required|mandatory|compulsory)(?:\s+(?:except|but)\s+(?:for\s+)?(.+))?/);
    if (everything) {
      allRequired = { except: everything[1] ? everything[1].split(/,|\band\b/).map((x) => x.trim()) : [] };
      highlights.push({ text: sentence, kind: 'rule', tag: 'required rule' });
      continue;
    }
    const reqM = lower.match(/^(?:make\s+)?(.+?)\s+(?:is\s+|are\s+|should be\s+)?(required|mandatory|compulsory|optional)$/) || lower.match(/^make\s+(.+?)\s+(required|mandatory|compulsory|optional)/);
    if (reqM && !/ask|collect|whether|if /.test(reqM[1])) {
      reqRules.push({ names: reqM[1].split(/,|\band\b/).map((x) => x.trim()).filter(Boolean), value: reqM[2] !== 'optional' });
      highlights.push({ text: sentence, kind: 'rule', tag: reqM[2] === 'optional' ? 'optional' : 'required' });
      continue;
    }
    if (/anonymous|no names?/.test(lower)) {
      notes.push('Kept it anonymous, so no name or email questions.');
      highlights.push({ text: sentence, kind: 'rule', tag: 'no PII' });
      continue;
    }

    // leading "if …" sentence
    const ifM = sentence.match(/^if\s+(.+)$/i);
    if (ifM) {
      handleConditional(ifM[1], sentence);
      continue;
    }

    // split out trailing inline conditional: "..., and if they need X ask Y"
    let main = sentence;
    let inlineIf: string | null = null;
    const inl = sentence.match(/^(.*?)[,]?\s*(?:and\s+)?\bif\s+(.+)$/i);
    if (inl && /\b(ask|find out|collect)\b/i.test(inl[2])) {
      main = inl[1];
      inlineIf = inl[2];
    }

    // strip title clause "I need a registration form for X" from list sentences
    main = main.replace(/^.*?\b(form|survey|questionnaire|rsvp|signup|sign-up)\b(\s+for\s+[^,]+?)?(?=\s*(?:\.|,|$|\s+(?:ask|asking|with|that|to collect|collecting)\b))/i, '').trim();
    main = main.replace(/^(?:asking|with|that asks?|to collect|collecting)\s+(?:for\s+)?/i, '');
    main = main.replace(LEAD, '').replace(LEAD, '').trim();

    if (main) {
      const items = splitItems(main);
      for (const itemRaw of items) {
        const item = itemRaw.replace(/^(and|also|plus|then)\s+/i, '').trim();
        if (!item || /^(for|to|with|me|a form|form)$/i.test(item)) continue;
        if (/^(whether|if)\b/i.test(item) && !/\bask\b/i.test(item)) {
          const label = toQuestion(item);
          const f = addField({ id: slug(label), label, type: 'multiple_choice', required: false, options: ['Yes', 'No'] }, itemRaw, 'multiple choice');
          if (f) lastYesNo = f;
          continue;
        }
        if (/^if\b/i.test(item)) {
          handleConditional(item.replace(/^if\s+/i, ''), itemRaw);
          continue;
        }
        if (item.split(/\s+/).length > 12) continue;
        const { base, options } = extractOptions(item);
        const g = guessType(base);
        if (g.note) notes.push(g.note);
        const label = g.label && base.split(/\s+/).length <= 3 ? g.label : labelFor(base);
        let type = g.type;
        let opts = g.options;
        if (options) {
          opts = options;
          type = /interest|areas?|skills|days|topics|select all|any of/i.test(base) ? 'checkboxes' : options.length > 5 ? 'dropdown' : 'multiple_choice';
        }
        const typeTag = type === 'checkboxes' ? 'checkboxes' : type === 'dropdown' ? 'dropdown' : 'multiple choice';
        const f = addField({ id: slug(label), label, type, required: !!g.required, options: opts }, itemRaw, options ? `${typeTag} ×${options.length}` : undefined);
        if (f && opts?.includes('Yes')) lastYesNo = f;
      }
    }
    if (inlineIf) handleConditional(inlineIf, 'if ' + inlineIf);
  }

  // fall back to a template when nothing concrete was asked
  let finalTitle = title;
  if (fields.length === 0) {
    const tpl = templateFor(text);
    if (tpl) {
      fields.push(...tpl.fields);
      finalTitle = finalTitle ?? tpl.title;
      notes.push('You didn’t list questions, so Intake suggested a starting set. Tell it what to change.');
    } else {
      fields.push(
        { id: 'full_name', label: 'Full name', type: 'short_text', required: true },
        { id: 'email', label: 'Email address', type: 'email', required: true },
        { id: 'response', label: 'Your response', type: 'long_text', required: false },
      );
      notes.push('Not much to go on. Try listing what you want to ask, like “ask for name, email and t-shirt size”.');
    }
  } else {
    const defaults = fields.filter((f) => f.required).map((f) => f.label.toLowerCase());
    if (defaults.length && !allRequired && !reqRules.length) notes.push(`Assumed ${defaults.join(', ')} ${defaults.length > 1 ? 'are' : 'is'} required. Say “make … optional” to change that.`);
  }

  // apply requirement rules
  const matches = (f: Field, name: string) => {
    const n = name.toLowerCase().replace(/^(the|their)\s+/, '').replace(/\s+(question|field)s?$/, '');
    const key = n.split(/\s+/)[0].slice(0, 5);
    return f.label.toLowerCase().includes(n) || f.id.includes(n.replace(/\s+/g, '_')) || (key.length >= 3 && (f.label.toLowerCase().includes(key) || f.id.includes(key)));
  };
  if (allRequired) {
    const ex = (allRequired as { except: string[] }).except;
    for (const f of fields) if (!f.when) f.required = !ex.some((e) => matches(f, e));
  }
  for (const r of reqRules) for (const f of fields) if (r.names.some((n) => matches(f, n))) f.required = r.value;
  if (reqRules.some((r) => r.value)) {
    const named = reqRules.filter((r) => r.value).flatMap((r) => r.names);
    for (const f of fields) if (f.required && !named.some((n) => matches(f, n)) && !reqRules.some((r) => !r.value && r.names.some((n) => matches(f, n)))) f.required = false;
  }
  if (/anonymous/i.test(text)) {
    for (let i = fields.length - 1; i >= 0; i--) if (/^(full_name|email|phone)/.test(fields[i].id) && !fields.some((x) => x.when?.field === fields[i].id)) fields.splice(i, 1);
  }

  const conds = fields.filter((f) => f.when).length;
  if (conds) notes.push(`Added ${conds} follow-up question${conds > 1 ? 's' : ''}. Hit “Try filling it in” to see ${conds > 1 ? 'them' : 'it'} work.`);

  finalTitle = finalTitle ?? 'Untitled Form';
  return {
    spec: { title: finalTitle, description: `Generated by Intake from ${text.split(/\s+/).length} words.`, fields },
    highlights,
    notes: [...new Set(notes)],
  };
}
