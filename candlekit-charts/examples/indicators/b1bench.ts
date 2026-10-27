/**
 * A2 — B1 benchmark harness (in-browser).
 *
 * Quantifies what the Web Worker offload (B1) actually buys: how long the MAIN
 * THREAD is blocked during a full-history batch recompute of K built-in
 * indicators over N bars, comparing
 *   - the synchronous backend (registry.calculate on the main thread), vs
 *   - the worker backend (off-thread compute; the main thread only pays the
 *     postMessage structured-clone of `bars` + the result apply).
 *
 * The headline metric is main-thread block time (= jank). We also report the
 * worker's off-thread wall time and the per-dispatch main-thread cost (the
 * structured-clone tax), because that tax is the honest counterweight to the
 * offload — if cloning `bars` costs more than computing them, the offload loses.
 *
 * Driven from the page via `window.__b1bench(opts)` (see main.tsx) so a Claude
 * Preview / Playwright session can call it and read JSON back. No assertions —
 * this produces numbers, it doesn't gate.
 */
import { createBuiltinRegistry, mainThreadCompute, createWorkerCompute, builtinIndicatorNames, generateBars } from "@getcandlekit/charts";
import type { IndicatorBar, BatchCompute } from "@getcandlekit/charts";

export interface B1BenchOptions {
  bars?: number;
  /** Built-in indicator names to compute (default: all built-ins). */
  indicators?: string[];
  /** Repetitions; the median is reported to damp GC/JIT noise. */
  runs?: number;
}

export interface B1BenchStat {
  runs: number;
  medianMs: number;
  meanMs: number;
  minMs: number;
  maxMs: number;
}

export interface B1BenchResult {
  bars: number;
  indicators: string[];
  /** Synchronous main-thread block per full recompute (THE jank number). */
  syncBlock: B1BenchStat;
  /** Worker: main-thread time to dispatch all K requests (structured-clone tax). */
  workerMainThread: B1BenchStat;
  /** Worker: wall-clock until all K results return (off-thread compute + clone). */
  workerWall: B1BenchStat;
  /** Longest single main-thread task observed during one sync recompute (longtask API). */
  syncLongestTaskMs: number | null;
  /** mainThreadBlock(sync) / mainThreadBlock(worker) — how much jank the offload removes. */
  mainThreadBlockReduction: number;
  note: string;
}

const median = (xs: number[]): number => {
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
};
const stat = (xs: number[]): B1BenchStat => ({
  runs: xs.length,
  medianMs: median(xs),
  meanMs: xs.reduce((a, b) => a + b, 0) / xs.length,
  minMs: Math.min(...xs),
  maxMs: Math.max(...xs),
});

/** Generate deterministic IndicatorBar[] (epoch seconds, candlekit indicator unit). */
function makeBars(n: number): IndicatorBar[] {
  return generateBars(n).map((b) => ({
    time: Math.floor(b.ts / 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? 0,
  }));
}

/** Observe the longest main-thread task during `fn` via the longtask API (browser only). */
async function longestTaskDuring(fn: () => void): Promise<number | null> {
  if (typeof PerformanceObserver === "undefined") {
    fn();
    return null;
  }
  let longest = 0;
  let obs: PerformanceObserver | null = null;
  try {
    obs = new PerformanceObserver((list) => {
      for (const e of list.getEntries()) longest = Math.max(longest, e.duration);
    });
    obs.observe({ entryTypes: ["longtask"] });
  } catch {
    obs = null; // longtask unsupported
  }
  fn();
  // let the observer flush
  await new Promise((r) => setTimeout(r, 0));
  obs?.disconnect();
  return obs ? longest : null;
}

export async function runB1Bench(opts: B1BenchOptions = {}): Promise<B1BenchResult> {
  const N = opts.bars ?? 50_000;
  const runs = opts.runs ?? 7;
  const registry = createBuiltinRegistry();
  const names = opts.indicators ?? builtinIndicatorNames();
  const bars = makeBars(N);

  const sync = mainThreadCompute(registry);
  const worker = new Worker(new URL("../../src/indicators/compute/indicatorWorker.ts", import.meta.url), { type: "module" });
  const wcompute: BatchCompute = createWorkerCompute({ worker, supportedNames: builtinIndicatorNames() });

  // Warm both paths once (JIT + worker module init) — not measured.
  await Promise.all(names.map((n) => sync.calculate(n, bars)));
  await Promise.all(names.map((n) => wcompute.calculate(n, bars)));

  const syncMs: number[] = [];
  const wMainMs: number[] = [];
  const wWallMs: number[] = [];

  for (let r = 0; r < runs; r++) {
    // Sync: the whole batch blocks the main thread.
    const t0 = performance.now();
    for (const n of names) await sync.calculate(n, bars);
    syncMs.push(performance.now() - t0);

    // Worker: main-thread cost = firing K postMessages (clones `bars` each time);
    // wall = until all results return (compute happens off-thread).
    const tDispatch = performance.now();
    const promises = names.map((n) => wcompute.calculate(n, bars));
    wMainMs.push(performance.now() - tDispatch);
    const tWall = performance.now();
    await Promise.all(promises);
    wWallMs.push(performance.now() - tWall);
  }

  const syncLongestTaskMs = await longestTaskDuring(() => {
    for (const n of names) registry.get(n)!.calculate(bars);
  });

  wcompute.dispose();

  const syncBlock = stat(syncMs);
  const workerMainThread = stat(wMainMs);
  const workerWall = stat(wWallMs);

  return {
    bars: N,
    indicators: names,
    syncBlock,
    workerMainThread,
    workerWall,
    syncLongestTaskMs,
    mainThreadBlockReduction: workerMainThread.medianMs > 0 ? syncBlock.medianMs / workerMainThread.medianMs : Infinity,
    note:
      "syncBlock = main-thread jank without B1. workerMainThread = main-thread cost WITH B1 " +
      "(structured-clone of bars per request — the offload tax). workerWall = off-thread compute. " +
      "B1 wins when workerMainThread << syncBlock.",
  };
}
