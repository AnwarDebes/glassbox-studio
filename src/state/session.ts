import { create } from 'zustand';
import type { Decision, GuardResult, Intent, LedgerEntry, Repair, RouteResult, ToolCall } from '../app/gb';
import { load, saveSoon } from '../workspace/persist';

export type ToolStatus = 'checking' | 'awaiting' | 'running' | 'done' | 'failed' | 'blocked' | 'denied' | 'proposal';

export interface UserItem {
  kind: 'user';
  id: string;
  text: string;
  at: number;
}
export interface RouteItem {
  kind: 'route';
  id: string;
  result: RouteResult;
  research: boolean;
  auto: boolean;
}
export interface AssistantItem {
  kind: 'assistant';
  id: string;
  text: string;
  streaming: boolean;
  /** A short "what I'm doing" note between tool calls rather than an answer. */
  aside?: boolean;
}
export interface DiffProposal {
  path: string;
  before: string;
  after: string;
  isNew: boolean;
}
export interface ToolItem {
  kind: 'tool';
  id: string;
  call: ToolCall;
  status: ToolStatus;
  origin: 'agent' | 'you';
  guard?: GuardResult;
  guardOff?: boolean;
  repairs?: Repair[];
  /** Why the run paused: the guard asked, or an edit needs review. */
  awaitReason?: 'guard' | 'review' | 'confirm';
  output?: string;
  summary?: string;
  diff?: DiffProposal;
  decidedBy?: 'guard' | 'you' | 'auto';
  note?: string;
  exitCode?: number;
  ms?: number;
  /** An applied edit that the person undid afterwards. */
  reverted?: boolean;
}
export interface PlanStep {
  text: string;
  status: 'todo' | 'doing' | 'done';
}
export interface PlanItem {
  kind: 'plan';
  id: string;
  title: string;
  steps: PlanStep[];
}
export interface NoticeItem {
  kind: 'notice';
  id: string;
  tone: 'info' | 'warn' | 'error' | 'success';
  text: string;
  /** Offer a button that opens the model picker. */
  pickModel?: boolean;
}
export type TranscriptItem = UserItem | RouteItem | AssistantItem | ToolItem | PlanItem | NoticeItem;

export interface TimelineEvent {
  id: string;
  at: number;
  kind: LedgerEntry['kind'];
  label: string;
  /** Decision or intent for route/guard events; outcome word for the rest. */
  outcome: Decision | Intent | 'approved' | 'rejected' | 'ok' | 'failed' | 'proposal' | 'chose';
  itemId: string;
  ledgerSeq?: number;
}

export interface ComputeTotals {
  llmPrompt: number;
  llmCompletion: number;
  llmEstimated: boolean;
  llmCalls: number;
  tmDecisions: number;
  tmOps: number;
  tmClauses: number;
  tmLiterals: number;
  tmMs: number;
  judgeOps: number;
}

export interface OutputEntry {
  id: string;
  at: number;
  title: string;
  text: string;
  ok: boolean;
}

export interface VerifyState {
  status: 'idle' | 'checking' | 'ok' | 'broken';
  brokenAt?: number;
  count?: number;
  at?: number;
}

export interface SessionState {
  restored: boolean;
  items: TranscriptItem[];
  timeline: TimelineEvent[];
  ledger: LedgerEntry[];
  compute: ComputeTotals;
  output: OutputEntry[];
  running: boolean;
  /** What the agent is doing right now, for the status line. */
  activity: string;
  inspect: string | null;
  verify: VerifyState;
  demo: { active: boolean; finished: boolean };
}

export const emptyCompute: ComputeTotals = {
  llmPrompt: 0,
  llmCompletion: 0,
  llmEstimated: false,
  llmCalls: 0,
  tmDecisions: 0,
  tmOps: 0,
  tmClauses: 0,
  tmLiterals: 0,
  tmMs: 0,
  judgeOps: 0,
};

const fresh = (): Omit<SessionState, 'restored'> => ({
  items: [],
  timeline: [],
  ledger: [],
  compute: { ...emptyCompute },
  output: [],
  running: false,
  activity: '',
  inspect: null,
  verify: { status: 'idle' },
  demo: { active: false, finished: false },
});

export const useSession = create<SessionState>(() => ({ restored: false, ...fresh() }));

const set = useSession.setState;
const get = useSession.getState;

let counter = 0;
export function uid(prefix = 'i'): string {
  counter++;
  return `${prefix}${Date.now().toString(36)}${counter.toString(36)}`;
}

interface SavedSession {
  items: TranscriptItem[];
  timeline: TimelineEvent[];
  ledger: LedgerEntry[];
  compute: ComputeTotals;
}

function persist() {
  saveSoon(
    'session',
    (): SavedSession => {
      const s = get();
      return { items: s.items, timeline: s.timeline, ledger: s.ledger, compute: s.compute };
    },
    600,
  );
}

export const session = {
  async restore(): Promise<LedgerEntry[]> {
    const saved = await load<SavedSession>('session');
    if (!saved) {
      set({ restored: true });
      return [];
    }
    // A run cannot resume after a reload: settle anything that was in flight.
    const items = saved.items.map((it): TranscriptItem => {
      if (it.kind === 'tool' && (it.status === 'checking' || it.status === 'awaiting' || it.status === 'running')) {
        return { ...it, status: 'failed', note: 'Interrupted when the page was closed.' };
      }
      if (it.kind === 'assistant' && it.streaming) return { ...it, streaming: false };
      return it;
    });
    set({ restored: true, items, timeline: saved.timeline ?? [], ledger: saved.ledger ?? [], compute: { ...emptyCompute, ...saved.compute } });
    return saved.ledger ?? [];
  },

  clear() {
    set({ ...fresh() });
    persist();
  },

  add<T extends TranscriptItem>(item: T): T {
    set((s) => ({ items: [...s.items, item] }));
    persist();
    return item;
  },

  update<T extends TranscriptItem>(id: string, patch: Partial<T>) {
    set((s) => ({ items: s.items.map((it) => (it.id === id ? ({ ...it, ...patch } as TranscriptItem) : it)) }));
    persist();
  },

  item<T extends TranscriptItem>(id: string): T | undefined {
    return get().items.find((it) => it.id === id) as T | undefined;
  },

  appendText(id: string, delta: string) {
    set((s) => ({
      items: s.items.map((it) => (it.id === id && it.kind === 'assistant' ? { ...it, text: it.text + delta } : it)),
    }));
  },

  timeline(ev: TimelineEvent) {
    set((s) => ({ timeline: [...s.timeline, ev] }));
    persist();
  },

  setLedger(entries: LedgerEntry[]) {
    set({ ledger: entries, verify: { status: 'idle' } });
    persist();
  },

  addCompute(patch: Partial<ComputeTotals>) {
    set((s) => {
      const c = { ...s.compute };
      for (const [k, v] of Object.entries(patch) as Array<[keyof ComputeTotals, number | boolean]>) {
        if (typeof v === 'boolean') (c[k] as boolean) = (c[k] as boolean) || v;
        else (c[k] as number) = (c[k] as number) + v;
      }
      return { compute: c };
    });
    persist();
  },

  output(entry: Omit<OutputEntry, 'id' | 'at'>) {
    set((s) => ({ output: [...s.output.slice(-49), { ...entry, id: uid('o'), at: Date.now() }] }));
  },

  setRunning(running: boolean, activity = '') {
    set({ running, activity });
  },

  setActivity(activity: string) {
    set({ activity });
  },

  inspect(id: string | null) {
    set({ inspect: id });
  },

  setVerify(verify: VerifyState) {
    set({ verify });
  },

  setDemo(demo: SessionState['demo']) {
    set({ demo });
  },
};
