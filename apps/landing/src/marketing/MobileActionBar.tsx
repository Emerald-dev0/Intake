import { useEffect, useState } from 'react';
import { StartLink } from './MarketingChrome';

/**
 * A mobile action bar.
 *
 * On a phone the primary action should be under the thumb, not at the top of a thousand-pixel
 * scroll. It appears once the hero is behind the reader and disappears again at the footer, where
 * the call to action already sits. It is a shortcut, never the only route: the same links stay in
 * the header and in the page.
 */
export function MobileActionBar({ authenticated }: { authenticated: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (typeof IntersectionObserver !== 'function') return;
    const hero = document.querySelector('.mk-hero');
    const footer = document.querySelector('.mk-footer');
    if (!hero || !footer) return;

    let heroGone = false;
    let footerIn = false;
    const sync = () => setVisible(heroGone && !footerIn);

    const observer = new IntersectionObserver(entries => {
      for (const entry of entries) {
        if (entry.target === hero) heroGone = !entry.isIntersecting;
        else footerIn = entry.isIntersecting;
      }
      sync();
    }, { rootMargin: '-20% 0px -20% 0px' });

    observer.observe(hero);
    observer.observe(footer);
    return () => observer.disconnect();
  }, []);

  return (
    <div className={`mk-mobile-cta${visible ? ' is-visible' : ''}`} aria-hidden={!visible}>
      <span className="mk-mobile-cta__label">
        <strong>{authenticated ? 'Your workspace' : 'Free to start'}</strong>
        <span>20 credits every day</span>
      </span>
      <StartLink authenticated={authenticated} className="mk-button mk-button--primary" />
    </div>
  );
}
