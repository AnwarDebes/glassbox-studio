import { usePixie } from '../../pixie/director';
import { PixieCanvas } from '../../pixie/PixieCanvas';
import { revealItem } from '../../state/ui';

export function PixieDock({ compact }: { compact?: boolean }) {
  const current = usePixie((s) => s.current);
  const label = usePixie((s) => s.label);
  const clickable = !!current.refId;
  return (
    <div className={`pixie-dock ${compact ? 'compact' : ''} state-${current.state}`}>
      <button
        type="button"
        className="pixie-stage"
        onClick={() => current.refId && revealItem(current.refId)}
        disabled={!clickable}
        aria-label={clickable ? `Pixie is ${label.toLowerCase()}. Show this step in the chat.` : `Pixie is ${label.toLowerCase()}.`}
        title={clickable ? 'Show this step in the chat' : undefined}
      >
        <PixieCanvas state={current.state} />
      </button>
      <div className="pixie-text">
        <div className="pixie-label">{label}</div>
        <div className="pixie-caption" aria-live="polite">
          {current.caption}
        </div>
      </div>
    </div>
  );
}
