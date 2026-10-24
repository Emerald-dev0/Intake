import type { ReactNode } from 'react';

/**
 * The signed-in page system.
 *
 * Library, Connections, Billing and Account were each written at a different time and each carried
 * its own heading, its own spacing and its own idea of what an empty state looks like. These five
 * components are the shared vocabulary: a page heading, a section, an empty state, a skeleton, and a
 * quiet note. When a page needs something these cannot express, the right move is to extend this
 * file rather than to invent a sixth local style.
 *
 * They intentionally own no data fetching and no routing. A page keeps its behaviour; only its
 * furniture comes from here.
 */

export function PageHeader({
  kicker,
  title,
  description,
  actions,
  children,
}: {
  kicker?: string;
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Extra content underneath the description, e.g. a status strip or a filter row. */
  children?: ReactNode;
}) {
  return (
    <header className="ui-head">
      <div className="ui-head__text">
        {kicker && <span className="ui-kicker">{kicker}</span>}
        <h1>{title}</h1>
        {description && <p>{description}</p>}
      </div>
      {actions && <div className="ui-head__actions">{actions}</div>}
      {children && <div className="ui-head__extra">{children}</div>}
    </header>
  );
}

export function Section({
  title,
  description,
  actions,
  id,
  children,
  tone = 'plain',
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
  /** Set when something else links to this section with a fragment. */
  id?: string;
  children: ReactNode;
  tone?: 'plain' | 'quiet';
}) {
  const titleId = id ? `${id}-title` : undefined;
  return (
    <section className={`ui-section ${tone === 'quiet' ? 'is-quiet' : ''}`} aria-labelledby={titleId} id={id}>
      <div className="ui-section__head">
        <div>
          <h2 id={titleId}>{title}</h2>
          {description && <p>{description}</p>}
        </div>
        {actions && <div className="ui-section__actions">{actions}</div>}
      </div>
      {children}
    </section>
  );
}

/**
 * An empty state, and only ever an empty state. It renders when a request succeeded and returned
 * nothing. A failed request must use `ErrorState` instead: "nothing here" and "I could not check"
 * are different claims and this product does not blur them.
 */
export function EmptyState({
  title,
  detail,
  action,
  icon,
}: {
  title: string;
  detail?: string;
  action?: ReactNode;
  icon?: ReactNode;
}) {
  return (
    <div className="ui-empty">
      {icon && <div className="ui-empty__icon" aria-hidden>{icon}</div>}
      <strong>{title}</strong>
      {detail && <p>{detail}</p>}
      {action && <div className="ui-empty__action">{action}</div>}
    </div>
  );
}

export function ErrorState({
  title,
  detail,
  onRetry,
  retryLabel = 'Try again',
}: {
  title: string;
  detail: string;
  onRetry?: () => void;
  retryLabel?: string;
}) {
  return (
    <div className="ui-error" role="alert">
      <strong>{title}</strong>
      <p>{detail}</p>
      {onRetry && <button type="button" className="btn btn-ghost btn-sm" onClick={onRetry}>{retryLabel}</button>}
    </div>
  );
}

/**
 * A loading placeholder shaped like the content it replaces, so the page does not jump when the
 * answer arrives. Screen readers get one polite "Loading" announcement, not one per bar.
 */
export function Skeleton({
  lines = 3,
  label = 'Loading…',
  variant = 'text',
}: {
  lines?: number;
  label?: string;
  variant?: 'text' | 'card' | 'rows';
}) {
  if (variant === 'card') {
    return <div className="ui-skeleton ui-skeleton--card" role="status" aria-label={label}><span /><span /><span /></div>;
  }
  if (variant === 'rows') {
    return (
      <div className="ui-skeleton ui-skeleton--rows" role="status" aria-label={label}>
        {Array.from({ length: Math.max(1, lines) }, (_value, index) => <span key={index} />)}
      </div>
    );
  }
  return (
    <div className="ui-skeleton" role="status" aria-label={label}>
      {Array.from({ length: Math.max(1, lines) }, (_value, index) => <span key={index} style={{ width: `${100 - index * 12}%` }} />)}
    </div>
  );
}

/** A one-line note under content. Fine print that still has to be read, not decoration. */
export function Note({ children }: { children: ReactNode }) {
  return <p className="ui-note">{children}</p>;
}
