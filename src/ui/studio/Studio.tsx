import { useEffect, useRef, useState } from 'react';
import './studio.css';
import { useLayoutTier, type LayoutTier } from '../hooks';
import { workspace } from '../../workspace/store';
import { session } from '../../state/session';
import { initLedger } from '../../agent/ledger';
import { ensureGlassbox } from '../../agent/glassbox';
import { startDemo } from '../../agent/demo-run';
import { navigate } from '../../app/router';
import { useUi } from '../../state/ui';
import { TopBar } from './TopBar';
import { FileTree } from './FileTree';
import { PixieDock } from './PixieDock';
import { EditorArea } from './EditorArea';
import { BottomPanel } from './BottomPanel';
import { AgentPanel } from './AgentPanel';
import { StatusBar } from './StatusBar';
import { ModelPicker } from './ModelPicker';
import { Sash } from './Sash';
import { PhoneStudio } from './PhoneStudio';
import { Toast } from './Toast';

let boot: Promise<void> | null = null;
function bootOnce(): Promise<void> {
  boot ??= (async () => {
    const [, entries] = await Promise.all([workspace.init(), session.restore()]);
    initLedger(entries);
    void ensureGlassbox();
  })();
  return boot;
}

function Desktop({ tier }: { tier: LayoutTier }) {
  const { drawer, sideWidth, agentWidth } = useUi();
  const tablet = tier === 'tablet';

  useEffect(() => {
    // Warm up the editor chunk while the browser is idle.
    const warm = () => void import('./CodeEditor');
    if ('requestIdleCallback' in window) {
      const id = window.requestIdleCallback(warm, { timeout: 2500 });
      return () => window.cancelIdleCallback(id);
    }
    const t = setTimeout(warm, 1200);
    return () => clearTimeout(t);
  }, []);

  useEffect(() => {
    if (!drawer) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') useUi.setState({ drawer: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drawer]);

  return (
    <div className={`studio tier-${tier}`}>
      <a
        className="skip-link"
        href="#composer-input"
        onClick={(e) => {
          // Hash routes drive the app, so focus the composer instead of navigating.
          e.preventDefault();
          document.getElementById('composer-input')?.focus();
        }}
      >
        Skip to the agent
      </a>
      <TopBar tablet={tablet} />
      <div
        className="studio-main"
        style={{ ['--side-w' as string]: `${sideWidth}px`, ['--agent-w' as string]: `${tablet ? Math.min(agentWidth, 400) : agentWidth}px` }}
      >
        {tablet ? (
          <>
            {drawer ? <div className="drawer-scrim" onClick={() => useUi.setState({ drawer: false })} aria-hidden /> : null}
            <aside className={`side drawer float ${drawer ? 'open' : ''}`} aria-label="Files" aria-hidden={!drawer} inert={!drawer}>
              <FileTree onOpen={() => useUi.setState({ drawer: false })} />
            </aside>
          </>
        ) : (
          <>
            <aside className="side pane" aria-label="Files and Pixie">
              <FileTree />
              <PixieDock />
            </aside>
            <Sash label="Resize the file panel" value={sideWidth} min={190} max={420} onChange={(v) => useUi.setState({ sideWidth: v })} />
          </>
        )}
        <main className="center" id="main">
          <EditorArea />
          <BottomPanel />
        </main>
        <Sash label="Resize the agent panel" value={agentWidth} min={340} max={640} invert onChange={(v) => useUi.setState({ agentWidth: v })} />
        <section className="agent pane" aria-label="Agent">
          <AgentPanel compactPixie={tablet} />
        </section>
      </div>
      <StatusBar />
      <ModelPicker />
      <Toast />
    </div>
  );
}

export default function Studio({ autoDemo }: { autoDemo: boolean }) {
  const tier = useLayoutTier();
  const [ready, setReady] = useState(false);
  const demoStarted = useRef(false);

  useEffect(() => {
    let alive = true;
    void bootOnce().then(() => alive && setReady(true));
    return () => {
      alive = false;
    };
  }, []);

  useEffect(() => {
    if (!ready || !autoDemo || demoStarted.current) return;
    demoStarted.current = true;
    navigate('studio', { replace: true });
    void startDemo();
  }, [ready, autoDemo]);

  if (!ready) {
    return (
      <div className="splash" role="status">
        <span className="sr-only">Opening the studio</span>
      </div>
    );
  }
  return tier === 'phone' ? <PhoneStudio /> : <Desktop tier={tier} />;
}
