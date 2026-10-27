/**
 * candlekit stress test — 50,000 REAL BTCUSDT 15m bars (Binance).
 *
 * Phases (auto-run):
 *  1. setData 50k bars            → sync time + time-to-first-paint
 *  2. pan baseline (no indicators)→ FPS / frame-time stats
 *  3. add 5 indicators            → per-add sync time (calculate + series setData)
 *  4. pan with indicators         → FPS
 *  5. zoom with indicators        → FPS
 *  6. add 100 drawings            → commit time, then pan FPS with drawings
 *  7. live ticks @30/s, 8s        → per-updateBar sync ms (this hits IndicatorController.onBar
 *                                   which recalculates EVERY indicator over ALL bars per tick)
 *  8. heap snapshots (Chrome)
 *
 * Results: window.__BENCH (JSON), table in side panel, console.log.
 */
import {
  ChartController,
  IndicatorController,
  DrawingController,
  createBuiltinRegistry,
  DEFAULT_STYLE,
  type Bar,
  type DrawingToolId,
} from "@getcandlekit/charts";
import { StreamingIndicatorController, stressDefs } from "./streaming-controller";

/**
 * ?engine=streaming → pine-rt peek/next plugin
 * ?engine=none      → no indicators at all (isolates the chart's own updateBar cost)
 * default           → candlekit batch IndicatorController
 */
const engineParam = new URLSearchParams(location.search).get("engine");
const ENGINE = engineParam === "streaming" || engineParam === "none" ? engineParam : "batch";
/** ?coalesce=1 → apply at most one updateBar per animation frame (latest tick wins). */
const COALESCE = new URLSearchParams(location.search).get("coalesce") === "1";
/** ?only=ticks → skip pan/zoom/drawing phases, go straight to the live-tick phase. */
const ONLY_TICKS = new URLSearchParams(location.search).get("only") === "ticks";
/** ?trim=1 → indicator plot series render only the last 2k points (state still warms over 50k). */
const TRIM = new URLSearchParams(location.search).get("trim") === "1";

const $ = (id: string) => document.getElementById(id)!;
const status = (msg: string) => (($("status").textContent = msg), console.log(`[bench] ${msg}`));

interface FrameStats {
  fps: number;
  frames: number;
  avgMs: number;
  p95Ms: number;
  maxMs: number;
  longFrames: number; // frames > 33ms (i.e. < 30fps moments)
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const results: Record<string, any> = {
  env: {
    ua: navigator.userAgent,
    cores: navigator.hardwareConcurrency,
    dpr: devicePixelRatio,
    viewport: `${innerWidth}x${innerHeight}`,
    engine: ENGINE,
  },
};

function heapMB(): number | null {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const m = (performance as any).memory;
  return m ? Math.round((m.usedJSHeapSize / 1048576) * 10) / 10 : null;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const nextPaint = () =>
  new Promise<number>((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(performance.now()))));

/** Run `step(progress 0..1)` every rAF for `durationMs`, collect frame times. */
function measureFrames(durationMs: number, step: (p: number) => void): Promise<FrameStats> {
  return new Promise((resolve) => {
    const deltas: number[] = [];
    const t0 = performance.now();
    let last = t0;
    const tick = () => {
      const now = performance.now();
      const elapsed = now - t0;
      deltas.push(now - last);
      last = now;
      if (elapsed >= durationMs) {
        deltas.shift(); // first delta is setup noise
        const sorted = [...deltas].sort((a, b) => a - b);
        const sum = deltas.reduce((a, b) => a + b, 0);
        resolve({
          fps: Math.round((deltas.length / sum) * 1000 * 10) / 10,
          frames: deltas.length,
          avgMs: Math.round((sum / deltas.length) * 100) / 100,
          p95Ms: Math.round(sorted[Math.floor(sorted.length * 0.95)] * 100) / 100,
          maxMs: Math.round(Math.max(...deltas) * 100) / 100,
          longFrames: deltas.filter((d) => d > 33).length,
        });
        return;
      }
      step(Math.min(1, elapsed / durationMs));
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  });
}

function row(label: string, value: string, cls = "") {
  const tbody = $("rows");
  const tr = document.createElement("tr");
  tr.innerHTML = `<td>${label}</td><td class="${cls}">${value}</td>`;
  tbody.appendChild(tr);
}

function fpsRow(label: string, s: FrameStats) {
  const cls = s.fps >= 50 ? "ok" : s.fps >= 30 ? "phase" : "bad";
  row(label, `${s.fps} fps · avg ${s.avgMs}ms · p95 ${s.p95Ms}ms · max ${s.maxMs}ms · ${s.longFrames} long`, cls);
}

async function main() {
  $("results").innerHTML = `<table><thead><tr><th>Metric</th><th>Value</th></tr></thead><tbody id="rows"></tbody></table>`;
  results.heap = { start: heapMB() };

  // ── Load real data ──────────────────────────────────────────────────────────
  status("fetching 50k real bars…");
  const t0 = performance.now();
  const raw = await (await fetch("/data-50k.json")).json();
  const bars: Bar[] = raw.bars.map((b: number[]) => ({
    ts: b[0],
    open: b[1],
    high: b[2],
    low: b[3],
    close: b[4],
    volume: b[5],
  }));
  results.data = {
    count: bars.length,
    symbol: raw.symbol,
    interval: raw.interval,
    from: new Date(bars[0].ts).toISOString(),
    to: new Date(bars[bars.length - 1].ts).toISOString(),
    fetchParseMs: Math.round(performance.now() - t0),
  };
  row("dataset", `${bars.length} bars ${raw.symbol} ${raw.interval} (real)`);

  // ── Chart + setData ─────────────────────────────────────────────────────────
  status("phase 1: setData 50k…");
  const chart = new ChartController($("chart"), { theme: "dark", seriesType: "candlestick", showVolume: true });
  const t1 = performance.now();
  chart.setData(bars);
  const setDataSync = performance.now() - t1;
  const paintAt = await nextPaint();
  results.setData = {
    syncMs: Math.round(setDataSync * 10) / 10,
    toFirstPaintMs: Math.round((paintAt - t1) * 10) / 10,
  };
  results.heap.afterSetData = heapMB();
  row("setData (sync)", `${results.setData.syncMs} ms`, results.setData.syncMs < 200 ? "ok" : "bad");
  row("setData → painted", `${results.setData.toFirstPaintMs} ms`);

  const ts = chart.getChart().timeScale();
  const N = bars.length;
  const WIN = 300; // visible bars while panning

  const panStep = (p: number) => {
    // ping-pong sweep across the whole dataset
    const x = p < 0.5 ? p * 2 : (1 - p) * 2;
    const from = x * (N - WIN);
    ts.setVisibleLogicalRange({ from, to: from + WIN });
  };

  await sleep(300);
  if (!ONLY_TICKS) {
    status("phase 2: pan sweep, no indicators (6s)…");
    results.panBaseline = await measureFrames(6000, panStep);
    fpsRow("pan 50k (chart only)", results.panBaseline);
  }

  // ── Indicators ──────────────────────────────────────────────────────────────
  status(`phase 3: adding 5 indicators (${ENGINE} engine)…`);
  row("engine", ENGINE, ENGINE === "streaming" ? "ok" : "phase");
  results.indicators = {};
  if (ENGINE === "none") {
    row("indicators", "skipped — isolating chart updateBar cost");
  } else if (ENGINE === "streaming") {
    const ind = new StreamingIndicatorController(TRIM ? 2000 : Infinity);
    if (TRIM) row("series trim", "indicator series seeded with last 2k pts only");
    chart.use(ind);
    for (const def of stressDefs()) {
      const ta = performance.now();
      ind.add(def);
      const ms = Math.round((performance.now() - ta) * 10) / 10;
      results.indicators[def.name] = ms;
      row(`add ${def.name}`, `${ms} ms`, ms < 100 ? "ok" : ms < 500 ? "phase" : "bad");
    }
  } else {
    const ind = new IndicatorController(createBuiltinRegistry());
    chart.use(ind);
    const indicatorSpecs: [string, Record<string, unknown>][] = [
      ["SMA", { length: 20 }],
      ["EMA", { length: 50 }],
      ["Bollinger", { length: 20, mult: 2 }],
      ["RSI", { length: 14 }],
      ["MACD", { fast: 12, slow: 26, signal: 9 }],
    ];
    for (const [name, params] of indicatorSpecs) {
      const ta = performance.now();
      ind.add(name, params);
      const ms = Math.round((performance.now() - ta) * 10) / 10;
      results.indicators[name] = ms;
      row(`add ${name}`, `${ms} ms`, ms < 100 ? "ok" : ms < 500 ? "phase" : "bad");
    }
  }
  results.heap.afterIndicators = heapMB();
  await sleep(300);

  if (!ONLY_TICKS) {
    status("phase 4: pan sweep with 5 indicators (6s)…");
    results.panIndicators = await measureFrames(6000, panStep);
    fpsRow("pan 50k + 5 indicators", results.panIndicators);

    await sleep(300);
    status("phase 5: zoom cycles with indicators (6s)…");
    results.zoomIndicators = await measureFrames(6000, (p) => {
      // oscillate visible width 100 ↔ 20000 bars, anchored at the right edge
      const width = 100 + ((Math.sin(p * Math.PI * 4 - Math.PI / 2) + 1) / 2) * 19900;
      ts.setVisibleLogicalRange({ from: N - width, to: N });
    });
    fpsRow("zoom 50k + 5 indicators", results.zoomIndicators);
  }

  // ── Drawings ────────────────────────────────────────────────────────────────
  if (!ONLY_TICKS) {
  status("phase 6: committing 100 drawings…");
  const draw = new DrawingController();
  chart.use(draw);
  const tools: DrawingToolId[] = ["TrendLine", "Rectangle", "FibRetracement", "Ray", "HorizontalLine"];
  const td = performance.now();
  for (let i = 0; i < 100; i++) {
    const tool = tools[i % tools.length];
    const a = Math.floor((i / 100) * (N - 400));
    const b = a + 50 + Math.floor(Math.random() * 300);
    const pa = { time: bars[a].ts / 1000, price: bars[a].close };
    const pb = { time: bars[Math.min(b, N - 1)].ts / 1000, price: bars[Math.min(b, N - 1)].close * 1.02 };
    const points = tool === "HorizontalLine" ? [pa] : [pa, pb];
    draw.engine.commit({ id: `bench-${i}`, tool, points, style: { ...DEFAULT_STYLE } });
  }
  results.drawings = { count: 100, commitMs: Math.round((performance.now() - td) * 10) / 10 };
  results.heap.afterDrawings = heapMB();
  row("commit 100 drawings", `${results.drawings.commitMs} ms`);
  await sleep(300);

  status("phase 6b: pan with indicators + 100 drawings (6s)…");
  results.panDrawings = await measureFrames(6000, panStep);
  fpsRow("pan + indicators + 100 drawings", results.panDrawings);
  } // end !ONLY_TICKS

  // ── Live ticks ──────────────────────────────────────────────────────────────
  status(`phase 7: live ticks 30/s for 8s (${ENGINE}${COALESCE ? " + coalesce" : ""})…`);
  ts.setVisibleLogicalRange({ from: N - WIN, to: N }); // watch the right edge like a live trader
  await sleep(200);

  const tickDurations: number[] = [];
  let lastBar = { ...bars[bars.length - 1] };
  let barCount = 0;
  const TICK_INTERVAL = 1000 / 30;
  let acc = 0;
  let lastT = performance.now();

  const tickStats = await measureFrames(8000, () => {
    const now = performance.now();
    acc += now - lastT;
    lastT = now;
    let dirty = false;
    while (acc >= TICK_INTERVAL) {
      acc -= TICK_INTERVAL;
      // synthetic tick continuing the real series (random walk)
      const drift = lastBar.close * (Math.random() - 0.5) * 0.0008;
      if (++barCount % 30 === 0) {
        // bar rollover must always be committed, even when coalescing
        if (COALESCE && dirty) {
          const tc = performance.now();
          chart.updateBar({ ...lastBar });
          tickDurations.push(performance.now() - tc);
          dirty = false;
        }
        lastBar = {
          ts: lastBar.ts + 15 * 60 * 1000,
          open: lastBar.close,
          high: lastBar.close,
          low: lastBar.close,
          close: lastBar.close + drift,
          volume: 0,
        };
      } else {
        const c = lastBar.close + drift;
        lastBar = { ...lastBar, close: c, high: Math.max(lastBar.high, c), low: Math.min(lastBar.low, c), volume: (lastBar.volume ?? 0) + 1 };
      }
      if (COALESCE) {
        dirty = true; // latest tick wins; flushed once per frame below
      } else {
        const tu = performance.now();
        chart.updateBar({ ...lastBar });
        tickDurations.push(performance.now() - tu);
      }
    }
    if (COALESCE && dirty) {
      const tu = performance.now();
      chart.updateBar({ ...lastBar });
      tickDurations.push(performance.now() - tu);
    }
  });

  const sortedTicks = [...tickDurations].sort((a, b) => a - b);
  results.liveTicks = {
    ticks: tickDurations.length,
    avgMs: Math.round((tickDurations.reduce((a, b) => a + b, 0) / tickDurations.length) * 100) / 100,
    p95Ms: Math.round(sortedTicks[Math.floor(sortedTicks.length * 0.95)] * 100) / 100,
    maxMs: Math.round(Math.max(...tickDurations) * 100) / 100,
    fpsDuring: tickStats,
  };
  results.heap.afterTicks = heapMB();
  row(
    "updateBar w/ 5 indicators",
    `avg ${results.liveTicks.avgMs}ms · p95 ${results.liveTicks.p95Ms}ms · max ${results.liveTicks.maxMs}ms (${results.liveTicks.ticks} ticks)`,
    results.liveTicks.avgMs < 4 ? "ok" : results.liveTicks.avgMs < 16 ? "phase" : "bad",
  );
  fpsRow("FPS during live ticks", tickStats);

  if (results.heap.start != null) {
    row(
      "heap MB (start→data→ind→draw→ticks)",
      `${results.heap.start} → ${results.heap.afterSetData} → ${results.heap.afterIndicators} → ${results.heap.afterDrawings} → ${results.heap.afterTicks}`,
    );
  }

  status("DONE");
  document.title = "BENCH-DONE";
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__chartCtl = chart;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (window as any).__BENCH = results;
  $("json").textContent = JSON.stringify(results, null, 2);
  console.log("BENCH RESULTS", JSON.stringify(results));
}

main().catch((e) => {
  status(`ERROR: ${e?.message ?? e}`);
  document.title = "BENCH-ERROR";
  console.error(e);
});
