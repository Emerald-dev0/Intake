import { AnimatePresence, motion } from 'motion/react';
import { forwardRef, type CSSProperties, type ReactNode } from 'react';
import { PROVIDERS, type Provider } from '../lib/providers';

export function StageTop({ title, status, provider }: { title: string; status: string; provider?: Provider }) {
  return (
    <div className="st-top">
      <div className="st-dots">
        <i />
        <i />
        <i />
      </div>
      <div className="st-crumbs">
        <span className="st-brand">
          <LogoMark size={14} /> intake
        </span>
        <span className="st-sep">/</span>
        <AnimatePresence mode="wait">
          <motion.span key={title} className="st-doc" initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }}>
            {title}
          </motion.span>
        </AnimatePresence>
      </div>
      {provider && (
        <div className="st-conn" style={{ '--pv': PROVIDERS[provider].color } as CSSProperties}>
          <span className="st-conn-dot" />
          {PROVIDERS[provider].name}
          <span className="st-conn-acc">not connected · scripted preview</span>
        </div>
      )}
      <div className="st-status is-preview" aria-label={status}>
        <i />
        <AnimatePresence mode="wait">
          <motion.span key={status} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -5 }}>
            {status}
          </motion.span>
        </AnimatePresence>
      </div>
    </div>
  );
}

export function Composer({ text, active, pressing, placeholder = 'Describe the form you need…' }: { text: string; active: boolean; pressing: boolean; placeholder?: string }) {
  return (
    <div className={`composer ${active ? 'is-active' : ''}`}>
      <div className="composer-text">
        <div>
          {text ? <span>{text}</span> : <span className="composer-ph">{placeholder}</span>}
          {active && <i className="caret" />}
        </div>
      </div>
      <div className="composer-foot">
        <span className="composer-hint">
          <kbd>↵</kbd> to build
        </span>
        <span className={`composer-send ${text ? 'is-ready' : ''} ${pressing ? 'is-press' : ''}`}>
          <svg width="14" height="14" viewBox="0 0 16 16"><path d="M8 13V3M3.5 7.5L8 3l4.5 4.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" /></svg>
        </span>
      </div>
    </div>
  );
}

export const Step = forwardRef<HTMLDivElement, { open: boolean; done: boolean; label: string; children?: ReactNode }>(function Step({ open, done, label, children }, ref) {
  return (
    <motion.div ref={ref} layout className={`step ${done ? 'is-done' : ''}`} initial={{ opacity: 0, y: 14 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0 }}>
      <div className="step-head">
        <span className="step-icon">{done ? <Tick /> : <span className="spin" />}</span>
        <span className="step-label">{label}</span>
      </div>
      <AnimatePresence initial={false}>
        {open && children && (
          <motion.div className="step-body" initial={{ height: 0, opacity: 0 }} animate={{ height: 'auto', opacity: 1 }} exit={{ height: 0, opacity: 0 }} transition={{ duration: 0.35 }}>
            <div className="step-pad">{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
});

export function Tick({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 12 12">
      <path d="M2.5 6.3l2.3 2.2 4.7-5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function Check({ on, label }: { on: boolean; label: string }) {
  return (
    <div className={`check ${on ? 'is-on' : ''}`}>
      <span className="check-box">{on ? <Tick size={10} /> : <span className="spin sm" />}</span>
      {label}
    </div>
  );
}

export const ReadyCard = forwardRef<HTMLDivElement, { provider: Provider }>(function ReadyCard({ provider }, ref) {
  const P = PROVIDERS[provider];
  return (
    <motion.div ref={ref} layout className="ready" initial={{ opacity: 0, y: 18, scale: 0.97 }} animate={{ opacity: 1, y: 0, scale: 1 }} transition={{ type: 'spring', stiffness: 300, damping: 24 }}>
      <div className="ready-top">
        <span className="ready-dot" /> Example proposal ready · not applied
      </div>
      <p className="ready-meta">Scripted {P.name} preview only. No form or responder link was created.</p>
      <div className="ready-btns">
        <span className="rb rb-primary">Review the example</span>
        <span className="rb">Confirmation required in Intake</span>
      </div>
    </motion.div>
  );
});

export function AccountPanel({ provider, newTitle, state, progress }: {
  provider: Provider;
  newTitle: string;
  state: 'waiting' | 'draft' | 'preparing' | 'ready';
  progress: number;
}) {
  const P = PROVIDERS[provider];
  const status = {
    waiting: 'Waiting for an example request',
    draft: 'Example draft · not applied',
    preparing: 'Preparing a local preview…',
    ready: 'Ready for review · not applied',
  }[state];
  return (
    <div className="acct" style={{ '--pv': P.color } as CSSProperties}>
      <div className="spec-head">
        <span className="spec-file">
          <span className="acct-app" /> {P.name} workflow
        </span>
        <span className="spec-badge">Scripted example</span>
      </div>
      <div className="acct-user">
        <span className="acct-av" aria-hidden>G</span>
        <div>
          <b>Google account not connected</b>
          <span>Google authorization is separate from Intake sign-in.</span>
        </div>
      </div>
      <div className="acct-label">Example proposal</div>
      <div className="acct-list">
        <div className={`acct-row ${state === 'ready' ? 'is-new' : ''}`}>
          <div className="acct-row-in">
            <span className="acct-doc" />
            <div className="acct-row-t">
              <b>{newTitle}</b>
              <span>{status}</span>
            </div>
            {state === 'preparing' && <span className="spin sm" />}
          </div>
          {state === 'preparing' && <div className="op-bar"><i style={{ transform: `scaleX(${progress})` }} /></div>}
        </div>
      </div>
      <div className="spec-foot">
        <span>No form or responder link is created in this demo.</span>
      </div>
    </div>
  );
}

export function Caption({ idx, total, label, text }: { idx: number; total: number; label: string; text: string }) {
  return (
    <div className="caption">
      <AnimatePresence mode="wait">
        <motion.div key={label} className="caption-in" initial={{ opacity: 0, y: 10, filter: 'blur(4px)' }} animate={{ opacity: 1, y: 0, filter: 'blur(0px)' }} exit={{ opacity: 0, y: -8, filter: 'blur(4px)' }} transition={{ duration: 0.35 }}>
          <span className="caption-n">
            {String(idx + 1).padStart(2, '0')}/{String(total).padStart(2, '0')} · {label}
          </span>
          <span className="caption-t">{text}</span>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

export function LogoMark({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden>
      <rect width="64" height="64" rx="16" fill="currentColor" opacity="0.08" />
      <circle cx="32" cy="19" r="7" fill="#ff5a1f" />
      <rect x="18" y="32" width="28" height="7" rx="3.5" fill="currentColor" />
      <rect x="18" y="44" width="18" height="7" rx="3.5" fill="currentColor" opacity=".45" />
    </svg>
  );
}
