import { AnimatePresence, motion, useInView } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { SectionHead } from '../components/SectionHead';

/** A looping clock (seconds) that only runs while the element is on screen. */
function useLoop(period: number) {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { margin: '-80px' });
  const [t, setT] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let raf = 0;
    let last = performance.now();
    const f = (now: number) => {
      const dt = (now - last) / 1000;
      last = now;
      setT((v) => (v + dt) % period);
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [inView, period]);
  return { ref, t };
}

const G = '#6d3fc0';

function ConnectVis({ t }: { t: number }) {
  const pressed = t > 1.2;
  const done = t > 2.2;
  return (
    <div className="hv hv-connect">
      <div className="hv-card">
        <span className="hv-k">Illustrative connection screen</span>
        <div className={`hv-btn ${pressed && !done ? 'is-press' : ''} ${done ? 'is-done' : ''}`} style={{ ['--pv' as string]: G }}>
          <span className="hv-dot" />
          {done ? 'Google account authorized' : 'Connect Google Forms'}
          {done && <span className="hv-ok">✓</span>}
        </div>
        <p className="hv-fine">Authorize Google separately from Intake sign-in. Scripted illustration; no account is connected here.</p>
      </div>
    </div>
  );
}

const SAY = 'RSVP form for my 30th. Name, plus-one, and any food allergies.';
function SayVis({ t }: { t: number }) {
  const n = Math.max(0, Math.min(SAY.length, Math.floor((t - 0.4) * 26)));
  const sent = t > 0.4 + SAY.length / 26 + 0.6;
  return (
    <div className="hv hv-say">
      <AnimatePresence>
        {sent && (
          <motion.div className="hv-bubble" initial={{ opacity: 0, y: 14, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} exit={{ opacity: 0 }}>
            {SAY}
          </motion.div>
        )}
      </AnimatePresence>
      <div className={`hv-input ${!sent ? 'is-typing' : ''}`}>
        <span>{sent ? <span className="hv-ph">Describe a form or change…</span> : SAY.slice(0, n)}</span>
        {!sent && <i className="caret" />}
        <span className={`hv-send ${n > 0 && !sent ? 'is-on' : ''}`}>↑</span>
      </div>
    </div>
  );
}

function LinkVis({ t }: { t: number }) {
  const started = t > 0.6;
  const ready = t >= 2.2;
  return (
    <div className="hv hv-link" style={{ ['--pv' as string]: G }}>
      <div className="hv-card">
        <span className="hv-k">Google Forms · review before apply</span>
        <AnimatePresence>
          {started && (
            <motion.div className={`hv-row is-new ${ready ? 'is-live' : ''}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <span className="acct-doc" />
              <div>
                <b>Tolu’s 30th — RSVP</b>
                <span>{ready ? 'Illustrative draft · not applied' : 'Preparing an example proposal…'}</span>
              </div>
              {ready ? <span className="acct-new">Review</span> : <span className="spin sm" />}
            </motion.div>
          )}
        </AnimatePresence>
        <p className="hv-fine">This scripted animation creates no form. In Intake, confirm only after reviewing the proposal.</p>
      </div>
    </div>
  );
}

const STEPS = [
  { n: '01', title: 'Describe, then review', body: 'Server-side AI turns natural language into a structured proposal. Revise it before Google Forms is changed.', Vis: SayVis, period: 5.5 },
  { n: '02', title: 'Authorize Google separately', body: 'Connect the Google account that owns the form or has editor access. Intake sign-in alone does not grant Google access.', Vis: ConnectVis, period: 5 },
  { n: '03', title: 'Confirm before apply', body: 'After confirmation, Intake can create a new Google Form or apply supported changes to the same existing form.', Vis: LinkVis, period: 5 },
];

function StepCard({ s, i }: { s: (typeof STEPS)[number]; i: number }) {
  const { ref, t } = useLoop(s.period);
  const V = s.Vis;
  return (
    <motion.div
      ref={ref}
      className="how-card"
      initial={{ opacity: 0, y: 30 }}
      whileInView={{ opacity: 1, y: 0 }}
      viewport={{ once: true, margin: '-60px' }}
      transition={{ duration: 0.8, delay: i * 0.1, ease: [0.22, 1, 0.36, 1] }}
    >
      <div className="how-vis">
        <div className="st-canvas-grid" />
        <V t={t} />
      </div>
      <div className="how-text">
        <span className="how-n">{s.n}</span>
        <h3>{s.title}</h3>
        <p>{s.body}</p>
      </div>
    </motion.div>
  );
}

export function HowItWorks() {
  return (
    <section className="section how" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <SectionHead
          n="02"
          kicker="How Intake works"
          titleId="how-title"
          title={<>Describe. <em>Review.</em> Confirm.</>}
          lede="1. Describe a new form or a change to an existing one. 2. Intake interprets the request with server-side AI and generates a structured proposal. 3. Review and revise the proposal. 4. Authorize Google separately and choose the form. 5. Confirm; Intake creates the new Google Form or applies supported edits to the same existing form. No provider change happens before confirmation. The animations are scripted illustrations, not live Google calls."
        />
        <div className="how-grid">
          {STEPS.map((s, i) => (
            <StepCard key={s.n} s={s} i={i} />
          ))}
        </div>
        <motion.div className="how-after" initial={{ opacity: 1, y: 0 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <span className="how-after-k">Edit an existing Google Form</span>
          <span className="how-after-msg">“Make church optional and add a question about T-shirt size.”</span>
          <span className="how-after-arrow">→</span>
          <span className="how-after-ok">
            <i /> Review the proposal; confirm to apply
          </span>
        </motion.div>
      </div>
    </section>
  );
}
