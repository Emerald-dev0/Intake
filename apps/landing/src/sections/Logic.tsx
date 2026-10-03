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
    id: 'yes-no',
    label: 'Yes / No',
    sentence: 'Ask if the attendee needs accommodation. If they answer yes, ask what support they need.',
    highlights: [
      { text: 'if the attendee needs accommodation', kind: 'field', tag: 'multiple choice' },
      { text: 'If they answer yes', kind: 'logic', tag: 'supported section route' },
      { text: 'what support they need', kind: 'field', tag: 'follow-up' },
    ],
    fields: [
      { id: 'need_accommodation', label: 'Do you need accommodation?', type: 'multiple_choice', required: true, options: ['Yes', 'No'] },
      { id: 'accommodation_support', label: 'What accommodation support do you need?', type: 'long_text', required: false, when: { field: 'need_accommodation', op: 'eq', value: 'Yes' } },
    ],
    branches: [
      { label: 'Yes', to: 'accommodation_support' },
      { label: 'No', to: null },
    ],
  },
  {
    id: 'dropdown',
    label: 'Dropdown',
    sentence: 'Ask which workshop track they prefer. If they choose Design, ask which tools they use.',
    highlights: [
      { text: 'which workshop track they prefer', kind: 'field', tag: 'dropdown' },
      { text: 'If they choose Design', kind: 'logic', tag: 'supported section route' },
      { text: 'which tools they use', kind: 'field', tag: 'follow-up' },
    ],
    fields: [
      { id: 'track', label: 'Which workshop track do you prefer?', type: 'dropdown', required: true, options: ['Design', 'Development', 'Product'] },
      { id: 'design_tools', label: 'Which design tools do you use?', type: 'short_text', required: false, when: { field: 'track', op: 'eq', value: 'Design' } },
    ],
    branches: [
      { label: 'Design', to: 'design_tools' },
      { label: 'Other tracks', to: null },
    ],
  },
  {
    id: 'multiple-choice',
    label: 'Multiple choice',
    sentence: 'Ask which role they are applying for. If they choose Engineering, ask which languages they use.',
    highlights: [
      { text: 'which role they are applying for', kind: 'field', tag: 'multiple choice' },
      { text: 'If they choose Engineering', kind: 'logic', tag: 'supported section route' },
      { text: 'which languages they use', kind: 'field', tag: 'follow-up' },
    ],
    fields: [
      { id: 'role', label: 'Which role are you applying for?', type: 'multiple_choice', required: true, options: ['Engineering', 'Design', 'Product'] },
      { id: 'languages', label: 'Which programming languages do you use?', type: 'short_text', required: false, when: { field: 'role', op: 'eq', value: 'Engineering' } },
    ],
    branches: [
      { label: 'Engineering', to: 'languages' },
      { label: 'Other roles', to: null },
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
    <section className="section logic" id="logic" aria-labelledby="logic-title">
      <div className="wrap">
        <SectionHead
          n="05"
          kicker="Google Forms follow-up routing"
          titleId="logic-title"
          title={<>Describe a follow-up. Intake plans the <em>supported routing.</em></>}
          lede="For supported Google Forms questions, Intake can translate conditional requests into section routing. Google does not support every kind of per-question show-or-hide logic; the workspace flags structures it cannot safely express instead of claiming to apply them."
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
