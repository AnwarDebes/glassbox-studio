// Parity: the TypeScript featurizers and model must reproduce the Python
// pipeline exactly on the examples exported to glassbox/parity.json (200
// held-out examples per model plus edge cases): same features, same in-model
// literals, same class scores, same prediction.
import { assert, assertEqual, diskLoader, MODELS_DIR, readJSON, sorted } from './helpers.mjs';
import { loadGlassbox, guard, route } from '../index.ts';
import { GuardFeaturizer } from '../guard-features.ts';
import { RouterFeaturizer } from '../router-features.ts';
import { CompiledModel } from '../tm.ts';

const parity = await readJSON('glassbox', 'parity.json');
const guardModel = await diskLoader(MODELS_DIR + 'glassbox-guard.json');
const routerModel = await diskLoader(MODELS_DIR + 'glassbox-router.json');
await loadGlassbox(MODELS_DIR, diskLoader);

function check(kind, model, featurize, api) {
  const block = parity[kind];
  assert(block && block.modelId === model.id, `parity.json has no block for ${model.id}`);
  const cm = new CompiledModel(model);
  const cases = [...block.heldOut.map((c) => ({ ...c, where: c.id })), ...block.edgeCases.map((c, i) => ({ ...c, where: `edge#${i}` }))];
  assert(block.heldOut.length >= 200, `expected at least 200 held-out parity examples, got ${block.heldOut.length}`);
  for (const c of cases) {
    const feats = featurize(c.input);
    assertEqual(feats, c.allFeatures, `${kind} ${c.where}: features differ`);
    const ev = cm.evaluate(feats);
    assertEqual(sorted(ev.active), sorted(c.literals), `${kind} ${c.where}: in-model literals differ`);
    assertEqual(ev.scores, c.scores, `${kind} ${c.where}: class scores differ`);
    assertEqual(model.classes[ev.winner], c.predicted, `${kind} ${c.where}: prediction differs`);
    const res = api(c.input);
    assertEqual(model.classes.map((k) => res.scores[k]), c.scores, `${kind} ${c.where}: public API scores differ`);
    assertEqual(res.decision ?? res.intent, c.predicted, `${kind} ${c.where}: public API prediction differs`);
    assertEqual(sorted(res.features), sorted(c.literals), `${kind} ${c.where}: public API features differ`);
  }
  return cases.length;
}

export const tests = [
  ['guard: python and typescript agree on every parity example', () => {
    const g = new GuardFeaturizer(guardModel.featurizer);
    const n = check('guard', guardModel, (call) => g.featurize(call).features, guard);
    console.log(`       ${n} guard examples identical (features, literals, scores, decision)`);
  }],
  ['router: python and typescript agree on every parity example', () => {
    const r = new RouterFeaturizer(routerModel.featurizer);
    const n = check('router', routerModel, (p) => r.featurize(p).features, route);
    console.log(`       ${n} router examples identical (features, literals, scores, intent)`);
  }],
];
