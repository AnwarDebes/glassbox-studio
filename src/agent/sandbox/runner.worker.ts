// The run_js sandbox. Code runs in a dedicated worker with no DOM, with
// network and storage APIs removed, and is terminated by the page after a
// timeout. Workspace files can import each other, and node:test plus
// node:assert are provided so a project's tests can run here.

interface RunRequest {
  nonce: string;
  files: Record<string, string>;
  entry?: string;
  code?: string;
}

interface RunResult {
  nonce: string;
  ok: boolean;
  output: string;
  tests?: { total: number; pass: number; fail: number };
  exitCode: number;
}

const realPost = (self as unknown as { postMessage(m: unknown): void }).postMessage.bind(self);

// Remove ways out of the sandbox before any user code runs.
const BLOCKED = [
  'fetch', 'XMLHttpRequest', 'WebSocket', 'WebSocketStream', 'EventSource', 'importScripts', 'indexedDB', 'caches',
  'BroadcastChannel', 'Worker', 'SharedWorker', 'WebTransport', 'postMessage', 'close', 'storage', 'cookieStore',
];
for (const name of BLOCKED) {
  try {
    Object.defineProperty(self, name, { value: undefined, configurable: false, writable: false });
  } catch {
    /* some are not configurable in some engines */
  }
}

// ---- formatting, close to Node's util.inspect ----
function inspect(value: unknown, depth = 0, seen = new WeakSet<object>()): string {
  if (typeof value === 'string') return depth === 0 ? value : `'${value.replace(/'/g, "\\'")}'`;
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') return String(value);
  if (value === undefined) return 'undefined';
  if (value === null) return 'null';
  if (typeof value === 'function') return `[Function: ${value.name || 'anonymous'}]`;
  if (typeof value === 'symbol') return value.toString();
  if (value instanceof Error) return `${value.name}: ${value.message}`;
  if (typeof value !== 'object') return String(value);
  if (seen.has(value)) return '[Circular]';
  seen.add(value);
  if (depth > 4) return Array.isArray(value) ? '[Array]' : '[Object]';
  const nested = (v: unknown) => inspect(v, depth + 1, seen);
  if (Array.isArray(value)) return value.length ? `[ ${value.map(nested).join(', ')} ]` : '[]';
  if (value instanceof Map) return `Map(${value.size}) { ${[...value].map(([k, v]) => `${nested(k)} => ${nested(v)}`).join(', ')} }`;
  if (value instanceof Set) return `Set(${value.size}) { ${[...value].map(nested).join(', ')} }`;
  if (value instanceof Date) return value.toISOString();
  if (value instanceof RegExp) return String(value);
  const keys = Object.keys(value);
  if (!keys.length) return '{}';
  const body = keys.map((k) => `${/^[A-Za-z_$][\w$]*$/.test(k) ? k : `'${k}'`}: ${nested((value as Record<string, unknown>)[k])}`);
  return `{ ${body.join(', ')} }`;
}

const fmt = (args: unknown[]) => args.map((a) => inspect(a)).join(' ');

// ---- assert ----
class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AssertionError';
  }
}

function deepEqual(a: unknown, b: unknown, strict: boolean): boolean {
  if (strict ? Object.is(a, b) : a == b || (a !== a && b !== b)) return true;
  if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null) return false;
  if (strict && Object.getPrototypeOf(a) !== Object.getPrototypeOf(b)) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
  if (Array.isArray(a) !== Array.isArray(b)) return false;
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k), strict)) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ka = Object.keys(a);
  const kb = Object.keys(b);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as Record<string, unknown>)[k], (b as Record<string, unknown>)[k], strict)) return false;
  }
  return true;
}

function makeAssert(strict: boolean) {
  const fail = (message: string): never => {
    throw new AssertionError(message);
  };
  const show = (v: unknown) => inspect(v, 1);
  const assert = (value: unknown, message?: string) => {
    if (!value) fail(message ?? `The expression evaluated to a falsy value: ${show(value)}`);
  };
  const eq = (a: unknown, b: unknown) => (strict ? Object.is(a, b) : a == b);
  const api = {
    ok: assert,
    equal: (a: unknown, b: unknown, m?: string) => {
      if (!eq(a, b)) fail(m ?? `Expected values to be ${strict ? 'strictly ' : ''}equal:\n  actual:   ${show(a)}\n  expected: ${show(b)}`);
    },
    notEqual: (a: unknown, b: unknown, m?: string) => {
      if (eq(a, b)) fail(m ?? `Expected values to differ, both were ${show(a)}`);
    },
    strictEqual: (a: unknown, b: unknown, m?: string) => {
      if (!Object.is(a, b)) fail(m ?? `Expected values to be strictly equal:\n  actual:   ${show(a)}\n  expected: ${show(b)}`);
    },
    notStrictEqual: (a: unknown, b: unknown, m?: string) => {
      if (Object.is(a, b)) fail(m ?? `Expected values to differ, both were ${show(a)}`);
    },
    deepEqual: (a: unknown, b: unknown, m?: string) => {
      if (!deepEqual(a, b, strict)) fail(m ?? `Expected values to be ${strict ? 'strictly ' : ''}deep-equal:\n  actual:   ${show(a)}\n  expected: ${show(b)}`);
    },
    deepStrictEqual: (a: unknown, b: unknown, m?: string) => {
      if (!deepEqual(a, b, true)) fail(m ?? `Expected values to be strictly deep-equal:\n  actual:   ${show(a)}\n  expected: ${show(b)}`);
    },
    notDeepEqual: (a: unknown, b: unknown, m?: string) => {
      if (deepEqual(a, b, strict)) fail(m ?? `Expected values not to be deep-equal: ${show(a)}`);
    },
    match: (s: string, re: RegExp, m?: string) => {
      if (!re.test(s)) fail(m ?? `The input did not match ${re}: ${show(s)}`);
    },
    throws: (fn: () => unknown, expected?: unknown, m?: string) => {
      try {
        fn();
      } catch (err) {
        if (expected instanceof RegExp && !expected.test(String((err as Error)?.message ?? err))) fail(m ?? `The error did not match ${expected}`);
        if (typeof expected === 'function' && !(err instanceof (expected as new () => unknown))) fail(m ?? 'The error was not of the expected type');
        return;
      }
      fail(typeof expected === 'string' ? expected : m ?? 'Missing expected exception.');
    },
    rejects: async (p: Promise<unknown> | (() => Promise<unknown>), _expected?: unknown, m?: string) => {
      try {
        await (typeof p === 'function' ? p() : p);
      } catch {
        return;
      }
      fail(m ?? 'Missing expected rejection.');
    },
    fail: (m?: string) => fail(m ?? 'Failed'),
  };
  return Object.assign(assert, api);
}

// ---- node:test ----
interface TestCase {
  name: string;
  fn: (t: unknown) => unknown;
  skip: boolean;
}
let tests: TestCase[] = [];
let suite: string[] = [];

function test(name: string, a?: unknown, b?: unknown) {
  const fn = (typeof a === 'function' ? a : b) as TestCase['fn'] | undefined;
  const opts = (typeof a === 'object' && a ? a : {}) as { skip?: boolean; todo?: boolean };
  tests.push({ name: [...suite, name].join(' > '), fn: fn ?? (() => undefined), skip: !!opts.skip || !!opts.todo });
}
function describe(name: string, a?: unknown, b?: unknown) {
  const fn = (typeof a === 'function' ? a : b) as (() => void) | undefined;
  suite.push(name);
  try {
    fn?.();
  } finally {
    suite.pop();
  }
}
const nodeTest = Object.assign(test, { test, it: test, describe, suite: describe, skip: (n: string) => tests.push({ name: n, fn: () => undefined, skip: true }) });

function unavailable(name: string) {
  return new Proxy(
    {},
    {
      get(_t, prop) {
        if (prop === '__esModule' || prop === 'default' || typeof prop === 'symbol') return undefined;
        throw new Error(`${name} is not available in the browser sandbox (tried to use ${String(prop)}).`);
      },
    },
  );
}

// ---- modules ----
function transformEsm(src: string): string {
  const exported: string[] = [];
  const req = (spec: string) => `require(${JSON.stringify(spec)})`;
  const named = (list: string) => list.replace(/\s+as\s+/g, ': ');
  let out = src
    .replace(/^\s*import\s+([\w$]+)\s*,\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\3\s*;?/gm, (_m, def: string, list: string, _q, spec: string) => `const ${def} = __default(${req(spec)}); const {${named(list)}} = ${req(spec)};`)
    .replace(/^\s*import\s+\*\s+as\s+([\w$]+)\s+from\s*(['"])([^'"]+)\2\s*;?/gm, (_m, ns: string, _q, spec: string) => `const ${ns} = ${req(spec)};`)
    .replace(/^\s*import\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?/gm, (_m, list: string, _q, spec: string) => `const {${named(list)}} = ${req(spec)};`)
    .replace(/^\s*import\s+([\w$]+)\s+from\s*(['"])([^'"]+)\2\s*;?/gm, (_m, def: string, _q, spec: string) => `const ${def} = __default(${req(spec)});`)
    .replace(/^\s*import\s*(['"])([^'"]+)\1\s*;?/gm, (_m, _q, spec: string) => `${req(spec)};`)
    .replace(/^\s*export\s*\{([^}]*)\}\s*from\s*(['"])([^'"]+)\2\s*;?/gm, (_m, list: string, _q, spec: string) =>
      list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [orig, alias] = s.split(/\s+as\s+/);
          return `exports.${alias ?? orig} = ${req(spec)}.${orig};`;
        })
        .join(' '),
    )
    .replace(/^\s*export\s*\{([^}]*)\}\s*;?/gm, (_m, list: string) =>
      list
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean)
        .map((s) => {
          const [orig, alias] = s.split(/\s+as\s+/);
          exported.push(`exports.${alias ?? orig} = ${orig};`);
          return '';
        })
        .join(''),
    )
    .replace(/^\s*export\s+default\s+/gm, 'exports.default = ')
    .replace(/^(\s*)export\s+(async\s+function\*?|function\*?|class|const|let|var)\s+([\w$]+)/gm, (_m, ws: string, kind: string, name: string) => {
      exported.push(`exports.${name} = ${name};`);
      return `${ws}${kind} ${name}`;
    });
  out = out.replace(/\bimport\.meta\.url\b/g, '__filename');
  return `${out}\n${exported.join('\n')}`;
}

function resolvePath(from: string, spec: string, files: Record<string, string>): string | null {
  const baseParts = from.split('/').slice(0, -1);
  const parts = spec.startsWith('/') ? [] : baseParts;
  for (const p of spec.replace(/^\//, '').split('/')) {
    if (!p || p === '.') continue;
    if (p === '..') parts.pop();
    else parts.push(p);
  }
  const path = parts.join('/');
  const candidates = [path, `${path}.js`, `${path}.mjs`, `${path}.cjs`, `${path}/index.js`];
  return candidates.find((c) => c in files) ?? null;
}

function run(req: RunRequest): Promise<RunResult> {
  const lines: string[] = [];
  const consoleShim = {
    log: (...a: unknown[]) => lines.push(fmt(a)),
    info: (...a: unknown[]) => lines.push(fmt(a)),
    debug: (...a: unknown[]) => lines.push(fmt(a)),
    warn: (...a: unknown[]) => lines.push(fmt(a)),
    error: (...a: unknown[]) => lines.push(fmt(a)),
    table: (...a: unknown[]) => lines.push(fmt(a)),
  };
  class ExitSignal {
    constructor(readonly code: number) {}
  }
  const processShim = {
    env: {},
    argv: ['node', req.entry ?? 'snippet.js'],
    platform: 'browser',
    version: 'v22-sandbox',
    cwd: () => '/workspace',
    exit: (code = 0) => {
      throw new ExitSignal(code);
    },
    nextTick: (fn: () => void) => queueMicrotask(fn),
    exitCode: 0,
  };
  const strictAssert = makeAssert(true);
  const looseAssert = Object.assign(makeAssert(false), { strict: strictAssert });
  const builtins: Record<string, unknown> = {
    'node:test': nodeTest,
    test: nodeTest,
    'node:assert': looseAssert,
    assert: looseAssert,
    'node:assert/strict': strictAssert,
    'assert/strict': strictAssert,
  };
  const cache = new Map<string, { exports: Record<string, unknown> }>();
  const __default = (m: unknown) => (m && typeof m === 'object' && 'default' in (m as object) ? (m as { default: unknown }).default : m);

  function load(path: string, source: string): Record<string, unknown> {
    const cached = cache.get(path);
    if (cached) return cached.exports;
    const module = { exports: {} as Record<string, unknown> };
    cache.set(path, module);
    const isEsm = /^\s*(import|export)\s/m.test(source);
    const code = isEsm ? transformEsm(source) : source;
    const require = (spec: string) => {
      if (spec in builtins) return builtins[spec];
      if (spec.startsWith('node:') || !spec.startsWith('.')) {
        const name = spec.startsWith('node:') ? spec : `"${spec}"`;
        return unavailable(name);
      }
      const target = resolvePath(path, spec, req.files);
      if (!target) throw new Error(`Cannot find module '${spec}' imported from ${path}`);
      if (target.endsWith('.json')) return JSON.parse(req.files[target]);
      return load(target, req.files[target]);
    };
    const fn = new Function('require', 'module', 'exports', 'console', 'process', '__filename', '__dirname', '__default', `"use strict";\n${code}\n//# sourceURL=${path}`);
    fn(require, module, module.exports, consoleShim, processShim, path, path.split('/').slice(0, -1).join('/'), __default);
    return module.exports;
  }

  return (async (): Promise<RunResult> => {
    tests = [];
    suite = [];
    let exitCode = 0;
    try {
      if (req.entry) {
        if (!(req.entry in req.files)) throw new Error(`No file named ${req.entry} in the workspace.`);
        load(req.entry, req.files[req.entry]);
      } else {
        load('snippet.js', req.code ?? '');
      }
    } catch (err) {
      if (err instanceof ExitSignal) exitCode = err.code;
      else {
        const e = err as Error;
        lines.push(`${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`);
        return { nonce: req.nonce, ok: false, output: lines.join('\n'), exitCode: 1 };
      }
    }

    if (!tests.length) {
      return { nonce: req.nonce, ok: exitCode === 0, output: lines.join('\n') || '(no output)', exitCode };
    }

    let pass = 0;
    let fail = 0;
    let skipped = 0;
    for (const t of tests) {
      if (t.skip) {
        skipped++;
        lines.push(`﹣ ${t.name} (skipped)`);
        continue;
      }
      const start = performance.now();
      try {
        await t.fn({ name: t.name, diagnostic: (m: string) => lines.push(`  # ${m}`) });
        pass++;
        lines.push(`✔ ${t.name} (${(performance.now() - start).toFixed(1)}ms)`);
      } catch (err) {
        fail++;
        const e = err as Error;
        lines.push(`✖ ${t.name} (${(performance.now() - start).toFixed(1)}ms)`);
        for (const l of `${e?.name ?? 'Error'}: ${e?.message ?? String(err)}`.split('\n')) lines.push(`    ${l}`);
      }
    }
    lines.push(`ℹ tests ${tests.length}`, `ℹ pass ${pass}`, `ℹ fail ${fail}`);
    if (skipped) lines.push(`ℹ skipped ${skipped}`);
    return { nonce: req.nonce, ok: fail === 0, output: lines.join('\n'), tests: { total: tests.length, pass, fail }, exitCode: fail ? 1 : 0 };
  })();
}

let busy = false;
self.onmessage = async (event: MessageEvent<RunRequest>) => {
  if (busy) return;
  busy = true;
  const result = await run(event.data);
  realPost(result);
};
