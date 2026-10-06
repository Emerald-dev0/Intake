import { useEffect, useState } from 'react';

/**
 * A section index in the left margin.
 *
 * A marketing page does not have to be a single column of stacked blocks. On wide screens this rail
 * sits in the margin and tells the reader where they are in the argument — the same numbering the
 * sections carry in their own gutters, so the two agree. It is a real set of links (keyboard
 * reachable, `aria-current` on the live one), not a decoration. Below the width where a margin
 * exists, it is simply not rendered: the mobile page keeps its own rhythm.
 */

const ENTRIES = [
  ['01', 'Why Intake', '#product'],
  ['02', 'How it works', '#how-it-works'],
  ['03', 'Create', '#creation'],
  ['04', 'Edit', '#editing'],
  ['05', 'Control', '#control'],
  ['06', 'Pricing', '#pricing'],
  ['07', 'Questions', '#faq'],
] as const;

export function MarketingIndex() {
  const [active, setActive] = useState<string>('');

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    // A type predicate, not `.filter(Boolean)`: that narrows nothing and leaves `Element | null`
    // reaching `observer.observe`, which is a type error rather than a runtime problem.
    const sections = ENTRIES
      .map(([, , href]) => document.querySelector(href))
      .filter((section): section is Element => section !== null);
    if (!sections.length) return;

    const observer = new IntersectionObserver(
      entries => {
        const visible = entries
          .filter(entry => entry.isIntersecting)
          .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];
        if (visible) setActive(`#${visible.target.id}`);
      },
      { rootMargin: '-45% 0px -45% 0px', threshold: [0, 0.2, 0.6] },
    );
    for (const section of sections) observer.observe(section);
    return () => observer.disconnect();
  }, []);

  return (
    <nav className="mk-index" aria-label="Sections on this page">
      <ol>
        {ENTRIES.map(([number, label, href]) => (
          <li key={href}>
            <a href={href} aria-current={active === href ? 'true' : undefined}>
              <span className="mk-index__tick" aria-hidden="true" />
              <span className="mk-index__number" aria-hidden="true">{number}</span>
              <span className="mk-index__label">{label}</span>
            </a>
          </li>
        ))}
      </ol>
    </nav>
  );
}
