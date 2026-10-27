/**
 * Hand-computed seed cases — the "quỷ ở seed" tests. Every value below was
 * derived by hand from the TradingView definitions; if one of these fails,
 * the implementation deviates from TradingView, not from the reference.
 */

import { describe, it, expect } from "vitest";
import { Sma, Ema, Rma, Wma, Stdev, Change, Rsi } from "../src/index";

function feed(step: (x: number) => number, xs: number[]): number[] {
  return xs.map((x) => step(x));
}

describe("hand-computed seeds (TradingView definitions)", () => {
  it("SMA(3) over [1,2,3,4,5] → [na,na,2,3,4]", () => {
    const s = new Sma(3);
    const out = feed((x) => s.next(x), [1, 2, 3, 4, 5]);
    expect(Number.isNaN(out[0]) && Number.isNaN(out[1])).toBe(true);
    expect(out.slice(2)).toEqual([2, 3, 4]);
  });

  it("EMA(3): seeds with SMA at bar 2, then alpha=0.5 recursion → [na,na,2,3,4]", () => {
    const e = new Ema(3);
    const out = feed((x) => e.next(x), [1, 2, 3, 4, 5]);
    expect(Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(2); // SMA seed
    expect(out[3]).toBe(3); // 4*0.5 + 2*0.5
    expect(out[4]).toBe(4); // 5*0.5 + 3*0.5
  });

  it("RMA(3): seeds with SMA, then Wilder alpha=1/3 → [na,na,2,8/3,31/9]", () => {
    const r = new Rma(3);
    const out = feed((x) => r.next(x), [1, 2, 3, 4, 5]);
    expect(out[2]).toBe(2);
    expect(out[3]).toBeCloseTo(8 / 3, 12); // (2*2+4)/3
    expect(out[4]).toBeCloseTo(31 / 9, 12); // ((8/3)*2+5)/3
  });

  it("WMA(3) over [1,2,3] → (1·1+2·2+3·3)/6 = 7/3", () => {
    const w = new Wma(3);
    const out = feed((x) => w.next(x), [1, 2, 3]);
    expect(out[2]).toBeCloseTo(14 / 6, 12);
  });

  it("Stdev(2) over [1,3] → population stdev = 1", () => {
    const s = new Stdev(2);
    s.next(1);
    expect(s.next(3)).toBe(1);
  });

  it("Change: na on first bar", () => {
    const c = new Change();
    expect(Number.isNaN(c.next(5))).toBe(true);
    expect(c.next(7)).toBe(2);
    expect(c.next(4)).toBe(-3);
  });

  it("RSI(2) over [1,2,3,2,1] → [na,na,100,50,25] (change na on bar 0 — TradingView warmup)", () => {
    const r = new Rsi(2);
    const out = feed((x) => r.next(x), [1, 2, 3, 2, 1]);
    expect(Number.isNaN(out[0]) && Number.isNaN(out[1])).toBe(true);
    expect(out[2]).toBe(100); // up rma=1, down rma=0
    expect(out[3]).toBe(50); // up=(1·1+0)/2=0.5, down=(0·1+1)/2=0.5
    expect(out[4]).toBe(25); // up=0.25, down=0.75
  });

  it("EMA skips leading na (ema-over-macd alignment)", () => {
    const e = new Ema(2);
    expect(Number.isNaN(e.next(Number.NaN))).toBe(true);
    expect(Number.isNaN(e.next(Number.NaN))).toBe(true);
    expect(Number.isNaN(e.next(10))).toBe(true); // first valid — warmup starts HERE
    expect(e.next(20)).toBe(15); // SMA seed of first 2 valid values
  });
});
