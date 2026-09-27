import { AnimatePresence, motion } from 'motion/react';
import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { PROVIDERS, type Provider } from '../lib/providers';

/**
 * Mobile-only demo. Instead of shrinking the desktop reels, the phone gets a
 * chat you'd actually see on a phone, told as tap-through "stories".
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
  account: string;
  prompt: string;
  reply: string;
  title: string;
  url: string;
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
    account: 'ada.okafor@gmail.com',
    prompt: 'Registration for our youth conference. Name, phone, age group, church, and if they need a bus, ask where to pick them up.',
    reply: 'Got it. 6 questions, plus a follow-up for anyone who needs the bus.',
    title: 'Youth Conference Registration',
    url: 'forms.gle/yc26-register',
    rows: [
      { label: 'Full name', type: 'Short answer', required: true },
      { label: 'Phone number', type: 'Phone', required: true },
      { label: 'Age group', type: 'Choice' },
      { label: 'Church', type: 'Short answer' },
      { label: 'Need transportation?', type: 'Yes / No' },
      { label: 'Pickup location', type: 'Short answer', cond: 'only if they say Yes' },
    ],
  },
  {
    id: 'ms',
    kind: 'create',
    label: 'Microsoft too',
    provider: 'microsoft',
    account: 'hello@mamaputkitchen.ng',
    prompt: 'Feedback form for Mama Put Kitchen. Rate the food and service out of 5. If service is below 3, ask what went wrong. Keep it anonymous.',
    reply: 'On it. Star ratings, no names, and a follow-up only after a bad score.',
    title: 'How was your meal?',
    url: 'forms.office.com/r/MamaPut5',
    rows: [
      { label: 'Rate the food', type: 'Rating ★' },
      { label: 'Rate the service', type: 'Rating ★' },
      { label: 'What went wrong?', type: 'Paragraph', cond: 'only if service is below 3' },
      { label: 'What did you order?', type: 'Short answer' },
      { label: 'Anything we could improve?', type: 'Paragraph' },
    ],
  },
  {
    id: 'edit',
    kind: 'edit',
    label: 'Change it',
    provider: 'google',
    account: 'kemi.events@gmail.com',
    prompt: 'Make email optional and ask how they heard about it.',
    reply: 'Done. Saved to your Google Form.',
    title: 'Rooftop Launch · RSVP',
    url: 'forms.gle/rooftop-rsvp',
    rows: [
      { label: 'Full name', type: 'Short answer', required: true },
      { label: 'Email', type: 'Email', required: true },
      { label: 'Age', type: 'Number' },
      { label: 'Bringing a guest?', type: 'Yes / No' },
    ],
    optionalIndex: 1,
    added: { label: 'How did you hear about it?', type: 'Choice' },
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
    const copied = live + 1.3;
    return { typeStart, typeEnd, send, dots, reply, card, rowAt, live, copied, change: 0, end: live + 3.4 };
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
        <div className="ms-scroll">
          <AnimatePresence mode="popLayout" initial={false}>
            <motion.div key={s.id} className="ms-msgs" initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.25 }}>
              <div className="ms-sys">
                Signed in as <b>{s.account}</b>
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
  const live = isEdit || t >= tl.live;
  const changed = isEdit && t >= tl.change;
  const saving = isEdit && t >= tl.send && t < tl.change + 0.3;
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
          {saving ? (
            <>
              <span className="spin sm" /> Saving…
            </>
          ) : live ? (
            <>
              <svg width="9" height="9" viewBox="0 0 12 12" aria-hidden>
                <rect x="2" y="5.5" width="8" height="5.5" rx="1.3" fill="currentColor" />
                <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
              </svg>
              {isEdit ? 'Live · 38 responses' : 'Live'}
            </>
          ) : (
            <>
              <span className="spin sm" /> Creating in your account…
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
          <motion.div className="mcard-share" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: 'auto' }}>
            <div className="mcard-share-in">
              <code>{s.url}</code>
              <span className={t >= tl.copied ? 'is-copied' : ''}>{t >= tl.copied ? 'Copied ✓' : 'Copy link'}</span>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}
