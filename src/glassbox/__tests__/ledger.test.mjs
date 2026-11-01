// Ledger: hash chain, tamper detection, JSON round trip, concurrent appends,
// and the pure-TypeScript SHA-256 fallback against crypto.subtle.
import { assert, assertEqual } from './helpers.mjs';
import { Ledger, canonicalJSON, GENESIS } from '../index.ts';
import { sha256HexSync, sha256Hex } from '../sha256.ts';

async function sample() {
  const l = new Ledger();
  await l.append('route', 'routed to run', { intent: 'run', scores: { run: 12, edit: -3 } });
  await l.append('guard', 'block: rm -rf ~', { call: { tool: 'run_command', args: { command: 'rm -rf ~' } }, decision: 'block' });
  await l.append('human', 'user chose the repair', { choice: 'Look first: list the workspace' });
  await l.append('tool', 'list_files .', { ok: true, files: ['src', 'package.json'], note: undefined, when: new Date(0) });
  return l;
}

export const tests = [
  ['appends a valid chain', async () => {
    const l = await sample();
    const e = l.toJSON();
    assertEqual(e.map((x) => x.seq), [0, 1, 2, 3], 'seq numbers');
    assert(e[0].prev === GENESIS, 'first prev is the genesis hash');
    for (let i = 1; i < e.length; i++) assert(e[i].prev === e[i - 1].hash, `entry ${i} links to entry ${i - 1}`);
    assert(e.every((x) => /^[0-9a-f]{64}$/.test(x.hash)), 'hashes are sha-256 hex');
    assertEqual(await l.verify(), { ok: true }, 'verify');
    assertEqual(e[3].data, { ok: true, files: ['src', 'package.json'], when: '1970-01-01T00:00:00.000Z' }, 'data is stored as JSON (undefined dropped, Date as string)');
  }],
  ['detects tampering and reports the first broken entry', async () => {
    const e = (await sample()).toJSON();
    const edited = JSON.parse(JSON.stringify(e));
    edited[1].data.decision = 'allow';
    assertEqual(await new Ledger(edited).verify(), { ok: false, brokenAt: 1 }, 'edited data');
    const summary = JSON.parse(JSON.stringify(e));
    summary[2].summary = 'nothing happened';
    assertEqual(await new Ledger(summary).verify(), { ok: false, brokenAt: 2 }, 'edited summary');
    const removed = JSON.parse(JSON.stringify(e)).filter((_, i) => i !== 1);
    assertEqual(await new Ledger(removed).verify(), { ok: false, brokenAt: 1 }, 'removed entry');
    const swapped = JSON.parse(JSON.stringify(e));
    [swapped[2], swapped[3]] = [swapped[3], swapped[2]];
    assertEqual(await new Ledger(swapped).verify(), { ok: false, brokenAt: 2 }, 'reordered entries');
    const rehashed = JSON.parse(JSON.stringify(e));
    rehashed[0].at = '2000-01-01T00:00:00.000Z';
    assertEqual(await new Ledger(rehashed).verify(), { ok: false, brokenAt: 0 }, 'edited timestamp');
  }],
  ['survives a JSON round trip and keeps appending', async () => {
    const l = await sample();
    const restored = new Ledger(JSON.parse(JSON.stringify(l)));
    assertEqual(await restored.verify(), { ok: true }, 'restored ledger verifies');
    const e = await restored.append('guard', 'allow: npm test', { decision: 'allow' });
    assert(e.seq === 4 && e.prev === l.toJSON()[3].hash, 'continues the chain');
    assertEqual(await restored.verify(), { ok: true }, 'verify after append');
  }],
  ['chains concurrent appends in call order', async () => {
    const l = new Ledger();
    const entries = await Promise.all(Array.from({ length: 25 }, (_, i) => l.append('tool', `step ${i}`, { i })));
    assertEqual(entries.map((x) => x.seq), Array.from({ length: 25 }, (_, i) => i), 'seq follows call order');
    assertEqual(await l.verify(), { ok: true }, 'verify');
  }],
  ['isolates stored data from later mutation by the caller', async () => {
    const l = new Ledger();
    const data = { list: [1, 2] };
    await l.append('tool', 'x', data);
    data.list.push(3);
    l.toJSON()[0].data.list.push(4);
    assertEqual(l.toJSON()[0].data, { list: [1, 2] }, 'stored copy unchanged');
    assertEqual(await l.verify(), { ok: true }, 'verify');
  }],
  ['canonical JSON sorts keys and is stable', () => {
    assertEqual(canonicalJSON({ b: 1, a: [true, null, 'x'], c: { z: 1.5, y: -0 } }), '{"a":[true,null,"x"],"b":1,"c":{"y":0,"z":1.5}}', 'canonical form');
    assertEqual(canonicalJSON({ n: NaN, i: Infinity, u: undefined }), '{"i":null,"n":null}', 'non-finite numbers and undefined');
  }],
  ['pure-TypeScript SHA-256 matches crypto.subtle', async () => {
    const inputs = ['', 'abc', 'a'.repeat(55), 'a'.repeat(56), 'a'.repeat(64), 'a'.repeat(1000), 'glassbox é\u{1F680}'];
    assertEqual(sha256HexSync(new TextEncoder().encode('abc')), 'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad', 'known vector');
    for (const s of inputs) assertEqual(sha256HexSync(new TextEncoder().encode(s)), await sha256Hex(s), `length ${s.length}`);
  }],
];
