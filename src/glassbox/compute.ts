// Compute accounting: what one Glassbox decision costs versus asking an LLM judge.

import type { Compute } from './types';

/**
 * Estimated floating-point operations for one forward pass of a dense
 * transformer used as a judge: about 2 x parameters x tokens (the standard
 * forward-pass estimate; attention over long contexts and the generated
 * answer tokens are ignored, so this is a lower bound for real judges).
 */
export function llmJudgeOps(paramsBillions: number, tokens: number): number {
  return 2 * paramsBillions * 1e9 * tokens;
}

/**
 * Compares a Glassbox decision with an LLM judge reading a prompt of `tokens`
 * tokens. Defaults: a 1B-parameter model (a small judge) and a 300-token
 * prompt (policy instructions plus the tool call). Both sides are estimates:
 * the Glassbox side counts regex characters scanned while extracting
 * features, one check per literal tested and one vote per clause.
 */
export function savings(compute: Compute, paramsBillions = 1, tokens = 300): { tmOps: number; llmOps: number; factor: number; text: string } {
  const tmOps = Math.max(1, compute.estimatedOps);
  const llmOps = llmJudgeOps(paramsBillions, tokens);
  const factor = llmOps / tmOps;
  const size = formatParams(paramsBillions);
  return {
    tmOps,
    llmOps,
    factor,
    text: `about ${formatFactor(factor)}x less compute than asking ${size.startsWith('8') ? 'an' : 'a'} ${size}-parameter model`,
  };
}

/** Two significant figures with thousands separators: 4,831,207 -> "4,800,000". */
export function formatFactor(x: number): string {
  if (!Number.isFinite(x) || x <= 0) return '0';
  if (x < 10) return (Math.round(x * 10) / 10).toString();
  const digits = Math.floor(Math.log10(x)) + 1;
  const scale = Math.pow(10, digits - 2);
  const rounded = Math.round(x / scale) * scale;
  return groupThousands(Math.round(rounded));
}

function groupThousands(n: number): string {
  const s = Math.abs(n).toString();
  let out = '';
  for (let i = 0; i < s.length; i++) {
    if (i > 0 && (s.length - i) % 3 === 0) out += ',';
    out += s[i];
  }
  return (n < 0 ? '-' : '') + out;
}

function formatParams(b: number): string {
  if (b >= 1000) return `${Math.round(b / 100) / 10}T`;
  if (b >= 1) return `${Math.round(b * 10) / 10}B`;
  return `${Math.round(b * 1000)}M`;
}
