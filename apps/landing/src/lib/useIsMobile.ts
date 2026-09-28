import { useEffect, useState } from 'react';

const Q = '(max-width: 719px)';

/** True on phone-sized screens. Mobile gets its own lighter components instead of the desktop reels. */
export function useIsMobile(): boolean {
  const [m, setM] = useState(() => typeof window !== 'undefined' && window.matchMedia(Q).matches);
  useEffect(() => {
    const mq = window.matchMedia(Q);
    const f = () => setM(mq.matches);
    f();
    mq.addEventListener('change', f);
    return () => mq.removeEventListener('change', f);
  }, []);
  return m;
}
