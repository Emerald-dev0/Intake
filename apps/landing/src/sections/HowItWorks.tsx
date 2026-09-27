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
const M = '#07827f';

function ConnectVis({ t }: { t: number }) {
  const pressed = t > 1.2;
  const done = t > 2.2;
  return (
    <div className="hv hv-connect">
      <div className="hv-card">
        <span className="hv-k">Connect an account</span>
        <div className={`hv-btn ${pressed && !done ? 'is-press' : ''} ${done ? 'is-done' : ''}`} style={{ ['--pv' as string]: G }}>
          <span className="hv-dot" />
          {done ? 'Connected · ada.okafor@gmail.com' : 'Continue with Google'}
          {done && <span className="hv-ok">✓</span>}
        </div>
        <div className="hv-btn is-muted" style={{ ['--pv' as string]: M }}>
          <span className="hv-dot" />
          Continue with Microsoft
        </div>
        <p className="hv-fine">You approve it once. Disconnect whenever you like.</p>
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
        <span>{sent ? <span className="hv-ph">Ask for anything…</span> : SAY.slice(0, n)}</span>
        {!sent && <i className="caret" />}
        <span className={`hv-send ${n > 0 && !sent ? 'is-on' : ''}`}>↑</span>
      </div>
    </div>
  );
}

function LinkVis({ t }: { t: number }) {
  const creating = t > 0.6 && t < 2.2;
  const live = t >= 2.2;
  return (
    <div className="hv hv-link" style={{ ['--pv' as string]: G }}>
      <div className="hv-card">
        <span className="hv-k">Your Google Forms</span>
        <AnimatePresence>
          {(creating || live) && (
            <motion.div className={`hv-row is-new ${live ? 'is-live' : ''}`} initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }} exit={{ opacity: 0, height: 0 }}>
              <span className="acct-doc" />
              <div>
                <b>Tolu’s 30th — RSVP</b>
                <span>{live ? 'Just now · made by Intake' : 'Creating…'}</span>
              </div>
              {live ? <span className="acct-new">new</span> : <span className="spin sm" />}
            </motion.div>
          )}
        </AnimatePresence>
        <div className="hv-row">
          <span className="acct-doc" />
          <div>
            <b>Choir rehearsal RSVP</b>
            <span>3 weeks ago</span>
          </div>
        </div>
        <AnimatePresence>
          {live && (
            <motion.div className="hv-share" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
              <code>forms.gle/tolu-30th</code>
              <span className={t > 3.2 ? 'is-copied' : ''}>{t > 3.2 ? 'Copied ✓' : 'Copy'}</span>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}

const STEPS = [
  { n: '01', title: 'Connect your account', body: 'Sign in with Google or Microsoft. That’s where your forms will live, same as always.', Vis: ConnectVis, period: 5 },
  { n: '02', title: 'Say what you need', body: 'Type it the way you’d text a friend. Intake picks up the questions, the required bits and the follow-ups.', Vis: SayVis, period: 5.5 },
  { n: '03', title: 'Get a real form', body: 'Intake builds it in your Google Forms or Microsoft Forms and gives you the link. Share it and the responses come in like normal.', Vis: LinkVis, period: 5 },
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
    <section className="section how" id="how">
      <div className="wrap">
        <SectionHead
          n="02"
          kicker="How it works"
          title={
            <>
              Three steps.
              <br />
              The last one is <em>sharing the link.</em>
            </>
          }
        />
        <div className="how-grid">
          {STEPS.map((s, i) => (
            <StepCard key={s.n} s={s} i={i} />
          ))}
        </div>
        <motion.div className="how-after" initial={{ opacity: 0, y: 20 }} whileInView={{ opacity: 1, y: 0 }} viewport={{ once: true }} transition={{ duration: 0.8 }}>
          <span className="how-after-k">Then just keep talking</span>
          <span className="how-after-msg">“Make church optional and add a question about T-shirt size.”</span>
          <span className="how-after-arrow">→</span>
          <span className="how-after-ok">
            <i /> Saved to your Google Form
          </span>
        </motion.div>
      </div>
    </section>
  );
}
