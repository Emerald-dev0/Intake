import { AnimatePresence, motion } from 'motion/react';
import { Paper } from '../components/Paper';
import { countBefore } from './engine';
import { fieldsAt, type EditScene, type EditTimeline } from './scenes';
import { Caption, Composer, StageTop, Tick } from './parts';
import { PROVIDERS } from '../lib/providers';
import type { CSSProperties } from 'react';

export function EditStage({ scene: s, tl, t, portrait }: { scene: EditScene; tl: EditTimeline; t: number; portrait: boolean }) {
  const { fields, version } = fieldsAt(s, tl, t);
  const active = [...tl.cmds].reverse().find((c) => t >= c.typeStart) ?? null;
  const typing = active && t < active.send ? active.cmd.text.slice(0, countBefore(active.charTimes, t)) : '';
  const flashCmd = tl.cmds.find((c) => t >= c.applyAt && t < c.applyAt + 1.4);
  const lastApplied = [...tl.cmds].reverse().find((c) => t >= c.applyAt);
  const chapter = [...tl.chapters].reverse().find((c) => t >= c.start) ?? tl.chapters[0];
  const P = PROVIDERS[s.provider];

  return (
    <div className={`st ${portrait ? 'st--portrait' : ''}`}>
      <StageTop title={s.base.title} status="Scripted preview" provider={s.provider} />
      <div className="st-body">
        <aside className="st-chat">
          <div className="st-thread">
            <motion.div layout className="ready is-compact">
              <div className="ready-top">
                {P.name} · existing-form example only
              </div>
              <div className="ready-meta">No provider account is connected; no real form or response data is shown.</div>
            </motion.div>
            <AnimatePresence initial={false}>
              {tl.cmds.flatMap((c, i) => {
                const out = [];
                if (t >= c.send)
                  out.push(
                    <motion.div key={`u${i}`} layout className="msg msg-user is-short" initial={{ opacity: 0, y: 24, scale: 0.96 }} animate={{ opacity: 1, y: 0, scale: 1 }}>
                      {c.cmd.text}
                    </motion.div>,
                  );
                if (t >= c.opAt)
                  out.push(
                    <motion.div key={`o${i}`} layout className="opcard" initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }}>
                      <div className="opcard-head">
                        <span className={`step-icon ${t >= c.syncedAt ? '' : 'is-busy'}`}>{t >= c.syncedAt ? <Tick /> : <span className="spin" />}</span>
                        {t >= c.syncedAt ? 'Example proposal revised · not applied' : t >= c.applyAt ? 'Revising the local example…' : 'Preparing change proposal'}
                      </div>
                      <code className="opcard-code">{c.cmd.op}</code>
                    </motion.div>,
                  );
                return out;
              })}
            </AnimatePresence>
          </div>
          <Composer text={typing} active={!!active && t < active.send} pressing={!!active && t >= active.send - 0.18 && t < active.send + 0.1} placeholder="Describe a change to this example…" />
        </aside>
        <div className="st-canvas">
          <div className="st-canvas-grid" />
          <div className="st-seg">
            <span className="on">Builder</span>
            <span>Preview</span>
            <i />
          </div>
          <div className="st-paper-slot">
            <div className="st-paper-anim">
              <Paper
                provider={s.provider}
                stripState="draft"
                title={s.base.title}
                description={s.base.description}
                fields={fields}
                mode="builder"
                flash={flashCmd?.cmd.flash ?? null}
                focus={lastApplied?.cmd.flash ?? null}
                focusAlign="center"
                autoScroll
                stamp
                stampLabel="Example"
                stampSub="Not applied"
              />
            </div>
          </div>
          {!portrait && (
            <div className="difflog" style={{ '--pv': P.color } as CSSProperties}>
              <div className="spec-head">
                <span className="spec-file">
                  <span className="spec-ic">↻</span> Example proposal
                </span>
                <span className="spec-badge is-valid">{version - 3 ? `${version - 3} so far` : 'none yet'}</span>
              </div>
              <div className="difflog-body">
                <div className="dl-row is-base">Example baseline · {s.base.fields.length} questions</div>
                <AnimatePresence initial={false}>
                  {tl.cmds.map((c, i) =>
                    t >= c.applyAt ? (
                      <motion.div key={i} className="dl-row" initial={{ opacity: 0, x: 12 }} animate={{ opacity: 1, x: 0 }}>
                        <span>{String(i + 1).padStart(2, '0')}</span>
                        <code>{c.cmd.op}</code>
                        <em>{t >= c.syncedAt ? 'prepared for review' : 'updating example…'}</em>
                      </motion.div>
                    ) : null,
                  )}
                </AnimatePresence>
              </div>
              <div className="spec-foot">
                <span>Local example only · nothing sent to Google</span>
                <span>{fields.length} questions</span>
              </div>
            </div>
          )}
          <Caption idx={tl.chapters.indexOf(chapter)} total={tl.chapters.length} label={chapter.label} text={chapter.caption} />
        </div>
      </div>
    </div>
  );
}
