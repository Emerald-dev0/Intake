import { AnimatePresence, motion } from 'motion/react';
import { useLayoutEffect, useRef, type CSSProperties, type ReactNode } from 'react';
import { condLabel, isVisible, TYPE_LABEL, type Answers, type AnswerValue, type Field } from '../lib/types';
import { PROVIDERS, type Provider } from '../lib/providers';

export interface PaperProps {
  title: string;
  description?: string;
  fields: Field[];
  /** All fields (used to resolve conditional labels while fields are still streaming in). */
  allFields?: Field[];
  mode: 'builder' | 'preview';
  answers?: Answers;
  onAnswer?: (id: string, v: AnswerValue) => void;
  typingField?: string | null;
  flash?: string | null;
  focus?: string | null;
  focusAlign?: 'bottom' | 'center';
  autoScroll?: boolean;
  stamp?: boolean;
  syncing?: boolean;
  scan?: number | null;
  showTitleCaret?: boolean;
  empty?: ReactNode;
  className?: string;
  version?: number;
  stampLabel?: string;
  stampSub?: string;
  provider?: Provider;
  stripState?: 'draft' | 'creating' | 'saving' | 'live' | 'preview';
  stripUrl?: string;
}

export function Paper(p: PaperProps) {
  const viewport = useRef<HTMLDivElement>(null);
  const inner = useRef<HTMLDivElement>(null);
  const answers = p.answers ?? {};
  const all = p.allFields ?? p.fields;
  const visible = p.mode === 'preview' ? p.fields.filter((f) => isVisible(f, answers)) : p.fields;

  // Auto-scroll: keep the focused field in view (reel mode). Measured every render.
  useLayoutEffect(() => {
    if (!p.autoScroll || !viewport.current || !inner.current) return;
    const vh = viewport.current.clientHeight;
    const ch = inner.current.scrollHeight;
    let target = 0;
    if (p.focus) {
      const el = inner.current.querySelector<HTMLElement>(`[data-fid="${p.focus}"]`);
      if (el) {
        target =
          p.focusAlign === 'center'
            ? el.offsetTop - vh * 0.3
            : el.offsetTop + el.offsetHeight - vh + 48;
      }
    }
    target = Math.max(0, Math.min(target, ch - vh));
    inner.current.style.transform = `translate3d(0, ${-target}px, 0)`;
  });

  return (
    <div
      className={`paper ${p.provider ? `paper--${p.provider}` : ''} ${p.className ?? ''} ${p.syncing ? 'is-syncing' : ''}`}
      style={p.provider ? ({ '--pv': PROVIDERS[p.provider].color } as CSSProperties) : undefined}
    >
      {p.provider && <Strip provider={p.provider} state={p.stripState ?? 'live'} url={p.stripUrl} />}
      <div className="paper-band" />
      <AnimatePresence>
        {p.stamp && (
          <motion.div
            className="paper-stamp"
            initial={{ opacity: 0, scale: 1.8, rotate: -24 }}
            animate={{ opacity: 1, scale: 1, rotate: -12 }}
            exit={{ opacity: 0 }}
            transition={{ type: 'spring', stiffness: 420, damping: 18 }}
          >
            <span>{p.stampLabel ?? 'Live'}</span>
            <small>{p.stampSub ?? (p.version ? `v${p.version}` : p.provider ? PROVIDERS[p.provider].short : 'ready')}</small>
          </motion.div>
        )}
      </AnimatePresence>
      <div className={`paper-viewport ${p.autoScroll ? 'is-auto' : ''}`} ref={viewport}>
        {p.scan != null && p.scan > 0 && p.scan < 1 && <div className="paper-scan" style={{ top: `${p.scan * 100}%` }} />}
        <div className="paper-inner" ref={inner}>
          <header className="paper-head">
            <h4>
              {p.title}
              {p.showTitleCaret && <i className="caret dark" />}
            </h4>
            {p.description && <p>{p.description}</p>}
            {p.mode === 'preview' && visible.some((f) => f.required) && <span className="paper-req-note">* Required</span>}
          </header>
          {p.fields.length === 0 && p.empty}
          <AnimatePresence initial={false}>
            {visible.map((f) => (
              <motion.div
                key={f.id}
                layout="position"
                data-fid={f.id}
                className="pf-wrap"
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                transition={{ duration: 0.42, ease: [0.22, 1, 0.36, 1] }}
              >
                <FieldCard
                  f={f}
                  all={all}
                  mode={p.mode}
                  value={answers[f.id]}
                  onAnswer={p.onAnswer}
                  typing={p.typingField === f.id}
                  flash={p.flash === f.id}
                />
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      </div>
    </div>
  );
}

function Strip({ provider, state, url }: { provider: Provider; state: 'draft' | 'creating' | 'saving' | 'live' | 'preview'; url?: string }) {
  const P = PROVIDERS[provider];
  return (
    <div className={`paper-strip is-${state}`}>
      <span className="ps-app">
        <span className="ps-dot" />
        {P.name}
      </span>
      <span className="ps-url">
        {state === 'live' ? (
          <>
            <svg width="10" height="10" viewBox="0 0 12 12" aria-hidden>
              <rect x="2" y="5.5" width="8" height="5.5" rx="1.3" fill="currentColor" />
              <path d="M4 5.5V4a2 2 0 0 1 4 0v1.5" fill="none" stroke="currentColor" strokeWidth="1.3" />
            </svg>
            {url ?? P.host}
          </>
        ) : state === 'creating' ? (
          <>
            <span className="spin sm" /> Creating in your account…
          </>
        ) : state === 'saving' ? (
          <>
            <span className="spin sm" /> Saving to {P.name}…
          </>
        ) : state === 'preview' ? (
          <>Preview of what Intake would create</>
        ) : (
          <>Draft · not in your account yet</>
        )}
      </span>
    </div>
  );
}

function FieldCard({
  f,
  all,
  mode,
  value,
  onAnswer,
  typing,
  flash,
}: {
  f: Field;
  all: Field[];
  mode: 'builder' | 'preview';
  value: AnswerValue | undefined;
  onAnswer?: (id: string, v: AnswerValue) => void;
  typing: boolean;
  flash: boolean;
}) {
  const builder = mode === 'builder';
  return (
    <motion.div
      className={`pf ${f.when ? 'is-cond' : ''} ${flash ? 'is-flash' : ''}`}
      initial={{ y: 14 }}
      animate={{ y: 0 }}
      transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
    >
      {f.when && builder && <div className="pf-cond">↳ only asked if {condLabel(f.when, all)}</div>}
      <div className="pf-top">
        <label className="pf-label">
          {f.label}
          <AnimatePresence>
            {f.required && (
              <motion.span className="pf-star" initial={{ opacity: 0, scale: 0 }} animate={{ opacity: 1, scale: 1 }} exit={{ opacity: 0, scale: 0 }}>
                *
              </motion.span>
            )}
          </AnimatePresence>
        </label>
        {builder && <span className="pf-type">{TYPE_LABEL[f.type]}</span>}
      </div>
      <Widget f={f} value={value} onAnswer={onAnswer} typing={typing} />
    </motion.div>
  );
}

const PLACEHOLDER: Partial<Record<Field['type'], string>> = {
  short_text: 'Your answer',
  long_text: 'Your answer',
  email: 'name@example.com',
};

function Widget({
  f,
  value,
  onAnswer,
  typing,
}: {
  f: Field;
  value: AnswerValue | undefined;
  onAnswer?: (id: string, v: AnswerValue) => void;
  typing: boolean;
}) {
  const live = !!onAnswer;
  switch (f.type) {
    case 'short_text':
    case 'email':
    case 'long_text': {
      const long = f.type === 'long_text';
      if (live) {
        return long ? (
          <textarea
            className="pw-input is-long"
            placeholder={PLACEHOLDER[f.type]}
            value={(value as string) ?? ''}
            onChange={(e) => onAnswer!(f.id, e.target.value)}
            rows={2}
            aria-label={f.label}
          />
        ) : (
          <input
            className="pw-input"
            type="text"
            placeholder={PLACEHOLDER[f.type]}
            value={(value as string) ?? ''}
            onChange={(e) => onAnswer!(f.id, e.target.value)}
            aria-label={f.label}
          />
        );
      }
      const v = typeof value === 'string' ? value : '';
      return (
        <div className={`pw-input ${long ? 'is-long' : ''} ${typing ? 'is-focus' : ''}`} data-input={f.id} aria-label={f.label}>
          {v ? <span className="pw-val">{v}</span> : <span className="pw-ph">{PLACEHOLDER[f.type]}</span>}
          {typing && <i className="caret dark" />}
        </div>
      );
    }
    case 'multiple_choice':
    case 'checkboxes': {
      const multi = f.type === 'checkboxes';
      const sel = (o: string) => (multi ? Array.isArray(value) && value.includes(o) : value === o);
      return (
        <div className="pw-opts" role="group" aria-label={f.label}>
          {(f.options ?? []).map((o) => (
            <button
              type="button"
              key={o}
              tabIndex={live ? 0 : -1}
              className={`pw-opt ${sel(o) ? 'is-on' : ''}`}
              aria-pressed={!!sel(o)}
              data-opt={`${f.id}:${o}`}
              onClick={
                live
                  ? () => {
                      if (multi) {
                        const cur = Array.isArray(value) ? value : [];
                        onAnswer!(f.id, cur.includes(o) ? cur.filter((x) => x !== o) : [...cur, o]);
                      } else onAnswer!(f.id, o);
                    }
                  : undefined
              }
            >
              <span className={multi ? 'pw-check' : 'pw-radio'} />
              {o}
            </button>
          ))}
        </div>
      );
    }
    case 'dropdown': {
      if (live) {
        return (
          <select className="pw-select is-live" value={(value as string) ?? ''} onChange={(e) => onAnswer!(f.id, e.target.value)} aria-label={f.label}>
            <option value="">Choose</option>
            {(f.options ?? []).map((o) => (
              <option key={o}>{o}</option>
            ))}
          </select>
        );
      }
      return (
        <div className="pw-drop">
          <div className="pw-select">
            <span>{(value as string) || 'Choose'}</span>
            <svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 4.5l3 3 3-3" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
          </div>
          <div className="pw-drop-opts">
            {(f.options ?? []).map((o) => (
              <span key={o}>{o}</span>
            ))}
          </div>
        </div>
      );
    }
  }
}
