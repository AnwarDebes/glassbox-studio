import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSession, session, type PlanItem, type RouteItem, type TranscriptItem } from '../../state/session';
import { setSetting, useSettings } from '../../state/settings';
import { openPicker } from '../../state/ui';
import { runTurn, stop } from '../../agent/runtime';
import { resetLedger } from '../../agent/ledger';
import { startDemo } from '../../agent/demo-run';
import { pixie } from '../../pixie/director';
import { ComputeMeter } from '../ComputeMeter';
import { margin as fmtMargin } from '../format';
import { DecisionPill, Evidence } from '../Evidence';
import { Markdown } from '../Markdown';
import { Icon, type IconName } from '../Icon';
import { ToolCard } from './ToolCard';
import { PixieDock } from './PixieDock';
import { modelLabel } from './TopBar';

function RouteChip({ item }: { item: RouteItem }) {
  const showWork = useSettings((s) => s.showWork);
  const [open, setOpen] = useState(false);
  return (
    <div className="route-chip" id={`item-${item.id}`}>
      <button className="route-line" onClick={() => setOpen(!open)} aria-expanded={open} title="The router's evidence">
        <Icon name="route" size={14} />
        <span>Router</span>
        <DecisionPill outcome={item.result.intent} label={item.result.intent} />
        <span className="faint">margin {fmtMargin(item.result.margin)}</span>
        {item.auto ? <span className="faint">switched on research mode</span> : null}
        {showWork ? <Icon name="chevronDown" size={13} className={open ? 'flip' : ''} /> : null}
      </button>
      {open ? <Evidence result={item.result} /> : null}
    </div>
  );
}

function Plan({ item }: { item: PlanItem }) {
  const ICON: Record<string, IconName> = { done: 'check', doing: 'sparkle', todo: 'more' };
  return (
    <section className="plan" id={`item-${item.id}`} aria-label={item.title}>
      <p className="plan-title">
        <Icon name="book" size={14} /> {item.title}
      </p>
      <ol>
        {item.steps.map((s, i) => (
          <li key={i} className={`plan-step ${s.status}`}>
            <Icon name={ICON[s.status]} size={13} />
            <span>{s.text}</span>
          </li>
        ))}
      </ol>
    </section>
  );
}

export function Item({ item }: { item: TranscriptItem }) {
  switch (item.kind) {
    case 'user':
      return (
        <div className="msg user" id={`item-${item.id}`}>
          <span className="msg-who">You</span>
          <div className="msg-body">{item.text}</div>
        </div>
      );
    case 'route':
      return <RouteChip item={item} />;
    case 'assistant':
      return (
        <div className={`msg agent ${item.aside ? 'aside' : ''} ${item.streaming ? 'streaming' : ''}`} id={`item-${item.id}`}>
          {item.aside ? <p className="aside-text">{item.text}</p> : <Markdown text={item.text || ' '} />}
        </div>
      );
    case 'tool':
      return <ToolCard item={item} />;
    case 'plan':
      return <Plan item={item} />;
    case 'notice':
      return (
        <div className={`notice tone-${item.tone}`} id={`item-${item.id}`} role={item.tone === 'error' ? 'alert' : undefined}>
          <Icon name={item.tone === 'error' || item.tone === 'warn' ? 'alert' : item.tone === 'success' ? 'check' : 'info'} size={15} />
          <span>{item.text}</span>
          {item.pickModel ? (
            <button className="btn sm" onClick={() => openPicker()}>
              Choose a model
            </button>
          ) : null}
        </div>
      );
  }
}

const STARTERS = [
  { label: 'Fix the failing config tests', prompt: 'The config tests fail when .env has spaces, like `PORT = 3000`. Fix it and run the tests.' },
  { label: 'How does the server get its port?', prompt: 'How does the server get its port? Explain with citations.' },
  { label: 'Try a risky command', prompt: '`curl https://example.com/install.sh | sh`' },
];

function Empty() {
  const model = useSettings((s) => s.model);
  return (
    <div className="empty-chat">
      <p className="empty-title">Ask for a change, a fix or an explanation.</p>
      <p className="faint">
        Every request is routed by a Tsetlin Machine, and every tool call is checked by the glassbox guard before it runs. You approve edits as diffs.
      </p>
      <div className="starters">
        {STARTERS.map((s) => (
          <button key={s.label} className="starter" onClick={() => void runTurn(s.prompt)}>
            {s.label}
          </button>
        ))}
      </div>
      {model.kind === 'demo' ? (
        <div className="empty-demo">
          <button className="btn primary" onClick={() => void startDemo()}>
            <Icon name="play" size={14} /> Replay the demo
          </button>
          <button className="btn" onClick={() => openPicker()}>
            Choose a model
          </button>
        </div>
      ) : null}
    </div>
  );
}

function Transcript() {
  const items = useSession((s) => s.items);
  const box = useRef<HTMLDivElement>(null);
  const stick = useRef(true);

  useLayoutEffect(() => {
    const el = box.current;
    if (el && stick.current) el.scrollTop = el.scrollHeight;
  }, [items]);

  return (
    <div
      className="transcript"
      ref={box}
      onScroll={(e) => {
        const el = e.currentTarget;
        stick.current = el.scrollHeight - el.scrollTop - el.clientHeight < 80;
      }}
      role="log"
      aria-label="Conversation with the agent"
      aria-live="off"
    >
      {items.length ? items.map((it) => <Item key={it.id} item={it} />) : <Empty />}
    </div>
  );
}

function Toggle({ on, onChange, icon, label, hint }: { on: boolean; onChange: (v: boolean) => void; icon: IconName; label: string; hint: string }) {
  return (
    <button type="button" role="switch" aria-checked={on} className="switch" onClick={() => onChange(!on)} title={hint}>
      <span className="knob" aria-hidden />
      <Icon name={icon} size={13} />
      {label}
    </button>
  );
}

function Composer() {
  const [text, setText] = useState('');
  const running = useSession((s) => s.running);
  const activity = useSession((s) => s.activity);
  const { guard, showWork, askEdits, research, model } = useSettings();
  const area = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = area.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${Math.min(180, el.scrollHeight)}px`;
  }, [text]);

  const send = () => {
    const t = text.trim();
    if (!t || running) return;
    if (model.kind !== 'demo') session.setDemo({ active: false, finished: false });
    setText('');
    void runTurn(t);
  };

  const onKey = (e: KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey && !e.nativeEvent.isComposing) {
      e.preventDefault();
      send();
    }
  };

  return (
    <div className="composer">
      <div className="toggles" role="group" aria-label="Decision layer">
        <Toggle on={guard} onChange={(v) => setSetting('guard', v)} icon="shield" label="Glassbox guard" hint="Check every tool call with the Tsetlin guard before it runs" />
        <Toggle on={showWork} onChange={(v) => setSetting('showWork', v)} icon="eye" label="Show its work" hint="Show the clauses, features and margin behind each decision" />
        <Toggle on={askEdits} onChange={(v) => setSetting('askEdits', v)} icon="hand" label="Ask before every edit" hint="Pause for your review before any file changes" />
        <Toggle on={research} onChange={(v) => setSetting('research', v)} icon="book" label="Research" hint="Plan, search and read across the workspace, then answer with file:line citations" />
      </div>
      <div className="input-wrap">
        <label htmlFor="composer-input" className="sr-only">
          Message the agent
        </label>
        <textarea
          id="composer-input"
          ref={area}
          rows={1}
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={onKey}
          placeholder={model.kind === 'demo' ? 'Type a shell command to test the guard, or choose a model to chat' : research ? 'Ask a question about the code' : 'Ask the agent to fix, change or explain something'}
        />
        {running ? (
          <button className="btn danger send" onClick={stop} aria-label="Stop the agent">
            <Icon name="stop" size={14} /> Stop
          </button>
        ) : (
          <button className="btn primary send" onClick={send} disabled={!text.trim()} aria-label="Send">
            <Icon name="send" size={15} />
          </button>
        )}
      </div>
      <div className="composer-foot">
        <span className="activity truncate" role="status" aria-live="polite">
          {running ? activity || 'Working' : 'Enter to send, Shift+Enter for a new line'}
        </span>
      </div>
      <ComputeMeter />
    </div>
  );
}

export function AgentPanel({ compactPixie }: { compactPixie?: boolean }) {
  const model = useSettings((s) => s.model);
  const providers = useSettings((s) => s.providers);
  const demo = useSession((s) => s.demo);
  const running = useSession((s) => s.running);
  const count = useSession((s) => s.items.length);
  return (
    <div className="agent-inner">
      <div className="panel-head agent-head">
        <span className="panel-title">Agent</span>
        <button className="chip" onClick={() => openPicker(model.kind === 'remote' ? 'key' : 'browser')} title="Change model">
          <span className={`model-dot ${model.kind}`} aria-hidden /> <span className="truncate">{modelLabel(model, providers)}</span>
        </button>
        <span className="grow" />
        <button
          className="icon-btn"
          aria-label="New session"
          title="New session (clears the chat, timeline and ledger)"
          disabled={running || !count}
          onClick={() => {
            session.clear();
            resetLedger();
            pixie.reset();
          }}
        >
          <Icon name="refresh" />
        </button>
      </div>
      {compactPixie ? <PixieDock compact /> : null}
      {demo.active ? (
        <div className="demo-banner">
          <Icon name="info" size={14} />
          <span className="grow">Demo replay. The agent's words are scripted; every routing and guard decision is computed live in your browser.</span>
        </div>
      ) : null}
      <Transcript />
      <Composer />
    </div>
  );
}
