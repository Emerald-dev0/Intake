import { motion, useInView } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SectionHead, Reveal } from '../components/SectionHead';
import { PROVIDERS } from '../lib/providers';

/**
 * Phone-only sections. Desktop tells the story with big animated reels;
 * on a phone that's too much, so each idea gets one small, calm card instead.
 */

const STEPS = ['Open Forms', 'Blank form', 'Add question', 'Pick type', 'Type options', 'Tick required', 'Repeat × 8', 'Follow-ups', 'Sections', 'Preview', 'Fix it', 'Find link'];

export function MCompare() {
  const ref = useRef<HTMLDivElement>(null);
  const inView = useInView(ref, { once: true, margin: '-80px' });
  const [n, setN] = useState(0);
  useEffect(() => {
    if (!inView) return;
    let i = 0;
    const id = window.setInterval(() => {
      i += 1;
      setN(i);
      if (i >= STEPS.length) window.clearInterval(id);
    }, 110);
    return () => window.clearInterval(id);
  }, [inView]);
  const done = n >= STEPS.length;

  return (
    <section className="section m-sec">
      <div className="wrap">
        <SectionHead
          n="01"
          kicker="The problem"
          title={
            <>
              Twelve steps,
              <br />
              or <em>one message.</em>
            </>
          }
        />
        <div className="mc" ref={ref}>
          <div className="mc-old">
            <div className="mc-row">
              <span className="mc-k">The usual way</span>
              <span className="mc-n">{n}<small>/12 steps</small></span>
            </div>
            <div className="mc-steps">
              {STEPS.map((s, i) => (
                <span key={s} className={i < n ? 'is-on' : ''}>
                  {s}
                </span>
              ))}
            </div>
          </div>
          <motion.div className="mc-new" initial={{ opacity: 0.25 }} animate={{ opacity: done ? 1 : 0.25 }} transition={{ duration: 0.5 }}>
            <div className="mc-row">
              <span className="mc-k is-accent">With Intake</span>
              <span className="mc-n">1<small> message</small></span>
            </div>
            <p className="mc-msg">“Sign-up form for the youth conference. Name, phone, age group, and if they need a bus, ask where to pick them up.”</p>
            <div className="mc-out">
              <i /> A real Google Form, ready to share
            </div>
          </motion.div>
        </div>
      </div>
    </section>
  );
}

const G = PROVIDERS.google.color;

export function MSteps() {
  return (
    <section className="section m-sec" id="how">
      <div className="wrap">
        <SectionHead
          n="02"
          kicker="How it works"
          title={
            <>
              Three steps.
              <br />
              <em>That’s it.</em>
            </>
          }
        />
        <ol className="msteps">
          <Reveal className="mstep">
            <span className="mstep-n">1</span>
            <div>
              <h3>Connect your account</h3>
              <p>Sign in with Google or Microsoft. Your forms stay there.</p>
              <span className="mstep-chip" style={{ '--pv': G } as CSSProperties}>
                <i /> Google Forms <b>✓ connected</b>
              </span>
            </div>
          </Reveal>
          <Reveal className="mstep" delay={0.06}>
            <span className="mstep-n">2</span>
            <div>
              <h3>Say what you need</h3>
              <p>Like you’d text a friend.</p>
              <span className="mstep-bubble">RSVP for my 30th. Name, plus-one, any allergies.</span>
            </div>
          </Reveal>
          <Reveal className="mstep" delay={0.12}>
            <span className="mstep-n">3</span>
            <div>
              <h3>Share the link</h3>
              <p>A real form appears in your account. Responses come in like normal.</p>
              <span className="mstep-link">
                <code>forms.gle/tolu-30th</code>
                <b>Copy</b>
              </span>
            </div>
          </Reveal>
        </ol>
        <Reveal className="mstep-after">
          Need a change later? <b>Just ask.</b> “Make church optional” updates the live form.
        </Reveal>
      </div>
    </section>
  );
}

const PROMISES = ['It lives in your own account', 'Responses go straight to Google or Microsoft', 'Edit it by hand anytime', 'Disconnect in one tap'];

export function MWhere() {
  return (
    <section className="section m-sec" id="where">
      <div className="wrap">
        <SectionHead
          n="04"
          kicker="Where your forms live"
          title={
            <>
              Your forms.
              <br />
              <em>Your</em> account.
            </>
          }
          lede="Intake doesn’t host forms or keep your responses. It just does the setup for you."
        />
        <Reveal className="mw">
          <div className="mw-pv" style={{ '--pv': PROVIDERS.google.color } as CSSProperties}>
            <i /> Google Forms <span className="is-live">First up</span>
          </div>
          <div className="mw-pv" style={{ '--pv': PROVIDERS.microsoft.color } as CSSProperties}>
            <i /> Microsoft Forms <span>Up next</span>
          </div>
          <ul className="mw-list">
            {PROMISES.map((p) => (
              <li key={p}>
                <span>✓</span>
                {p}
              </li>
            ))}
          </ul>
        </Reveal>
      </div>
    </section>
  );
}
