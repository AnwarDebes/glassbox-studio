// Page side of the run_js sandbox: one fresh worker per run, a hard timeout,
// and a nonce so code inside cannot forge the result message.

export interface SandboxResult {
  ok: boolean;
  output: string;
  exitCode: number;
  timedOut: boolean;
  ms: number;
  tests?: { total: number; pass: number; fail: number };
}

const RUNNABLE = /\.(m?js|cjs|json)$/;

export function runInSandbox(
  input: { files: Record<string, string>; entry?: string; code?: string },
  timeoutMs = 5000,
): Promise<SandboxResult> {
  const files = Object.fromEntries(Object.entries(input.files).filter(([p]) => RUNNABLE.test(p)));
  const nonce = crypto.getRandomValues(new Uint32Array(4)).join('-');
  const start = performance.now();
  return new Promise((resolve) => {
    const worker = new Worker(new URL('./runner.worker.ts', import.meta.url), { type: 'module', name: 'run_js sandbox' });
    let settled = false;
    const finish = (r: Omit<SandboxResult, 'ms'>) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      worker.terminate();
      resolve({ ...r, ms: Math.round(performance.now() - start) });
    };
    const timer = setTimeout(
      () => finish({ ok: false, output: `Stopped: the code ran longer than ${timeoutMs / 1000}s.`, exitCode: 124, timedOut: true }),
      timeoutMs,
    );
    worker.onmessage = (e: MessageEvent<{ nonce: string; ok: boolean; output: string; exitCode: number; tests?: SandboxResult['tests'] }>) => {
      if (e.data?.nonce !== nonce) return;
      finish({ ok: e.data.ok, output: e.data.output, exitCode: e.data.exitCode, timedOut: false, tests: e.data.tests });
    };
    worker.onerror = (e) => {
      e.preventDefault();
      finish({ ok: false, output: `Sandbox error: ${e.message || 'the worker failed to start'}`, exitCode: 1, timedOut: false });
    };
    worker.postMessage({ nonce, files, entry: input.entry, code: input.code });
  });
}
