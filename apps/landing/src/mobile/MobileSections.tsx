import { motion, useInView } from 'motion/react';
import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { SectionHead, Reveal } from '../components/SectionHead';
import { Audience } from '../components/Audience';
import { ExampleCommands } from '../components/ExampleCommands';
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
              You know what to ask.
              <br />
              Building it is the <em>tedious part.</em>
            </>
          }
          lede="For a final-year project, you might spend 20–30 minutes building a questionnaire by hand. That’s an illustration, not a measured saving."
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
            <p className="mc-msg">“Create a registration form for my final-year project. Ask for name, email, department, level, phone number and whether they need accommodation. If yes, ask what type.”</p>
            <div className="mc-out">
              <i /> One request → a structured form (concept)
            </div>
          </motion.div>
        </div>
        <p className="mc-preview">Name · Email · Department · Level · Phone<br />Need accommodation? → If yes: what type?</p>
        <Audience />
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
          lede="Scripted walkthrough of the Google-only workspace flow. The animation does not connect an account or create a form; live use still needs setup and verification."
        />
        <ol className="msteps">
          <Reveal className="mstep">
            <span className="mstep-n">1</span>
            <div>
              <h3>Connect Google</h3>
              <p>After signing in, connect Google separately in the workspace. Microsoft Forms creation is unavailable.</p>
              <span className="mstep-chip" style={{ '--pv': G } as CSSProperties}>
                <i /> Google Forms <b>supported</b>
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
              <p>After you review and confirm, Intake returns the Google Form link. This sample link is illustrative, not a created form.</p>
              <span className="mstep-link">
                <code>forms.gle/tolu-30th</code>
                <b>Copy</b>
              </span>
            </div>
          </Reveal>
        </ol>
        <Reveal className="mstep-after">
          Before creation, need a change? <b>Just ask.</b> After creation, edit the real form in Google Forms.
        </Reveal>
        <div className="m-commands"><h3>What can I ask Intake to do?</h3><ExampleCommands /></div>
      </div>
    </section>
  );
}

const PROMISES = ['Real forms in your connected Google account', 'Responses stay with Google Forms', 'Edit the created form in Google', 'Separate Google consent and explicit confirmation'];

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
          lede="Intake connects to Google separately from your login. The workspace implements creation in Google Forms; Microsoft creation is not supported."
        />
        <Reveal className="mw">
          <div className="mw-pv" style={{ '--pv': PROVIDERS.google.color } as CSSProperties}>
            <i /> Google Forms <span>Supported</span>
          </div>
          <div className="mw-pv" style={{ '--pv': PROVIDERS.microsoft.color } as CSSProperties}>
            <i /> Microsoft Forms <span>Creation unavailable</span>
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
