import { LogoMark } from './LogoMark';

/**
 * The branded loader: our mark with a breathing accent dot, a sweeping
 * hairline, and one quiet line of copy. Used for the initial app Suspense
 * fallback and the workspace session check — the two moments a user stares
 * at the screen waiting. Pure CSS motion; the global reduced-motion rule
 * stills it automatically.
 */
export function IntakeLoader({ label, markSize = 48 }: { label: string; markSize?: number }) {
  return (
    <div className="workspace-status" role="status">
      <span className="intake-loader__mark" aria-hidden="true">
        <LogoMark size={markSize} />
      </span>
      <span className="intake-loader__bar" aria-hidden="true">
        <i />
      </span>
      <p className="intake-loader__label">{label}</p>
    </div>
  );
}
