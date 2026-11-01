import { Suspense, lazy, useEffect, useSyncExternalStore } from 'react';
import { applyTheme, useSettings } from './state/settings';
import { readRoute, subscribeHash, type Route } from './app/router';
import { PwaToasts } from './ui/PwaToasts';

const Landing = lazy(() => import('./ui/landing/Landing'));
const Studio = lazy(() => import('./ui/studio/Studio'));

function Splash() {
  return (
    <div className="splash" role="status" aria-live="polite">
      <span className="sr-only">Loading Glassbox Studio</span>
    </div>
  );
}

export function App() {
  const route = useSyncExternalStore(subscribeHash, readRoute, (): Route => 'landing');
  const theme = useSettings((s) => s.theme);

  useEffect(() => applyTheme(theme), [theme]);

  useEffect(() => {
    document.title = route === 'landing' ? 'Glassbox Studio: the coding agent that shows its work' : 'Glassbox Studio';
  }, [route]);

  return (
    <>
      <Suspense fallback={<Splash />}>{route === 'landing' ? <Landing /> : <Studio autoDemo={route === 'demo'} />}</Suspense>
      <PwaToasts />
    </>
  );
}
