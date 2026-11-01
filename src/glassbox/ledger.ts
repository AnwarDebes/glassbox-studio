// A hash-chained decision ledger in the spirit of the TRACE certificate ledger:
// every route, guard, human and tool event is appended with
//   hash = SHA-256(canonical JSON of {seq, at, kind, summary, data, prev})
// where prev is the hash of the previous entry (64 zeros for the first one).
// Changing, removing or reordering any entry breaks every hash after it, and
// verify() reports the first entry that no longer checks out.

import type { LedgerEntry } from './types';
import { sha256Hex } from './sha256';

export const GENESIS = '0'.repeat(64);

/**
 * Canonical JSON (RFC 8785 style): object keys sorted by UTF-16 code units, no
 * whitespace, ECMAScript number formatting; undefined members are dropped and
 * non-finite numbers become null, exactly as JSON.stringify does.
 */
export function canonicalJSON(value: unknown): string {
  if (value === null || value === undefined || typeof value === 'function' || typeof value === 'symbol') return 'null';
  if (typeof value === 'number') return Number.isFinite(value) ? JSON.stringify(value) : 'null';
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value);
  if (typeof value === 'bigint') throw new TypeError('ledger data cannot contain BigInt values');
  const withToJSON = value as { toJSON?: () => unknown };
  if (typeof withToJSON.toJSON === 'function') return canonicalJSON(withToJSON.toJSON());
  if (Array.isArray(value)) return '[' + value.map((v) => canonicalJSON(v)).join(',') + ']';
  const obj = value as Record<string, unknown>;
  const keys = Object.keys(obj)
    .filter((k) => obj[k] !== undefined && typeof obj[k] !== 'function' && typeof obj[k] !== 'symbol')
    .sort();
  return '{' + keys.map((k) => JSON.stringify(k) + ':' + canonicalJSON(obj[k])).join(',') + '}';
}

function hashInput(e: Pick<LedgerEntry, 'seq' | 'at' | 'kind' | 'summary' | 'data' | 'prev'>): string {
  return canonicalJSON({ seq: e.seq, at: e.at, kind: e.kind, summary: e.summary, data: e.data, prev: e.prev });
}

/** Detached, JSON-only copy: what is hashed is exactly what toJSON() later returns. */
function toJsonValue(data: unknown): unknown {
  if (data === undefined) return null;
  const text = JSON.stringify(data);
  return text === undefined ? null : JSON.parse(text);
}

export class Ledger {
  private readonly entries: LedgerEntry[];
  private tail: Promise<unknown> = Promise.resolve();

  /** Starts empty, or continues from entries saved earlier with toJSON() (they are verified, not trusted). */
  constructor(entries?: LedgerEntry[]) {
    this.entries = entries ? (JSON.parse(JSON.stringify(entries)) as LedgerEntry[]) : [];
  }

  /** Appends one entry. Concurrent calls are chained, so the hash chain never forks. */
  append(kind: LedgerEntry['kind'], summary: string, data: unknown): Promise<LedgerEntry> {
    const run = async (): Promise<LedgerEntry> => {
      const last = this.entries[this.entries.length - 1];
      const body = {
        seq: this.entries.length,
        at: new Date().toISOString(),
        kind,
        summary: String(summary),
        data: toJsonValue(data),
        prev: last ? last.hash : GENESIS,
      };
      const entry: LedgerEntry = { ...body, hash: await sha256Hex(hashInput(body)) };
      this.entries.push(entry);
      return JSON.parse(JSON.stringify(entry)) as LedgerEntry;
    };
    const next = this.tail.then(run, run);
    this.tail = next.catch(() => undefined);
    return next;
  }

  /** Recomputes the chain. brokenAt is the position (expected seq) of the first entry that fails. */
  async verify(): Promise<{ ok: boolean; brokenAt?: number }> {
    await this.tail;
    let prev = GENESIS;
    for (let i = 0; i < this.entries.length; i++) {
      const e = this.entries[i];
      if (!e || e.seq !== i || e.prev !== prev) return { ok: false, brokenAt: i };
      if ((await sha256Hex(hashInput(e))) !== e.hash) return { ok: false, brokenAt: i };
      prev = e.hash;
    }
    return { ok: true };
  }

  get length(): number {
    return this.entries.length;
  }

  /** A deep copy of every entry, safe to store and to pass back to the constructor. */
  toJSON(): LedgerEntry[] {
    return JSON.parse(JSON.stringify(this.entries)) as LedgerEntry[];
  }
}
