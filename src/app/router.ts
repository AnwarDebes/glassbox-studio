// Hash routes, so the app works on GitHub Pages without server rewrites.

export type Route = 'landing' | 'studio' | 'demo';

export function readRoute(): Route {
  const h = location.hash.replace(/^#\/?/, '');
  if (h.startsWith('demo')) return 'demo';
  if (h.startsWith('studio')) return 'studio';
  return 'landing';
}

export function subscribeHash(cb: () => void) {
  window.addEventListener('hashchange', cb);
  return () => window.removeEventListener('hashchange', cb);
}

export function navigate(route: Route, opts: { replace?: boolean } = {}) {
  const hash = route === 'landing' ? '#/' : `#/${route}`;
  if (location.hash === hash) return;
  if (opts.replace) {
    history.replaceState(null, '', hash);
    window.dispatchEvent(new HashChangeEvent('hashchange'));
  } else location.hash = hash;
}

export const LINKS = {
  source: 'https://github.com/AnwarDebes/glassbox-studio',
  author: 'https://github.com/AnwarDebes',
  decisionLayer: 'https://github.com/AnwarDebes/glassbox-studio/blob/main/glassbox/README.md',
};
