import { useEffect } from 'react';
import { applyUpdate, dismissPwaToasts, usePwa } from '../app/pwa';
import { Icon } from './Icon';

export function PwaToasts() {
  const { needRefresh, offlineReady } = usePwa();

  useEffect(() => {
    if (!offlineReady) return;
    const t = setTimeout(() => usePwa.setState({ offlineReady: false }), 5000);
    return () => clearTimeout(t);
  }, [offlineReady]);

  if (!needRefresh && !offlineReady) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      {needRefresh ? (
        <div className="toast float">
          <Icon name="refresh" size={18} />
          <div className="grow">
            <strong>A new version is ready.</strong>
            <div className="muted">Reload to use it. Your workspace is saved.</div>
          </div>
          <button className="btn sm primary" onClick={applyUpdate}>
            Reload
          </button>
          <button className="icon-btn" aria-label="Dismiss" onClick={dismissPwaToasts}>
            <Icon name="x" />
          </button>
        </div>
      ) : (
        <div className="toast float">
          <Icon name="check" size={18} />
          <div className="grow">Glassbox Studio now works offline.</div>
        </div>
      )}
    </div>
  );
}
