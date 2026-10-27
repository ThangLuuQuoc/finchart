/**
 * Composite streaming indicators built from primitives. Same contract:
 * `next()` commits a confirmed bar, `peek()` previews the current tick
 * without mutating state. NaN = Pine `na` (warmup).
 *
 * RSI follows TradingView exactly: gains/losses start from the FIRST CHANGE
 * (`ta.change` is na on bar 0), so the first RSI value lands on bar index
 * `length` — one bar later than implementations that fake a 0 change on bar 0
 * (e.g. candlekit's builtin RSI).
 */

import { NA } from "./na";
import { Sma, Ema, Rma, Stdev, Highest, Lowest, TrueRange } from "./primitives";

export class Rsi {
  private prev = NA;
  private readonly up: Rma;
  private readonly down: Rma;

  constructor(readonly length: number) {
    this.up = new Rma(length);
    this.down = new Rma(length);
  }

  next(close: number): number {
    if (Number.isNaN(close)) return NA;
    if (Number.isNaN(this.prev)) {
      this.prev = close;
      return NA;
    }
    const ch = close - this.prev;
    this.prev = close;
    return rsiOf(this.up.next(Math.max(ch, 0)), this.down.next(Math.max(-ch, 0)));
  }

  peek(close: number): number {
    if (Number.isNaN(close) || Number.isNaN(this.prev)) return NA;
    const ch = close - this.prev;
    return rsiOf(this.up.peek(Math.max(ch, 0)), this.down.peek(Math.max(-ch, 0)));
  }
}

/** 100 * g / (g + l) ≡ TradingView's 100 - 100/(1 + g/l), defined also when l = 0. */
function rsiOf(g: number, l: number): number {
  if (Number.isNaN(g) || Number.isNaN(l)) return NA;
  const t = g + l;
  return t === 0 ? NA : (100 * g) / t;
}

export interface MacdValue {
  macd: number;
  signal: number;
  hist: number;
}

export class Macd {
  private readonly fast: Ema;
  private readonly slow: Ema;
  private readonly sig: Ema;

  constructor(fastLength = 12, slowLength = 26, signalLength = 9) {
    this.fast = new Ema(fastLength);
    this.slow = new Ema(slowLength);
    this.sig = new Ema(signalLength);
  }

  next(close: number): MacdValue {
    const f = this.fast.next(close);
    const s = this.slow.next(close);
    const macd = f - s; // NaN until both seeded
    const signal = this.sig.next(macd); // Ema skips leading NaN — warmup aligns itself
    return { macd, signal, hist: macd - signal };
  }

  peek(close: number): MacdValue {
    const macd = this.fast.peek(close) - this.slow.peek(close);
    const signal = this.sig.peek(macd);
    return { macd, signal, hist: macd - signal };
  }
}

export interface BollingerValue {
  basis: number;
  upper: number;
  lower: number;
}

export class Bollinger {
  private readonly sma: Sma;
  private readonly stdev: Stdev;

  constructor(
    readonly length = 20,
    readonly mult = 2,
  ) {
    this.sma = new Sma(length);
    this.stdev = new Stdev(length);
  }

  next(close: number): BollingerValue {
    const basis = this.sma.next(close);
    const dev = this.stdev.next(close) * this.mult;
    return { basis, upper: basis + dev, lower: basis - dev };
  }

  peek(close: number): BollingerValue {
    const basis = this.sma.peek(close);
    const dev = this.stdev.peek(close) * this.mult;
    return { basis, upper: basis + dev, lower: basis - dev };
  }
}

export class Atr {
  private readonly tr = new TrueRange();
  private readonly rma: Rma;

  constructor(readonly length = 14) {
    this.rma = new Rma(length);
  }

  next(high: number, low: number, close: number): number {
    return this.rma.next(this.tr.next(high, low, close));
  }

  peek(high: number, low: number): number {
    return this.rma.peek(this.tr.peek(high, low));
  }
}

export interface StochValue {
  k: number;
  d: number;
}

/** %K raw (smoothing 1) + %D = SMA(%K, dLength). hi == lo → na. */
export class Stochastic {
  private readonly hi: Highest;
  private readonly lo: Lowest;
  private readonly d: Sma;

  constructor(
    readonly kLength = 14,
    readonly dLength = 3,
  ) {
    this.hi = new Highest(kLength);
    this.lo = new Lowest(kLength);
    this.d = new Sma(dLength);
  }

  next(high: number, low: number, close: number): StochValue {
    const h = this.hi.next(high);
    const l = this.lo.next(low);
    const k = kOf(h, l, close);
    return { k, d: this.d.next(k) };
  }

  peek(high: number, low: number, close: number): StochValue {
    const h = this.hi.peek(high);
    const l = this.lo.peek(low);
    const k = kOf(h, l, close);
    return { k, d: this.d.peek(k) };
  }
}

function kOf(h: number, l: number, close: number): number {
  if (Number.isNaN(h) || Number.isNaN(l) || h === l) return NA;
  return (100 * (close - l)) / (h - l);
}
