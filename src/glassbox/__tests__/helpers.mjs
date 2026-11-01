// Shared helpers for the src/glassbox tests (plain node, no dependencies).
import { readFile } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..', '..');
export const MODELS_DIR = join(ROOT, 'public', 'models') + '/';

export const diskLoader = async (path) => JSON.parse(await readFile(path, 'utf8'));

export async function readJSON(...parts) {
  return JSON.parse(await readFile(join(ROOT, ...parts), 'utf8'));
}

export function assert(cond, msg) {
  if (!cond) throw new Error(msg);
}

export function assertEqual(actual, expected, msg) {
  const a = JSON.stringify(actual);
  const e = JSON.stringify(expected);
  if (a !== e) throw new Error(`${msg}\n         expected ${e.slice(0, 400)}\n         actual   ${a.slice(0, 400)}`);
}

export const sorted = (xs) => [...xs].sort();
