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
    <section className="section m-sec" id="what-is-intake" aria-labelledby="what-is-intake-title">
      <div className="wrap">
        <SectionHead
          n="01"
          kicker="What is Intake?"
          titleId="what-is-intake-title"
          title={<>A natural-language workspace for Google Forms.</>}
          lede="Intake turns a plain-language request into a structured Google Forms draft. Review and revise it before confirming creation. Intake also prepares reviewable, natural-language edits to existing Google Forms."
        />
        <div className="mc" ref={ref}>
          <div className="mc-old">
            <div className="mc-row">
              <span className="mc-k">Manual setup · illustration</span>
              <span className="mc-n">{n}<small>/12 example tasks</small></span>
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
              <span className="mc-n">1<small> initial request</small></span>
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
    <section className="section m-sec" id="how" aria-labelledby="how-title">
      <div className="wrap">
        <SectionHead
          n="02"
          kicker="How Intake works"
          titleId="how-title"
          title={<>Describe. <em>Review.</em> Confirm.</>}
          lede="1. Describe a new form or a requested edit. 2. Server-side AI interprets the request and creates a structured proposal. 3. Review and revise the proposal. 4. Authorize Google separately and choose the form. 5. Confirm to create a new Google Form or update the same existing form. No provider change happens before confirmation; this animation is only an illustration."
        />
        <ol className="msteps">
          <Reveal className="mstep">
            <span className="mstep-n">1</span>
            <div>
              <h3>Describe the form or change</h3>
              <p>Tell Intake what a new form should collect or what you want to change in an existing Google Form.</p>
              <span className="mstep-chip" style={{ '--pv': G } as CSSProperties}>
                <i /> Google Forms <b>supported</b>
              </span>
            </div>
          </Reveal>
          <Reveal className="mstep" delay={0.06}>
            <span className="mstep-n">2</span>
            <div>
              <h3>Review the structured proposal</h3>
              <p>AI proposes supported questions or edits. You can revise the draft; Google Forms is not changed during this step.</p>
              <span className="mstep-bubble">“Make email optional and add a dietary question.”</span>
            </div>
          </Reveal>
          <Reveal className="mstep" delay={0.12}>
            <span className="mstep-n">3</span>
            <div>
              <h3>Confirm before apply</h3>
              <p>After separate Google authorization, confirmation creates a new form or updates the same existing form.</p>
              <span className="mstep-link">
                <code>Google Forms · review then confirm</code>
                <b>Apply</b>
              </span>
            </div>
          </Reveal>
        </ol>
        <Reveal className="mstep-after">
          To edit an existing form, choose it from your Intake library or provide its Google Forms edit URL. <b>Supported changes are reviewed first and only applied after confirmation.</b>
        </Reveal>
        <div className="m-commands"><h3>What can I ask Intake to do?</h3><ExampleCommands /></div>
      </div>
    </section>
  );
}

const PROMISES = ['Google hosts forms and responses', 'Google authorization is separate from Intake sign-in', 'Review and revise proposals before applying them', 'Edits update the same selected Google Form'];

export function MWhere() {
  return (
    <section className="section m-sec" id="where" aria-labelledby="where-title">
      <div className="wrap">
        <SectionHead
          n="04"
          kicker="Google Forms integration"
          titleId="where-title"
          title={<>Your forms. <em>Your</em> account.</>}
          lede="Intake creates real Google Forms and can propose supported edits to existing forms. You authorize Google separately from your Intake sign-in. Google hosts the response form and its answers; Intake applies a creation or edit only after your explicit confirmation. Live use requires an active Intake service configuration."
        />
        <Reveal className="mw">
          <div className="mw-pv" style={{ '--pv': PROVIDERS.google.color } as CSSProperties}>
            <i /> Google Forms <span>Create and edit</span>
          </div>
          <p className="mw-edit-note">Load an existing form from your Intake library or provide its Google Forms edit URL. Intake reviews supported changes and applies them to that same form after confirmation.</p>
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
