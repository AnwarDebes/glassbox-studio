import { Suspense, lazy, useRef, type KeyboardEvent } from 'react';
import { useWorkspace, workspace } from '../../workspace/store';
import { basename } from '../../workspace/paths';
import { useSession, type ToolItem } from '../../state/session';
import { useSettings, effectiveTheme } from '../../state/settings';
import { decide } from '../../agent/runtime';
import { startDemo } from '../../agent/demo-run';
import { useMediaQuery } from '../hooks';
import { DecisionPill } from '../Evidence';
import { Icon } from '../Icon';
import { margin as fmtMargin } from '../format';

const FileEditor = lazy(() => import('./CodeEditor'));
const ReviewEditor = lazy(() => import('./CodeEditor').then((m) => ({ default: m.ReviewEditor })));

function useTheme(): 'dark' | 'light' {
  const pref = useSettings((s) => s.theme);
  const prefersLight = useMediaQuery('(prefers-color-scheme: light)');
  return pref === 'system' ? (prefersLight ? 'light' : 'dark') : effectiveTheme(pref);
}

function Tabs() {
  const tabs = useWorkspace((s) => s.tabs);
  const active = useWorkspace((s) => s.active);
  const dirtyKey = useWorkspace((s) => (s.kind === 'local' ? s.tabs.filter((t) => s.files[t] !== undefined && s.files[t] !== s.disk[t]).join('\n') : ''));
  const items = useSession((s) => s.items);
  const ref = useRef<HTMLDivElement>(null);
  const dirty = new Set(dirtyKey ? dirtyKey.split('\n') : []);

  const label = (id: string) => {
    if (id.startsWith('review:')) {
      const item = items.find((it) => it.id === id.slice(7)) as ToolItem | undefined;
      return `Review ${basename(item?.diff?.path ?? 'edit')}`;
    }
    return basename(id);
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key === 'Delete') {
      e.preventDefault();
      workspace.closeTab(tabs[i]);
      return;
    }
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const next = tabs[(i + (e.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length];
    workspace.openTab(next);
    ref.current?.querySelectorAll<HTMLElement>('.tab-btn')[tabs.indexOf(next)]?.focus();
  };

  if (!tabs.length) return <div className="tabs empty" />;
  return (
    <div className="tabs" role="group" aria-label="Open files" ref={ref}>
      {tabs.map((id, i) => {
        const isActive = id === active;
        const review = id.startsWith('review:');
        return (
          <div key={id} className={`tab ${isActive ? 'active' : ''} ${review ? 'is-review' : ''}`}>
            <button
              aria-current={isActive ? 'page' : undefined}
              tabIndex={isActive ? 0 : -1}
              className="tab-btn"
              onClick={() => workspace.openTab(id)}
              onKeyDown={(e) => onKey(e, i)}
              title={review ? 'Proposed edit waiting for your review' : `${id} (Delete closes the tab)`}
            >
              {review ? <Icon name="eye" size={13} /> : null}
              <span className="truncate">{label(id)}</span>
              {dirty.has(id) ? (
                <span className="tab-dirty">
                  <span className="sr-only">unsaved changes</span>
                </span>
              ) : null}
            </button>
            <button className="tab-close" aria-label={`Close ${label(id)}`} onClick={() => workspace.closeTab(id)} tabIndex={isActive ? 0 : -1}>
              <Icon name="x" size={12} />
            </button>
          </div>
        );
      })}
    </div>
  );
}

function ReviewPane({ itemId, theme }: { itemId: string; theme: 'dark' | 'light' }) {
  const item = useSession((s) => s.items.find((it) => it.id === itemId)) as ToolItem | undefined;
  const wide = useMediaQuery('(min-width: 1400px)');
  if (!item?.diff) return <div className="editor-empty">This review is no longer available.</div>;
  const awaiting = item.status === 'awaiting';
  return (
    <div className="review-pane">
      <div className="review-bar">
        <div className="grow">
          <div className="review-title">
            {item.diff.isNew ? 'New file' : 'Proposed edit to'} <code>{item.diff.path}</code>
          </div>
          <div className="faint review-sub">
            {item.guard ? (
              <>
                Guard: <DecisionPill outcome={item.guard.decision} /> margin {fmtMargin(item.guard.margin)}
              </>
            ) : (
              'The guard is off for this edit.'
            )}
          </div>
        </div>
        {awaiting ? (
          <>
            <button className="btn danger" onClick={() => decide(item.id, 'reject')}>
              <Icon name="x" size={14} /> Reject
            </button>
            <button className="btn approve" onClick={() => decide(item.id, 'approve')}>
              <Icon name="check" size={14} /> Accept edit
            </button>
          </>
        ) : (
          <span className="pill muted">{item.status === 'denied' ? 'Rejected' : 'Accepted'}</span>
        )}
      </div>
      <div className="review-editor">
        <Suspense fallback={<div className="editor-loading">Preparing the review</div>}>
          <ReviewEditor reviewId={item.id} path={item.diff.path} before={item.diff.before} after={item.diff.after} theme={theme} sideBySide={wide} />
        </Suspense>
      </div>
    </div>
  );
}

function Welcome() {
  return (
    <div className="editor-empty">
      <p className="welcome-title">Nothing open yet</p>
      <p className="faint">Pick a file on the left, or let the agent work and watch the files open as it reads them.</p>
      <div className="row welcome-actions">
        <button className="btn primary" onClick={() => void startDemo()}>
          <Icon name="play" size={14} /> Replay the demo
        </button>
        <button className="btn" onClick={() => document.getElementById('composer-input')?.focus()}>
          Ask the agent
        </button>
      </div>
    </div>
  );
}

export function EditorArea() {
  const active = useWorkspace((s) => s.active);
  const exists = useWorkspace((s) => (s.active ? s.active.startsWith('review:') || s.active in s.files : false));
  const theme = useTheme();
  return (
    <div className="editor-area pane">
      <Tabs />
      <div className="editor-body">
        {!active || !exists ? (
          <Welcome />
        ) : active.startsWith('review:') ? (
          <ReviewPane itemId={active.slice(7)} theme={theme} />
        ) : (
          <Suspense fallback={<div className="editor-loading">Loading the editor</div>}>
            <FileEditor path={active} theme={theme} />
          </Suspense>
        )}
      </div>
    </div>
  );
}
