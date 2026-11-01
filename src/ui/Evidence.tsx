import { useState, type CSSProperties } from 'react';
import { savings, type ClauseEvidence, type GuardResult, type RouteResult } from '../app/gb';
import { useGlassbox } from '../agent/glassbox';
import { compact, factor, margin as fmtMargin, ms } from './format';

type Result = GuardResult | RouteResult;

const DECISION_CLASS: Record<string, string> = { allow: 'allow', ask: 'ask', block: 'block' };

export function decisionOf(r: Result): string {
  return 'decision' in r ? r.decision : r.intent;
}

export function pillClass(outcome: string): string {
  return DECISION_CLASS[outcome] ?? 'glass';
}

export function DecisionPill({ outcome, label }: { outcome: string; label?: string }) {
  const text = label ?? (outcome === 'allow' ? 'Allowed' : outcome === 'ask' ? 'Asks you' : outcome === 'block' ? 'Blocked' : outcome);
  return (
    <span className={`pill ${pillClass(outcome)}`}>
      <span className="dot" aria-hidden />
      {text}
    </span>
  );
}

function Scores({ r }: { r: Result }) {
  const entries = Object.entries(r.scores) as Array<[string, number]>;
  const max = Math.max(1e-9, ...entries.map(([, v]) => Math.abs(v)));
  const winner = decisionOf(r);
  return (
    <div className="ev-scores" role="list" aria-label="Class scores">
      {entries
        .sort((a, b) => b[1] - a[1])
        .map(([cls, v]) => (
          <div key={cls} className={`ev-score ${cls === winner ? 'win' : ''}`} role="listitem">
            <span className="ev-score-label">{cls}</span>
            <span className="ev-bar" aria-hidden>
              <span className={`ev-fill ${pillClass(cls)}`} style={{ width: `${Math.max(2, (Math.max(0, v) / max) * 100)}%` }} />
            </span>
            <span className="ev-score-val mono">{Number.isInteger(v) ? v : v.toFixed(2)}</span>
          </div>
        ))}
    </div>
  );
}

function Clause({ c }: { c: ClauseEvidence }) {
  const sign = c.polarity > 0 ? '+' : '−';
  return (
    <li className={`ev-clause ${c.polarity > 0 ? 'for' : 'against'}`}>
      <div className="ev-clause-head">
        <span className={`ev-weight ${pillClass(c.cls)}`} title={`${c.polarity > 0 ? 'Votes for' : 'Votes against'} ${c.cls} with weight ${c.weight}`}>
          {sign}
          {c.weight}
        </span>
        <span className="ev-clause-cls">{c.polarity > 0 ? 'for' : 'against'} {c.cls}</span>
        <span className="ev-clause-id faint">clause {c.id}</span>
      </div>
      <p className="ev-rule">{c.rule}</p>
      {c.literals.length ? (
        <div className="ev-literals">
          {c.literals.map((l, i) => (
            <code key={i} className={`lit ${/^(NOT |¬|!)/.test(l) ? 'neg' : ''}`}>
              {l}
            </code>
          ))}
        </div>
      ) : null}
    </li>
  );
}

interface EvidenceProps {
  result: Result;
  /** Compact: no score bars, fewer clauses. */
  compact?: boolean;
}

export function Evidence({ result, compact: small }: EvidenceProps) {
  const [all, setAll] = useState(false);
  const cards = useGlassbox((s) => s.cards);
  const card = cards.find((c) => c.id === result.modelId);
  const clauses = [...result.evidence].sort((a, b) => b.weight - a.weight || b.polarity - a.polarity);
  const limit = small ? 3 : 5;
  const shown = all ? clauses : clauses.slice(0, limit);
  const s = savings(result.compute);
  return (
    <div className="evidence" style={card ? ({ '--model': card.color } as CSSProperties) : undefined}>
      <div className="ev-head">
        <DecisionPill outcome={decisionOf(result)} />
        <span className="ev-margin" title="How far the winning class is ahead of the runner-up">
          margin <strong className="mono">{fmtMargin(result.margin)}</strong>
        </span>
        <span className="ev-model faint truncate">{card?.name ?? result.modelId}</span>
      </div>
      {!small ? <Scores r={result} /> : null}
      <div className="ev-section-title">
        Clauses that fired <span className="faint">({clauses.length})</span>
      </div>
      {clauses.length ? (
        <ul className="ev-clauses">
          {shown.map((c) => (
            <Clause key={`${c.cls}-${c.id}`} c={c} />
          ))}
        </ul>
      ) : (
        <p className="faint ev-empty">No clause fired; the decision fell back to the class prior.</p>
      )}
      {clauses.length > limit ? (
        <button type="button" className="btn ghost sm" onClick={() => setAll(!all)}>
          {all ? 'Show fewer' : `Show all ${clauses.length}`}
        </button>
      ) : null}
      <div className="ev-section-title">Features seen</div>
      <div className="ev-literals">
        {result.features.length ? result.features.map((f) => <code key={f} className="lit">{f}</code>) : <span className="faint">none</span>}
      </div>
      <div className="ev-compute">
        <span>
          {compact(result.compute.clausesEvaluated)} clauses, {compact(result.compute.literalChecks)} literal checks, about {compact(result.compute.estimatedOps)} operations in {ms(result.ms)}.
        </span>
        <span className="ev-savings" title={s.text}>
          About {factor(s.factor)} less compute than an LLM judge (estimate)
        </span>
      </div>
    </div>
  );
}
