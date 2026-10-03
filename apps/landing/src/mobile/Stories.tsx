import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PROVIDERS, type Provider } from '../lib/providers';

/**
 * Mobile-only scripted preview. It illustrates form-request and edit-proposal
 * flows without connecting an account or calling Google Forms.
 */

interface Row {
  label: string;
  type: string;
  required?: boolean;
  cond?: string;
}

interface Base {
  id: string;
  label: string;
  provider: Provider;
  prompt: string;
  reply: string;
  title: string;
}
interface CreateStory extends Base {
  kind: 'create';
  rows: Row[];
}
interface EditStory extends Base {
  kind: 'edit';
  rows: Row[];
  optionalIndex: number;
  added: Row;
}
type Story = CreateStory | EditStory;

const STORIES: Story[] = [
  {
    id: 'conf',
    kind: 'create',
    label: 'Make a form',
    provider: 'google',
    prompt: 'Registration for our youth conference. Name, phone, age group, church, and if they need a bus, ask where to pick them up.',
    reply: 'Got it. 6 questions, plus a follow-up for anyone who needs the bus.',
    title: 'Youth Conference Registration',
    rows: [
      { label: 'Full name', type: 'Short answer', required: true },
      { label: 'Phone number', type: 'Short answer', required: true },
      { label: 'Age group', type: 'Multiple choice · one answer' },
      { label: 'Church', type: 'Short answer' },
      { label: 'Need transportation?', type: 'Multiple choice · one answer' },
      { label: 'Pickup location', type: 'Short answer', cond: 'only if they say Yes' },
    ],
  },
  {
    id: 'edit',
    kind: 'edit',
    label: 'Change it',
    provider: 'google',
    prompt: 'Make email optional and ask how they heard about it.',
    reply: 'Here is a change proposal. Review it before confirming the update.',
    title: 'Rooftop Launch · RSVP',
    rows: [
      { label: 'Full name', type: 'Short answer', required: true },
      { label: 'Email address', type: 'Short answer · no format validation', required: true },
      { label: 'Age group', type: 'Multiple choice · one answer' },
      { label: 'Bringing a guest?', type: 'Multiple choice · one answer' },
    ],
    optionalIndex: 1,
    added: { label: 'How did you hear about it?', type: 'Multiple choice · one answer' },
  },
];

const CPS = 30; // typing speed

function timeline(s: Story) {
  const typeStart = s.kind === 'edit' ? 1.3 : 0.5;
  const typeEnd = typeStart + s.prompt.length / CPS;
  const send = typeEnd + 0.35;
  const dots = send + 0.35;
  const reply = send + 1.5;
  if (s.kind === 'create') {
    const card = reply + 0.45;
    const rowAt = s.rows.map((_, i) => card + 0.45 + i * 0.3);
    const live = rowAt[rowAt.length - 1] + 0.7;
    return { typeStart, typeEnd, send, dots, reply, card, rowAt, live, change: 0, end: live + 3.4 };
  }
  const change = reply - 0.25;
  return { typeStart, typeEnd, send, dots, reply, card: 0, rowAt: [], live: 0, copied: 0, change, end: reply + 3.6 };
}

export function Stories() {
  const reduce = useMemo(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches, []);
  // Story index and its clock live together so switching stories can never see a stale time.
  const [{ idx, t }, setState] = useState(() => ({ idx: 0, t: reduce ? timeline(STORIES[0]).end - 1.5 : 0 }));
  const [inView, setInView] = useState(false);
  const [held, setHeld] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const downAt = useRef(0);
  const s = STORIES[idx];
  const tl = useMemo(() => timeline(s), [s]);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => setInView(e.isIntersecting), { threshold: 0.35 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  const startOf = (i: number) => (reduce ? timeline(STORIES[i]).end - 1.5 : 0);
  const show = (i: number) => {
    const n = (i + STORIES.length) % STORIES.length;
    setState({ idx: n, t: startOf(n) });
  };

  const playing = inView && !held && !reduce;
  useEffect(() => {
    if (!playing) return;
    let raf = 0;
    let last = performance.now();
    const f = (now: number) => {
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      setState((st) => {
        const nt = st.t + dt;
        if (nt < timeline(STORIES[st.idx]).end) return { idx: st.idx, t: nt };
        return { idx: (st.idx + 1) % STORIES.length, t: 0 };
      });
      raf = requestAnimationFrame(f);
    };
    raf = requestAnimationFrame(f);
    return () => cancelAnimationFrame(raf);
  }, [playing]);

  const go = (d: number) => show(idx + d);

  const P = PROVIDERS[s.provider];
  const typed = t < tl.typeStart ? '' : s.prompt.slice(0, Math.floor((t - tl.typeStart) * CPS));
  const sent = t >= tl.send;
  const showDots = t >= tl.dots && t < tl.reply;
  const showReply = t >= tl.reply;

  return (
    <div className="ms" ref={ref} style={{ '--pv': P.color } as CSSProperties}>
      <div className="ms-bars">
        {STORIES.map((x, i) => (
          <span key={x.id} className="ms-bar">
            <i style={{ transform: `scaleX(${i < idx ? 1 : i > idx ? 0 : Math.min(1, t / tl.end)})` }} />
          </span>
        ))}
      </div>
      <div className="ms-head">
        <span className="ms-app">
          <span className="ms-logo">
            <svg width="14" height="14" viewBox="0 0 64 64" aria-hidden>
              <circle cx="32" cy="19" r="8" fill="#ff5a1f" />
              <rect x="16" y="32" width="32" height="8" rx="4" fill="currentColor" />
              <rect x="16" y="45" width="20" height="8" rx="4" fill="currentColor" opacity=".45" />
            </svg>
          </span>
          <span>
            <b>Intake</b>
            <small>{s.label}</small>
          </span>
        </span>
        <span className="ms-conn">
          <i /> {P.name}
        </span>
      </div>

      <div
        className="ms-thread"
        onPointerDown={() => {
          downAt.current = performance.now();
          setHeld(true);
        }}
        onPointerUp={(e) => {
          setHeld(false);
          if (performance.now() - downAt.current > 350) return; // that was a hold, not a tap
          const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
          go(e.clientX - r.left < r.width * 0.3 ? -1 : 1);
        }}
        onPointerLeave={() => setHeld(false)}
        onPointerCancel={() => setHeld(false)}
      >
        <AnimatePresence>
          {s.kind === 'create' && !sent && (
            <motion.div key={`empty-${s.id}`} className="ms-empty" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0, y: -12 }} transition={{ duration: 0.3 }}>
              <span className="ms-empty-logo">
                <svg width="26" height="26" viewBox="0 0 64 64" aria-hidden>
                  <circle cx="32" cy="19" r="8" fill="#ff5a1f" />
                  <rect x="16" y="32" width="32" height="8" rx="4" fill="currentColor" />
                  <rect x="16" y="45" width="20" height="8" rx="4" fill="currentColor" opacity=".45" />
                </svg>
              </span>
              <b>What do you want to ask people?</b>
              <span>Intake prepares a {P.name} proposal for review.</span>
            </motion.div>
          )}
        </AnimatePresence>
        <div className="ms-scroll">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={s.id} className="ms-msgs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <div className="ms-sys">
                Scripted example · no real Google account is connected
              </div>

              {s.kind === 'edit' && <FormCard s={s} t={t} tl={tl} />}

              {sent && (
                <motion.div layout className="ms-bubble ms-me" initial={{ opacity: 0, y: 16, scale: 0.94 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 380, damping: 30 }}>
                  {s.prompt}
                </motion.div>
              )}
              {showDots && (
                <motion.div layout className="ms-bubble ms-bot ms-dots" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  <i />
                  <i />
                  <i />
                </motion.div>
              )}
              {showReply && (
                <motion.div layout className="ms-bubble ms-bot" initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
                  {s.reply}
                </motion.div>
              )}
              {s.kind === 'create' && t >= tl.card && <FormCard s={s} t={t} tl={tl} />}
            </motion.div>
          </AnimatePresence>
        </div>
      </div>

      <div className="ms-composer">
        <span className={`ms-input ${typed && !sent ? 'is-typing' : ''}`}>
          {!sent && typed ? (
            <>
              {typed.length > 46 ? '…' + typed.slice(-46) : typed}
              <i className="caret" />
            </>
          ) : (
            <span className="ms-ph">Describe a form…</span>
          )}
        </span>
        <span className={`ms-send ${typed && !sent ? 'is-on' : ''}`}>↑</span>
      </div>

      <div className="ms-nav">
        {STORIES.map((x, i) => (
          <button key={x.id} className={i === idx ? 'on' : ''} onClick={() => show(i)}>
            {x.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function FormCard({ s, t, tl }: { s: Story; t: number; tl: ReturnType<typeof timeline> }) {
  const P = PROVIDERS[s.provider];
  const isEdit = s.kind === 'edit';
  const changed = isEdit && t >= tl.change;
  const complete = isEdit ? changed : t >= tl.live;
  const proposing = isEdit && t >= tl.send && t < tl.change + 0.3;
  const rows: (Row & { isNew?: boolean; flash?: boolean })[] = isEdit
    ? [
        ...s.rows.map((r, i) => (changed && i === (s as EditStory).optionalIndex ? { ...r, required: false, flash: true } : r)),
        ...(changed ? [{ ...(s as EditStory).added, isNew: true }] : []),
      ]
    : s.rows.filter((_, i) => t >= tl.rowAt[i]);

  return (
    <motion.div layout className="mcard" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 28 }}>
      <div className="mcard-strip">
        <span className="mcard-app">
          <i /> {P.name}
        </span>
        <span className="mcard-state">
          {proposing ? (
            <>
              <span className="spin sm" /> Preparing proposal…
            </>
          ) : complete ? (
            <>{isEdit ? 'Proposal · not applied' : 'Example · not created'}</>
          ) : isEdit ? (
            <>Existing form · example</>
          ) : (
            <>
              <span className="spin sm" /> Preparing example…
            </>
          )}
        </span>
      </div>
      <div className="mcard-band" />
      <div className="mcard-body">
        <b className="mcard-title">{s.title}</b>
        <AnimatePresence initial={false}>
          {rows.map((r) => (
            <motion.div
              key={r.label}
              layout
              className={`mrow ${r.cond ? 'is-cond' : ''} ${r.isNew ? 'is-new' : ''} ${r.flash ? 'is-flash' : ''}`}
              initial={{ opacity: 0, height: 0 }}
              animate={{ opacity: 1, height: 'auto' }}
              transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
            >
              <div className="mrow-in">
                {r.cond && <small>↳ {r.cond}</small>}
                <span className="mrow-l">
                  {r.label}
                  {r.required && <em>*</em>}
                  {r.flash && <span className="mrow-tag">optional</span>}
                  {r.isNew && <span className="mrow-tag is-new">new</span>}
                </span>
                <span className="mrow-t">{r.type}</span>
              </div>
            </motion.div>
          ))}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {!isEdit && t >= tl.live && (
          <motion.p className="mcard-share" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            Scripted example only. No Google Form or responder link is created here.
          </motion.p>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
