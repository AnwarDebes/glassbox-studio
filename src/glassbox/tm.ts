// Inference over an exported Tsetlin Machine: integer-weighted clauses, each an
// AND of literals over named Boolean features. Twin of ExportedModel in
// glassbox/gbx/tm.py; this is the only place the class scores are computed.

import type { ClauseEvidence, ClauseJSON, FeatureInfo, ModelJSON } from './types';

/** How many conditions a rule sentence spells out before "(+N more conditions)". */
export const RULE_SHOWN = 6;

interface Clause {
  id: number;
  cls: number;
  pol: 1 | -1;
  w: number;
  pos: Int32Array;
  neg: Int32Array;
}

export interface Evaluation {
  /** Class scores (sum of polarity x weight over firing clauses), indexed like `classes`. */
  scores: number[];
  /** Index of the winning class (ties go to the class listed first in tiePriority). */
  winner: number;
  /** Winning score minus the best other score (0 on a tie). */
  margin: number;
  /** Indices (into `clauses`) of every clause that fired. */
  fired: number[];
  /** In-vocabulary features that are present, in vocabulary order. */
  active: string[];
  literalChecks: number;
}

export class CompiledModel {
  readonly json: ModelJSON;
  readonly classes: string[];
  readonly features: FeatureInfo[];
  private readonly index: Map<string, number>;
  private readonly clauses: Clause[];
  private readonly priority: number[];
  private readonly x: Uint8Array;

  constructor(json: ModelJSON) {
    if (json.format !== 'glassbox-tm/1') throw new Error(`unsupported model format: ${String(json.format)}`);
    this.json = json;
    this.classes = json.classes;
    this.features = json.features;
    this.index = new Map(json.features.map((f, i) => [f.name, i]));
    const F = json.features.length;
    const classIndex = new Map(json.classes.map((c, i) => [c, i]));
    this.clauses = json.clauses.map((c: ClauseJSON) => {
      const cls = classIndex.get(c.cls);
      if (cls === undefined) throw new Error(`clause ${c.id} has unknown class ${c.cls}`);
      for (const j of [...c.pos, ...c.neg]) if (!(j >= 0 && j < F)) throw new Error(`clause ${c.id} references feature ${j}`);
      return { id: c.id, cls, pol: c.pol === -1 ? -1 : 1, w: c.w, pos: Int32Array.from(c.pos), neg: Int32Array.from(c.neg) };
    });
    this.priority = json.tiePriority.map((c) => {
      const k = classIndex.get(c);
      if (k === undefined) throw new Error(`tiePriority names unknown class ${c}`);
      return k;
    });
    this.x = new Uint8Array(F);
  }

  get clauseCount(): number {
    return this.clauses.length;
  }

  evaluate(featureNames: readonly string[]): Evaluation {
    const x = this.x;
    x.fill(0);
    for (const name of featureNames) {
      const j = this.index.get(name);
      if (j !== undefined) x[j] = 1;
    }
    const scores = new Array<number>(this.classes.length).fill(0);
    const fired: number[] = [];
    let checks = 0;
    const clauses = this.clauses;
    for (let c = 0; c < clauses.length; c++) {
      const cl = clauses[c];
      let ok = true;
      const pos = cl.pos;
      for (let i = 0; i < pos.length; i++) {
        checks++;
        if (x[pos[i]] === 0) { ok = false; break; }
      }
      if (ok) {
        const neg = cl.neg;
        for (let i = 0; i < neg.length; i++) {
          checks++;
          if (x[neg[i]] === 1) { ok = false; break; }
        }
      }
      if (ok) {
        scores[cl.cls] += cl.pol * cl.w;
        fired.push(c);
      }
    }
    let winner = this.priority[0];
    for (const k of this.priority) if (scores[k] > scores[winner]) winner = k;
    let second = -Infinity;
    for (let k = 0; k < scores.length; k++) if (k !== winner && scores[k] > second) second = scores[k];
    const active: string[] = [];
    for (let j = 0; j < x.length; j++) if (x[j]) active.push(this.features[j].name);
    return { scores, winner, margin: second === -Infinity ? 0 : scores[winner] - second, fired, active, literalChecks: checks };
  }

  /**
   * Readable form of one clause, e.g. `block because: deletes files AND target
   * is outside the workspace AND NOT "--dry-run"`. Present-feature conditions
   * come first, then negations in the order the training pipeline ranked them
   * (most discriminating first). The rule shows at most RULE_SHOWN conditions
   * and says how many more there are; `literals` always lists all of them.
   */
  describe(clauseIndex: number): ClauseEvidence {
    const c = this.clauses[clauseIndex];
    const literals = [...Array.from(c.pos, (j) => this.features[j].text), ...Array.from(c.neg, (j) => this.features[j].neg)];
    const cls = this.classes[c.cls];
    const head = c.pol > 0 ? cls : `not ${cls}`;
    const more = literals.length - RULE_SHOWN;
    const rule = `${head} because: ${literals.slice(0, RULE_SHOWN).join(' AND ')}${more > 0 ? ` (+${more} more conditions)` : ''}`;
    return { id: c.id, cls, polarity: c.pol, weight: c.w, rule, literals };
  }

  /**
   * Evidence for a decision: up to `top` clauses that fired and voted for the
   * winning class (those that name something present in the input first, as
   * they explain the most; then by weight), then the single heaviest firing
   * clause that argues against it (a -1 clause of the winner, or a +1 clause
   * of another class), if any.
   */
  evidence(ev: Evaluation, top = 3): ClauseEvidence[] {
    const by = (a: number, b: number): number => {
      const ca = this.clauses[a];
      const cb = this.clauses[b];
      return cb.w - ca.w || ca.pos.length + ca.neg.length - (cb.pos.length + cb.neg.length) || ca.id - cb.id;
    };
    const named = (i: number): number => (this.clauses[i].pos.length > 0 ? 1 : 0);
    const forWinner = ev.fired
      .filter((i) => this.clauses[i].cls === ev.winner && this.clauses[i].pol > 0)
      .sort((a, b) => named(b) - named(a) || by(a, b))
      .slice(0, top);
    const against = ev.fired
      .filter((i) => {
        const c = this.clauses[i];
        return (c.cls === ev.winner && c.pol < 0) || (c.cls !== ev.winner && c.pol > 0);
      })
      .sort(by)[0];
    const out = forWinner.map((i) => this.describe(i));
    if (against !== undefined) out.push(this.describe(against));
    return out;
  }
}
