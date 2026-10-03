import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paper } from '../components/Paper';
import { Highlighted } from '../components/Highlighted';
import { plan, type Plan } from '../lib/planner';
import { type Answers, type AnswerValue } from '../lib/types';
import { PROVIDERS } from '../lib/providers';
import { SectionHead } from '../components/SectionHead';

const EXAMPLES = [
  { label: 'Final-year project', text: 'Create a registration form for my final-year project. Ask for full name, email, department (Science, Arts, Engineering), level, phone number, and whether they need accommodation. If they select yes, ask what type of accommodation they need.' },
  { label: 'Workshop signup', text: 'Workshop signup with name, email, t-shirt size, dietary needs and whether they need a laptop. If yes, ask which operating system they prefer.' },
  { label: 'Cake orders', text: 'Order form for my cake business. Ask for name, phone number, cake flavour (chocolate, vanilla, red velvet), preferred pickup window (morning, afternoon, evening), and whether they want delivery. If yes, ask for their address. Make everything required.' },
  { label: 'Customer feedback', text: 'Customer feedback form. Ask how their visit went (Excellent, Okay, Needs improvement). If they choose Needs improvement, ask what we could improve. Ask how they heard about us.' },
  { label: 'Hackathon', text: 'Registration form for a weekend hackathon. Ask for full name, email, team name, role (designer, developer, product), preferred track (web, mobile, hardware), and whether they need accommodation. If yes, ask what support they need.' },
  { label: 'Just “wedding rsvp”', text: 'wedding rsvp' },
];

export function Playground() {
  const [text, setText] = useState(EXAMPLES[0].text);
  const [result, setResult] = useState<Plan | null>(null);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'building' | 'done'>('idle');
  const [mode, setMode] = useState<'builder' | 'preview'>('builder');
  const [answers, setAnswers] = useState<Answers>({});
  const timers = useRef<number[]>([]);
  const taRef = useRef<HTMLTextAreaElement>(null);
  const sectionRef = useRef<HTMLElement>(null);
  const started = useRef(false);

  const run = useCallback((input: string) => {
    const src = input.trim();
    if (!src) return;
    started.current = true;
    timers.current.forEach(clearTimeout);
    timers.current = [];
    const p = plan(src);
    setResult(p);
    setShown(0);
    setAnswers({});
    setMode('builder');
    setPhase('thinking');
    timers.current.push(
      window.setTimeout(() => {
        setPhase('building');
        p.spec.fields.forEach((_, i) => {
          timers.current.push(
            window.setTimeout(() => {
              setShown(i + 1);
              if (i === p.spec.fields.length - 1) timers.current.push(window.setTimeout(() => setPhase('done'), 450));
            }, i * 190),
          );
        });
      }, 900),
    );
  }, []);

  // External triggers (hero composer / final CTA)
  useEffect(() => {
    const h = (e: Event) => {
      const t = (e as CustomEvent<string>).detail;
      if (!t) return;
      setText(t);
      sectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      window.setTimeout(() => run(t), 650);
    };
    window.addEventListener('intake:try', h);
    return () => window.removeEventListener('intake:try', h);
  }, [run]);

  // Build the first example once the section comes into view
  useEffect(() => {
    const el = sectionRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => {
        if (e.isIntersecting) {
          if (!started.current) run(EXAMPLES[0].text);
          io.disconnect();
        }
      },
      { threshold: 0.15 },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [run]);

  useEffect(() => () => timers.current.forEach(clearTimeout), []);

  const fields = useMemo(() => (result ? result.spec.fields.slice(0, shown) : []), [result, shown]);
  const key = result ? result.spec.title + result.spec.fields.length + text.length : '';
  const conds = result?.spec.fields.filter((f) => f.when).length ?? 0;
  const req = result?.spec.fields.filter((f) => f.required).length ?? 0;
  const P = PROVIDERS.google;
  const summary = result
    ? [
        `${result.spec.fields.length} question${result.spec.fields.length === 1 ? '' : 's'}`,
        `${conds} follow-up${conds === 1 ? '' : 's'}`,
        `${req} required`,
      ]
    : [];

  return (
    <section className="section play" id="try" ref={sectionRef} aria-labelledby="create-with-ai-title">
      <div className="wrap">
        <SectionHead
          n="04"
          kicker="Create Google Forms with AI"
          titleId="create-with-ai-title"
          title={<>Describe what your form needs.</>}
          lede="In the workspace, server-side AI interprets your request and prepares a structured Google Forms draft for review. This interactive browser-only preview uses a simple example parser, not the AI model; it sends nothing to Google and never creates a form."
        />

        <div className="play-grid">
          <div className="play-left">
            <form
              className="play-composer"
              onSubmit={(e) => {
                e.preventDefault();
                run(text);
              }}
            >
              <div className="play-composer-top">
                <span className="play-dot" aria-hidden />
                <label className="play-input-label" htmlFor="playground-request">What should the form ask?</label>
                <span className="play-count">{text.length} characters</span>
              </div>
              <textarea
                id="playground-request"
                ref={taRef}
                value={text}
                onChange={(e) => setText(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    run(text);
                  }
                }}
                rows={5}
                spellCheck={false}
                placeholder="e.g. Signup for our book club. Ask for name, email, favourite genre (fiction, history, poetry) and whether they can host. If yes, ask for their address."
              />
              <div className="play-composer-foot">
                <div className="play-examples">
                  {EXAMPLES.map((ex) => (
                    <button
                      type="button"
                      key={ex.label}
                      className={`pill ${text === ex.text ? 'is-on' : ''}`}
                      onClick={() => {
                        setText(ex.text);
                        run(ex.text);
                      }}
                    >
                      {ex.label}
                    </button>
                  ))}
                </div>
                <button type="submit" className="btn btn-accent play-go" disabled={!text.trim()}>
                  Preview it <kbd>↵</kbd>
                </button>
              </div>
            </form>

            <AnimatePresence mode="wait">
              {result && (
                <motion.div key={key} className="play-heard" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="play-label">
                    What this local parser inferred
                    <span className="legend">
                      <i className="lg-field" /> question <i className="lg-logic" /> follow-up <i className="lg-rule" /> rule <i className="lg-meta" /> title
                    </span>
                  </div>
                  <p className={`play-heard-text ${phase === 'thinking' ? 'is-scanning' : ''}`}>
                    <Highlighted text={text} highlights={result.highlights} active={() => phase !== 'thinking'} />
                  </p>
                  <div className="play-meta">
                    <div className="play-sum">
                      {summary.map((c, i) => (
                        <motion.span key={c} className="play-sum-chip" initial={{ opacity: 0, y: 6 }} animate={{ opacity: phase === 'thinking' ? 0.3 : 1, y: 0 }} transition={{ delay: 0.9 + i * 0.12 }}>
                          {c}
                        </motion.span>
                      ))}
                    </div>
                    {result.notes.length > 0 && (
                      <ul className="play-notes">
                        {result.notes.map((n) => (
                          <li key={n}>{n}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                </motion.div>
              )}
            </AnimatePresence>
          </div>

          <div className="play-right">
            <div className="play-toolbar">
              <span className="play-provider-label" style={{ ['--pv' as string]: P.color }}>
                <i className="pv-tab-dot" /> Google Forms · local preview
              </span>
              <div className="tabs tabs-sm">
                <button className={mode === 'builder' ? 'on' : ''} onClick={() => setMode('builder')}>
                  Questions
                </button>
                <button className={mode === 'preview' ? 'on' : ''} onClick={() => setMode('preview')}>
                  Try filling it in
                </button>
              </div>
            </div>
            <div className="play-stage">
              <div className="st-canvas-grid" />
              <div className="play-paper">
                {result ? (
                  <Paper
                    provider="google"
                    stripState="preview"
                    title={result.spec.title}
                    description={phase === 'thinking' ? 'Thinking…' : result.spec.description}
                    fields={fields}
                    mode={mode}
                    answers={answers}
                    onAnswer={mode === 'preview' ? (id: string, v: AnswerValue) => setAnswers((a) => ({ ...a, [id]: v })) : undefined}
                    stamp={phase === 'done'}
                    stampLabel="Preview"
                    stampSub={P.short}
                    syncing={phase === 'thinking'}
                    empty={
                      <div className="play-skel">
                        <i />
                        <i />
                        <i />
                      </div>
                    }
                  />
                ) : (
                  <div className="st-empty-box">Your form appears here</div>
                )}
              </div>
            </div>
            <div className="play-create">
              <a className="btn play-create-btn" href="/auth/sign-up" style={{ ['--pv' as string]: P.color }}>
                Use Intake to create or edit a Google Form →
              </a>
            </div>
            <p className="play-foot">Demo only · local parser · nothing you type is sent to AI, Google, or a server.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
