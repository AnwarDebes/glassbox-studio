// Glassbox decision layer: two small Tsetlin Machines (a tool-call guard and a
// prompt router) whose every decision comes with the readable clauses that
// made it, plus safer-alternative repairs, compute accounting and a
// hash-chained ledger. No runtime dependencies; works in browsers and node.

export type {
  Decision,
  Intent,
  ToolName,
  ToolCall,
  ClauseEvidence,
  Compute,
  GuardResult,
  RouteResult,
  Repair,
  ModelCard,
  LedgerEntry,
  ModelLoader,
  ModelJSON,
  FeatureInfo,
  ClauseJSON,
  EvalBlock,
} from './types';

export { loadGlassbox, initGlassbox, isGlassboxLoaded, getModelCards, guard, route, MODEL_COLORS, GUARD_ID, ROUTER_ID } from './models';
export { repairs } from './repairs';
export { llmJudgeOps, savings, formatFactor } from './compute';
export { Ledger, canonicalJSON, GENESIS } from './ledger';
export { sha256Hex } from './sha256';
