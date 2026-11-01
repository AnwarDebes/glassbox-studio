import { useEffect, useState, useSyncExternalStore } from 'react';

function subscribeMedia(query: string) {
  return (onChange: () => void) => {
    const mql = window.matchMedia(query);
    mql.addEventListener('change', onChange);
    return () => mql.removeEventListener('change', onChange);
  };
}

/** Live result of a CSS media query. */
export function useMediaQuery(query: string): boolean {
  return useSyncExternalStore(
    subscribeMedia(query),
    () => window.matchMedia(query).matches,
    () => false,
  );
}

export function useReducedMotion(): boolean {
  return useMediaQuery('(prefers-reduced-motion: reduce)');
}

/** Layout tiers: phone is read-only, tablet collapses the file tree. */
export type LayoutTier = 'phone' | 'tablet' | 'desktop';

export function useLayoutTier(): LayoutTier {
  const phone = useMediaQuery('(max-width: 759px)');
  const tablet = useMediaQuery('(max-width: 1179px)');
  return phone ? 'phone' : tablet ? 'tablet' : 'desktop';
}

/** Re-render on an interval, for relative times. */
export function useNow(intervalMs = 30_000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);
  return now;
}
