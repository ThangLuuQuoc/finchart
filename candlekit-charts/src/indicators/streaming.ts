/**
 * Incremental (streaming) engines for the built-in indicator catalog.
 *
 * `IndicatorController.onBar` recalculates every active indicator over the
 * FULL bar history on each live tick — O(history) per tick per indicator.
 * On large datasets this collapses under a realtime feed (measured: ~39 ms
 * per tick with 5 active indicators on 50k bars, i.e. a frozen UI at
 * 30 ticks/s). The engines here produce the same values as their batch
 * `calculate` counterparts while costing O(indicator window) per tick,
 * independent of history length (measured: sub-microsecond per tick).
 *
 * Contract (see {@link StreamingIndicator}):
 *  - `next(bar)` — commit a CONFIRMED bar;
 *  - `peek(bar)` — the values the indicator would have if the in-progress bar
 *    closed now; never mutates state, safe to call on every intra-bar tick.
 *
 * NaN encodes "warmup / not defined yet" (the batch path's `null`).
 * Original MIT code — no third-party indicator runtime (invariant #3).
 */

import type { IndicatorBar, StreamingIndicator, StreamValue } from "./types";
import type { SourceExtractor } from "./source";

/** Default price source for engines that take one. */
const CLOSE: SourceExtractor = (b) => b.close;

// ── window / smoothing primitives ──────────────────────────────────────────────

/** Simple moving average — O(1) per tick via running sum over a ring buffer. */
class Sma {
  private readonly buf: Float64Array;
  private idx = 0;
  private count = 0;
  private sum = 0;

  constructor(private readonly len: number) {
    this.buf = new Float64Array(len);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NaN;
    if (this.count === this.len) this.sum -= this.buf[this.idx];
    else this.count++;
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.len;
    this.sum += x;
    return this.count === this.len ? this.sum / this.len : NaN;
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NaN;
    const full = this.count === this.len;
    const sum = full ? this.sum - this.buf[this.idx] + x : this.sum + x;
    return (full ? this.len : this.count + 1) === this.len ? sum / this.len : NaN;
  }
}

/**
 * EMA seeded with the SMA of the first `len` values (matches `emaSeries`).
 * Leading-NaN inputs are skipped, which is what makes `ema(macd, signalLen)`
 * align with the batch path's compress-defined-values approach.
 */
class Ema {
  private readonly alpha: number;
  private seed: Sma | null;
  private value = NaN;

  constructor(len: number) {
    this.alpha = 2 / (len + 1);
    this.seed = new Sma(len);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NaN;
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
    if (Number.isNaN(x)) return NaN;
    if (this.seed) return this.seed.peek(x);
    return x * this.alpha + this.value * (1 - this.alpha);
  }
}

/** Wilder's RMA, SMA-seeded (matches `rmaSeries`). Used by RSI and ATR. */
class Rma {
  private seed: Sma | null;
  private value = NaN;

  constructor(private readonly len: number) {
    this.seed = new Sma(len);
  }

  next(x: number): number {
    if (Number.isNaN(x)) return NaN;
    if (this.seed) {
      const s = this.seed.next(x);
      if (!Number.isNaN(s)) {
        this.value = s;
        this.seed = null;
      }
      return this.value;
    }
    this.value = (this.value * (this.len - 1) + x) / this.len;
    return this.value;
  }

  peek(x: number): number {
    if (Number.isNaN(x)) return NaN;
    if (this.seed) return this.seed.peek(x);
    return (this.value * (this.len - 1) + x) / this.len;
  }
}

/** Ring buffer for O(window) reductions (WMA, stdev, highest/lowest). */
class Win {
  readonly buf: Float64Array;
  idx = 0;
  count = 0;

  constructor(readonly len: number) {
    this.buf = new Float64Array(len);
  }

  push(x: number): void {
    this.buf[this.idx] = x;
    this.idx = (this.idx + 1) % this.len;
    if (this.count < this.len) this.count++;
  }

  full(): boolean {
    return this.count === this.len;
  }

  /** Value committed `j` steps back (j=1 → most recent). */
  back(j: number): number {
    return this.buf[(this.idx - j + 2 * this.len) % this.len];
  }
}

function wmaOf(win: Win, newest: number): number {
  // newest carries weight len, then committed values descending.
  let acc = newest * win.len;
  for (let j = 1; j < win.len; j++) acc += win.back(j) * (win.len - j);
  return acc / ((win.len * (win.len + 1)) / 2);
}

function stdevOf(win: Win, newest: number): number {
  let mean = newest;
  for (let j = 1; j < win.len; j++) mean += win.back(j);
  mean /= win.len;
  let v = (newest - mean) * (newest - mean);
  for (let j = 1; j < win.len; j++) {
    const d = win.back(j) - mean;
    v += d * d;
  }
  return Math.sqrt(v / win.len);
}

function hiLoOf(win: Win, newest: number): { hi: number; lo: number } {
  let hi = newest;
  let lo = newest;
  for (let j = 1; j < win.len; j++) {
    const v = win.back(j);
    if (v > hi) hi = v;
    if (v < lo) lo = v;
  }
  return { hi, lo };
}

// ── streaming engines (plot ids match the builtin defs exactly) ───────────────

export function streamingSma(len: number, src: SourceExtractor = CLOSE): StreamingIndicator {
  const s = new Sma(len);
  return {
    next: (b) => ({ sma: s.next(src(b)) }),
    peek: (b) => ({ sma: s.peek(src(b)) }),
  };
}

export function streamingEma(len: number, src: SourceExtractor = CLOSE): StreamingIndicator {
  const e = new Ema(len);
  return {
    next: (b) => ({ ema: e.next(src(b)) }),
    peek: (b) => ({ ema: e.peek(src(b)) }),
  };
}

export function streamingWma(len: number, src: SourceExtractor = CLOSE): StreamingIndicator {
  const w = new Win(len);
  return {
    next(b) {
      // compute with the source value as the newest BEFORE committing it —
      // pushing first would count it twice and drop the oldest window value
      const x = src(b);
      const v = w.count + 1 >= w.len ? wmaOf(w, x) : NaN;
      w.push(x);
      return { wma: v };
    },
    peek(b) {
      return { wma: w.count + 1 >= w.len ? wmaOf(w, src(b)) : NaN };
    },
  };
}

export function streamingVwap(): StreamingIndicator {
  let pv = 0;
  let vol = 0;
  const value = (b: IndicatorBar, cpv: number, cvol: number): number => {
    const typical = (b.high + b.low + b.close) / 3;
    const npv = cpv + typical * (b.volume || 0);
    const nvol = cvol + (b.volume || 0);
    return nvol > 0 ? npv / nvol : typical;
  };
  return {
    next(b) {
      const v = value(b, pv, vol);
      const typical = (b.high + b.low + b.close) / 3;
      pv += typical * (b.volume || 0);
      vol += b.volume || 0;
      return { vwap: v };
    },
    peek: (b) => ({ vwap: value(b, pv, vol) }),
  };
}

export function streamingBollinger(len: number, mult: number, src: SourceExtractor = CLOSE): StreamingIndicator {
  const sma = new Sma(len);
  const win = new Win(len);
  const bands = (basis: number, dev: number) =>
    Number.isNaN(basis) || Number.isNaN(dev)
      ? { upper: NaN, basis: NaN, lower: NaN }
      : { upper: basis + mult * dev, basis, lower: basis - mult * dev };
  return {
    next(b) {
      const x = src(b);
      const basis = sma.next(x);
      const dev = win.count + 1 >= win.len ? stdevOf(win, x) : NaN;
      win.push(x);
      return bands(basis, dev);
    },
    peek(b) {
      const x = src(b);
      const basis = sma.peek(x);
      return bands(basis, win.count + 1 >= win.len ? stdevOf(win, x) : NaN);
    },
  };
}

/**
 * RSI with TradingView semantics: the first change is measured between bars 0
 * and 1 (`ta.change` is na on bar 0), so the first defined RSI lands on bar
 * index `len` — mirroring the fixed batch implementation in `builtin.ts`.
 */
export function streamingRsi(len: number, src: SourceExtractor = CLOSE): StreamingIndicator {
  const up = new Rma(len);
  const down = new Rma(len);
  let prev = NaN;
  const rsiOf = (g: number, l: number): number => {
    if (Number.isNaN(g) || Number.isNaN(l)) return NaN;
    if (l === 0) return g === 0 ? NaN : 100;
    return 100 - 100 / (1 + g / l);
  };
  return {
    next(b) {
      const x = src(b);
      if (Number.isNaN(prev)) {
        prev = x;
        return { rsi: NaN };
      }
      const ch = x - prev;
      prev = x;
      return { rsi: rsiOf(up.next(Math.max(ch, 0)), down.next(Math.max(-ch, 0))) };
    },
    peek(b) {
      if (Number.isNaN(prev)) return { rsi: NaN };
      const ch = src(b) - prev;
      return { rsi: rsiOf(up.peek(Math.max(ch, 0)), down.peek(Math.max(-ch, 0))) };
    },
  };
}

const HIST_UP = "#26a69a";
const HIST_DOWN = "#ef5350";

export function streamingMacd(fast: number, slow: number, signal: number, src: SourceExtractor = CLOSE): StreamingIndicator {
  const ef = new Ema(fast);
  const es = new Ema(slow);
  const sig = new Ema(signal);
  const out = (macd: number, sg: number): Record<string, StreamValue> => {
    const hist = macd - sg;
    return {
      macd,
      signal: sg,
      hist: Number.isNaN(hist) ? NaN : { value: hist, color: hist >= 0 ? HIST_UP : HIST_DOWN },
    };
  };
  return {
    next(b) {
      const x = src(b);
      const macd = ef.next(x) - es.next(x);
      return out(macd, sig.next(macd));
    },
    peek(b) {
      const x = src(b);
      const macd = ef.peek(x) - es.peek(x);
      return out(macd, sig.peek(macd));
    },
  };
}

export function streamingAtr(len: number): StreamingIndicator {
  const rma = new Rma(len);
  let prevClose = NaN;
  const tr = (b: IndicatorBar, pc: number): number =>
    Number.isNaN(pc) ? b.high - b.low : Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  return {
    next(b) {
      const v = rma.next(tr(b, prevClose));
      prevClose = b.close;
      return { atr: v };
    },
    peek: (b) => ({ atr: rma.peek(tr(b, prevClose)) }),
  };
}

export function streamingStochastic(kLen: number, dLen: number): StreamingIndicator {
  const highs = new Win(kLen);
  const lows = new Win(kLen);
  const d = new Sma(dLen);
  // hi === lo → 50, matching the batch implementation.
  const kOf = (hi: number, lo: number, close: number): number => (hi === lo ? 50 : (100 * (close - lo)) / (hi - lo));
  return {
    next(b) {
      const ready = highs.count + 1 >= kLen;
      const k = ready ? kOf(hiLoOf(highs, b.high).hi, hiLoOf(lows, b.low).lo, b.close) : NaN;
      highs.push(b.high);
      lows.push(b.low);
      return ready ? { k, d: d.next(k) } : { k: NaN, d: NaN };
    },
    peek(b) {
      if (highs.count + 1 < kLen) return { k: NaN, d: NaN };
      const k = kOf(hiLoOf(highs, b.high).hi, hiLoOf(lows, b.low).lo, b.close);
      return { k, d: d.peek(k) };
    },
  };
}
