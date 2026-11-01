// Router featurizer: a chat prompt -> named Boolean features.
// Twin of glassbox/gbx/router_features.py (unigrams w:, bigrams b:, first
// content word f:, regex facts x:, len:short / len:long).

import type { RouterSpec } from './types';
import { fold, norm } from './text';

export interface RouterFeatureResult { features: string[]; scanned: number }

export class RouterFeaturizer {
  private readonly token: RegExp;
  private readonly fillers: Set<string>;
  private readonly facts: { name: string; on: string; re: RegExp }[];
  private readonly shortMax: number;
  private readonly longMin: number;

  constructor(spec: RouterSpec) {
    this.token = new RegExp(spec.token, 'g');
    this.fillers = new Set(spec.fillers);
    this.facts = spec.facts.map((f) => ({ name: f.name, on: Array.isArray(f.on) ? f.on[0] : f.on, re: new RegExp(f.re) }));
    this.shortMax = spec.shortMax;
    this.longMin = spec.longMin;
  }

  featurize(prompt: string): RouterFeatureResult {
    const text = norm(prompt).replace(/'/g, '');
    const raw = fold(prompt);
    const toks = text.match(this.token) ?? [];
    const feats = new Set<string>();
    for (const t of toks) feats.add('w:' + t);
    for (let i = 0; i + 1 < toks.length; i++) feats.add('b:' + toks[i] + ' ' + toks[i + 1]);
    for (const t of toks) {
      if (!this.fillers.has(t)) {
        feats.add('f:' + t);
        break;
      }
    }
    if (toks.length <= this.shortMax) feats.add('len:short');
    if (toks.length >= this.longMin) feats.add('len:long');
    let scanned = text.length;
    for (const f of this.facts) {
      const s = f.on === 'text' ? text : raw;
      scanned += s.length;
      if (f.re.test(s)) feats.add(f.name);
    }
    return { features: [...feats].sort(), scanned };
  }
}
