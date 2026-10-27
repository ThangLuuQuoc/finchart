import { describe, it, expect } from "vitest";
import { createBuiltinRegistry, BUILTIN_INDICATORS } from "../src/indicators/builtin";
import type { IndicatorBar } from "../src/indicators/types";

const bars: IndicatorBar[] = Array.from({ length: 120 }, (_, i) => {
  const base = 100 + 10 * Math.sin(i / 8) + i * 0.05;
  return { time: 1_700_000_000 + i * 60, open: base, high: base + 1, low: base - 1, close: base, volume: 100 + i };
});

describe("built-in indicator registry", () => {
  it("registers the full catalog grouped by category", () => {
    const reg = createBuiltinRegistry();
    expect(reg.list().length).toBe(BUILTIN_INDICATORS.length);
    const cats = reg.byCategory();
    expect(cats.overlay.map((d) => d.name)).toContain("SMA");
    expect(cats.oscillator.map((d) => d.name)).toContain("RSI");
  });

  it("SMA matches a hand-computed window", () => {
    const sma = createBuiltinRegistry().get("SMA")!;
    const res = sma.calculate(bars, { length: 5 });
    const pts = res.plots.sma;
    // First SMA point is at index 4 = mean of closes[0..4].
    const expected = (bars.slice(0, 5).reduce((s, b) => s + b.close, 0)) / 5;
    expect(pts[0].value).toBeCloseTo(expected, 6);
    expect(pts[0].time).toBe(bars[4].time);
  });

  it("RSI stays within [0,100]", () => {
    const rsi = createBuiltinRegistry().get("RSI")!;
    const pts = rsi.calculate(bars, { length: 14 }).plots.rsi;
    expect(pts.length).toBeGreaterThan(0);
    for (const p of pts) {
      expect(p.value).toBeGreaterThanOrEqual(0);
      expect(p.value).toBeLessThanOrEqual(100);
    }
  });

  it("MACD returns macd, signal, and a colored histogram", () => {
    const macd = createBuiltinRegistry().get("MACD")!;
    const res = macd.calculate(bars, { fast: 12, slow: 26, signal: 9 });
    expect(res.plots.macd.length).toBeGreaterThan(0);
    expect(res.plots.signal.length).toBeGreaterThan(0);
    expect(res.plots.hist.length).toBeGreaterThan(0);
    expect(res.plots.hist[0].color).toBeTruthy();
  });

  it("Bollinger yields upper >= basis >= lower", () => {
    const bb = createBuiltinRegistry().get("Bollinger")!;
    const res = bb.calculate(bars, { length: 20, mult: 2 });
    const n = res.plots.basis.length - 1;
    expect(res.plots.upper[n].value).toBeGreaterThanOrEqual(res.plots.basis[n].value);
    expect(res.plots.basis[n].value).toBeGreaterThanOrEqual(res.plots.lower[n].value);
  });

  // Bars with open/high/low/close all distinct → source choice changes output.
  const ohlc: IndicatorBar[] = Array.from({ length: 80 }, (_, i) => {
    const c = 100 + 5 * Math.sin(i / 6) + i * 0.1;
    return { time: 1_700_000_000 + i * 60, open: c - 2, high: c + 3, low: c - 4, close: c, volume: 100 + i };
  });

  it("SMA honors the `source` input (close vs hl2 vs open)", () => {
    const sma = createBuiltinRegistry().get("SMA")!;
    const last = (src: string) => {
      const pts = sma.calculate(ohlc, { length: 10, source: src }).plots.sma;
      return pts[pts.length - 1].value;
    };
    const onClose = last("close");
    const onHl2 = last("hl2");
    const onOpen = last("open");
    expect(onClose).not.toBeCloseTo(onHl2, 6);
    expect(onClose).not.toBeCloseTo(onOpen, 6);
    // hl2 SMA == mean of last-10 (high+low)/2 by hand
    const hl2 = ohlc.slice(-10).map((b) => (b.high + b.low) / 2);
    expect(onHl2).toBeCloseTo(hl2.reduce((s, v) => s + v, 0) / 10, 6);
  });

  it("source input exposed as type 'source' on price-based indicators", () => {
    const reg = createBuiltinRegistry();
    for (const name of ["SMA", "EMA", "WMA", "Bollinger", "RSI", "MACD"]) {
      const cfg = reg.get(name)!.inputConfig.find((c) => c.name === "source");
      expect(cfg?.type, name).toBe("source");
    }
  });

  it("streaming honors `source` and matches batch (EMA on open)", () => {
    const ema = createBuiltinRegistry().get("EMA")!;
    const batch = ema.calculate(ohlc, { length: 12, source: "open" }).plots.ema;
    const stream = ema.streaming!({ length: 12, source: "open" });
    let lastStream = NaN;
    for (const b of ohlc) {
      const v = stream.next(b).ema as number;
      if (Number.isFinite(v)) lastStream = v;
    }
    expect(lastStream).toBeCloseTo(batch[batch.length - 1].value, 6);
  });

  it("every indicator computes finite values", () => {
    const reg = createBuiltinRegistry();
    for (const def of reg.list()) {
      const res = def.calculate(bars, def.defaultInputs);
      for (const series of Object.values(res.plots)) {
        for (const p of series) expect(Number.isFinite(p.value)).toBe(true);
      }
    }
  });
});
