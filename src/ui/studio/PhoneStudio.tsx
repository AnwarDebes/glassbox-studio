import { useState } from 'react';
import { useSession, type RouteItem, type ToolItem } from '../../state/session';
import { useWorkspace } from '../../workspace/store';
import { startDemo } from '../../agent/demo-run';
import { verifyLedger } from '../../agent/ledger';
import { Evidence, pillClass } from '../Evidence';
import { clockTime, shortHash } from '../format';
import { Icon } from '../Icon';
import { Logo } from '../Logo';
import { Item } from './AgentPanel';
import { PixieDock } from './PixieDock';

type Tab = 'agent' | 'files' | 'decisions' | 'ledger';

function AgentView() {
  const items = useSession((s) => s.items);
  const running = useSession((s) => s.running);
  const demo = useSession((s) => s.demo);
  return (
    <div className="phone-agent">
      {!running ? (
        <button className="btn primary phone-demo" onClick={() => void startDemo()}>
          <Icon name="play" size={14} /> {items.length ? 'Replay the demo' : 'Play the demo'}
        </button>
      ) : null}
      {demo.active ? <p className="faint phone-note">The agent's words are scripted. Routing and guard decisions are computed live on this phone.</p> : null}
      <div className="phone-transcript" role="log" aria-label="Conversation">
        {items.map((it) => (
          <Item key={it.id} item={it} />
        ))}
      </div>
      <p className="faint phone-note">This is a read-only view. Open Glassbox Studio on a tablet or computer to run your own prompts and edit files.</p>
    </div>
  );
}

function FilesView() {
  const files = useWorkspace((s) => s.files);
  const [open, setOpen] = useState<string | null>(null);
  if (open && files[open] !== undefined) {
    const lines = files[open].split('\n');
    return (
      <div className="phone-file">
        <button className="btn ghost sm" onClick={() => setOpen(null)}>
          <Icon name="chevron" size={14} className="flip-h" /> All files
        </button>
        <p className="phone-path mono">{open}</p>
        <pre className="phone-code" tabIndex={0}>
          {lines.map((l, i) => (
            <span key={i} className="code-line">
              <span className="ln" aria-hidden>
                {i + 1}
              </span>
              {l || ' '}
              {'\n'}
            </span>
          ))}
        </pre>
      </div>
    );
  }
  return (
    <ul className="phone-files">
      {Object.keys(files)
        .sort()
        .map((p) => (
          <li key={p}>
            <button className="phone-file-btn" onClick={() => setOpen(p)}>
              <Icon name="file" size={14} />
              <span className="mono truncate">{p}</span>
            </button>
          </li>
        ))}
    </ul>
  );
}

function DecisionsView() {
  const timeline = useSession((s) => s.timeline);
  const items = useSession((s) => s.items);
  const [open, setOpen] = useState<string | null>(null);
  if (!timeline.length) return <p className="faint phone-note">Play the demo to see each decision and the clauses behind it.</p>;
  return (
    <ol className="phone-decisions">
      {[...timeline].reverse().map((e) => {
        const item = items.find((it) => it.id === e.itemId);
        const result = item?.kind === 'tool' ? (item as ToolItem).guard : item?.kind === 'route' ? (item as RouteItem).result : undefined;
        return (
          <li key={e.id}>
            <button className="phone-dec" aria-expanded={open === e.id} onClick={() => setOpen(open === e.id ? null : e.id)} disabled={!result}>
              <span className={`pill ${e.kind === 'guard' ? pillClass(e.outcome) : e.kind === 'route' ? 'glass' : 'muted'}`}>{e.kind === 'guard' || e.kind === 'route' ? e.outcome : e.kind}</span>
              <span className="grow truncate">{e.label}</span>
            </button>
            {open === e.id && result ? <Evidence result={result} /> : null}
          </li>
        );
      })}
    </ol>
  );
}

function LedgerView() {
  const ledger = useSession((s) => s.ledger);
  const verify = useSession((s) => s.verify);
  return (
    <div className="phone-ledger">
      <div className="row">
        <button className="btn sm" disabled={!ledger.length || verify.status === 'checking'} onClick={() => void verifyLedger()}>
          <Icon name="chain" size={14} /> Verify chain
        </button>
        <span className={`verify-status ${verify.status}`} role="status">
          {verify.status === 'ok' ? `Intact: ${verify.count} entries` : verify.status === 'broken' ? `Broken at ${verify.brokenAt}` : `${ledger.length} entries`}
        </span>
      </div>
      <ol className="ledger-list">
        {[...ledger].reverse().map((e) => (
          <li key={e.seq} className="ledger-row">
            <div className="ledger-line static">
              <span className="mono faint ledger-seq">{e.seq}</span>
              <span className={`ledger-kind kind-${e.kind}`}>{e.kind}</span>
              <span className="grow truncate">{e.summary}</span>
            </div>
            <div className="faint mono phone-hash">
              {clockTime(e.at)} {shortHash(e.hash)}
            </div>
          </li>
        ))}
      </ol>
    </div>
  );
}

export function PhoneStudio() {
  const [tab, setTab] = useState<Tab>('agent');
  const TABS: Array<{ id: Tab; label: string }> = [
    { id: 'agent', label: 'Agent' },
    { id: 'files', label: 'Files' },
    { id: 'decisions', label: 'Decisions' },
    { id: 'ledger', label: 'Ledger' },
  ];
  return (
    <div className="phone">
      <header className="phone-top">
        <a className="brand" href="#/" aria-label="Glassbox Studio home">
          <Logo size={22} />
          <span className="brand-name">Glassbox Studio</span>
        </a>
      </header>
      <PixieDock compact />
      <nav className="seg phone-tabs" role="tablist" aria-label="Views">
        {TABS.map((t) => (
          <button key={t.id} role="tab" aria-selected={tab === t.id} className={`seg-btn ${tab === t.id ? 'active' : ''}`} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>
      <main className="phone-body" role="tabpanel">
        {tab === 'agent' ? <AgentView /> : tab === 'files' ? <FilesView /> : tab === 'decisions' ? <DecisionsView /> : <LedgerView />}
      </main>
    </div>
  );
}
