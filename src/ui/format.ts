export function compact(n: number): string {
  if (!Number.isFinite(n)) return '0';
  const abs = Math.abs(n);
  const units: Array<[number, string]> = [
    [1e15, 'P'],
    [1e12, 'T'],
    [1e9, 'B'],
    [1e6, 'M'],
    [1e3, 'k'],
  ];
  for (const [v, s] of units) {
    if (abs >= v) {
      const x = n / v;
      return `${x >= 100 ? Math.round(x) : x >= 10 ? x.toFixed(1).replace(/\.0$/, '') : x.toFixed(2).replace(/0$/, '').replace(/\.0$/, '')}${s}`;
    }
  }
  return String(Math.round(n));
}

/** "2.4M×" style factor. */
export function factor(n: number): string {
  if (!Number.isFinite(n) || n <= 0) return '–';
  if (n < 10) return `${n.toFixed(1)}×`;
  return `${compact(n)}×`;
}

export function pct(x: number, digits = 1): string {
  return `${(x * 100).toFixed(digits).replace(/\.0$/, '')}%`;
}

export function ms(x: number): string {
  if (x < 1) return `${(x * 1000).toFixed(0)} µs`;
  if (x < 10) return `${x.toFixed(2)} ms`;
  return `${Math.round(x)} ms`;
}

export function clockTime(at: number | string): string {
  const d = typeof at === 'string' ? new Date(at) : new Date(at);
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' });
}

export function shortHash(h: string): string {
  return h ? `${h.slice(0, 8)}…${h.slice(-4)}` : '';
}

/** A decision margin: the vote lead of the winning class over the runner-up. */
export function margin(x: number): string {
  if (!Number.isFinite(x)) return '0';
  return Number.isInteger(x) ? String(x) : Math.abs(x) >= 10 ? x.toFixed(0) : x.toFixed(2);
}
