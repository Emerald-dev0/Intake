import { AnimatePresence, motion } from 'motion/react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Paper } from '../components/Paper';
import { Highlighted } from '../components/Highlighted';
import { plan, type Plan } from '../lib/planner';
import { type Answers, type AnswerValue } from '../lib/types';
import { PROVIDERS, type Provider } from '../lib/providers';
import { SectionHead } from '../components/SectionHead';
import { REPO } from './Hero';

const EXAMPLES = [
  { label: 'Workshop signup', text: 'Workshop signup with name, email, t-shirt size, dietary needs and whether they need a laptop. If yes, ask which OS they prefer.' },
  { label: 'Cake orders', text: 'Order form for my cake business. Ask for name, phone number, cake flavour (chocolate, vanilla, red velvet), pickup date, and whether they want delivery. If yes, ask for their address. Make everything required.' },
  { label: 'Clinic intake', text: 'Patient intake form for a dental clinic. Collect full name, date of birth, phone, email, reason for visit, and whether they have any allergies. If yes, ask them to describe the allergies. Make email optional.' },
  { label: 'Hackathon', text: 'Registration form for a weekend hackathon. Ask for full name, email, team name, role (designer, developer, product), years of experience, and whether they need accommodation — if yes, ask how many nights.' },
  { label: 'Just “wedding rsvp”', text: 'wedding rsvp' },
];

export function Playground() {
  const [text, setText] = useState(EXAMPLES[0].text);
  const [result, setResult] = useState<Plan | null>(null);
  const [shown, setShown] = useState(0);
  const [phase, setPhase] = useState<'idle' | 'thinking' | 'building' | 'done'>('idle');
  const [provider, setProvider] = useState<Provider>('google');
  const [note, setNote] = useState(false);
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
    setNote(false);
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
  const P = PROVIDERS[provider];
  const summary = result
    ? [
        `${result.spec.fields.length} question${result.spec.fields.length === 1 ? '' : 's'}`,
        `${conds} follow-up${conds === 1 ? '' : 's'}`,
        `${req} required`,
      ]
    : [];

  return (
    <section className="section play" id="try" ref={sectionRef}>
      <div className="wrap">
        <SectionHead
          n="04"
          kicker="Try it"
          title={
            <>
              Your turn. Type <em>any</em> form.
            </>
          }
          lede="Describe a form and watch it take shape. This demo runs in your browser, so nothing gets created. The real thing makes the form in your own account."
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
                <span className="play-dot" /> what do you want to ask people?
                <span className="play-count">{text.length} chars</span>
              </div>
              <textarea
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
                  Build it <kbd>↵</kbd>
                </button>
              </div>
            </form>

            <AnimatePresence mode="wait">
              {result && (
                <motion.div key={key} className="play-heard" initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
                  <div className="play-label">
                    What Intake heard
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
              <div className="tabs pv-tabs">
                {(['google', 'microsoft'] as Provider[]).map((k) => (
                  <button key={k} className={provider === k ? 'on' : ''} onClick={() => setProvider(k)} style={{ ['--pv' as string]: PROVIDERS[k].color }}>
                    <i className="pv-tab-dot" />
                    {PROVIDERS[k].name}
                  </button>
                ))}
              </div>
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
                    provider={provider}
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
              <button className="btn play-create-btn" style={{ ['--pv' as string]: P.color }} disabled={phase !== 'done'} onClick={() => setNote(true)}>
                <i className="pv-tab-dot" /> Create in {P.name}
              </button>
              <AnimatePresence>
                {note && (
                  <motion.p className="play-create-note" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }} exit={{ opacity: 0 }}>
                    Connecting accounts is coming soon.{' '}
                    <a href={REPO} target="_blank" rel="noreferrer">
                      Star the repo
                    </a>{' '}
                    to hear when it’s ready.
                  </motion.p>
                )}
              </AnimatePresence>
            </div>
            <p className="play-foot">Demo only · runs in your browser · nothing you type is sent anywhere.</p>
          </div>
        </div>
      </div>
    </section>
  );
}
