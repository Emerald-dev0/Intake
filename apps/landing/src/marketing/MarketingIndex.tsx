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
  ['05', 'Providers', '#providers'],
  ['06', 'Control', '#control'],
  ['07', 'Pricing', '#pricing'],
  ['08', 'Questions', '#faq'],
] as const;

export function MarketingIndex() {
  const [active, setActive] = useState<string>('');
  // The centred hero has no margin to spare, so the rail waits until the headline and the thread
  // diagram have scrolled away. Without IntersectionObserver it simply stays visible.
  const [pastHero, setPastHero] = useState(true);

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const targets = [document.querySelector('.mk-hero__center'), document.querySelector('.mk-flow')]
      .filter((node): node is Element => node !== null);
    if (!targets.length) return;
    const visible = new Set<Element>();
    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.isIntersecting) visible.add(entry.target);
        else visible.delete(entry.target);
      }
      setPastHero(visible.size === 0);
    });
    for (const target of targets) observer.observe(target);
    return () => observer.disconnect();
  }, []);

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
    <nav className={`mk-index${pastHero ? '' : ' is-hidden'}`} aria-label="Sections on this page">
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
