# Glassbox decision layer: results

Prototype status: both models are trained on synthetic, template-generated data (labelling policy in
`gbx/data_guard.py` / `gbx/data_router.py`) and evaluated on a held-out split of it plus small hand-written
challenge sets. Details, model cards and limitations: `glassbox/README.md`.

## Final metrics (published models, run 2)

| | Guard (`glassbox-guard`) | Router (`glassbox-router`) |
|---|---|---|
| held-out test accuracy | **99.2%** (n = 1,074), macro-F1 0.992 | **98.7%** (n = 520), macro-F1 0.987 |
| hand-written challenge accuracy | **97.7%** (n = 129) | **95.8%** (n = 120) |
| clauses / features / avg literals | 180 / 355 / 35.0 | 497 / 628 / 22.8 |
| model file | 101 KiB | 118 KiB |

Per-class precision/recall and confusion matrices: README and `glassbox/results/<model>.json`. Held-out
numbers are optimistic (same templates as training); the challenge sets are the better guide. Run 1 scored
guard 98.8% / 97.7% and router 98.7% / 95.8%; the guard was retrained once after adding read-only cloud
commands (`aws s3 ls`, `helm status`), which run 1 wrongly blocked. Both runs are disclosed in the README.

## Tests and benchmark

* Parity: all 214 guard examples (200 held-out + 14 edge cases) and 207 router examples (200 + 7) give
  identical features, literals, class scores and predictions in Python and TypeScript.
* TypeScript suite: 23/23 pass. Python suite: 14/14 pass. Rerunning `python glassbox/train.py` (27 s)
  reproduced identical models.
* Node v22.14.0, i7-1165G7: `guard()` 0.114 ms mean / 0.098 median / 0.383 p99; `route()` 0.078 / 0.065 /
  0.249 ms (10,000 timed calls each, including feature extraction). Not measured in a browser.

## Files

* `glassbox/`: `train.py`, `config.json`, `gbx/` (TM, features, generators, challenge sets, pipeline),
  `data/*.jsonl`, `results/` (tuning, reports, benchmark), `parity.json`, `tests/`, `README.md`, this file.
* `src/glassbox/`: `index.ts`, `types.ts`, `text.ts`, `guard-features.ts`, `router-features.ts`, `tm.ts`,
  `models.ts`, `repairs.ts`, `compute.ts`, `ledger.ts`, `sha256.ts`, `__tests__/` (`run.mjs`, tests, `bench.mjs`).
* `public/models/glassbox-guard.json`, `public/models/glassbox-router.json`.

## Using it from the app

1. `loadGlassbox(\`${import.meta.env.BASE_URL}models/\`)` (as `src/agent/glassbox.ts` already does). After it
   resolves, `guard()` / `route()` are synchronous; before, they throw.
2. Args the guard reads: `command` (run_command), `path` (file tools, search scope, run_js script file), `code`
   (inline run_js), `content` (write_file), `url` / `method` / `body` (fetch_url), `query` (search). Pass
   `workspaceRoot` (the workspace name is fine); `~` and absolute paths count as outside the workspace.
3. `features` = in-model features present. `evidence` = up to 3 clauses for the decision (those naming
   something present first, then by weight) plus the strongest clause against it. `rule` shows at most 6
   conditions then "(+N more conditions)"; `literals` lists all.
4. `repairs()` returns [] for allow and at most 3 suggestions otherwise; every suggestion is checked with
   `guard()` and is never blocked. Refusals are a harmless `echo "glassbox refused this call: ..."`. Demo
   script: `rm -rf ~/.cache` and `git push --force` are blocked; repairs are the `.trash` move / list
   workspace and `git push --force-with-lease`.
5. `savings()` defaults to a 1B model and a 300-token prompt. `MODEL_COLORS` keys are
   `glassbox-guard` (#10b981) and `glassbox-router` (#f59e0b).
6. `Ledger.append` is async and chains concurrent calls; it stores a JSON copy of `data`; `verify()` returns
   `{ ok, brokenAt }`. SHA-256 falls back to pure TypeScript where `crypto.subtle` is missing (plain http).
7. Extra exports: `initGlassbox`, `isGlassboxLoaded`, `getModelCards`, `GUARD_ID`, `ROUTER_ID`,
   `formatFactor`, `canonicalJSON`, `GENESIS`, `sha256Hex`. Imports are extensionless; tests run with
   `node --experimental-strip-types src/glassbox/__tests__/run.mjs`.
