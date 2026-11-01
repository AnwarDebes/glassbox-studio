// Loading the two exported Tsetlin Machines and running them.

import type { Decision, GuardResult, GuardSpec, Intent, ModelCard, ModelJSON, ModelLoader, RouteResult, RouterSpec, ToolCall } from './types';
import { CompiledModel } from './tm';
import { GuardFeaturizer } from './guard-features';
import { RouterFeaturizer } from './router-features';

export const GUARD_ID = 'glassbox-guard';
export const ROUTER_ID = 'glassbox-router';

/** A distinctive accent per model: the guard is emerald, the router amber. */
export const MODEL_COLORS: Record<string, string> = {
  [GUARD_ID]: '#10b981',
  [ROUTER_ID]: '#f59e0b',
};

interface Loaded<F> {
  model: CompiledModel;
  featurizer: F;
  card: ModelCard;
}

const state: { guard: Loaded<GuardFeaturizer> | null; router: Loaded<RouterFeaturizer> | null } = { guard: null, router: null };

const now = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

function parseModel(raw: unknown, expectedId: string): ModelJSON {
  const json = (typeof raw === 'string' ? JSON.parse(raw) : raw) as ModelJSON;
  if (!json || typeof json !== 'object' || json.id !== expectedId) throw new Error(`expected model "${expectedId}", got ${json && typeof json === 'object' ? `"${String(json.id)}"` : typeof json}`);
  return json;
}

function cardOf(m: ModelJSON): ModelCard {
  return {
    id: m.id,
    name: m.name,
    task: m.task,
    classes: [...m.classes],
    clauses: m.meta.clauses,
    avgLiterals: m.meta.avgLiterals,
    heldOutAccuracy: m.metrics.heldOut.accuracy,
    heldOutSize: m.meta.heldOutSize,
    trainedAt: m.meta.trainedAt,
    color: MODEL_COLORS[m.id] ?? '#94a3b8',
    notes: m.meta.notes,
  };
}

/**
 * Loads public/models/glassbox-guard.json and glassbox-router.json.
 * In the browser the default fetches `${baseUrl}<id>.json` (pass
 * `import.meta.env.BASE_URL + 'models/'` when the app is not served from the
 * site root). In node, pass a loader, e.g.
 * `loadGlassbox('public/models/', async (p) => JSON.parse(await readFile(p, 'utf8')))`.
 */
export async function loadGlassbox(baseUrl = './models/', loader?: ModelLoader): Promise<ModelCard[]> {
  const base = baseUrl === '' || baseUrl.endsWith('/') ? baseUrl : baseUrl + '/';
  const load: ModelLoader =
    loader ??
    (async (url: string) => {
      const res = await fetch(url);
      if (!res.ok) throw new Error(`could not load ${url}: HTTP ${res.status}`);
      return res.json();
    });
  const [g, r] = await Promise.all([load(`${base}${GUARD_ID}.json`), load(`${base}${ROUTER_ID}.json`)]);
  initGlassbox(g, r);
  return getModelCards();
}

/** Synchronous alternative to loadGlassbox for callers that already hold the two model files (parsed JSON or text). */
export function initGlassbox(guardModel: unknown, routerModel: unknown): ModelCard[] {
  const g = parseModel(guardModel, GUARD_ID);
  const r = parseModel(routerModel, ROUTER_ID);
  if (g.featurizer.kind !== 'guard' || r.featurizer.kind !== 'router') throw new Error('model files have the wrong featurizer kind');
  state.guard = { model: new CompiledModel(g), featurizer: new GuardFeaturizer(g.featurizer as GuardSpec), card: cardOf(g) };
  state.router = { model: new CompiledModel(r), featurizer: new RouterFeaturizer(r.featurizer as RouterSpec), card: cardOf(r) };
  return getModelCards();
}

export function isGlassboxLoaded(): boolean {
  return state.guard !== null && state.router !== null;
}

export function getModelCards(): ModelCard[] {
  return [state.guard, state.router].filter((x): x is Loaded<GuardFeaturizer> | Loaded<RouterFeaturizer> => x !== null).map((x) => ({ ...x.card }));
}

function need<F>(x: Loaded<F> | null, what: string): Loaded<F> {
  if (!x) throw new Error(`Glassbox ${what} model is not loaded; await loadGlassbox() first`);
  return x;
}

/** @internal used by repairs() to see every feature, including ones outside the model vocabulary. */
export function guardFeaturesOf(call: ToolCall): string[] {
  return need(state.guard, 'guard').featurizer.featurize(call).features;
}

/** @internal the guard model's spec (word lists and patterns). */
export function guardSpec(): GuardSpec {
  return need(state.guard, 'guard').model.json.featurizer as GuardSpec;
}

/** Classifies a proposed tool call as allow, ask or block, with the clauses that decided it. */
export function guard(call: ToolCall): GuardResult {
  const g = need(state.guard, 'guard');
  const t0 = now();
  const fx = g.featurizer.featurize(call);
  const ev = g.model.evaluate(fx.features);
  const evidence = g.model.evidence(ev);
  const ms = now() - t0;
  const scores = { allow: 0, ask: 0, block: 0 } as Record<Decision, number>;
  g.model.classes.forEach((c, k) => (scores[c as Decision] = ev.scores[k]));
  const clausesEvaluated = g.model.clauseCount;
  return {
    decision: g.model.classes[ev.winner] as Decision,
    scores,
    margin: ev.margin,
    evidence,
    features: ev.active,
    compute: { clausesEvaluated, literalChecks: ev.literalChecks, estimatedOps: fx.scanned + ev.literalChecks + clausesEvaluated },
    ms,
    modelId: g.model.json.id,
  };
}

/** Routes a chat prompt to answer, edit, run, search or research, with the clauses that decided it. */
export function route(prompt: string): RouteResult {
  const r = need(state.router, 'router');
  const t0 = now();
  const fx = r.featurizer.featurize(String(prompt ?? ''));
  const ev = r.model.evaluate(fx.features);
  const evidence = r.model.evidence(ev);
  const ms = now() - t0;
  const scores = { answer: 0, edit: 0, run: 0, search: 0, research: 0 } as Record<Intent, number>;
  r.model.classes.forEach((c, k) => (scores[c as Intent] = ev.scores[k]));
  const clausesEvaluated = r.model.clauseCount;
  return {
    intent: r.model.classes[ev.winner] as Intent,
    scores,
    margin: ev.margin,
    evidence,
    features: ev.active,
    compute: { clausesEvaluated, literalChecks: ev.literalChecks, estimatedOps: fx.scanned + ev.literalChecks + clausesEvaluated },
    ms,
    modelId: r.model.json.id,
  };
}
