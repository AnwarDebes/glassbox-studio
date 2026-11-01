// Small text helpers shared by research mode and the demo.

const STOP = new Set(
  'a an and are as at be by can could do does for from had has have how i if in into is it its me my of on or our so than that the their them then there these this to was we what when where which who why will with would you your about after before doing done explain show tell walk through work works codebase project code file files use used using get gets please'.split(
    ' ',
  ),
);

/** Likely search terms in a question: identifiers first, then longer words. */
export function keywords(prompt: string, max = 4): string[] {
  const ids = prompt.match(/[A-Za-z_$][\w$]*(?:\.[A-Za-z_$][\w$]*)*/g) ?? [];
  const scored = ids
    .filter((w) => w.length >= 3 && !STOP.has(w.toLowerCase()))
    .map((w) => ({ w, s: (/[A-Z_.]/.test(w.slice(1)) ? 3 : 0) + Math.min(w.length, 10) / 10 }));
  const seen = new Set<string>();
  const out: string[] = [];
  for (const { w } of scored.sort((a, b) => b.s - a.s)) {
    const k = w.toLowerCase();
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(w);
    if (out.length >= max) break;
  }
  return out;
}
