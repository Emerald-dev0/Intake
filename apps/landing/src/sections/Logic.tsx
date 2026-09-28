import { AnimatePresence, motion } from 'motion/react';
import { useState } from 'react';
import { SectionHead } from '../components/SectionHead';
import { Paper } from '../components/Paper';
import { Highlighted } from '../components/Highlighted';
import { isVisible, shortLabel, TYPE_LABEL, type Answers, type Field, type Highlight } from '../lib/types';

interface Example {
  id: string;
  label: string;
  sentence: string;
  highlights: Highlight[];
  fields: Field[];
  branches: { label: string; to: string | null }[];
}

const EXAMPLES: Example[] = [
  {
    id: 'acc',
    label: 'Yes / No',
    sentence: 'Ask if they need accommodation. If they say yes, ask what type of accommodation they need.',
    highlights: [
      { text: 'if they need accommodation', kind: 'field', tag: 'yes / no' },
      { text: 'If they say yes', kind: 'logic', tag: 'condition' },
      { text: 'what type of accommodation they need', kind: 'field', tag: 'follow-up' },
    ],
    fields: [
      { id: 'need_accommodation', label: 'Do you need accommodation?', type: 'single_choice', required: true, options: ['Yes', 'No'] },
      { id: 'accommodation_type', label: 'What type of accommodation do you need?', type: 'single_choice', required: true, options: ['Hostel', 'Hotel', 'Host family'], when: { field: 'need_accommodation', op: 'eq', value: 'Yes' } },
    ],
    branches: [
      { label: 'Yes', to: 'accommodation_type' },
      { label: 'No', to: null },
    ],
  },
  {
    id: 'rate',
    label: 'Low rating',
    sentence: 'Ask them to rate the delivery out of 5. If they give it less than 3, ask what went wrong.',
    highlights: [
      { text: 'rate the delivery out of 5', kind: 'field', tag: 'rating' },
      { text: 'If they give it less than 3', kind: 'logic', tag: '< 3' },
      { text: 'ask what went wrong', kind: 'field', tag: 'follow-up' },
    ],
    fields: [
      { id: 'delivery_rating', label: 'How would you rate the delivery?', type: 'rating', required: true },
      { id: 'what_went_wrong', label: 'Sorry! What went wrong?', type: 'long_text', required: false, when: { field: 'delivery_rating', op: 'lt', value: 3 } },
    ],
    branches: [
      { label: '1–2 ★', to: 'what_went_wrong' },
      { label: '3–5 ★', to: null },
    ],
  },
  {
    id: 'media',
    label: 'Checkboxes',
    sentence: 'Ask which teams they want to join: media, ushering or welfare. If they pick media, ask for a portfolio link.',
    highlights: [
      { text: 'which teams they want to join: media, ushering or welfare', kind: 'field', tag: 'checkboxes' },
      { text: 'If they pick media', kind: 'logic', tag: 'includes' },
      { text: 'ask for a portfolio link', kind: 'field', tag: 'follow-up' },
    ],
    fields: [
      { id: 'teams', label: 'Which teams do you want to join?', type: 'multiple_choice', required: true, options: ['Media', 'Ushering', 'Welfare'] },
      { id: 'portfolio', label: 'Link to your portfolio', type: 'short_text', required: false, when: { field: 'teams', op: 'has', value: 'Media' } },
    ],
    branches: [
      { label: 'Media ticked', to: 'portfolio' },
      { label: 'otherwise', to: null },
    ],
  },
];

export function Logic() {
  const [i, setI] = useState(0);
  const [answers, setAnswers] = useState<Answers>({});
  const ex = EXAMPLES[i];
  const child = ex.fields[1];
  const open = isVisible(child, answers);

  return (
    <section className="section logic" id="logic">
      <div className="wrap">
        <SectionHead
          n="05"
          kicker="Follow-up questions"
          title={
            <>
              Say <em>“if.”</em> It just works.
            </>
          }
          lede="Follow-up questions are the fiddliest part of making a form. With Intake you just say when to ask them, and it sets them up in Google or Microsoft Forms for you."
        />
        <div className="logic-grid">
          <div className="logic-left">
            <div className="logic-tabs">
              {EXAMPLES.map((e, k) => (
                <button
                  key={e.id}
                  className={`pill ${k === i ? 'is-on' : ''}`}
                  onClick={() => {
                    setI(k);
                    setAnswers({});
                  }}
                >
                  {e.label}
                </button>
              ))}
            </div>
            <AnimatePresence mode="wait">
              <motion.p key={ex.id} className="logic-sentence" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -10 }}>
                “<Highlighted text={ex.sentence} highlights={ex.highlights} showTags />”
              </motion.p>
            </AnimatePresence>

            <div className="tree">
              <div className="tree-node tree-root">
                <span className="tree-id">{shortLabel(ex.fields[0].label)}</span>
                <span className="tree-type">{TYPE_LABEL[ex.fields[0].type]}</span>
              </div>
              <svg className="tree-svg" viewBox="0 0 400 120" preserveAspectRatio="none" aria-hidden>
                <motion.path key={`a${ex.id}`} d="M200 0 C200 60, 100 50, 100 120" className={`tree-path ${open ? 'is-hot' : ''}`} initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9 }} />
                <motion.path key={`b${ex.id}`} d="M200 0 C200 60, 300 50, 300 120" className="tree-path is-dim" initial={{ pathLength: 0 }} animate={{ pathLength: 1 }} transition={{ duration: 0.9, delay: 0.15 }} />
              </svg>
              <div className="tree-leaves">
                <div className={`tree-leaf ${open ? 'is-hot' : ''}`}>
                  <span className="tree-branch">{ex.branches[0].label}</span>
                  <div className="tree-node">
                    <span className="tree-id">{shortLabel(child.label)}</span>
                    <span className="tree-type">{TYPE_LABEL[child.type]}</span>
                  </div>
                </div>
                <div className="tree-leaf">
                  <span className="tree-branch">{ex.branches[1].label}</span>
                  <div className="tree-node is-end">skip it ↓</div>
                </div>
              </div>
            </div>
          </div>
          <div className="logic-right">
            <div className="logic-try">
              <span className="logic-try-k">
                <i className="rec" /> Go ahead, answer it
              </span>
              <span className={`logic-state ${open ? 'is-open' : ''}`}>{open ? 'follow-up showing' : 'follow-up hidden'}</span>
            </div>
            <div className="logic-paper">
              <Paper
                key={ex.id}
                title="Preview"
                fields={ex.fields}
                mode="preview"
                answers={answers}
                onAnswer={(id, v) => setAnswers((a) => ({ ...a, [id]: v }))}
              />
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
