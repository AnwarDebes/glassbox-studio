// Micro-benchmark of guard() and route() in node:
//   node --experimental-strip-types src/glassbox/__tests__/bench.mjs
// Times every call individually over the held-out parity inputs (after a
// warm-up), reports mean / median / p99 per call and the average compute
// counts, and writes glassbox/results/benchmark.json.
import { register } from 'node:module';
import { writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import os from 'node:os';

register('./ts-resolve-hooks.mjs', import.meta.url);
const { ROOT, MODELS_DIR, diskLoader, readJSON } = await import('./helpers.mjs');
const { loadGlassbox, guard, route, savings } = await import('../index.ts');

await loadGlassbox(MODELS_DIR, diskLoader);
const parity = await readJSON('glassbox', 'parity.json');
const calls = parity.guard.heldOut.map((c) => c.input);
const prompts = parity.router.heldOut.map((c) => c.input);
const ROUNDS = Number(process.argv[2] ?? 50);

function bench(name, inputs, fn) {
  for (let r = 0; r < 10; r++) for (const x of inputs) fn(x);
  const times = [];
  let ops = 0;
  let checks = 0;
  let clauses = 0;
  const t0 = performance.now();
  for (let r = 0; r < ROUNDS; r++) {
    for (const x of inputs) {
      const a = performance.now();
      const res = fn(x);
      times.push(performance.now() - a);
      ops += res.compute.estimatedOps;
      checks += res.compute.literalChecks;
      clauses = res.compute.clausesEvaluated;
    }
  }
  const wall = performance.now() - t0;
  times.sort((a, b) => a - b);
  const n = times.length;
  const q = (p) => times[Math.min(n - 1, Math.floor(p * n))];
  const out = {
    calls: n,
    meanMs: +(times.reduce((s, t) => s + t, 0) / n).toFixed(4),
    medianMs: +q(0.5).toFixed(4),
    p99Ms: +q(0.99).toFixed(4),
    maxMs: +times[n - 1].toFixed(4),
    throughputPerSecond: Math.round(n / (wall / 1000)),
    clausesEvaluated: clauses,
    avgLiteralChecks: Math.round(checks / n),
    avgEstimatedOps: Math.round(ops / n),
  };
  out.savingsVs1B300 = savings({ clausesEvaluated: clauses, literalChecks: out.avgLiteralChecks, estimatedOps: out.avgEstimatedOps }).text;
  console.log(`${name}: mean ${out.meanMs} ms, median ${out.medianMs} ms, p99 ${out.p99Ms} ms per call (${n} calls); ` +
    `${out.avgLiteralChecks} literal checks, ~${out.avgEstimatedOps} ops; ${out.savingsVs1B300}`);
  return out;
}

const result = {
  date: new Date().toISOString(),
  node: process.version,
  cpu: os.cpus()[0]?.model ?? 'unknown',
  platform: `${os.platform()} ${os.release()}`,
  rounds: ROUNDS,
  guard: bench('guard()', calls, guard),
  route: bench('route()', prompts, route),
};
await writeFile(join(ROOT, 'glassbox', 'results', 'benchmark.json'), JSON.stringify(result, null, 1) + '\n');
console.log('wrote glassbox/results/benchmark.json');
