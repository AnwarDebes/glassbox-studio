import { Ledger, type LedgerEntry } from '../app/gb';
import { session } from '../state/session';
import { downloadBlob } from '../workspace/zip';

// One hash-chained ledger per session. Appends are serialised so each entry
// always links to the one before it.

let ledger = new Ledger();
let chain: Promise<unknown> = Promise.resolve();

export function initLedger(entries: LedgerEntry[]) {
  ledger = new Ledger(entries);
  session.setLedger(ledger.toJSON());
}

export function resetLedger() {
  ledger = new Ledger();
  chain = Promise.resolve();
  session.setLedger([]);
}

export function appendLedger(kind: LedgerEntry['kind'], summary: string, data: unknown): Promise<LedgerEntry> {
  const next = chain.then(() => ledger.append(kind, summary, data));
  chain = next.catch(() => undefined);
  return next.then((entry) => {
    session.setLedger(ledger.toJSON());
    return entry;
  });
}

export async function verifyLedger(): Promise<{ ok: boolean; brokenAt?: number; count: number }> {
  session.setVerify({ status: 'checking' });
  await chain;
  const started = performance.now();
  const result = await ledger.verify();
  // Keep the check visible for a beat so the result reads as a result.
  const wait = 450 - (performance.now() - started);
  if (wait > 0) await new Promise((r) => setTimeout(r, wait));
  const count = ledger.toJSON().length;
  session.setVerify({ status: result.ok ? 'ok' : 'broken', brokenAt: result.brokenAt, count, at: Date.now() });
  return { ...result, count };
}

export function exportLedger() {
  const entries = ledger.toJSON();
  const doc = {
    format: 'glassbox-ledger',
    version: 1,
    exportedAt: new Date().toISOString(),
    entries,
  };
  const blob = new Blob([JSON.stringify(doc, null, 2)], { type: 'application/json' });
  downloadBlob(blob, `glassbox-ledger-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.json`);
}

/** Copy of the chain with one entry altered, to show that verification catches it. */
export async function verifyTampered(seq: number): Promise<{ ok: boolean; brokenAt?: number }> {
  const entries = ledger.toJSON().map((e) => ({ ...e }));
  const target = entries.find((e) => e.seq === seq);
  if (!target) return { ok: true };
  target.summary = `${target.summary} (edited)`;
  return new Ledger(entries).verify();
}

export async function sha256Hex(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, '0')).join('');
}
