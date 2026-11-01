// Public types of the Glassbox decision layer, plus the shape of the exported
// model files in public/models/*.json (written by glassbox/train.py).

export type Decision = 'allow' | 'ask' | 'block';
export type Intent = 'answer' | 'edit' | 'run' | 'search' | 'research';
export type ToolName = 'read_file' | 'list_files' | 'search' | 'write_file' | 'delete_file' | 'run_command' | 'run_js' | 'fetch_url';

export interface ToolCall { tool: ToolName; args: Record<string, string>; workspaceRoot?: string }
export interface ClauseEvidence { id: number; cls: string; polarity: 1 | -1; weight: number; rule: string; literals: string[] }
export interface Compute { clausesEvaluated: number; literalChecks: number; estimatedOps: number }
export interface GuardResult { decision: Decision; scores: Record<Decision, number>; margin: number; evidence: ClauseEvidence[]; features: string[]; compute: Compute; ms: number; modelId: string }
export interface RouteResult { intent: Intent; scores: Record<Intent, number>; margin: number; evidence: ClauseEvidence[]; features: string[]; compute: Compute; ms: number; modelId: string }
export interface Repair { title: string; call: ToolCall; why: string }
export interface ModelCard { id: string; name: string; task: string; classes: string[]; clauses: number; avgLiterals: number; heldOutAccuracy: number; heldOutSize: number; trainedAt: string; color: string; notes: string }
export interface LedgerEntry { seq: number; at: string; kind: 'route' | 'guard' | 'human' | 'tool'; summary: string; data: unknown; prev: string; hash: string }

/** Reads one model file. Gets the full URL or path (baseUrl + file name) and returns parsed JSON or the raw text. */
export type ModelLoader = (url: string) => Promise<unknown>;

// ---------------------------------------------------------------------------
// Model file format ("glassbox-tm/1")
// ---------------------------------------------------------------------------

export interface FeatureInfo { name: string; text: string; neg: string }

export interface ClauseJSON {
  id: number;
  cls: string;
  /** +1 votes for `cls`, -1 votes against it. */
  pol: 1 | -1;
  /** Integer weight: the number of votes the clause casts when it fires. */
  w: number;
  /** Feature indices that must be present. */
  pos: number[];
  /** Feature indices that must be absent. */
  neg: number[];
}

export interface FactSpec { name: string; on: string[] | string; re: string }

export interface GuardSpec {
  kind: 'guard';
  version: number;
  argKeys: Record<string, string[]>;
  wrappers: string[];
  wrapperValueFlags: string[];
  multi: string[];
  fileCmds: string[];
  modeFirstArg: string[];
  devNull: string[];
  readonlyHead: string;
  localhostHost: string;
  knownHost: string;
  facts: FactSpec[];
  anyOf: { name: string; of: string[] }[];
  allOf: { name: string; groups: string[][] }[];
}

export interface RouterSpec {
  kind: 'router';
  version: number;
  token: string;
  fillers: string[];
  shortMax: number;
  longMin: number;
  facts: FactSpec[];
}

export interface ClassMetrics { precision: number; recall: number; f1: number; support: number }
export interface EvalBlock {
  accuracy: number;
  macroF1: number;
  n: number;
  perClass: Record<string, ClassMetrics>;
  confusion: { rows: string; cols: string; classes: string[]; matrix: number[][] };
}

export interface ModelJSON {
  format: 'glassbox-tm/1';
  id: string;
  name: string;
  task: string;
  classes: string[];
  tiePriority: string[];
  features: FeatureInfo[];
  clauses: ClauseJSON[];
  featurizer: GuardSpec | RouterSpec;
  metrics: { heldOut: EvalBlock; challenge?: EvalBlock; [k: string]: unknown };
  meta: {
    trainedAt: string;
    trainSize: number;
    heldOutSize: number;
    clauses: number;
    avgLiterals: number;
    datasetSha256: string;
    command: string;
    notes: string;
    [k: string]: unknown;
  };
  [k: string]: unknown;
}
