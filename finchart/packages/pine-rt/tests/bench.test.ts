/**
 * Per-tick cost: streaming runtime vs the batch-recalc-per-tick pattern
 * (what candlekit's IndicatorController.onBar does today). Same 5 indicators
 * the browser stress test used: SMA20, EMA50, Bollinger(20,2), RSI14,
 * MACD(12,26,9), over 50k real bars.
 *
 * Numbers are logged for the benchmark report; the assertion is a generous
 * sanity ceiling so CI stays stable on slow machines.
 */

import { describe, it, expect } from "vitest";
import { Sma, Ema, Rsi, Macd, Bollinger } from "../src/index";
import { loadBars } from "./data";
import { refSma, refEma, refRsi, refMacd, refBollinger } from "./reference";

const bars = loadBars();

describe("per-tick cost on 50k real bars (5 indicators)", () => {
  it("streaming peek/next vs batch recalc", () => {
    const sma = new Sma(20);
    const ema = new Ema(50);
    const bb = new Bollinger(20, 2);
    const rsi = new Rsi(14);
    const macd = new Macd(12, 26, 9);

    // initial warm pass over full history (what setData triggers)
    const tWarm = performance.now();
    for (const b of bars) {
      sma.next(b.close);
      ema.next(b.close);
      bb.next(b.close);
      rsi.next(b.close);
      macd.next(b.close);
    }
    const warmMs = performance.now() - tWarm;

    // intra-bar ticks → peek
    const TICKS = 100_000;
    const last = bars[bars.length - 1].close;
    let sink = 0;
    const tPeek = performance.now();
    for (let i = 0; i < TICKS; i++) {
      const px = last * (1 + ((i % 200) - 100) * 1e-6);
      sink += sma.peek(px) + ema.peek(px) + bb.peek(px).basis + rsi.peek(px) + macd.peek(px).hist;
    }
    const peekUs = ((performance.now() - tPeek) / TICKS) * 1000;

    // confirmed bars → next
    const tNext = performance.now();
    for (let i = 0; i < TICKS; i++) {
      const px = last * (1 + ((i % 200) - 100) * 1e-6);
      sink += sma.next(px) + ema.next(px) + bb.next(px).basis + rsi.next(px) + macd.next(px).hist;
    }
    const nextUs = ((performance.now() - tNext) / TICKS) * 1000;

    // batch pattern: rebuild value arrays + full recalc of all 5, per tick
    const BATCH_TICKS = 10;
    const tBatch = performance.now();
    for (let i = 0; i < BATCH_TICKS; i++) {
      const closes = bars.map((b) => b.close); // candlekit's bars() remap analogue
      refSma(closes, 20);
      refEma(closes, 50);
      refBollinger(closes, 20, 2);
      refRsi(closes, 14);
      refMacd(closes, 12, 26, 9);
    }
    const batchMs = (performance.now() - tBatch) / BATCH_TICKS;

    const speedup = (batchMs * 1000) / nextUs;
    console.log(
      `\n[pine-rt bench] 50k bars, 5 indicators` +
        `\n  warm full history : ${warmMs.toFixed(1)} ms (one-off)` +
        `\n  streaming peek    : ${peekUs.toFixed(3)} µs/tick` +
        `\n  streaming next    : ${nextUs.toFixed(3)} µs/tick` +
        `\n  batch recalc      : ${batchMs.toFixed(1)} ms/tick  (candlekit onBar pattern)` +
        `\n  speedup           : ${Math.round(speedup).toLocaleString()}×  (sink=${Number.isFinite(sink)})\n`,
    );

    expect(Number.isFinite(sink)).toBe(true);
    expect(nextUs).toBeLessThan(50); // generous sanity ceiling (µs per tick)
    expect(peekUs).toBeLessThan(50);
  }, 120_000);
});
