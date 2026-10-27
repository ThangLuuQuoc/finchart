/**
 * Pine Script standard library shims for generated TypeScript.
 * Covers: array.*, math.*, str.*, color.*, BarHistory for series lookback.
 */

// ── PineArray<T> ──────────────────────────────────────────────────────────────

export class PineArray<T = unknown> {
  private _d: T[];

  private constructor(d: T[]) { this._d = d; }

  static newFloat(size: number, fill = 0): PineArray<number> {
    return new PineArray<number>(new Array<number>(size).fill(fill));
  }
  static newInt(size: number, fill = 0): PineArray<number> {
    return new PineArray<number>(new Array<number>(size).fill(fill));
  }
  static newBool(size: number, fill = false): PineArray<boolean> {
    return new PineArray<boolean>(new Array<boolean>(size).fill(fill));
  }
  static newString(size: number, fill = ''): PineArray<string> {
    return new PineArray<string>(new Array<string>(size).fill(fill));
  }
  static new<T>(size = 0, fill?: T): PineArray<T> {
    const d = size > 0 && fill !== undefined ? new Array<T>(size).fill(fill) : [];
    return new PineArray<T>(d);
  }
  static from<T>(items: T[]): PineArray<T> { return new PineArray<T>([...items]); }

  // ── read ──
  get(i: number): T { return this._d[i]; }
  size(): number { return this._d.length; }
  first(): T { return this._d[0]; }
  last(): T { return this._d[this._d.length - 1]; }
  includes(v: T): boolean { return this._d.includes(v); }
  indexof(v: T): number { return this._d.indexOf(v); }
  lastindexof(v: T): number { return this._d.lastIndexOf(v); }

  // ── write ──
  set(i: number, v: T): void { this._d[i] = v; }
  push(v: T): void { this._d.push(v); }
  unshift(v: T): void { this._d.unshift(v); }
  pop(): T { return this._d.pop()!; }
  shift(): T { return this._d.shift()!; }
  insert(i: number, v: T): void { this._d.splice(i, 0, v); }
  remove(i: number): T { return this._d.splice(i, 1)[0]; }
  clear(): void { this._d = []; }
  fill(v: T, from = 0, to = this._d.length): void { this._d.fill(v, from, to); }
  reverse(): void { this._d.reverse(); }
  sort(asc = true): void {
    this._d.sort((a, b) => {
      if (typeof a === 'number' && typeof b === 'number') return asc ? a - b : b - a;
      return asc ? String(a).localeCompare(String(b)) : String(b).localeCompare(String(a));
    });
  }
  concat(other: PineArray<T>): PineArray<T> { return PineArray.from([...this._d, ...other._d]); }
  slice(from: number, to?: number): PineArray<T> { return PineArray.from(this._d.slice(from, to)); }
  copy(): PineArray<T> { return PineArray.from([...this._d]); }

  // ── aggregate (numeric) ──
  sum(): number {
    let s = 0;
    for (const v of this._d) s += (v as unknown as number) || 0;
    return s;
  }
  max(): number { return Math.max(...(this._d as unknown as number[])); }
  min(): number { return Math.min(...(this._d as unknown as number[])); }
  avg(): number { return this._d.length ? this.sum() / this._d.length : NaN; }
  stdev(biased = false): number {
    const m = this.avg();
    if (isNaN(m) || this._d.length === 0) return NaN;
    const n = biased ? this._d.length : this._d.length - 1;
    if (n <= 0) return NaN;
    const v = (this._d as unknown as number[]).reduce((s, x) => s + (x - m) ** 2, 0) / n;
    return Math.sqrt(v);
  }
  variance(biased = false): number { const s = this.stdev(biased); return s * s; }
  median(): number {
    const sorted = [...this._d as unknown as number[]].sort((a, b) => a - b);
    const m = sorted.length >> 1;
    return sorted.length % 2 ? sorted[m] : (sorted[m - 1] + sorted[m]) / 2;
  }
  mode(): T {
    const freq = new Map<T, number>();
    for (const v of this._d) freq.set(v, (freq.get(v) ?? 0) + 1);
    let best = this._d[0], bestN = 0;
    for (const [v, n] of freq) if (n > bestN) { best = v; bestN = n; }
    return best;
  }
  range(): number {
    const d = this._d as unknown as number[];
    return Math.max(...d) - Math.min(...d);
  }
  percentile_nearest_rank(pct: number): number {
    const sorted = [...this._d as unknown as number[]].sort((a, b) => a - b);
    const i = Math.max(0, Math.ceil(pct / 100 * sorted.length) - 1);
    return sorted[i];
  }
  percentile_linear_interpolation(pct: number): number {
    const sorted = [...this._d as unknown as number[]].sort((a, b) => a - b);
    const rank = pct / 100 * (sorted.length - 1);
    const lo = Math.floor(rank), hi = Math.ceil(rank);
    return sorted[lo] + (sorted[hi] - sorted[lo]) * (rank - lo);
  }
  covariance(other: PineArray<number>, biased = false): number {
    const n = this._d.length;
    if (n !== other.size()) return NaN;
    const ma = this.avg(), mb = other.avg();
    const denom = biased ? n : n - 1;
    if (denom <= 0) return NaN;
    let s = 0;
    for (let i = 0; i < n; i++) s += ((this._d[i] as unknown as number) - ma) * (other.get(i) - mb);
    return s / denom;
  }
  standardize(): PineArray<number> {
    const m = this.avg(), s = this.stdev();
    return PineArray.from((this._d as unknown as number[]).map(v => (v - m) / s));
  }

  join(sep: string): string { return this._d.join(sep); }
  _raw(): T[] { return this._d; }
}

// ── BarHistory ────────────────────────────────────────────────────────────────

export interface Bar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export class BarHistory {
  private readonly _buf: Bar[];
  private _idx = 0;
  private _count = 0;

  constructor(readonly capacity: number) {
    const e = (): Bar => ({ time: 0, open: NaN, high: NaN, low: NaN, close: NaN, volume: NaN });
    this._buf = Array.from({ length: capacity }, e);
  }

  push(bar: Bar): void {
    this._buf[this._idx] = { ...bar };
    this._idx = (this._idx + 1) % this.capacity;
    if (this._count < this.capacity) this._count++;
  }

  at(barsBack: number): Bar | null {
    if (barsBack < 0 || barsBack >= this._count) return null;
    const i = (this._idx - 1 - barsBack + this.capacity) % this.capacity;
    return this._buf[i];
  }

  get length(): number { return this._count; }

  /**
   * Cursor snapshot for a transactional peek: snapshot → push(formingBar) →
   * read history with the forming bar visible → restore. Restoring only resets
   * the ring cursor (idx/count); the overwritten slot is the oldest bar, beyond
   * any realistic lookback (capacity is sized to maxBarsBack), so this is safe.
   */
  snapshot(): { idx: number; count: number } { return { idx: this._idx, count: this._count }; }
  restore(s: { idx: number; count: number }): void { this._idx = s.idx; this._count = s.count; }

  close(barsBack = 0): number { return this.at(barsBack)?.close ?? NaN; }
  high(barsBack = 0): number { return this.at(barsBack)?.high ?? NaN; }
  low(barsBack = 0): number { return this.at(barsBack)?.low ?? NaN; }
  open(barsBack = 0): number { return this.at(barsBack)?.open ?? NaN; }
  volume(barsBack = 0): number { return this.at(barsBack)?.volume ?? NaN; }
  time(barsBack = 0): number { return this.at(barsBack)?.time ?? 0; }
}

// ── PineColor ─────────────────────────────────────────────────────────────────

function toHex2(n: number): string {
  return Math.round(Math.max(0, Math.min(255, n))).toString(16).padStart(2, '0');
}

export const PineColor = {
  red:     '#FF4136',
  blue:    '#2196F3',
  green:   '#4CAF50',
  white:   '#FFFFFF',
  black:   '#000000',
  orange:  '#FF9800',
  yellow:  '#FFEB3B',
  purple:  '#9C27B0',
  lime:    '#CDDC39',
  silver:  '#9E9E9E',
  aqua:    '#00BCD4',
  navy:    '#1565C0',
  maroon:  '#B71C1C',
  olive:   '#827717',
  teal:    '#00695C',
  fuchsia: '#E91E63',
  gray:    '#9E9E9E',

  new(c: string, transp: number): string {
    const alpha = toHex2(Math.round((1 - transp / 100) * 255));
    return c.slice(0, 7) + alpha;
  },

  rgb(r: number, g: number, b: number, transp = 0): string {
    const alpha = transp > 0 ? toHex2(Math.round((1 - transp / 100) * 255)) : '';
    return '#' + toHex2(r) + toHex2(g) + toHex2(b) + alpha;
  },

  from_gradient(value: number, bottom_val: number, top_val: number, bottom_color: string, top_color: string): string {
    const t = Math.max(0, Math.min(1, (value - bottom_val) / (top_val - bottom_val)));
    const parse = (hex: string): [number, number, number] => {
      const n = parseInt(hex.replace('#', '').slice(0, 6), 16);
      return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
    };
    const [r1, g1, b1] = parse(bottom_color);
    const [r2, g2, b2] = parse(top_color);
    return PineColor.rgb(r1 + (r2 - r1) * t, g1 + (g2 - g1) * t, b1 + (b2 - b1) * t);
  },
};

// ── PineMath ──────────────────────────────────────────────────────────────────

export const PineMath = {
  abs: Math.abs,
  ceil: Math.ceil,
  floor: Math.floor,
  round: Math.round,
  sqrt: Math.sqrt,
  exp: Math.exp,
  log: Math.log,
  log2: Math.log2,
  log10: Math.log10,
  pow: Math.pow,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  sign: Math.sign,
  max: (...args: number[]): number => {
    if (args.length === 2) return isNaN(args[0]) || isNaN(args[1]) ? NaN : Math.max(args[0], args[1]);
    return Math.max(...args);
  },
  min: (...args: number[]): number => {
    if (args.length === 2) return isNaN(args[0]) || isNaN(args[1]) ? NaN : Math.min(args[0], args[1]);
    return Math.min(...args);
  },
  pi: Math.PI,
  e: Math.E,
  phi: 1.6180339887498949,
  rphi: 0.6180339887498949,

  round_to_mintick(val: number, mintick = 0.01): number {
    return Math.round(val / mintick) * mintick;
  },
  todegrees(rad: number): number { return rad * (180 / Math.PI); },
  toradians(deg: number): number { return deg * (Math.PI / 180); },
  avg(...args: number[]): number { return args.reduce((s, v) => s + v, 0) / args.length; },
  sum(...args: number[]): number { return args.reduce((s, v) => s + v, 0); },

  random(min = 0, max = 1): number { return min + Math.random() * (max - min); },
};

// ── PineStr ───────────────────────────────────────────────────────────────────

export const PineStr = {
  tostring(v: unknown, format?: string): string {
    if (typeof v === 'number') {
      if (isNaN(v)) return 'NaN';
      if (format) {
        const m = format.match(/\.(0+)/);
        if (m) return v.toFixed(m[1].length);
      }
      return String(v);
    }
    if (typeof v === 'boolean') return v ? 'true' : 'false';
    return String(v ?? '');
  },
  tonumber(s: string): number { return parseFloat(s); },
  toint(s: string): number { return parseInt(s, 10); },
  format(fmt: string, ...args: unknown[]): string {
    return fmt.replace(/\{(\d+)\}/g, (_, i) => String(args[+i] ?? ''));
  },
  contains(s: string, sub: string): boolean { return s.includes(sub); },
  startswith(s: string, pre: string): boolean { return s.startsWith(pre); },
  endswith(s: string, suf: string): boolean { return s.endsWith(suf); },
  length(s: string): number { return s.length; },
  lower(s: string): string { return s.toLowerCase(); },
  upper(s: string): string { return s.toUpperCase(); },
  replace(s: string, target: string, replacement: string, count?: number): string {
    if (count !== undefined && count >= 0) {
      let r = s, c = 0;
      while (c < count) {
        const i = r.indexOf(target);
        if (i < 0) break;
        r = r.slice(0, i) + replacement + r.slice(i + target.length);
        c++;
      }
      return r;
    }
    return s.replaceAll(target, replacement);
  },
  replace_all(s: string, target: string, replacement: string): string { return s.replaceAll(target, replacement); },
  split(s: string, sep: string): PineArray<string> { return PineArray.from(s.split(sep)); },
  substring(s: string, from: number, to?: number): string { return s.substring(from, to); },
  trim(s: string): string { return s.trim(); },
  match(s: string, pattern: string): string { return s.match(new RegExp(pattern))?.[0] ?? ''; },
  pos(s: string, target: string, from = 0): number { return s.indexOf(target, from); },
  concat(...args: string[]): string { return args.join(''); },
};

// ── Drawing stubs (box, line, label, table) ───────────────────────────────────
// Generated code uses these; actual rendering is handled by the chart layer.

export interface DrawBox {
  kind: 'box';
  left: number; top: number; right: number; bottom: number;
  border_color?: string; border_width?: number; border_style?: string;
  bgcolor?: string; text?: string; text_color?: string;
}

export interface DrawLine {
  kind: 'line';
  x1: number; y1: number; x2: number; y2: number;
  color?: string; width?: number; style?: string; extend?: string;
}

export interface DrawLabel {
  kind: 'label';
  x: number; y: number; text?: string;
  color?: string; text_color?: string; size?: string; style?: string;
}

export type DrawCmd = DrawBox | DrawLine | DrawLabel;

/** A collection of drawings (box/line/label). One per Pine instance. */
export interface Drawings {
  boxes: Set<DrawBox>;
  lines: Set<DrawLine>;
  labels: Set<DrawLabel>;
  clear(): void;
}

/** Fresh, empty drawing collection. Each transpiled instance owns one. */
export function createDrawings(): Drawings {
  return {
    boxes: new Set<DrawBox>(),
    lines: new Set<DrawLine>(),
    labels: new Set<DrawLabel>(),
    clear() { this.boxes.clear(); this.lines.clear(); this.labels.clear(); },
  };
}

/**
 * The current drawing target. `box.new` / `line.new` / `label.new` add to it.
 * A transpiled `createInstance()` calls {@link setActiveDrawings} at the start of
 * each `onBar` to point this at its OWN collection, so multiple Pine drawing
 * indicators never share/clobber one global set. Defaults to a standalone one.
 */
export let activeDrawings: Drawings = createDrawings();

/** Point the drawing factories at `d` (called per-instance by generated code). */
export function setActiveDrawings(d: Drawings): void { activeDrawings = d; }

class BoxObj implements DrawBox {
  kind: 'box' = 'box';
  constructor(public left: number, public top: number, public right: number, public bottom: number, opts: any) {
    Object.assign(this, opts);
  }
  delete() { PineBox.delete(this); }
  set_left(v: number) { PineBox.set_left(this, v); }
  set_right(v: number) { PineBox.set_right(this, v); }
  set_top(v: number) { PineBox.set_top(this, v); }
  set_bottom(v: number) { PineBox.set_bottom(this, v); }
  set_bgcolor(v: string) { PineBox.set_bgcolor(this, v); }
  set_border_color(v: string) { PineBox.set_border_color(this, v); }
  set_border_width(v: number) { PineBox.set_border_width(this, v); }
  set_text(v: string) { PineBox.set_text(this, v); }
}

export const PineBox = {
  new(left: number, top: number, right: number, bottom: number, opts: Partial<Omit<DrawBox, 'kind'>> = {}): DrawBox {
    const b = new BoxObj(left, top, right, bottom, opts);
    activeDrawings.boxes.add(b);
    return b;
  },
  delete(_b: DrawBox | null): void { if (_b) activeDrawings.boxes.delete(_b); },
  set_left(b: DrawBox, v: number): void { if (b) b.left = v; },
  set_right(b: DrawBox, v: number): void { if (b) b.right = v; },
  set_top(b: DrawBox, v: number): void { if (b) b.top = v; },
  set_bottom(b: DrawBox, v: number): void { if (b) b.bottom = v; },
  set_bgcolor(b: DrawBox, v: string): void { if (b) b.bgcolor = v; },
  set_border_color(b: DrawBox, v: string): void { if (b) b.border_color = v; },
  set_border_width(b: DrawBox, v: number): void { if (b) b.border_width = v; },
  set_text(b: DrawBox, v: string): void { if (b) b.text = v; },
};

class LineObj implements DrawLine {
  kind: 'line' = 'line';
  constructor(public x1: number, public y1: number, public x2: number, public y2: number, opts: any) {
    Object.assign(this, opts);
  }
  delete() { PineLine.delete(this); }
  set_x1(v: number) { PineLine.set_x1(this, v); }
  set_x2(v: number) { PineLine.set_x2(this, v); }
  set_y1(v: number) { PineLine.set_y1(this, v); }
  set_y2(v: number) { PineLine.set_y2(this, v); }
  set_color(v: string) { PineLine.set_color(this, v); }
  set_width(v: number) { PineLine.set_width(this, v); }
  set_extend(v: string) { PineLine.set_extend(this, v); }
}

export const PineLine = {
  new(x1: number, y1: number, x2: number, y2: number, opts: Partial<Omit<DrawLine, 'kind'>> = {}): DrawLine {
    const l = new LineObj(x1, y1, x2, y2, opts);
    activeDrawings.lines.add(l);
    return l;
  },
  delete(_l: DrawLine | null): void { if (_l) activeDrawings.lines.delete(_l); },
  set_x1(l: DrawLine, v: number): void { if (l) l.x1 = v; },
  set_x2(l: DrawLine, v: number): void { if (l) l.x2 = v; },
  set_y1(l: DrawLine, v: number): void { if (l) l.y1 = v; },
  set_y2(l: DrawLine, v: number): void { if (l) l.y2 = v; },
  set_color(l: DrawLine, v: string): void { if (l) l.color = v; },
  set_width(l: DrawLine, v: number): void { if (l) l.width = v; },
  set_extend(l: DrawLine, v: string): void { if (l) l.extend = v; },
};

class LabelObj implements DrawLabel {
  kind: 'label' = 'label';
  constructor(public x: number, public y: number, opts: any) {
    Object.assign(this, opts);
  }
  delete() { PineLabel.delete(this); }
  set_x(v: number) { PineLabel.set_x(this, v); }
  set_y(v: number) { PineLabel.set_y(this, v); }
  set_text(v: string) { PineLabel.set_text(this, v); }
  set_color(v: string) { PineLabel.set_color(this, v); }
  set_text_color(v: string) { PineLabel.set_text_color(this, v); }
  set_style(v: string) { PineLabel.set_style(this, v); }
}

export const PineLabel = {
  new(x: number, y: number, opts: Partial<Omit<DrawLabel, 'kind'>> = {}): DrawLabel {
    const l = new LabelObj(x, y, opts);
    activeDrawings.labels.add(l);
    return l;
  },
  delete(_l: DrawLabel | null): void { if (_l) activeDrawings.labels.delete(_l); },
  set_x(l: DrawLabel, v: number): void { if (l) l.x = v; },
  set_y(l: DrawLabel, v: number): void { if (l) l.y = v; },
  set_text(l: DrawLabel, v: string): void { if (l) l.text = v; },
  set_color(l: DrawLabel, v: string): void { if (l) l.color = v; },
  set_text_color(l: DrawLabel, v: string): void { if (l) l.text_color = v; },
  set_style(l: DrawLabel, v: string): void { if (l) l.style = v; },
};
