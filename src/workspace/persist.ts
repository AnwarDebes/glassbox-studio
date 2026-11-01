import { createStore, get, set, del } from 'idb-keyval';

// Everything the studio remembers lives in this browser's IndexedDB.
const store = createStore('glassbox-studio', 'state');

export async function load<T>(key: string): Promise<T | undefined> {
  try {
    return (await get(key, store)) as T | undefined;
  } catch {
    return undefined;
  }
}

export async function save(key: string, value: unknown): Promise<void> {
  try {
    await set(key, value, store);
  } catch {
    // Private windows can refuse IndexedDB; the studio still works in memory.
  }
}

export async function remove(key: string): Promise<void> {
  try {
    await del(key, store);
  } catch {
    /* ignore */
  }
}

/** Debounce saves per key so typing in the editor does not hammer IndexedDB. */
const pending = new Map<string, ReturnType<typeof setTimeout>>();
export function saveSoon(key: string, value: () => unknown, ms = 400) {
  clearTimeout(pending.get(key));
  pending.set(
    key,
    setTimeout(() => {
      pending.delete(key);
      void save(key, value());
    }, ms),
  );
}

/** Small typed localStorage helpers that never throw. */
export const local = {
  get<T>(key: string, fallback: T): T {
    try {
      const raw = localStorage.getItem(key);
      return raw == null ? fallback : (JSON.parse(raw) as T);
    } catch {
      return fallback;
    }
  },
  set(key: string, value: unknown) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      /* storage may be full or blocked */
    }
  },
  remove(key: string) {
    try {
      localStorage.removeItem(key);
    } catch {
      /* ignore */
    }
  },
};
