import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Paper } from '../components/Paper';
import { Highlighted } from '../components/Highlighted';
import { TYPE_LABEL, type Answers, type Field } from '../lib/types';
import { PROVIDERS } from '../lib/providers';
import { countBefore, easeInOut, prog } from './engine';
import type { CreateScene, CreateTimeline, RespondAction } from './scenes';
import { Composer, AccountPanel, StageTop, Step, Caption, ReadyCard, Check } from './parts';

export function CreateStage({
  scene: s,
  tl,
  t,
  portrait,
  scale,
}: {
  scene: CreateScene;
  tl: CreateTimeline;
  t: number;
  portrait: boolean;
  scale: number;
}) {
  const canvasRef = useRef<HTMLDivElement>(null);
  const cursorRef = useRef<HTMLDivElement>(null);

  /* ── derived state ── */
  const typed = t < tl.send ? s.prompt.slice(0, countBefore(tl.charTimes, t)) : '';
  const sent = t >= tl.send;
  const nVisible = countBefore(tl.fieldTimes, t);
  const fields = s.spec.fields.slice(0, nVisible);
  const titleChars = Math.round(prog(t, tl.titleStart, tl.titleEnd - tl.titleStart) * s.spec.title.length);
  const mode: 'builder' | 'preview' = t >= tl.previewAt ? 'preview' : 'builder';

  const answers: Answers = {};
  let typingField: string | null = null;
  for (const a of tl.actions) {
    if (t < a.click) continue;
    const act = a.action;
    if (act.kind === 'click') {
      const f = s.spec.fields.find((x) => x.id === act.field);
      if (f?.type === 'multiple_choice') {
        const cur = (answers[act.field] as string[] | undefined) ?? [];
        answers[act.field] = [...cur, act.option];
      } else answers[act.field] = act.option;
    } else if (act.kind === 'star') answers[act.field] = act.value;
    else {
      answers[act.field] = act.text.slice(0, countBefore(a.typeTimes, t));
      if (t < a.done + 1.2) typingField = act.field;
    }
  }

  let focus: string | null = fields.length ? fields[fields.length - 1].id : null;
  let focusAlign: 'bottom' | 'center' = 'bottom';
  if (mode === 'preview' && tl.actions.length) {
    const cur = [...tl.actions].reverse().find((a) => t >= a.moveStart) ?? tl.actions[0];
    focus = cur.action.field;
    focusAlign = 'center';
  }

  const status =
    t < tl.typeStart ? 'Ready' : !sent ? 'Typing' : t < tl.planStart ? 'Thinking' : t < tl.validateStart ? 'Drafting' : t < tl.createStart ? 'Checking' : t < tl.ready ? 'Creating' : 'Live';

  const chapter = [...tl.chapters].reverse().find((c) => t >= c.start) ?? tl.chapters[0];
  const chapterIdx = tl.chapters.indexOf(chapter);

  /* ── cursor (measured every frame, applied imperatively) ── */
  useLayoutEffect(() => {
    const canvas = canvasRef.current;
    const cur = cursorRef.current;
    if (!canvas || !cur) return;
    const cb = canvas.getBoundingClientRect();
    const rest = { x: canvas.clientWidth * 0.82, y: canvas.clientHeight * 0.86 };
    const measure = (a: RespondAction | undefined) => {
      if (!a) return null;
      const sel = a.kind === 'type' ? `[data-input="${a.field}"]` : a.kind === 'star' ? `[data-opt="${a.field}:${a.value}"]` : `[data-opt="${a.field}:${a.option}"]`;
      const el = canvas.querySelector<HTMLElement>(sel);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      const x = (r.left - cb.left) / scale + (a.kind === 'type' ? 40 : a.kind === 'star' ? r.width / scale / 2 : 16);
      const y = (r.top - cb.top) / scale + r.height / scale / 2;
      return { x, y };
    };
    let k = -1;
    tl.actions.forEach((a, i) => {
      if (t >= a.moveStart) k = i;
    });
    let pos = rest;
    if (k >= 0) {
      const a = tl.actions[k];
      const from = (k > 0 ? measure(tl.actions[k - 1].action) : null) ?? rest;
      const to = measure(a.action) ?? from;
      const p = easeInOut(prog(t, a.moveStart, a.arrive - a.moveStart));
      pos = { x: from.x + (to.x - from.x) * p, y: from.y + (to.y - from.y) * p - Math.sin(p * Math.PI) * 30 };
    }
    cur.style.transform = `translate3d(${pos.x}px, ${pos.y}px, 0)`;
  });

  const clicking = tl.actions.some((a) => t >= a.click && t < a.click + 0.45);
  const clickP = (() => {
    const a = tl.actions.find((a) => t >= a.click && t < a.click + 0.45);
    return a ? (t - a.click) / 0.45 : 0;
  })();

  const understandOpen = t < tl.planStart;
  const planOpen = t < tl.validateStart;
  const validateOpen = t < tl.createStart;
  const createOpen = t < tl.ready + 0.5;
  const hlOn = (i: number) => t >= tl.hlTimes[i];
  const conds = s.spec.fields.filter((f) => f.when).length;
  const req = s.spec.fields.filter((f) => f.required).length;
  const P = PROVIDERS[s.provider];

  return (
    <div className={`st ${portrait ? 'st--portrait' : ''}`}>
      <StageTop title={t >= tl.titleEnd ? s.spec.title : 'New form'} status={status} provider={s.provider} account={s.account} />
      <div className="st-body">
        <aside className="st-chat">
          <div className="st-thread">
            <motion.div layout className="sys-line" style={{ '--pv': P.color } as CSSProperties}>
              <span className="st-conn-dot" /> Connected to {P.name} · {s.account}
            </motion.div>
            <AnimatePresence initial={false}>
              {sent && (
                <motion.div key="u" layout className="msg msg-user" initial={{ opacity: 0, y: 30, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
                  <Highlighted text={s.prompt} highlights={s.highlights} active={hlOn} />
                </motion.div>
              )}
              {t >= tl.interpStart && (
                <Step key="understand" open={understandOpen} done={t >= tl.hlTimes[tl.hlTimes.length - 1] + 0.3} label={understandOpen ? 'Reading your request' : `Got it · ${s.spec.fields.length} questions, ${conds} follow-up${conds === 1 ? '' : 's'}`}>
                  <div className="chips">
                    {s.highlights.map((h, i) =>
                      hlOn(i) ? (
                        <motion.span key={i} className={`chip chip-${h.kind}`} initial={{ opacity: 0, scale: 0.6, y: 6 }} animate={{ opacity: 1, scale: 1, y: 0 }}>
                          {h.tag}
                        </motion.span>
                      ) : null,
                    )}
                  </div>
                </Step>
              )}
              {tl.clarify && s.clarify && t >= tl.clarify.ask && t < tl.planStart + 0.01 && (
                <motion.div key="clarify" layout className="msg msg-agent" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  <p>{s.clarify.question}</p>
                  <div className="quick">
                    {s.clarify.options.map((o, i) => (
                      <span key={o} className={`quick-opt ${i === s.clarify!.pick && t >= tl.clarify!.pick ? 'is-picked' : ''} ${t >= tl.clarify!.pick && i !== s.clarify!.pick ? 'is-dim' : ''}`}>
                        {o}
                      </span>
                    ))}
                  </div>
                </motion.div>
              )}
              {tl.clarify && s.clarify && t >= tl.clarify.answer && t < tl.planStart + 0.01 && (
                <motion.div key="clarify-a" layout className="msg msg-user is-short" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, height: 0 }}>
                  {s.clarify.options[s.clarify.pick]}
                </motion.div>
              )}
              {t >= tl.planStart && (
                <Step key="plan" open={planOpen} done={t >= tl.planEnd - 0.2} label={planOpen ? `Drafting questions · ${nVisible}/${s.spec.fields.length}` : `Drafted ${s.spec.fields.length} questions · ${req} required`}>
                  <div className="mini-list">
                    {fields.map((f: Field) => (
                      <motion.div key={f.id} className="mini-row" initial={{ opacity: 0, x: -8 }} animate={{ opacity: 1, x: 0 }}>
                        <span className="mini-id">{f.label}</span>
                        <span className="mini-type">{TYPE_LABEL[f.type]}</span>
                      </motion.div>
                    ))}
                  </div>
                </Step>
              )}
              {t >= tl.validateStart && (
                <Step key="validate" open={validateOpen} done={t >= tl.validateEnd - 0.15} label={validateOpen ? 'Double-checking' : 'All good · 4/4 checks'}>
                  <div className="checks">
                    {tl.checks.map((c, i) => (
                      <Check key={c} on={t >= tl.checkTimes[i]} label={c} />
                    ))}
                  </div>
                </Step>
              )}
              {t >= tl.createStart && (
                <Step key="create" open={createOpen} done={t >= tl.createEnd - 0.15} label={createOpen ? `Creating it in your ${P.name}` : `Created in your ${P.name}`}>
                  <div className="ops">
                    {tl.ops.map((o, i) =>
                      t >= tl.opTimes[i] ? (
                        <motion.div key={o} className="op" initial={{ opacity: 0 }} animate={{ opacity: 1 }}>
                          <span className="op-ok">✓</span>
                          {o}
                        </motion.div>
                      ) : null,
                    )}
                    <div className="op-bar">
                      <i style={{ transform: `scaleX(${prog(t, tl.createStart, tl.createEnd - tl.createStart)})` }} />
                    </div>
                  </div>
                </Step>
              )}
              {t >= tl.ready && <ReadyCard key="ready" url={s.url} provider={s.provider} />}
            </AnimatePresence>
          </div>
          <Composer text={typed} active={t >= tl.typeStart - 0.3 && !sent} pressing={t >= tl.send - 0.18 && t < tl.send + 0.1} />
        </aside>

        <div className="st-canvas" ref={canvasRef}>
          <div className="st-canvas-grid" />
          <div className="st-seg">
            <span className={mode === 'builder' ? 'on' : ''}>Builder</span>
            <span className={mode === 'preview' ? 'on' : ''}>Preview</span>
            <i style={{ transform: `translateX(${mode === 'preview' ? '100%' : '0'})` }} />
          </div>
          <div className="st-paper-slot">
            <AnimatePresence mode="wait">
              {t < tl.planStart ? (
                <motion.div key="empty" className="st-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, scale: 0.97 }}>
                  <div className="st-empty-box">
                    <span className="st-empty-dot" />
                    <p>{sent ? 'Reading your request…' : 'Your form appears here'}</p>
                    <div className="st-empty-lines">
                      <i /> <i /> <i />
                    </div>
                  </div>
                </motion.div>
              ) : (
                <motion.div key="paper" className="st-paper-anim" initial={{ opacity: 0, y: 40, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ duration: 0.6, ease: [0.22, 1, 0.36, 1] }}>
                  <Paper
                    provider={s.provider}
                    stripState={t >= tl.ready ? 'live' : t >= tl.createStart ? 'creating' : 'draft'}
                    stripUrl={mode === 'preview' ? s.url : s.editUrl}
                    title={s.spec.title.slice(0, titleChars)}
                    showTitleCaret={t < tl.titleEnd + 0.2}
                    description={t >= tl.titleEnd ? s.spec.description : undefined}
                    fields={fields}
                    allFields={s.spec.fields}
                    mode={mode}
                    answers={answers}
                    typingField={typingField}
                    focus={focus}
                    focusAlign={focusAlign}
                    autoScroll
                    stamp={t >= tl.ready + 0.2}
                    syncing={t >= tl.createStart && t < tl.ready}
                    scan={t >= tl.validateStart && t < tl.validateEnd ? prog(t, tl.validateStart, tl.validateEnd - tl.validateStart) : null}
                  />
                </motion.div>
              )}
            </AnimatePresence>
          </div>
          {!portrait && (
            <AccountPanel
              provider={s.provider}
              account={s.account}
              newTitle={s.spec.title}
              state={t < tl.planStart ? 'waiting' : t < tl.createStart ? 'draft' : t < tl.ready ? 'creating' : 'live'}
              progress={prog(t, tl.createStart, tl.createEnd - tl.createStart)}
              shareUrl={s.url}
              editUrl={s.editUrl}
            />
          )}
          <div className={`cursor ${t >= tl.previewAt + 0.35 ? 'is-on' : ''}`} ref={cursorRef}>
            {clicking && <span className="cursor-ripple" style={{ transform: `scale(${0.3 + clickP * 1.6})`, opacity: 1 - clickP }} />}
            <svg width="22" height="24" viewBox="0 0 22 24" style={{ transform: `scale(${clicking && clickP < 0.35 ? 0.86 : 1})` }}>
              <path d="M2 1.5l17 9.6-7.3 1.7 4.2 8-3.1 1.6-4.2-8L3.3 19z" fill="#0c0c0b" stroke="#fff" strokeWidth="1.6" strokeLinejoin="round" />
            </svg>
          </div>
          <Caption idx={chapterIdx} total={tl.chapters.length} label={chapter.label} text={chapter.caption} />
        </div>
      </div>
    </div>
  );
}
