import { useWorkspace } from '../../workspace/store';
import { useSession } from '../../state/session';
import { useSettings } from '../../state/settings';
import { useGlassbox } from '../../agent/glassbox';
import { openPicker } from '../../state/ui';
import { Icon } from '../Icon';

export function StatusBar() {
  const name = useWorkspace((s) => s.name);
  const kind = useWorkspace((s) => s.kind);
  const count = useWorkspace((s) => Object.keys(s.files).length);
  const permission = useWorkspace((s) => s.permission);
  const running = useSession((s) => s.running);
  const activity = useSession((s) => s.activity);
  const guardOn = useSettings((s) => s.guard);
  const gb = useGlassbox((s) => s.status);
  const models = useGlassbox((s) => s.cards.length);

  return (
    <footer className="statusbar">
      <span className="sb-item">
        <Icon name="folder" size={13} />
        {name}
        <span className="faint">
          {count} files{kind === 'local' ? (permission === 'granted' ? ', saving to disk' : ', disk access paused') : kind === 'sample' ? ', sample' : ', in this browser'}
        </span>
      </span>
      <span className="sb-item grow truncate" aria-hidden>
        {running ? <span className="sb-busy" /> : null}
        {running ? activity : ''}
      </span>
      <button className={`sb-item sb-btn ${guardOn && gb === 'ready' ? 'on' : 'off'}`} onClick={() => openPicker('glassbox')}>
        <Icon name={guardOn ? 'shieldCheck' : 'shield'} size={13} />
        {gb === 'error' ? 'Glassbox models failed to load' : gb !== 'ready' ? 'Loading glassbox models' : guardOn ? `Guard on, ${models} models` : 'Guard off'}
      </button>
      <span className="sb-item faint hide-narrow">
        <Icon name="lock" size={13} />
        No server, no tracking
      </span>
    </footer>
  );
}
