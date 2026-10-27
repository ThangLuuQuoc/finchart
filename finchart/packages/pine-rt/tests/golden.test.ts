/**
 * Golden harness: the streaming runtime must reproduce the independent batch
 * reference BAR-BY-BAR over 50,000 real BTCUSDT bars — including the exact
 * warmup index (NaN ↔ NaN). Tolerance is relative 1e-9 (float-accumulation
 * differences between running-sum and fresh-window arithmetic).
 */

import { describe, it, expect } from "vitest";
import { Sma, Ema, Rma, Wma, Stdev, Rsi, Macd, Bollinger, Atr, Stochastic } from "../src/index";
import { loadBars } from "./data";
import {
  refSma,
  refEma,
  refRma,
  refWma,
  refStdev,
  refRsi,
  refMacd,
  refBollinger,
  refAtr,
  refStochastic,
} from "./reference";

const bars = loadBars();
const closes = bars.map((b) => b.close);

/** Both NaN, or numerically equal within relative 1e-9. */
function expectSeriesEqual(actual: readonly number[], expected: readonly number[], label: string): void {
  expect(actual.length).toBe(expected.length);
  let firstActual = -1;
  let firstExpected = -1;
  for (let i = 0; i < expected.length; i++) {
    const a = actual[i];
    const e = expected[i];
    if (firstActual === -1 && !Number.isNaN(a)) firstActual = i;
    if (firstExpected === -1 && !Number.isNaN(e)) firstExpected = i;
    if (Number.isNaN(e) || Number.isNaN(a)) {
      if (Number.isNaN(e) !== Number.isNaN(a)) {
        throw new Error(`${label}[${i}]: NaN mismatch — actual=${a} expected=${e} (warmup off-by-one is a seeding bug)`);
      }
      continue;
    }
    const tol = 1e-9 * Math.max(1, Math.abs(a), Math.abs(e));
    if (Math.abs(a - e) > tol) {
      throw new Error(`${label}[${i}]: ${a} != ${e} (diff ${Math.abs(a - e)})`);
    }
  }
  expect(firstActual, `${label}: first defined index`).toBe(firstExpected);
}

function run(makeNext: () => (i: number) => number): number[] {
  const step = makeNext();
  return bars.map((_, i) => step(i));
}

describe("golden: streaming == independent batch reference over 50k real bars", () => {
  it("SMA(20)", () => {
    const s = new Sma(20);
    expectSeriesEqual(run(() => (i) => s.next(closes[i])), refSma(closes, 20), "sma20");
  });

  it("EMA(50)", () => {
    const e = new Ema(50);
    expectSeriesEqual(run(() => (i) => e.next(closes[i])), refEma(closes, 50), "ema50");
  });

  it("RMA(14)", () => {
    const r = new Rma(14);
    expectSeriesEqual(run(() => (i) => r.next(closes[i])), refRma(closes, 14), "rma14");
  });

  it("WMA(9)", () => {
    const w = new Wma(9);
    expectSeriesEqual(run(() => (i) => w.next(closes[i])), refWma(closes, 9), "wma9");
  });

  it("Stdev(20)", () => {
    const s = new Stdev(20);
    expectSeriesEqual(run(() => (i) => s.next(closes[i])), refStdev(closes, 20), "stdev20");
  });

  it("RSI(14) — TradingView warmup (first value at index len, not len-1)", () => {
    const r = new Rsi(14);
    const actual = run(() => (i) => r.next(closes[i]));
    expectSeriesEqual(actual, refRsi(closes, 14), "rsi14");
    // explicit seed assertions
    expect(Number.isNaN(actual[13])).toBe(true);
    expect(Number.isNaN(actual[14])).toBe(false);
  });

  it("MACD(12,26,9) — signal warmup self-aligns through leading-na skipping", () => {
    const m = new Macd(12, 26, 9);
    const out = bars.map((_, i) => m.next(closes[i]));
    const ref = refMacd(closes, 12, 26, 9);
    expectSeriesEqual(out.map((v) => v.macd), ref.macd, "macd.macd");
    expectSeriesEqual(out.map((v) => v.signal), ref.signal, "macd.signal");
    expectSeriesEqual(out.map((v) => v.hist), ref.hist, "macd.hist");
    // macd defined at slow-1 = 25; signal needs 9 macd values → defined at 25+9-1 = 33
    expect(Number.isNaN(out[25].macd)).toBe(false);
    expect(Number.isNaN(out[32].signal)).toBe(true);
    expect(Number.isNaN(out[33].signal)).toBe(false);
  });

  it("Bollinger(20, 2)", () => {
    const b = new Bollinger(20, 2);
    const out = bars.map((_, i) => b.next(closes[i]));
    const ref = refBollinger(closes, 20, 2);
    expectSeriesEqual(out.map((v) => v.basis), ref.basis, "bb.basis");
    expectSeriesEqual(out.map((v) => v.upper), ref.upper, "bb.upper");
    expectSeriesEqual(out.map((v) => v.lower), ref.lower, "bb.lower");
  });

  it("ATR(14)", () => {
    const a = new Atr(14);
    expectSeriesEqual(
      run(() => (i) => a.next(bars[i].high, bars[i].low, bars[i].close)),
      refAtr(bars, 14),
      "atr14",
    );
  });

  it("Stochastic(14, 3)", () => {
    const s = new Stochastic(14, 3);
    const out = bars.map((_, i) => s.next(bars[i].high, bars[i].low, bars[i].close));
    const ref = refStochastic(bars, 14, 3);
    expectSeriesEqual(out.map((v) => v.k), ref.k, "stoch.k");
    expectSeriesEqual(out.map((v) => v.d), ref.d, "stoch.d");
  });
});

describe("peek(): intra-bar preview never mutates state", () => {
  it("peek equals the value next() would produce, and interleaved peeks do not change the stream", () => {
    const SLICE = 5000;
    const a = new Rsi(14);
    const b = new Rsi(14);
    for (let i = 0; i < SLICE; i++) {
      const c = closes[i];
      // hammer peek with several fake intra-bar ticks before committing
      const preview = a.peek(c);
      a.peek(c * 1.001);
      a.peek(c * 0.999);
      const committedA = a.next(c);
      const committedB = b.next(c);
      if (Number.isNaN(preview)) expect(Number.isNaN(committedA)).toBe(true);
      else expect(preview).toBeCloseTo(committedA, 9);
      if (Number.isNaN(committedA)) expect(Number.isNaN(committedB)).toBe(true);
      else expect(committedA).toBe(committedB);
    }
  });

  it("peek works for composite MACD", () => {
    const m1 = new Macd(12, 26, 9);
    const m2 = new Macd(12, 26, 9);
    for (let i = 0; i < 2000; i++) {
      const c = closes[i];
      const preview = m1.peek(c);
      const v1 = m1.next(c);
      const v2 = m2.next(c);
      for (const key of ["macd", "signal", "hist"] as const) {
        if (Number.isNaN(v1[key])) {
          expect(Number.isNaN(preview[key])).toBe(true);
          expect(Number.isNaN(v2[key])).toBe(true);
        } else {
          expect(preview[key]).toBeCloseTo(v1[key], 9);
          expect(v1[key]).toBe(v2[key]);
        }
      }
    }
  });
});
