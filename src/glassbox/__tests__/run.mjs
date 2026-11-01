// Test runner for src/glassbox, no dependencies:
//   node --experimental-strip-types src/glassbox/__tests__/run.mjs            (all tests)
//   node --experimental-strip-types src/glassbox/__tests__/run.mjs parity     (one file)
// Each *.test.mjs exports `tests`: an array of [name, async fn] pairs.
import { register } from 'node:module';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

register('./ts-resolve-hooks.mjs', import.meta.url);

const here = dirname(fileURLToPath(import.meta.url));
const only = process.argv[2];
const files = readdirSync(here).filter((f) => f.endsWith('.test.mjs') && (!only || f.startsWith(only))).sort();
let passed = 0;
let failed = 0;
for (const file of files) {
  const mod = await import(pathToFileURL(join(here, file)).href);
  for (const [name, fn] of mod.tests) {
    const t0 = performance.now();
    try {
      await fn();
      passed++;
      console.log(`  ok   ${file.replace('.test.mjs', '')} > ${name} (${(performance.now() - t0).toFixed(0)} ms)`);
    } catch (err) {
      failed++;
      console.log(`  FAIL ${file.replace('.test.mjs', '')} > ${name}\n       ${String(err && err.stack ? err.stack : err).split('\n').slice(0, 6).join('\n       ')}`);
    }
  }
}
console.log(`\n${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
