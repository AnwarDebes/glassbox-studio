import { useUi } from '../../state/ui';
import { Icon } from '../Icon';

export function Toast() {
  const t = useUi((s) => s.toast);
  if (!t) return null;
  return (
    <div className="toasts" role="status" aria-live="polite">
      <div className={`toast float tone-${t.tone}`}>
        <Icon name={t.tone === 'error' ? 'alert' : t.tone === 'success' ? 'check' : 'info'} size={18} />
        <div className="grow">{t.text}</div>
        <button className="icon-btn" aria-label="Dismiss" onClick={() => useUi.setState({ toast: null })}>
          <Icon name="x" />
        </button>
      </div>
    </div>
  );
}
