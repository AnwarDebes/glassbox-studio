import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useSession, type RouteItem, type TimelineEvent, type ToolItem } from '../../state/session';
import { setSetting, useSettings, type BottomTab } from '../../state/settings';
import { revealItem } from '../../state/ui';
import { exportLedger, verifyLedger, verifyTampered } from '../../agent/ledger';
import { Evidence, pillClass } from '../Evidence';
import { clockTime, shortHash } from '../format';
import { Icon } from '../Icon';

const KIND_LABEL: Record<TimelineEvent['kind'], string> = { route: 'Router', guard: 'Guard', human: 'You', tool: 'Tool' };

function outcomeClass(e: TimelineEvent): string {
  if (e.kind === 'guard') return pillClass(e.outcome);
  if (e.kind === 'route') return 'glass';
  if (e.kind === 'human') return e.outcome === 'rejected' ? 'fail' : 'human';
  return e.outcome === 'failed' ? 'fail' : e.outcome === 'proposal' ? 'proposal' : 'tool';
}

const TOOL_VERB: Record<string, string> = {
  list_files: 'list',
  read_file: 'read',
  search: 'search',
  write_file: 'edit',
  delete_file: 'delete',
  run_js: 'run',
  run_command: 'command',
  fetch_url: 'fetch',
};

/** A one-word label under each timeline node. */
function nodeWord(e: TimelineEvent, items: ReturnType<typeof useSession.getState>['items']): string {
  if (e.kind === 'guard' || e.kind === 'route') return e.outcome;
  if (e.kind === 'human') return e.outcome === 'rejected' ? 'you: no' : e.outcome === 'chose' ? 'you: fix' : 'you: yes';
  const item = items.find((it) => it.id === e.itemId);
  return item?.kind === 'tool' ? (TOOL_VERB[item.call.tool] ?? 'tool') : 'tool';
}

function Inspector({ ev }: { ev: TimelineEvent | undefined }) {
  const item = useSession((s) => (ev ? s.items.find((it) => it.id === ev.itemId) : undefined));
  const entry = useSession((s) => (ev?.ledgerSeq !== undefined ? s.ledger.find((l) => l.seq === ev.ledgerSeq) : undefined));
  if (!ev) return <div className="inspector empty faint">Decisions appear here as the agent works. Select one to see why it went that way.</div>;
  const result = item?.kind === 'tool' ? (item as ToolItem).guard : item?.kind === 'route' ? (item as RouteItem).result : undefined;
  const tool = item?.kind === 'tool' ? (item as ToolItem) : undefined;
  return (
    <div className="inspector">
      <div className="inspector-head">
        <span className={`tl-kind ${outcomeClass(ev)}`}>{KIND_LABEL[ev.kind]}</span>
        <span className="grow truncate">{ev.label}</span>
        <span className="faint mono">{clockTime(ev.at)}</span>
        <button className="btn ghost sm" onClick={() => revealItem(ev.itemId)}>
          Show in chat
        </button>
      </div>
      {(ev.kind === 'guard' || ev.kind === 'route') && result ? (
        <Evidence result={result} />
      ) : (
        <>
          <p className="muted inspector-text">
            {ev.kind === 'human'
              ? ev.outcome === 'chose'
                ? 'You picked one of the guard’s safer alternatives. It went through the guard again before it ran.'
                : 'A decision you made. It is recorded in the ledger right after the guard decision it answered.'
              : ev.outcome === 'proposal'
                ? 'A command the agent proposed. Commands never run in the browser; the guard rated it and you can run it yourself.'
                : tool?.decidedBy === 'you'
                  ? 'This ran after you approved it.'
                  : 'This ran after the guard allowed it.'}
          </p>
          {ev.kind === 'tool' && tool?.output ? <pre className="inspector-output" tabIndex={0}>{tool.output.split('\n').slice(0, 12).join('\n')}</pre> : null}
        </>
      )}
      {entry ? (
        <p className="faint inspector-ledger">
          Ledger entry {entry.seq}, hash <span className="mono">{shortHash(entry.hash)}</span>
        </p>
      ) : null}
    </div>
  );
}

function Decisions() {
  const timeline = useSession((s) => s.timeline);
  const items = useSession((s) => s.items);
  const inspect = useSession((s) => s.inspect);
  const rail = useRef<HTMLOListElement>(null);
  const [follow, setFollow] = useState(true);
  const selected = timeline.find((e) => e.id === inspect) ?? (follow ? timeline[timeline.length - 1] : undefined);

  useEffect(() => {
    if (!follow) return;
    rail.current?.lastElementChild?.scrollIntoView({ block: 'nearest', inline: 'end' });
  }, [timeline.length, follow]);

  const select = (id: string) => {
    setFollow(id === timeline[timeline.length - 1]?.id);
    useSession.setState({ inspect: id });
  };

  const onKey = (e: KeyboardEvent, i: number) => {
    if (e.key !== 'ArrowRight' && e.key !== 'ArrowLeft') return;
    e.preventDefault();
    const j = Math.max(0, Math.min(timeline.length - 1, i + (e.key === 'ArrowRight' ? 1 : -1)));
    select(timeline[j].id);
    rail.current?.querySelectorAll<HTMLButtonElement>('button')[j]?.focus();
  };

  return (
    <div className="decisions">
      <ol className="tl-rail" ref={rail} aria-label="Decision timeline">
        {timeline.map((e, i) => (
          <li key={e.id} className="tl-item">
            <button
              className={`tl-node ${outcomeClass(e)} kind-${e.kind} ${selected?.id === e.id ? 'selected' : ''}`}
              onClick={() => select(e.id)}
              onKeyDown={(ev) => onKey(ev, i)}
              aria-pressed={selected?.id === e.id}
              title={`${KIND_LABEL[e.kind]}: ${e.label}`}
            >
              <span className="tl-mark" aria-hidden />
              <span className="tl-text truncate">{nodeWord(e, items)}</span>
              <span className="sr-only">
                , {KIND_LABEL[e.kind]}: {e.label}
              </span>
            </button>
          </li>
        ))}
      </ol>
      <Inspector ev={selected} />
    </div>
  );
}

function Ledger() {
  const ledger = useSession((s) => s.ledger);
  const verify = useSession((s) => s.verify);
  const [open, setOpen] = useState<number | null>(null);
  const [tamper, setTamper] = useState<string>('');

  const runTamper = async () => {
    if (!ledger.length) return;
    const seq = ledger[Math.floor(ledger.length / 2)].seq;
    const r = await verifyTampered(seq);
    setTamper(r.ok ? 'The altered copy still verified, which should not happen.' : `Edited entry ${seq} in a copy: verification fails at entry ${r.brokenAt}. The real ledger is untouched.`);
  };

  return (
    <div className="ledger">
      <div className="ledger-bar">
        <button className="btn sm" onClick={() => void verifyLedger()} disabled={!ledger.length || verify.status === 'checking'}>
          <Icon name="chain" size={14} />
          {verify.status === 'checking' ? 'Verifying' : 'Verify chain'}
        </button>
        <button className="btn sm" onClick={exportLedger} disabled={!ledger.length}>
          <Icon name="download" size={14} /> Export JSON
        </button>
        <button className="btn ghost sm" onClick={() => void runTamper()} disabled={ledger.length < 2} title="Change one entry in a copy and verify it">
          Tamper test
        </button>
        <span className="grow" />
        <span role="status" aria-live="polite" className={`verify-status ${verify.status}`}>
          {verify.status === 'ok' ? `Chain intact: ${verify.count} entries verified` : verify.status === 'broken' ? `Broken at entry ${verify.brokenAt}` : verify.status === 'checking' ? 'Checking every hash' : `${ledger.length} entries`}
        </span>
      </div>
      {tamper ? <p className="tamper-note">{tamper}</p> : null}
      {ledger.length ? (
        <ol className="ledger-list">
          {[...ledger].reverse().map((e) => (
            <li key={e.seq} className={`ledger-row kind-${e.kind}`}>
              <button className="ledger-line" aria-expanded={open === e.seq} onClick={() => setOpen(open === e.seq ? null : e.seq)}>
                <span className="mono faint ledger-seq">{e.seq}</span>
                <span className={`ledger-kind kind-${e.kind}`}>{e.kind}</span>
                <span className="grow truncate">{e.summary}</span>
                <span className="mono faint hide-narrow">{clockTime(e.at)}</span>
                <span className="mono faint ledger-hash">{shortHash(e.hash)}</span>
              </button>
              {open === e.seq ? (
                <pre className="ledger-data" tabIndex={0}>{JSON.stringify({ prev: e.prev, hash: e.hash, at: e.at, data: e.data }, null, 2)}</pre>
              ) : null}
            </li>
          ))}
        </ol>
      ) : (
        <p className="faint panel-empty">Every routing decision, guard decision, approval and tool run is appended here, each hashed together with the one before it.</p>
      )}
    </div>
  );
}

function Output() {
  const output = useSession((s) => s.output);
  if (!output.length) return <p className="faint panel-empty">Output from run_js (code and tests run in the sandbox) shows up here.</p>;
  return (
    <div className="output">
      {[...output].reverse().map((o) => (
        <section key={o.id} className={`output-block ${o.ok ? 'ok' : 'fail'}`}>
          <header className="row">
            <Icon name={o.ok ? 'check' : 'alert'} size={14} />
            <span className="grow truncate">{o.title}</span>
            <span className="faint mono">{clockTime(o.at)}</span>
          </header>
          <pre tabIndex={0}>{o.text}</pre>
        </section>
      ))}
    </div>
  );
}

const TABS: Array<{ id: BottomTab; label: string }> = [
  { id: 'decisions', label: 'Decisions' },
  { id: 'ledger', label: 'Ledger' },
  { id: 'output', label: 'Output' },
];

export function BottomPanel() {
  const tab = useSettings((s) => s.bottomTab);
  const open = useSettings((s) => s.bottomOpen);
  const decisions = useSession((s) => s.timeline.length);
  const ledger = useSession((s) => s.ledger.length);
  const output = useSession((s) => s.output.length);
  const counts2: Record<BottomTab, number> = { decisions, ledger, output };
  return (
    <section className={`bottom pane ${open ? 'open' : 'closed'}`} aria-label="Decisions, ledger and output">
      <div className="bottom-tabs">
        <div className="bottom-tablist" role="tablist" aria-label="Bottom panel">
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`btab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls="bottom-panel"
            className={`bottom-tab ${tab === t.id ? 'active' : ''}`}
            onClick={() => {
              setSetting('bottomTab', t.id);
              if (!open) setSetting('bottomOpen', true);
            }}
          >
            {t.label}
            <span className="count">{counts2[t.id]}</span>
          </button>
        ))}
        </div>
        <span className="grow" />
        <button className="icon-btn" aria-label={open ? 'Collapse panel' : 'Expand panel'} aria-expanded={open} onClick={() => setSetting('bottomOpen', !open)}>
          <Icon name="chevronDown" className={open ? '' : 'flip'} />
        </button>
      </div>
      {open ? (
        <div className="bottom-body" id="bottom-panel" role="tabpanel" aria-labelledby={`btab-${tab}`}>
          {tab === 'decisions' ? <Decisions /> : tab === 'ledger' ? <Ledger /> : <Output />}
        </div>
      ) : null}
    </section>
  );
}
