import { create } from 'zustand';
import { PIXIE_LABELS, type PixieState } from './renderer';

// The director turns a stream of agent steps into something a person can
// follow: every pose is held long enough to read, urgent poses (waiting for
// you, blocked) jump the queue, one-shot poses fall back to rest, and a long
// quiet spell sends Pixie to sleep. Captions always travel with the pose.

export interface PixieCue {
  state: PixieState;
  caption: string;
  /** The transcript item this pose is about, so clicking Pixie can reveal it. */
  refId?: string;
}

interface PixieStore {
  current: PixieCue;
  label: string;
  show: (cue: PixieCue) => void;
  reset: () => void;
}

const DWELL: Record<PixieState, number> = {
  idle: 0,
  sleeping: 0,
  thinking: 380,
  typing: 380,
  reading: 650,
  searching: 650,
  editing: 700,
  running: 800,
  debugging: 800,
  guarding: 560,
  waiting: 0,
  blocked: 2200,
  celebrating: 2600,
  error: 2000,
};

const PRIORITY: Record<PixieState, number> = {
  sleeping: 0,
  idle: 0,
  typing: 10,
  thinking: 12,
  reading: 14,
  searching: 15,
  editing: 20,
  running: 22,
  debugging: 24,
  guarding: 26,
  celebrating: 60,
  error: 70,
  blocked: 80,
  waiting: 100,
};

const ONE_SHOT = new Set<PixieState>(['celebrating', 'error', 'blocked']);
const SLEEP_AFTER_MS = 90_000;
const IDLE: PixieCue = { state: 'idle', caption: 'Ready when you are.' };

let since = 0;
let queue: PixieCue[] = [];
let timer: ReturnType<typeof setTimeout> | undefined;
let sleepTimer: ReturnType<typeof setTimeout> | undefined;

export const usePixie = create<PixieStore>((set, get) => {
  const apply = (cue: PixieCue) => {
    since = Date.now();
    set({ current: cue, label: PIXIE_LABELS[cue.state] });
    schedule();
    clearTimeout(sleepTimer);
    if (cue.state === 'idle') {
      sleepTimer = setTimeout(() => {
        if (get().current.state === 'idle') apply({ state: 'sleeping', caption: 'Resting until there is work.' });
      }, SLEEP_AFTER_MS);
    }
  };

  const schedule = () => {
    clearTimeout(timer);
    const cur = get().current;
    const remaining = Math.max(0, DWELL[cur.state] - (Date.now() - since));
    if (queue.length) {
      timer = setTimeout(() => {
        const next = queue.shift();
        if (next) apply(next);
      }, remaining);
    } else if (ONE_SHOT.has(cur.state)) {
      timer = setTimeout(() => {
        if (!queue.length && get().current === cur) apply(IDLE);
      }, remaining);
    }
  };

  return {
    current: IDLE,
    label: PIXIE_LABELS.idle,
    show: (cue) => {
      const cur = get().current;
      const elapsed = Date.now() - since;
      const urgent = PRIORITY[cue.state] >= PRIORITY.blocked && PRIORITY[cue.state] >= PRIORITY[cur.state];
      if (urgent || elapsed >= DWELL[cur.state]) {
        queue = [];
        apply(cue);
        return;
      }
      // Keep important poses and the most recent step; drop stale chatter.
      queue = [...queue.filter((q) => PRIORITY[q.state] >= PRIORITY.celebrating), cue].slice(-3);
      schedule();
    },
    reset: () => {
      queue = [];
      clearTimeout(timer);
      apply(IDLE);
    },
  };
});

export const pixie = {
  show: (state: PixieState, caption: string, refId?: string) => usePixie.getState().show({ state, caption, refId }),
  reset: () => usePixie.getState().reset(),
};
