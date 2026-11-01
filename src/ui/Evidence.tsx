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

function Clause({ c, winner }: { c: ClauseEvidence; winner: string }) {
  const sign = c.polarity > 0 ? '+' : '−';
  const head = ruleHead(c.rule);
  const [all, setAll] = useState(false);
  return (
    <li className={`ev-clause ${c.cls === winner && c.polarity > 0 ? 'for' : 'against'}`}>
      <div className="ev-clause-head">
        <span className={`ev-weight ${pillClass(c.cls)}`} title={`${c.polarity > 0 ? 'Votes for' : 'Votes against'} ${c.cls} with weight ${c.weight}`}>
          {sign}
          {c.weight}
        </span>
        <span className="ev-clause-cls">{c.polarity > 0 ? 'for' : 'against'} {c.cls}</span>
        {c.polarity > 0 && c.cls !== winner ? <span className="ev-against">argued against this decision</span> : null}
        <span className="ev-clause-id faint">clause {c.id}</span>
      </div>
      {head ? (
        <p className="ev-rule-head">
          <strong>{head}</strong>, because all of these hold:
        </p>
      ) : (
        <p className="ev-rule">{c.rule}</p>
      )}
      {c.literals.length ? (
        <div className="ev-literals">
          {(all ? c.literals : c.literals.slice(0, LITERALS_SHOWN)).map((l, i) => (
            <span key={i} className={`lit phrase ${isNegated(l) ? 'neg' : ''}`}>
              {l}
            </span>
          ))}
          {c.literals.length > LITERALS_SHOWN ? (
            <button type="button" className="lit-more" onClick={() => setAll(!all)} aria-expanded={all}>
              {all ? 'Show fewer' : `+${c.literals.length - LITERALS_SHOWN} more`}
            </button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

const LITERALS_SHOWN = 8;

function isNegated(literal: string): boolean {
  return /^(NOT\b|not\b|no\b|nothing\b|¬|!)/.test(literal) || /\bis not\b/.test(literal);
}

/** "block" from "block because: a AND b", or null for other rule formats. */
export function ruleHead(rule: string): string | null {
  const m = /^(.*?) because:? /.exec(rule);
  return m ? m[1] : null;
}

/**
 * The clause that best explains a decision in one line: among the clauses
 * voting for the winner, the one with the most positive (present) conditions,
 * then the heaviest.
 */
export function tellingClause(r: Result): ClauseEvidence | undefined {
  const cls = decisionOf(r);
  const positives = (c: ClauseEvidence) => c.literals.filter((l) => !isNegated(l)).length;
  return r.evidence
    .filter((e) => e.cls === cls && e.polarity > 0)
    .sort((a, b) => positives(b) - positives(a) || b.weight - a.weight)[0];
}

/** A one-line reading of a clause for previews: "block because a and b, and 12 more". */
export function ruleSummary(c: ClauseEvidence, n = 2): string {
  const head = ruleHead(c.rule);
  if (!head || !c.literals.length) return c.rule;
  const shown = c.literals.slice(0, n).join(' and ');
  const rest = c.literals.length - n;
  return `${head} because ${shown}${rest > 0 ? `, and ${rest} more` : ''}`;
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
  const winner = decisionOf(result);
  const decided = (c: ClauseEvidence) => (c.cls === winner && c.polarity > 0 ? 1 : 0);
  const clauses = [...result.evidence].sort((a, b) => decided(b) - decided(a) || b.weight - a.weight);
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
            <Clause key={`${c.cls}-${c.id}`} c={c} winner={winner} />
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
