import { useSettings, setSetting, effectiveTheme } from '../../state/settings';
import { openPicker, useUi } from '../../state/ui';
import { useSession } from '../../state/session';
import { startDemo } from '../../agent/demo-run';
import { PRESET_BY_ID } from '../../agent/providers/presets';
import { localModelById } from '../../agent/providers/webllm-models';
import { LINKS } from '../../app/router';
import { Icon } from '../Icon';
import { Logo } from '../Logo';
import { WorkspaceMenu } from './WorkspaceMenu';

export function modelLabel(model: ReturnType<typeof useSettings.getState>['model'], providers: ReturnType<typeof useSettings.getState>['providers']): string {
  if (model.kind === 'demo') return 'Demo replay';
  if (model.kind === 'webllm') return localModelById(model.modelId)?.name ?? model.modelId;
  const p = PRESET_BY_ID[model.providerId];
  const m = providers[model.providerId]?.model ?? p?.models[0] ?? '';
  return `${p?.name ?? model.providerId}${m ? `: ${m}` : ''}`;
}

export function TopBar({ tablet }: { tablet: boolean }) {
  const model = useSettings((s) => s.model);
  const providers = useSettings((s) => s.providers);
  const theme = useSettings((s) => s.theme);
  const running = useSession((s) => s.running);
  const drawer = useUi((s) => s.drawer);
  const dark = effectiveTheme(theme) === 'dark';

  return (
    <header className="topbar">
      {tablet ? (
        <button className="icon-btn" aria-label="Show files" aria-expanded={drawer} onClick={() => useUi.setState({ drawer: !drawer })}>
          <Icon name="sidebar" />
        </button>
      ) : null}
      <a className="brand" href="#/" aria-label="Glassbox Studio home">
        <Logo size={22} />
        <span className="brand-name">Glassbox Studio</span>
      </a>
      <WorkspaceMenu />
      <div className="grow" />
      <button className="btn ghost sm demo-btn" onClick={() => void startDemo()} disabled={running}>
        <Icon name="play" size={14} />
        <span className="hide-narrow">Replay demo</span>
      </button>
      <button className="model-btn" onClick={() => openPicker(model.kind === 'remote' ? 'key' : 'browser')} aria-label={`Model: ${modelLabel(model, providers)}. Change model`}>
        <span className={`model-dot ${model.kind}`} aria-hidden />
        <span className="truncate">{modelLabel(model, providers)}</span>
        <Icon name="chevronDown" size={14} />
      </button>
      <button className="icon-btn" aria-label="Glassbox models" title="Glassbox models" onClick={() => openPicker('glassbox')}>
        <Icon name="box" />
      </button>
      <button className="icon-btn" aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'} title="Theme" onClick={() => setSetting('theme', dark ? 'light' : 'dark')}>
        <Icon name={dark ? 'sun' : 'moon'} />
      </button>
      <a className="icon-btn" href={LINKS.source} target="_blank" rel="noreferrer noopener" aria-label="Source code on GitHub" title="Source on GitHub">
        <Icon name="github" />
      </a>
    </header>
  );
}
