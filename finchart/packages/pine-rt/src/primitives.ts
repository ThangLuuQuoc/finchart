/**
 * Streaming TA primitives with TradingView-compatible semantics.
 *
 * Every primitive is a stateful "call-site instance" (one per occurrence in a
 * script — the transpiler hoists each `ta.*` call site to one of these):
 *
 *   - `next(x)`  — commit a CONFIRMED bar value, O(window) worst case,
 *                  independent of total history length.
 *   - `peek(x)`  — value the indicator WOULD have if the current (unconfirmed)
 *                  bar closed at `x`. Never mutates state — call it on every
 *                  intra-bar tick, call `next()` once when the bar closes.
 *
 * Seeding follows TradingView exactly (the part most ports get wrong):
 *   - EMA/RMA seed with the SMA of the first `length` valid values.
 *   - Leading `na` inputs are skipped (warmup does not start until the first
 *     valid value) — this is what makes e.g. `ema(macd, 9)` line up.
 *   - `na` AFTER warmup propagates to the output of that bar but does not
 *     corrupt internal state.
 *
 * All values are `number`; `NaN` encodes Pine's `na`.
 */

import { NA } from "./na";

/** Simple moving average — O(1) per tick via running sum. */
export class Sma {
  private readonly buf: Float64Array;
  private idx = 0;
  private count = 0;
  private sum = 0;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError(`Sma length must be a positive integer, got ${length}`);
    this.buf = new Float64Array(length);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.count === this.length) this.sum -= this.buf[this.idx];
    else this.count++;
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.length;
    this.sum += x;
    return this.count === this.length ? this.sum / this.length : NA;
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NA;
    const full = this.count === this.length;
    const sum = full ? this.sum - this.buf[this.idx] + x : this.sum + x;
    const count = full ? this.length : this.count + 1;
    return count === this.length ? sum / this.length : NA;
  }
}

/** Exponential moving average, alpha = 2/(length+1), seeded with SMA (TradingView). */
export class Ema {
  private readonly alpha: number;
  private seed: Sma | null;
  private value = NA;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError(`Ema length must be a positive integer, got ${length}`);
    this.alpha = 2 / (length + 1);
    this.seed = new Sma(length);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.seed) {
      const s = this.seed.next(x);
      if (!Number.isNaN(s)) {
        this.value = s;
        this.seed = null;
      }
      return this.value;
    }
    this.value = x * this.alpha + this.value * (1 - this.alpha);
    return this.value;
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.seed) return this.seed.peek(x);
    return x * this.alpha + this.value * (1 - this.alpha);
  }
}

/** Wilder's smoothing (ta.rma), alpha = 1/length, seeded with SMA. Used by RSI/ATR. */
export class Rma {
  private readonly length_: number;
  private seed: Sma | null;
  private value = NA;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError(`Rma length must be a positive integer, got ${length}`);
    this.length_ = length;
    this.seed = new Sma(length);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.seed) {
      const s = this.seed.next(x);
      if (!Number.isNaN(s)) {
        this.value = s;
        this.seed = null;
      }
      return this.value;
    }
    this.value = (this.value * (this.length_ - 1) + x) / this.length_;
    return this.value;
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.seed) return this.seed.peek(x);
    return (this.value * (this.length_ - 1) + x) / this.length_;
  }
}

/** Weighted moving average (linear weights, newest heaviest). O(length) per tick. */
export class Wma {
  private readonly buf: Float64Array;
  private idx = 0;
  private count = 0;
  private readonly denom: number;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError(`Wma length must be a positive integer, got ${length}`);
    this.buf = new Float64Array(length);
    this.denom = (length * (length + 1)) / 2;
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.length;
    if (this.count < this.length) this.count++;
    return this.compute();
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.count + 1 < this.length) return NA;
    // newest = x, then walk backwards through committed values
    let acc = x * this.length;
    let w = this.length - 1;
    for (let j = 1; j < this.length; j++, w--) {
      const i = (this.idx - j + this.length * 2) % this.length;
      acc += this.buf[i] * w;
    }
    return acc / this.denom;
  }

  private compute(): number {
    if (this.count < this.length) return NA;
    let acc = 0;
    let w = this.length;
    for (let j = 1; j <= this.length; j++, w--) {
      const i = (this.idx - j + this.length * 2) % this.length;
      acc += this.buf[i] * w;
    }
    return acc / this.denom;
  }
}

/** Population (biased) standard deviation over a window — ta.stdev default. O(length). */
export class Stdev {
  private readonly buf: Float64Array;
  private idx = 0;
  private count = 0;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError(`Stdev length must be a positive integer, got ${length}`);
    this.buf = new Float64Array(length);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.length;
    if (this.count < this.length) this.count++;
    if (this.count < this.length) return NA;
    return stdevOf(this.buf, this.length);
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.count + 1 < this.length) return NA;
    // window = committed values with the oldest displaced by x
    let mean = x;
    for (let j = 1; j < this.length; j++) mean += this.buf[(this.idx - j + this.length * 2) % this.length];
    mean /= this.length;
    let v = (x - mean) * (x - mean);
    for (let j = 1; j < this.length; j++) {
      const d = this.buf[(this.idx - j + this.length * 2) % this.length] - mean;
      v += d * d;
    }
    return Math.sqrt(v / this.length);
  }
}

function stdevOf(buf: Float64Array, n: number): number {
  let mean = 0;
  for (let i = 0; i < n; i++) mean += buf[i];
  mean /= n;
  let v = 0;
  for (let i = 0; i < n; i++) {
    const d = buf[i] - mean;
    v += d * d;
  }
  return Math.sqrt(v / n);
}

/** ta.change — difference from the previous confirmed value (na on the first bar). */
export class Change {
  private prev = NA;

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    const out = Number.isNaN(this.prev) ? NA : x - this.prev;
    this.prev = x;
    return out;
  }

  peek(x: number): number {
    if (Number.isNaN(x) || Number.isNaN(this.prev)) return NA;
    return x - this.prev;
  }
}

/** Rolling maximum over a window (ta.highest). O(length) scan — window sizes are small. */
export class Highest {
  protected readonly buf: Float64Array;
  protected idx = 0;
  protected count = 0;

  constructor(readonly length: number) {
    if (!Number.isInteger(length) || length <= 0) throw new RangeError(`window length must be a positive integer, got ${length}`);
    this.buf = new Float64Array(length);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NA;
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.length;
    if (this.count < this.length) this.count++;
    return this.count === this.length ? this.reduce() : NA;
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NA;
    if (this.count + 1 < this.length) return NA;
    let m = x;
    for (let j = 1; j < this.length; j++) m = this.pick(m, this.buf[(this.idx - j + this.length * 2) % this.length]);
    return m;
  }

  protected pick(a: number, b: number): number {
    return a >= b ? a : b;
  }

  protected reduce(): number {
    let m = this.buf[0];
    for (let i = 1; i < this.length; i++) m = this.pick(m, this.buf[i]);
    return m;
  }
}

/** Rolling minimum over a window (ta.lowest). */
export class Lowest extends Highest {
  protected override pick(a: number, b: number): number {
    return a <= b ? a : b;
  }
}

/** ta.tr(handle_na = true): true range; high-low on the first bar. */
export class TrueRange {
  private prevClose = NA;

  next(high: number, low: number, close: number): number {
    const pc = this.prevClose;
    this.prevClose = close;
    if (Number.isNaN(pc)) return high - low;
    return Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
  }

  peek(high: number, low: number): number {
    const pc = this.prevClose;
    if (Number.isNaN(pc)) return high - low;
    return Math.max(high - low, Math.abs(high - pc), Math.abs(low - pc));
  }
}
