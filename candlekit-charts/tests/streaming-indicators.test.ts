/**
 * Streaming/batch parity: every builtin def that ships a `streaming` engine
 * must produce values identical to its batch `calculate` — same warmup start,
 * same numbers — when fed the same bars one at a time. Also covers the
 * peek/next contract (peek never mutates) and the TradingView-correct RSI
 * warmup.
 */

import { describe, it, expect } from "vitest";
import { BUILTIN_INDICATORS } from "../src/indicators/builtin";
import type { IndicatorBar, StreamValue } from "../src/indicators/types";

/** Deterministic pseudo-random walk (no Math.random — reproducible failures). */
function makeBars(n: number): IndicatorBar[] {
  let seed = 42;
  const rnd = () => {
    seed = (seed * 1664525 + 1013904223) % 4294967296;
    return seed / 4294967296;
  };
  const bars: IndicatorBar[] = [];
  let close = 100;
  for (let i = 0; i < n; i++) {
    const open = close;
    close = Math.max(1, close * (1 + (rnd() - 0.5) * 0.02));
    const high = Math.max(open, close) * (1 + rnd() * 0.005);
    const low = Math.min(open, close) * (1 - rnd() * 0.005);
    bars.push({ time: 1_700_000_000 + i * 60, open, high, low, close, volume: 100 + Math.floor(rnd() * 900) });
  }
  return bars;
}

const bars = makeBars(500);

const num = (v: StreamValue): number => (typeof v === "number" ? v : v.value);

describe("streaming engines match batch calculate bar-for-bar", () => {
  for (const def of BUILTIN_INDICATORS) {
    if (!def.streaming) continue;
    it(`${def.name}`, () => {
      const batch = def.calculate(bars, def.defaultInputs);
      const inst = def.streaming!(def.defaultInputs);

      // collect streaming output per plot, keyed by bar time
      const streamed: Record<string, Map<number, number>> = {};
      for (const b of bars) {
        const vals = inst.next(b);
        for (const [plotId, v] of Object.entries(vals)) {
          const value = num(v);
          if (Number.isNaN(value)) continue;
          (streamed[plotId] ??= new Map()).set(b.time, value);
        }
      }

      for (const [plotId, points] of Object.entries(batch.plots)) {
        const sm = streamed[plotId];
        expect(sm, `${def.name}.${plotId}: streaming produced no values`).toBeTruthy();
        expect(sm!.size, `${def.name}.${plotId}: point count (warmup parity)`).toBe(points.length);
        for (const p of points) {
          const v = sm!.get(p.time);
          expect(v, `${def.name}.${plotId}@${p.time} missing in stream`).toBeDefined();
          const tol = 1e-9 * Math.max(1, Math.abs(p.value));
          expect(Math.abs((v as number) - p.value), `${def.name}.${plotId}@${p.time}: ${v} != ${p.value}`).toBeLessThanOrEqual(tol);
        }
      }
    });
  }

  it("ships a streaming engine for every builtin", () => {
    for (const def of BUILTIN_INDICATORS) expect(def.streaming, def.name).toBeTypeOf("function");
  });
});

describe("peek() contract", () => {
  it("peek equals what next() returns and never mutates state (RSI, MACD)", () => {
    for (const name of ["RSI", "MACD"]) {
      const def = BUILTIN_INDICATORS.find((d) => d.name === name)!;
      const a = def.streaming!(def.defaultInputs);
      const b = def.streaming!(def.defaultInputs);
      for (const bar of bars.slice(0, 200)) {
        const preview = a.peek(bar);
        a.peek({ ...bar, close: bar.close * 1.01 }); // extra intra-bar ticks
        a.peek({ ...bar, close: bar.close * 0.99 });
        const committedA = a.next(bar);
        const committedB = b.next(bar);
        for (const plotId of Object.keys(committedA)) {
          const pv = num(preview[plotId]);
          const av = num(committedA[plotId]);
          const bv = num(committedB[plotId]);
          if (Number.isNaN(av)) {
            expect(Number.isNaN(pv), `${name}.${plotId} preview NaN parity`).toBe(true);
            expect(Number.isNaN(bv)).toBe(true);
          } else {
            expect(pv).toBeCloseTo(av, 9);
            expect(av, `${name}.${plotId}: interleaved peeks changed the stream`).toBe(bv);
          }
        }
      }
    }
  });

  it("commit-on-rollover equals a fresh batch over the extended history", () => {
    const def = BUILTIN_INDICATORS.find((d) => d.name === "EMA")!;
    const inst = def.streaming!({ length: 10 });
    const history = bars.slice(0, 100);
    for (const b of history.slice(0, -1)) inst.next(b);
    // last bar pending: tick it a few times, then roll over to a new bar
    const pending = history[history.length - 1];
    inst.peek(pending);
    inst.peek({ ...pending, close: pending.close * 1.002 });
    inst.next(pending); // bar closed
    const nextBar: IndicatorBar = { ...pending, time: pending.time + 60, close: pending.close * 1.001 };
    const streamed = num(inst.next(nextBar).ema);
    const batch = def.calculate([...history, nextBar], { length: 10 }).plots.ema;
    expect(streamed).toBeCloseTo(batch[batch.length - 1].value, 9);
  });
});

describe("RSI TradingView warmup semantics", () => {
  it("first change is bar0→bar1; first defined RSI lands at index `length`", () => {
    const def = BUILTIN_INDICATORS.find((d) => d.name === "RSI")!;
    const closesIn = [1, 2, 3, 2, 1];
    const five: IndicatorBar[] = closesIn.map((c, i) => ({
      time: 1000 + i * 60,
      open: c,
      high: c,
      low: c,
      close: c,
      volume: 1,
    }));
    const pts = def.calculate(five, { length: 2 }).plots.rsi;
    // length 2 → first RSI at bar index 2 (time 1120), values hand-computed:
    // up rma seeds [1,1]→1, down [0,0]→0 → 100; then 50; then 25.
    expect(pts.map((p) => p.time)).toEqual([1120, 1180, 1240]);
    expect(pts[0].value).toBeCloseTo(100, 9);
    expect(pts[1].value).toBeCloseTo(50, 9);
    expect(pts[2].value).toBeCloseTo(25, 9);
  });
});
