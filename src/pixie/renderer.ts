// Pixie, the pixel companion: a procedural canvas creature that acts out what
// the agent is doing. Ported from Pixie, the author's web companion, and extended
// with the poses Glassbox needs: checking with the guard, blocked, and asleep.

export type PixieState =
  | 'idle'
  | 'sleeping'
  | 'thinking'
  | 'typing'
  | 'reading'
  | 'searching'
  | 'editing'
  | 'running'
  | 'debugging'
  | 'guarding'
  | 'waiting'
  | 'blocked'
  | 'celebrating'
  | 'error';

export const PIXIE_LABELS: Record<PixieState, string> = {
  idle: 'Ready',
  sleeping: 'Resting',
  thinking: 'Thinking',
  typing: 'Writing a reply',
  reading: 'Reading',
  searching: 'Searching',
  editing: 'Editing',
  running: 'Running',
  debugging: 'Testing',
  guarding: 'Checking with the guard',
  waiting: 'Waiting for you',
  blocked: 'Blocked by the guard',
  celebrating: 'Done',
  error: 'Something went wrong',
};

const PALETTE = {
  body: '#d97757',
  bodyHi: '#e8a085',
  bodyLo: '#b85d40',
  eye: '#2b2a27',
  white: '#f7f4ec',
  ink: '#3a3833',
  paper: '#f4efe2',
  pencil: '#e3b341',
  glass: '#bfe0e8',
  green: '#5bd69a',
  red: '#ff6b78',
  term: '#14211f',
  termText: '#7ce7a0',
  spark: '#f0c674',
  bug: '#4a4640',
  cube: '#7ce7df',
  shadow: 'rgba(0,0,0,0.22)',
};

const SCENE_W = 34;
const SCENE_H = 32;

export interface PixieRendererOptions {
  reducedMotion?: boolean;
}

export class PixieRenderer {
  private ctx: CanvasRenderingContext2D;
  private state: PixieState = 'idle';
  private stateSince = performance.now();
  private t0 = performance.now();
  private blinkAt = 0;
  private raf = 0;
  private visible = true;
  private onScreen = true;
  private W = 0;
  private H = 0;
  private u = 1;
  private ox = 0;
  private oy = 0;
  private reduced: boolean;
  private resizeObs: ResizeObserver | null = null;
  private interObs: IntersectionObserver | null = null;
  private readonly onVisibility = () => {
    this.visible = !document.hidden;
    this.kick();
  };

  constructor(private canvas: HTMLCanvasElement, opts: PixieRendererOptions = {}) {
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Canvas 2D is not available');
    this.ctx = ctx;
    this.reduced = !!opts.reducedMotion;
    this.resize();
    if (typeof ResizeObserver !== 'undefined') {
      this.resizeObs = new ResizeObserver(() => this.resize());
      this.resizeObs.observe(canvas);
    }
    if (typeof IntersectionObserver !== 'undefined') {
      this.interObs = new IntersectionObserver((entries) => {
        this.onScreen = entries.some((e) => e.isIntersecting);
        this.kick();
      });
      this.interObs.observe(canvas);
    }
    document.addEventListener('visibilitychange', this.onVisibility);
    this.kick();
  }

  setState(state: PixieState) {
    if (state === this.state) return;
    this.state = state;
    this.stateSince = performance.now();
    this.kick();
  }

  setReducedMotion(on: boolean) {
    this.reduced = on;
    this.kick();
  }

  destroy() {
    cancelAnimationFrame(this.raf);
    this.raf = 0;
    this.resizeObs?.disconnect();
    this.interObs?.disconnect();
    document.removeEventListener('visibilitychange', this.onVisibility);
  }

  private kick() {
    if (this.raf) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private loop(now: number) {
    this.raf = 0;
    this.draw(now);
    // With reduced motion Pixie holds a still pose: draw once per change only.
    if (this.reduced || !this.visible || !this.onScreen) return;
    this.raf = requestAnimationFrame((t) => this.loop(t));
  }

  private resize() {
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const rect = this.canvas.getBoundingClientRect();
    const w = Math.max(48, rect.width || 200);
    const h = Math.max(48, rect.height || 200);
    this.canvas.width = Math.floor(w * dpr);
    this.canvas.height = Math.floor(h * dpr);
    this.ctx.imageSmoothingEnabled = false;
    this.W = this.canvas.width;
    this.H = this.canvas.height;
    this.u = Math.max(1, Math.floor(Math.min(this.W / SCENE_W, this.H / SCENE_H)));
    this.ox = Math.floor((this.W - SCENE_W * this.u) / 2);
    this.oy = Math.floor((this.H - SCENE_H * this.u) / 2);
    this.draw(performance.now());
  }

  // ---- drawing helpers, in scene cells ----
  private rect(x: number, y: number, w: number, h: number, color: string) {
    const u = this.u;
    this.ctx.fillStyle = color;
    this.ctx.fillRect(this.ox + Math.round(x * u), this.oy + Math.round(y * u), Math.ceil(w * u), Math.ceil(h * u));
  }
  private dot(x: number, y: number, color: string) {
    this.rect(x, y, 1, 1, color);
  }

  private draw(now: number) {
    const ctx = this.ctx;
    ctx.clearRect(0, 0, this.W, this.H);
    const t = this.reduced ? 0.35 : (now - this.t0) / 1000;
    const since = (now - this.stateSince) / 1000;
    const state = this.state;

    let bob = Math.sin(t * 3) * 0.5;
    if (state === 'sleeping') bob = Math.sin(t * 1.2) * 0.35 + 0.6;
    if (state === 'celebrating' && !this.reduced) bob = -Math.abs(Math.sin(t * 9)) * 2.2;
    let shake = 0;
    if (state === 'error' && !this.reduced) shake = Math.sin(t * 40) * 0.6;
    if (state === 'blocked' && !this.reduced && since < 0.45) shake = Math.sin(since * 60) * 0.5 * (1 - since / 0.45);

    if (now > this.blinkAt) this.blinkAt = now + 2200 + Math.random() * 2600;
    const blinking = !this.reduced && now > this.blinkAt - 140;

    this.rect(11.5, 25.5, 11, 1.4, PALETTE.shadow);
    this.drawProps(state, t);
    const bx = 10 + shake;
    const by = 8 + bob;
    this.drawCreature(bx, by, state, t, blinking);
    this.drawOverlays(state, t, since, bx, by);
  }

  private drawCreature(bx: number, by: number, state: PixieState, t: number, blinking: boolean) {
    const BW = 14;
    const BH = 11;
    const lp = Math.sin(t * 6);
    const legXs = [bx + 1.5, bx + 4.5, bx + BW - 5.5, bx + BW - 2.5];
    legXs.forEach((lx, i) => {
      const busy = state === 'running' || state === 'searching';
      const off = busy ? Math.sin(t * 8 + i) * 0.4 : lp * 0.2 * (i % 2 ? 1 : -1);
      this.rect(lx, by + BH - 0.5 + off, 1.6, 2.6, PALETTE.bodyLo);
    });

    const sway = state === 'sleeping' ? 0.6 : Math.sin(t * 2.2) * 0.5;
    const pulse = state === 'thinking' || state === 'guarding' ? Math.abs(Math.sin(t * 5)) * 0.6 : 0;
    for (const side of [-1, 1]) {
      const ax = side < 0 ? bx + 3 : bx + BW - 4;
      this.rect(ax, by - 2.4 - pulse, 1, 2.8 + pulse, PALETTE.body);
      const tip = state === 'guarding' ? PALETTE.cube : PALETTE.bodyHi;
      this.rect(ax - 0.6 + side * sway, by - 3.6 - pulse, 2.2, 1.6, tip);
    }

    this.rect(bx + 1, by, BW - 2, BH, PALETTE.body);
    this.rect(bx, by + 1, BW, BH - 2, PALETTE.body);
    this.rect(bx + 2, by + 0.6, BW - 4, 1, PALETTE.bodyHi);
    this.rect(bx + 1, by + BH - 1.4, BW - 2, 1.4, PALETTE.bodyLo);

    this.drawEyes(bx, by, BW, state, t, blinking);
    this.drawMouth(bx, by, BW, BH, state);
  }

  private drawEyes(bx: number, by: number, BW: number, state: PixieState, t: number, blinking: boolean) {
    const eyeY = by + 3.4;
    const lx = bx + 3.3;
    const rx = bx + BW - 5.3;
    let look = 0;
    if (state === 'reading') look = Math.sin(t * 3) * 0.8;
    else if (state === 'searching') look = Math.sin(t * 2) * 0.6;
    else if (state === 'blocked') look = 0.8;
    let up = 0;
    if (state === 'thinking') up = -0.7;
    else if (state === 'guarding' || state === 'typing' || state === 'editing') up = 1.2;

    const drawEye = (ex: number) => {
      if (state === 'celebrating') {
        this.rect(ex, eyeY + 0.6, 1, 1, PALETTE.eye);
        this.rect(ex + 1, eyeY, 1, 1, PALETTE.eye);
        this.rect(ex + 2, eyeY + 0.6, 1, 1, PALETTE.eye);
        return;
      }
      if (state === 'error') {
        this.rect(ex, eyeY, 1, 1, PALETTE.eye);
        this.rect(ex + 2, eyeY, 1, 1, PALETTE.eye);
        this.rect(ex + 1, eyeY + 1, 1, 1, PALETTE.eye);
        this.rect(ex, eyeY + 2, 1, 1, PALETTE.eye);
        this.rect(ex + 2, eyeY + 2, 1, 1, PALETTE.eye);
        return;
      }
      if (state === 'sleeping') {
        this.rect(ex, eyeY + 1.6, 3, 0.7, PALETTE.eye);
        return;
      }
      if (blinking) {
        this.rect(ex, eyeY + 1.4, 3, 0.8, PALETTE.eye);
        return;
      }
      if (state === 'blocked') {
        // Determined: a flat brow over the eye.
        this.rect(ex, eyeY + 0.8, 3, 2.4, PALETTE.eye);
        this.rect(ex - 0.2, eyeY - 0.2, 3.4, 0.6, PALETTE.bodyLo);
        this.rect(ex + 1.7 + look * 0.5, eyeY + 1.2, 0.9, 0.9, PALETTE.white);
        return;
      }
      this.rect(ex, eyeY, 3, 3.2, PALETTE.eye);
      this.rect(ex + 1.7 + look * 0.6, eyeY + 0.4 + Math.max(-0.4, Math.min(1.6, up)), 0.9, 0.9, PALETTE.white);
    };
    drawEye(lx);
    drawEye(rx);
  }

  private drawMouth(bx: number, by: number, BW: number, BH: number, state: PixieState) {
    const mx = bx + BW / 2 - 1.5;
    const my = by + BH - 3.4;
    const c = PALETTE.bodyLo;
    if (state === 'celebrating') {
      this.rect(mx, my, 0.8, 1, c);
      this.rect(mx + 0.8, my + 0.8, 1.6, 0.8, c);
      this.rect(mx + 2.4, my, 0.8, 1, c);
    } else if (state === 'error' || state === 'debugging') {
      this.rect(mx + 0.4, my + 0.8, 2.4, 0.8, c);
      this.rect(mx, my + 0.2, 0.8, 0.8, c);
      this.rect(mx + 2.6, my + 0.2, 0.8, 0.8, c);
    } else if (state === 'thinking' || state === 'sleeping') {
      this.rect(mx + 0.8, my + 0.6, 1.6, 0.8, c);
    } else if (state === 'blocked') {
      this.rect(mx, my + 0.6, 3.2, 0.8, c);
    } else {
      this.rect(mx + 0.4, my + 0.4, 2.4, 0.8, c);
    }
  }

  private drawProps(state: PixieState, t: number) {
    if (state === 'typing' || state === 'running' || state === 'debugging') {
      const lx = 12;
      const ly = 21.5;
      this.rect(lx, ly + 3, 10, 1.2, PALETTE.bodyLo);
      this.rect(lx + 0.5, ly - 4, 9, 7, PALETTE.ink);
      if (state === 'running') {
        this.rect(lx + 1.2, ly - 3.2, 7.6, 5.4, PALETTE.term);
        this.rect(lx + 2, ly - 2.4, 1, 0.8, PALETTE.termText);
        if (Math.floor(t * 2) % 2) this.rect(lx + 3.2, ly - 2.4, 1.6, 0.8, PALETTE.termText);
        this.rect(lx + 2, ly - 1, 4, 0.7, 'rgba(124,231,160,0.6)');
        this.rect(lx + 2, ly + 0.1, 5.4, 0.7, 'rgba(124,231,160,0.4)');
      } else {
        this.rect(lx + 1.2, ly - 3.2, 7.6, 5.4, PALETTE.glass);
        const tick = Math.floor(t * 6) % 3;
        for (let i = 0; i < 3; i++) this.rect(lx + 2, ly - 2.4 + i * 1.4, 2 + ((i + tick) % 3) * 2, 0.7, 'rgba(43,42,39,0.5)');
        if (state === 'debugging') this.rect(lx + 6.5, ly - 1, 1, 0.9, PALETTE.red);
      }
    }
  }

  private drawOverlays(state: PixieState, t: number, since: number, bx: number, by: number) {
    if (state === 'thinking') {
      for (let i = 0; i < 3; i++) {
        const ph = (t * 1.2 + i * 0.4) % 1;
        const y = by - 4 - ph * 4;
        const x = bx + 11 + i * 1.4;
        this.rect(x, y, 1 + i * 0.2, 1 + i * 0.2, `rgba(217,119,87,${(1 - ph).toFixed(2)})`);
      }
    }
    if (state === 'reading') {
      const dx = 13;
      const dy = 18;
      this.rect(dx, dy, 8, 6, PALETTE.paper);
      this.rect(dx - 0.4, dy - 0.4, 8.8, 0.6, PALETTE.bodyLo);
      const scan = Math.floor((Math.sin(t * 3) * 0.5 + 0.5) * 3);
      for (let i = 0; i < 4; i++) this.rect(dx + 1, dy + 1 + i * 1.2, i === scan ? 6 : 5, 0.7, i === scan ? PALETTE.body : PALETTE.ink);
    }
    if (state === 'editing') {
      const dx = 12.5;
      const dy = 19;
      this.rect(dx, dy, 9, 6, PALETTE.paper);
      const prog = Math.sin(t * 2) * 0.5 + 0.5;
      this.rect(dx + 1, dy + 1.5, 1 + prog * 6, 0.7, PALETTE.ink);
      this.rect(dx + 1, dy + 3, 1 + ((prog + 0.3) % 1) * 6, 0.7, PALETTE.ink);
      const px = dx + 1 + prog * 6;
      this.rect(px, dy + 0.2, 1, 3.4, PALETTE.pencil);
      this.rect(px, dy + 3.4, 1, 0.8, PALETTE.ink);
    }
    if (state === 'searching') {
      const cx = bx + 7 + Math.cos(t * 2) * 6;
      const cy = by + 14 + Math.sin(t * 2) * 3;
      this.ring(cx, cy, 2.4, PALETTE.ink);
      this.rect(cx + 0.4, cy + 0.4, 1.6, 1.6, PALETTE.glass);
      this.rect(cx + 2, cy + 2, 2.4, 1, PALETTE.ink);
      if (Math.floor(t * 3) % 2) this.dot(cx - 3, cy - 3, PALETTE.spark);
    }
    if (state === 'debugging') {
      const gx = 9 + ((t * 4) % 16);
      const jit = Math.sin(t * 30) * 0.3;
      this.rect(gx, 24 + jit, 2.4, 1.6, PALETTE.bug);
      this.dot(gx - 0.6, 24 + jit, PALETTE.bug);
      this.dot(gx + 2.4, 24 + jit, PALETTE.bug);
      this.dot(gx + 0.4, 23.4 + jit, PALETTE.red);
    }
    if (state === 'guarding') {
      // A small glass cube: the logic model. Its cells light up one by one
      // like literals being checked.
      const cx = 12.5;
      const cy = 18.5;
      const s = 8;
      this.rect(cx, cy, s, s, 'rgba(124,231,223,0.16)');
      this.rect(cx, cy, s, 0.6, PALETTE.cube);
      this.rect(cx, cy + s - 0.6, s, 0.6, PALETTE.cube);
      this.rect(cx, cy, 0.6, s, PALETTE.cube);
      this.rect(cx + s - 0.6, cy, 0.6, s, PALETTE.cube);
      this.rect(cx + 1.4, cy - 1.2, s, 0.6, 'rgba(124,231,223,0.55)');
      this.rect(cx + s + 0.8, cy - 1.2, 0.6, s, 'rgba(124,231,223,0.55)');
      const lit = Math.floor(t * 9) % 9;
      for (let i = 0; i < 9; i++) {
        const gx = cx + 1.4 + (i % 3) * 1.9;
        const gy = cy + 1.4 + Math.floor(i / 3) * 1.9;
        const on = this.reduced ? i % 2 === 0 : i <= lit;
        this.rect(gx, gy, 1.2, 1.2, on ? PALETTE.cube : 'rgba(124,231,223,0.22)');
      }
    }
    if (state === 'blocked') {
      // A stop sign, raised with a little hop at first.
      const lift = this.reduced ? 0 : since < 0.3 ? -(0.3 - since) * 6 : Math.sin(t * 2.4) * 0.25;
      const sx = 24.5;
      const sy = 7.5 + lift;
      this.rect(sx + 2.6, sy + 6.5, 0.9, 9, PALETTE.ink);
      this.rect(sx + 1.4, sy, 3.4, 0.9, PALETTE.red);
      this.rect(sx + 0.5, sy + 0.9, 5.2, 0.9, PALETTE.red);
      this.rect(sx, sy + 1.8, 6.2, 3, PALETTE.red);
      this.rect(sx + 0.5, sy + 4.8, 5.2, 0.9, PALETTE.red);
      this.rect(sx + 1.4, sy + 5.7, 3.4, 0.9, PALETTE.red);
      this.rect(sx + 1, sy + 2.7, 4.2, 1.2, PALETTE.white);
      // A paw holding the pole.
      this.rect(bx + 13.4, by + 6.2, 1.6, 1.4, PALETTE.body);
    }
    if (state === 'celebrating') {
      const spk: Array<[number, number]> = [
        [6, 4],
        [26, 6],
        [28, 18],
        [5, 16],
      ];
      spk.forEach(([x, y], i) => {
        if (this.reduced || Math.floor(t * 6 + i) % 2) {
          this.dot(x, y - Math.sin(t * 4 + i) * 1.5, PALETTE.spark);
          this.dot(x + 1, y - 1 - Math.sin(t * 4 + i) * 1.5, PALETTE.white);
        }
      });
      this.rect(24, 20, 1, 1, PALETTE.green);
      this.rect(25, 21, 1, 1, PALETTE.green);
      this.rect(26, 20, 1, 1, PALETTE.green);
      this.rect(27, 19, 1, 1, PALETTE.green);
      this.rect(28, 18, 1, 1, PALETTE.green);
    }
    if (state === 'waiting') {
      const lift = this.reduced ? 0 : Math.sin(t * 2.4) * 0.4;
      const qx = bx + 15.4;
      const qy = by - 3.4 + lift;
      this.rect(qx, qy, 6.2, 6, PALETTE.white);
      this.rect(qx - 0.6, qy + 0.6, 7.4, 4.8, PALETTE.white);
      this.rect(qx - 1.4, qy + 4.4, 1.4, 1.2, PALETTE.white);
      this.rect(qx + 1.6, qy + 0.9, 3, 1, PALETTE.body);
      this.rect(qx + 3.6, qy + 1.9, 1, 1, PALETTE.body);
      this.rect(qx + 2.6, qy + 2.6, 1, 1.2, PALETTE.body);
      if (this.reduced || Math.floor(t * 2) % 2 === 0) this.rect(qx + 2.6, qy + 4.4, 1, 0.9, PALETTE.body);
    }
    if (state === 'sleeping') {
      for (let i = 0; i < 2; i++) {
        const ph = this.reduced ? 0.3 + i * 0.4 : (t * 0.35 + i * 0.5) % 1;
        const zx = bx + 14 + ph * 4;
        const zy = by - 1 - ph * 6;
        const a = this.reduced ? 0.8 : 1 - ph;
        const col = `rgba(191,224,232,${a.toFixed(2)})`;
        this.rect(zx, zy, 2.4, 0.6, col);
        this.rect(zx + 1.2, zy + 0.6, 0.8, 0.6, col);
        this.rect(zx + 0.6, zy + 1.2, 0.8, 0.6, col);
        this.rect(zx, zy + 1.8, 2.4, 0.6, col);
      }
    }
    if (state === 'error') {
      this.rect(bx + 13, by + 2, 1, 1.6, PALETTE.glass);
      this.dot(bx + 13, by + 3.4, PALETTE.glass);
    }
  }

  private ring(cx: number, cy: number, r: number, color: string) {
    const steps = 16;
    for (let i = 0; i < steps; i++) {
      const a = (i / steps) * Math.PI * 2;
      this.dot(cx + Math.cos(a) * r, cy + Math.sin(a) * r, color);
    }
  }
}
