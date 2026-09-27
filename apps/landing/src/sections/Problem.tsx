import { motion, useInView, useScroll, useTransform } from 'motion/react';
import { useEffect, useRef, useState } from 'react';
import { SectionHead, Reveal } from '../components/SectionHead';

const BUILDER_STEPS = [
  'Open Google Forms',
  'Start a blank form',
  'Add a question',
  'Pick the question type',
  'Type in the options',
  'Tick “Required”',
  'Do it all again × 8',
  'Work out the follow-ups',
  'Set up sections',
  'Preview it',
  'Fix what broke',
  'Find the share link',
];

function useCount(target: number, run: boolean, dur = 2200) {
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!run) return;
    let raf = 0;
    const t0 = performance.now();
    const f = (now: number) => {
      const p = Math.min(1, (now - t0) / dur);
      setN(Math.round(target * (1 - Math.pow(1 - p, 3))));
      if (p < 1) raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [run, target, dur]);
  return n;
}

export function Problem() {
  const cmp = useRef<HTMLDivElement>(null);
  const inView = useInView(cmp, { once: true, margin: '-120px' });
  const decisions = useCount(12, inView, 1600);

  return (
    <section className="section problem" id="problem">
      <div className="wrap">
        <SectionHead
          n="01"
          kicker="The problem"
          title={
            <>
              You know what to ask.
              <br />
              Form builders want <em>clicks.</em>
            </>
          }
          lede="Every question means picking a type, typing options, ticking boxes and fiddling with follow-ups. None of it is hard. It's just slow and boring, and Intake does it for you."
        />

        <div className="cmp" ref={cmp}>
          <div className="cmp-col cmp-old">
            <div className="cmp-head">
              <span className="cmp-tag">The usual way</span>
              <span className="cmp-count">
                <b>{decisions}</b> steps
              </span>
            </div>
            <ol className="cmp-steps">
              {BUILDER_STEPS.map((s, i) => (
                <motion.li
                  key={s}
                  initial={{ opacity: 0, x: -16 }}
                  animate={inView ? { opacity: 1, x: 0 } : {}}
                  transition={{ delay: 0.1 + i * 0.09, duration: 0.5 }}
                >
                  <span className="cmp-i">{String(i + 1).padStart(2, '0')}</span>
                  {s}
                  {s.startsWith('Repeat') && <span className="cmp-loop">↻</span>}
                </motion.li>
              ))}
            </ol>
          </div>
          <div className="cmp-vs">
            <span>vs</span>
          </div>
          <div className="cmp-col cmp-new">
            <div className="cmp-head">
              <span className="cmp-tag is-accent">With Intake</span>
              <span className="cmp-count">
                <b>1</b> message
              </span>
            </div>
            <motion.blockquote
              className="cmp-quote"
              initial={{ opacity: 0, y: 20 }}
              animate={inView ? { opacity: 1, y: 0 } : {}}
              transition={{ delay: 0.5, duration: 0.8 }}
            >
              “Registration form for our youth conference. Name, phone, age group, church, and whether they need a bus. If they do, ask where to pick them up.”
            </motion.blockquote>
            <motion.div className="cmp-result" initial={{ opacity: 0, y: 16 }} animate={inView ? { opacity: 1, y: 0 } : {}} transition={{ delay: 1.2, duration: 0.7 }}>
              <div className="cmp-arrow">↓</div>
              <div className="cmp-out">
                <span className="cmp-out-dot" />
                <div>
                  <b>A real Google Form, ready to share</b>
                  <span>6 questions · 1 follow-up · in your own account</span>
                </div>
              </div>
            </motion.div>
          </div>
        </div>

        <Translation />
      </div>
    </section>
  );
}

function Translation() {
  const ref = useRef<HTMLDivElement>(null);
  const { scrollYProgress } = useScroll({ target: ref, offset: ['start 85%', 'center 45%'] });
  const strike = useTransform(scrollYProgress, [0.15, 0.6], ['0% 3px', '100% 3px']);
  const fade = useTransform(scrollYProgress, [0.35, 0.75], [1, 0.32]);
  const rise = useTransform(scrollYProgress, [0.45, 0.95], [0.25, 1]);
  const y = useTransform(scrollYProgress, [0.45, 0.95], [24, 0]);
  return (
    <div className="trans" ref={ref}>
      <Reveal>
        <span className="trans-k">Nobody thinks</span>
      </Reveal>
      <motion.p className="trans-old" style={{ opacity: fade }}>
        <motion.span className="trans-strike-wrap" style={{ backgroundSize: strike }}>
          “I need a multiple-choice question with three options.”
        </motion.span>
      </motion.p>
      <motion.span className="trans-k" style={{ opacity: rise }}>
        They think
      </motion.span>
      <motion.p className="trans-new" style={{ opacity: rise, y }}>
        “I need to know whether the person is <em>coming by bus.</em>”
      </motion.p>
    </div>
  );
}
