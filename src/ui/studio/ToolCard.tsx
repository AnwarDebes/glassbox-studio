import { useState } from 'react';
import type { ToolItem } from '../../state/session';
import { useSession } from '../../state/session';
import { useSettings } from '../../state/settings';
import { decide, revertEdit, runRepair } from '../../agent/runtime';
import { describeCall } from '../../agent/tools';
import { workspace } from '../../workspace/store';
import { DecisionPill, Evidence, ruleSummary, tellingClause } from '../Evidence';
import { DiffView } from '../DiffView';
import { Icon, type IconName } from '../Icon';
import { toast } from '../../state/ui';

const TOOL_ICON: Record<string, IconName> = {
  list_files: 'folder',
  read_file: 'file',
  search: 'search',
  write_file: 'edit',
  delete_file: 'trash',
  run_js: 'play',
  run_command: 'terminal',
  fetch_url: 'globe',
};

const STATUS_TEXT: Record<ToolItem['status'], string> = {
  checking: 'Checking',
  awaiting: 'Waiting for you',
  running: 'Running',
  done: 'Done',
  failed: 'Failed',
  blocked: 'Not run',
  denied: 'Rejected',
  proposal: 'Proposal',
};

function topRule(item: ToolItem): string | null {
  const g = item.guard;
  if (!g) return null;
  const c = tellingClause(g);
  return c ? ruleSummary(c, 2) : null;
}

export function ToolCard({ item }: { item: ToolItem }) {
  const showWork = useSettings((s) => s.showWork);
  const running = useSession((s) => s.running);
  const autoOpen = item.status === 'blocked' || item.awaitReason === 'guard';
  const [evOpen, setEvOpen] = useState<boolean | null>(null);
  const [outOpen, setOutOpen] = useState(false);
  const evidenceOpen = evOpen ?? (showWork && autoOpen);
  const call = item.call;
  const rule = topRule(item);
  const awaiting = item.status === 'awaiting';

  return (
    <article className={`tool-card status-${item.status} ${item.guard ? `d-${item.guard.decision}` : 'd-none'}`} id={`item-${item.id}`} aria-label={describeCall(call)}>
      <header className="tool-head">
        <span className="tool-icon" aria-hidden>
          <Icon name={TOOL_ICON[call.tool] ?? 'cpu'} size={15} />
        </span>
        <span className="tool-title truncate">{describeCall(call)}</span>
        {item.guard ? (
          <button className="pill-btn" onClick={() => setEvOpen(!evidenceOpen)} aria-expanded={evidenceOpen} title="Show the guard's evidence">
            <DecisionPill outcome={item.guard.decision} />
          </button>
        ) : item.guardOff ? (
          <span className="pill muted" title="The glassbox guard was off for this call">
            Unchecked
          </span>
        ) : null}
        <span className={`tool-status s-${item.reverted ? 'denied' : item.status}`}>
          {item.status === 'checking' ? <span className="spinner" aria-hidden /> : null}
          {item.reverted ? 'Reverted' : STATUS_TEXT[item.status]}
        </span>
      </header>

      {showWork && rule && !evidenceOpen ? (
        <button className="tool-why" onClick={() => setEvOpen(true)}>
          <span className="faint">Why:</span> <span className="truncate">{rule}</span>
        </button>
      ) : null}
      {evidenceOpen && item.guard ? <Evidence result={item.guard} compact={item.guard.decision === 'allow'} /> : null}

      {call.tool === 'run_command' ? (
        <div className="cmd-block">
          <code>$ {call.args.command}</code>
          <button
            className="icon-btn"
            aria-label="Copy command"
            onClick={() => {
              void navigator.clipboard?.writeText(call.args.command ?? '').then(() => toast('Command copied.', 'success'));
            }}
          >
            <Icon name="copy" size={14} />
          </button>
        </div>
      ) : null}

      {item.diff && (awaiting || item.status === 'denied' || item.status === 'done' || item.status === 'blocked') ? (
        <DiffView before={item.diff.before} after={item.diff.after} maxRows={awaiting ? 60 : 24} />
      ) : null}

      {awaiting ? (
        <div className="approval" role="group" aria-label="Your decision">
          <p className="approval-text">
            {item.awaitReason === 'guard'
              ? 'The guard is not sure about this one and wants you to decide.'
              : item.awaitReason === 'review'
                ? 'Review the edit. Nothing changes until you accept it.'
                : 'This needs your OK before it runs.'}
          </p>
          <div className="row">
            {item.diff ? (
              <button className="btn ghost sm" onClick={() => workspace.openTab(`review:${item.id}`)}>
                <Icon name="eye" size={14} /> Open in editor
              </button>
            ) : null}
            <span className="grow" />
            <button className="btn danger sm" onClick={() => decide(item.id, 'reject')}>
              {item.diff ? 'Reject' : 'Deny'}
            </button>
            <button className="btn approve sm" onClick={() => decide(item.id, 'approve')} autoFocus>
              {item.diff ? 'Accept edit' : 'Allow once'}
            </button>
          </div>
        </div>
      ) : null}

      {item.status === 'blocked' && item.repairs?.length ? (
        <div className="repairs">
          <p className="repairs-title">Safer alternatives</p>
          {item.repairs.map((r, i) => (
            <div key={i} className="repair">
              <div className="grow">
                <div className="repair-title">{r.title}</div>
                <div className="faint repair-why">{r.why}</div>
                <code className="repair-call">
                  {r.call.tool}({Object.entries(r.call.args)
                    .map(([k, v]) => `${k}: ${JSON.stringify(v.length > 60 ? `${v.slice(0, 57)}...` : v)}`)
                    .join(', ')})
                </code>
              </div>
              <button className="btn sm" disabled={running} onClick={() => void runRepair(item.id, r)} title={running ? 'Available when the agent is idle' : 'Run this instead (the guard checks it first)'}>
                Use this
              </button>
            </div>
          ))}
        </div>
      ) : null}

      {item.summary || item.output || item.note ? (
        <footer className="tool-foot">
          {item.summary ? <span className="tool-summary">{item.summary}</span> : null}
          {item.note ? <span className="faint">{item.note}</span> : null}
          {call.tool === 'write_file' && item.status === 'done' && item.diff && !item.reverted ? (
            <button className="btn ghost sm" disabled={running} onClick={() => void revertEdit(item.id)} title="Put the file back the way it was">
              Revert edit
            </button>
          ) : null}
          {item.output && call.tool !== 'write_file' ? (
            <button className="btn ghost sm" aria-expanded={outOpen} onClick={() => setOutOpen(!outOpen)}>
              {outOpen ? 'Hide output' : 'Show output'}
            </button>
          ) : null}
        </footer>
      ) : null}
      {outOpen && item.output ? (
        <pre className="tool-output" tabIndex={0}>
          {item.output}
        </pre>
      ) : null}
    </article>
  );
}
