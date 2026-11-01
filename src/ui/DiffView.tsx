import { useMemo } from 'react';
import { diffLines, diffStats, withContext } from '../workspace/diff';

interface DiffViewProps {
  before: string;
  after: string;
  maxRows?: number;
}

/** A compact unified diff for chat cards and phones. */
export function DiffView({ before, after, maxRows = 80 }: DiffViewProps) {
  const { rows, stats } = useMemo(() => {
    const lines = diffLines(before, after);
    return { rows: withContext(lines, 2), stats: diffStats(lines) };
  }, [before, after]);
  const shown = rows.slice(0, maxRows);
  return (
    <div className="diff" role="group" aria-label={`Proposed change: ${stats.added} lines added, ${stats.removed} removed`}>
      <div className="diff-stats">
        <span className="diff-add">+{stats.added}</span>
        <span className="diff-del">−{stats.removed}</span>
      </div>
      <div className="diff-body" tabIndex={0} role="region" aria-label="Changed lines">
        {shown.map((r, i) =>
          r.type === 'gap' ? (
            <div key={i} className="diff-gap">
              {r.hidden} unchanged line{r.hidden === 1 ? '' : 's'}
            </div>
          ) : (
            <div key={i} className={`diff-line ${r.type}`}>
              <span className="diff-no" aria-hidden>
                {r.type === 'add' ? '' : r.oldNo}
              </span>
              <span className="diff-no" aria-hidden>
                {r.type === 'del' ? '' : r.newNo}
              </span>
              <span className="diff-sign" aria-hidden>
                {r.type === 'add' ? '+' : r.type === 'del' ? '−' : ' '}
              </span>
              <span className="diff-text">
                {r.type === 'add' ? <span className="sr-only">Added: </span> : r.type === 'del' ? <span className="sr-only">Removed: </span> : null}
                {r.text || ' '}
              </span>
            </div>
          ),
        )}
        {rows.length > shown.length ? <div className="diff-gap">{rows.length - shown.length} more rows in the editor review</div> : null}
      </div>
    </div>
  );
}
