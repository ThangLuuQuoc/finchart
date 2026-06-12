/**
 * Indicator plugin. Manages the lifecycle of indicator series (overlay lines,
 * oscillator panes, histogram plots, horizontal price lines, and pattern
 * markers) on a chart, driven by an {@link IndicatorRegistry} and a set of
 * active indicators.
 *
 * Ported from the original React IndicatorManager into a framework-agnostic
 * controller: it reads bars from the plugin context (already at the active
 * interval) instead of resampling internally.
 */

import {
  LineSeries,
  HistogramSeries,
  LineStyle,
  createSeriesMarkers,
  type IChartApi,
  type ISeriesApi,
  type Time,
  type ISeriesMarkersPluginApi,
  type SeriesMarker,
} from "lightweight-charts";
import type { ChartPlugin, PluginContext } from "../plugins/types";
import type { Bar } from "../core/types";
import type { IndicatorRegistry } from "./registry";
import type {
  ActiveIndicator,
  IndicatorBar,
  IndicatorDef,
  IndicatorResult,
  PlotConfig,
  PlotPoint,
  StreamingIndicator,
} from "./types";

const HISTOGRAM_STYLES = new Set(["histogram", "columns"]);

interface Managed {
  plotSeries: Map<string, ISeriesApi<"Line" | "Histogram">>;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  pane: any | null;
  isPattern: boolean;
  /**
   * Incremental engine (when the def provides one), warmed over the current
   * history minus the in-progress bar. `pendingTime` is the time (epoch
   * seconds) of that uncommitted bar: ticks on it go through `peek()`; a newer
   * bar first commits it via `next()`. Keeps live ticks O(window) instead of
   * O(history).
   */
  stream: { inst: StreamingIndicator; pendingTime: number } | null;
}

export class IndicatorController implements ChartPlugin {
  readonly id = "indicators";

  private chart: IChartApi | null = null;
  private candleSeries: ISeriesApi<"Candlestick" | "Bar" | "Line" | "Area"> | null = null;
  private getBars: () => readonly Bar[] = () => [];
  private active = new Map<string, ActiveIndicator>();
  private managed = new Map<string, Managed>();
  private barsCache: IndicatorBar[] = [];
  private barsCacheDirty = true;
  private markers = new Map<string, SeriesMarker<Time>[]>();
  private markersPlugin: ISeriesMarkersPluginApi<Time> | null = null;
  private onChange?: (names: string[]) => void;

  constructor(
    private readonly registry: IndicatorRegistry,
    opts: { onChange?: (names: string[]) => void } = {},
  ) {
    this.onChange = opts.onChange;
  }

  init(ctx: PluginContext): void {
    this.chart = ctx.chart;
    this.candleSeries = ctx.series;
    this.getBars = ctx.getBars;
  }

  onData(): void {
    this.barsCacheDirty = true;
    this.refresh();
  }

  /**
   * Live/replay tick: refresh only the newest point of each active indicator.
   *
   * Defs that provide a `streaming` engine pay O(indicator window) per tick:
   * the in-progress bar is previewed with `peek()` and committed exactly once
   * via `next()` when a newer bar arrives. Defs without one fall back to the
   * batch recompute (O(bars), `update()`-ing just the last LWC point).
   * Newly-toggled indicators are materialized by `add()` → `refresh()`, not here.
   */
  onBar(): void {
    const chart = this.chart;
    const candle = this.candleSeries;
    if (!chart || !candle || this.managed.size === 0) return;
    const bars = this.bars();
    if (bars.length === 0) return;

    for (const [name, m] of this.managed) {
      const def = this.registry.get(name);
      const act = this.active.get(name);
      if (!def || !act) continue;

      if (m.stream && !m.isPattern) {
        this.streamTick(m, def.plotConfig, act, bars);
        continue;
      }

      let res: IndicatorResult;
      try {
        res = def.calculate(bars, act.params);
      } catch {
        continue;
      }
      if (m.isPattern) {
        this.markers.set(name, buildMarkers(res));
        this.flushMarkers();
        continue;
      }
      for (const [plotId, raw] of Object.entries(res.plots)) {
        const s = m.plotSeries.get(plotId);
        if (!s) continue;
        const filtered = filterValid(raw);
        const last = filtered[filtered.length - 1];
        if (!last) continue;
        const pc = def.plotConfig.find((c) => c.id === plotId);
        const color = resolveColor(act.colors, plotId, pc?.color);
        if (HISTOGRAM_STYLES.has(pc?.style ?? "")) {
          (s as ISeriesApi<"Histogram">).update({ time: last.time as Time, value: last.value, color: last.color ?? color });
        } else {
          (s as ISeriesApi<"Line">).update({ time: last.time as Time, value: last.value });
        }
      }
    }
  }

  /** O(window) tick for a streaming-capable indicator. */
  private streamTick(m: Managed, plotConfig: PlotConfig[], act: ActiveIndicator, bars: IndicatorBar[]): void {
    const stream = m.stream!;
    const ib = bars[bars.length - 1]; // the tick already landed in the cache
    if (ib.time > stream.pendingTime) {
      // the previously pending bar closed — commit it exactly once
      const prev = bars[bars.length - 2];
      if (prev && prev.time === stream.pendingTime) stream.inst.next(prev);
      stream.pendingTime = ib.time;
    }
    const vals = stream.inst.peek(ib);
    for (const [plotId, v] of Object.entries(vals)) {
      const s = m.plotSeries.get(plotId);
      if (!s) continue;
      const value = typeof v === "number" ? v : v.value;
      if (Number.isNaN(value)) continue;
      const pc = plotConfig.find((c) => c.id === plotId);
      const color = resolveColor(act.colors, plotId, pc?.color);
      const t = ib.time as Time;
      if (HISTOGRAM_STYLES.has(pc?.style ?? "")) {
        (s as ISeriesApi<"Histogram">).update({ time: t, value, color: (typeof v === "object" ? v.color : undefined) ?? color });
      } else {
        (s as ISeriesApi<"Line">).update({ time: t, value });
      }
    }
  }

  destroy(): void {
    if (this.chart) {
      for (const m of this.managed.values()) {
        for (const s of m.plotSeries.values()) {
          try {
            this.chart.removeSeries(s);
          } catch {
            /* */
          }
        }
      }
    }
    this.managed.clear();
    this.markers.clear();
    this.markersPlugin = null;
    this.chart = null;
    this.candleSeries = null;
  }

  // ── Public API ─────────────────────────────────────────────────────────────

  /** List indicators available in the registry, grouped by category. */
  available() {
    return this.registry.byCategory();
  }

  /** Currently active indicator names. */
  activeNames(): string[] {
    return [...this.active.keys()];
  }

  /** The active indicator (name + resolved params), or undefined if off. */
  getActive(name: string): ActiveIndicator | undefined {
    return this.active.get(name);
  }

  /** Turn every active indicator off. */
  clear(): void {
    if (this.active.size === 0) return;
    this.active.clear();
    this.refresh();
    this.onChange?.(this.activeNames());
  }

  /** Turn an indicator on (or update its params). Preserves color overrides. */
  add(name: string, params: Record<string, unknown> = {}): void {
    const def = this.registry.get(name);
    if (!def) return;
    const prev = this.active.get(name);
    this.active.set(name, {
      name,
      params: { ...def.defaultInputs, ...params },
      colors: prev?.colors ?? {},
    });
    this.refresh();
    this.onChange?.(this.activeNames());
  }

  /**
   * Override the per-plot colors of an active indicator. Colors do not affect
   * computed values, so this re-applies series options in place rather than
   * re-running `refresh()` — line series take `applyOptions({ color })`,
   * histogram series are re-`setData`'d (per-point colors win where present).
   * No-op if the indicator is not active.
   */
  setColors(name: string, colors: Record<string, string>): void {
    const act = this.active.get(name);
    if (!act) return;
    this.active.set(name, { ...act, colors });
    this.applyColors(name);
    this.onChange?.(this.activeNames());
  }

  /** Turn an indicator off. */
  remove(name: string): void {
    this.active.delete(name);
    this.refresh();
    this.onChange?.(this.activeNames());
  }

  toggle(name: string): void {
    if (this.active.has(name)) this.remove(name);
    else this.add(name);
  }

  // ── Lifecycle reconciliation ─────────────────────────────────────────────────

  /**
   * Bars converted to {@link IndicatorBar}, cached between calls. A live tick
   * only appends or replaces the last element instead of re-mapping the whole
   * history (which allocated O(history) objects per tick). `onData` marks the
   * cache dirty for a full rebuild.
   */
  private bars(): IndicatorBar[] {
    const src = this.getBars();
    const cached = this.barsCache;
    if (this.barsCacheDirty || src.length < cached.length || src.length - cached.length > 1) {
      this.barsCache = src.map(toIndicatorBar);
      this.barsCacheDirty = false;
      return this.barsCache;
    }
    if (src.length === 0) return cached;
    if (src.length === cached.length + 1) cached.push(toIndicatorBar(src[src.length - 1]));
    else cached[src.length - 1] = toIndicatorBar(src[src.length - 1]);
    return cached;
  }

  private refresh(): void {
    const chart = this.chart;
    const candle = this.candleSeries;
    if (!chart || !candle) return;

    if (!this.markersPlugin) this.markersPlugin = createSeriesMarkers(candle);
    const bars = this.bars();

    // 1. Remove deactivated.
    for (const [name, m] of this.managed) {
      if (this.active.has(name)) continue;
      for (const s of m.plotSeries.values()) {
        try {
          chart.removeSeries(s);
        } catch {
          /* */
        }
      }
      if (m.pane) {
        const idx = chart.panes().indexOf(m.pane);
        if (idx > 0) {
          try {
            chart.removePane(idx);
          } catch {
            /* */
          }
        }
      }
      if (m.isPattern) {
        this.markers.delete(name);
        this.flushMarkers();
      }
      this.managed.delete(name);
    }

    // 2. Update still-active.
    for (const [name, m] of this.managed) {
      const def = this.registry.get(name);
      const act = this.active.get(name);
      if (!def || !act) continue;
      let res: IndicatorResult;
      try {
        res = def.calculate(bars, act.params);
      } catch {
        continue;
      }
      m.stream = this.makeStream(def, act, bars);
      if (m.isPattern) {
        this.markers.set(name, buildMarkers(res));
        this.flushMarkers();
        continue;
      }
      for (const [plotId, raw] of Object.entries(res.plots)) {
        const s = m.plotSeries.get(plotId);
        if (!s) continue;
        const pc = def.plotConfig.find((c) => c.id === plotId);
        const color = resolveColor(act.colors, plotId, pc?.color);
        const isHist = HISTOGRAM_STYLES.has(pc?.style ?? "");
        const filtered = filterValid(raw);
        if (isHist) {
          (s as ISeriesApi<"Histogram">).setData(
            filtered.map((d) => ({ time: d.time as Time, value: d.value, color: d.color ?? color })),
          );
        } else {
          (s as ISeriesApi<"Line">).applyOptions({ color });
          (s as ISeriesApi<"Line">).setData(filtered.map((d) => ({ time: d.time as Time, value: d.value })));
        }
      }
    }

    // 3. Add newly activated.
    for (const [name, act] of this.active) {
      if (this.managed.has(name)) continue;
      const def = this.registry.get(name);
      if (!def) continue;
      let res: IndicatorResult;
      try {
        res = def.calculate(bars, act.params);
      } catch {
        continue;
      }

      if (def.category === "pattern") {
        this.markers.set(name, buildMarkers(res));
        this.flushMarkers();
        this.managed.set(name, { plotSeries: new Map(), pane: null, isPattern: true, stream: null });
        continue;
      }

      const isOverlay = def.category === "overlay";
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      let pane: any = null;
      let paneIndex = 0;
      if (!isOverlay) {
        pane = chart.addPane();
        pane.setHeight(140);
        paneIndex = chart.panes().length - 1;
      }

      const plotSeries = new Map<string, ISeriesApi<"Line" | "Histogram">>();
      for (const [plotId, raw] of Object.entries(res.plots)) {
        const pc = def.plotConfig.find((c) => c.id === plotId);
        const color = resolveColor(act.colors, plotId, pc?.color);
        const lineWidth = clampWidth(pc?.lineWidth ?? 1);
        const isHist = HISTOGRAM_STYLES.has(pc?.style ?? "");
        const filtered = filterValid(raw);
        if (isHist) {
          const s = chart.addSeries(HistogramSeries, { color, priceLineVisible: false, lastValueVisible: false }, paneIndex);
          s.setData(filtered.map((d) => ({ time: d.time as Time, value: d.value, color: d.color ?? color })));
          plotSeries.set(plotId, s);
        } else {
          const s = chart.addSeries(LineSeries, { color, lineWidth, priceLineVisible: false, lastValueVisible: false }, paneIndex);
          s.setData(filtered.map((d) => ({ time: d.time as Time, value: d.value })));
          plotSeries.set(plotId, s);
        }
      }

      const first = [...plotSeries.values()][0];
      if (first && def.hlineConfig.length > 0) {
        for (const hl of def.hlineConfig) {
          try {
            first.createPriceLine({
              price: hl.price,
              color: hl.color ?? "#888",
              lineWidth: clampWidth(hl.linewidth ?? 1),
              lineStyle:
                hl.linestyle === "dashed"
                  ? LineStyle.Dashed
                  : hl.linestyle === "dotted"
                    ? LineStyle.Dotted
                    : LineStyle.Solid,
              axisLabelVisible: false,
              title: hl.title ?? "",
            });
          } catch {
            /* */
          }
        }
      }
      this.managed.set(name, { plotSeries, pane, isPattern: false, stream: this.makeStream(def, act, bars) });
    }
  }

  /**
   * Build + warm a streaming engine for a def that provides one: commit every
   * bar except the last (which stays pending — live ticks preview it via
   * `peek()` until a newer bar commits it). One lightweight O(bars) pass at
   * toggle/refresh time buys O(window) ticks afterwards.
   */
  private makeStream(def: IndicatorDef, act: ActiveIndicator, bars: IndicatorBar[]): Managed["stream"] {
    if (!def.streaming) return null;
    try {
      const inst = def.streaming(act.params);
      for (let i = 0; i < bars.length - 1; i++) inst.next(bars[i]);
      return { inst, pendingTime: bars.length > 0 ? bars[bars.length - 1].time : -Infinity };
    } catch {
      return null;
    }
  }

  private flushMarkers(): void {
    if (!this.markersPlugin) return;
    const all = [...this.markers.values()].flat();
    all.sort((a, b) => (a.time as number) - (b.time as number));
    this.markersPlugin.setMarkers(all);
  }

  /**
   * Re-style an active indicator's existing series from its current color
   * overrides, without recomputing values. Patterns have no plot series.
   */
  private applyColors(name: string): void {
    const m = this.managed.get(name);
    const def = this.registry.get(name);
    const act = this.active.get(name);
    if (!m || !def || !act || m.isPattern) return;
    let res: IndicatorResult;
    try {
      res = def.calculate(this.bars(), act.params);
    } catch {
      return;
    }
    for (const [plotId, s] of m.plotSeries) {
      const pc = def.plotConfig.find((c) => c.id === plotId);
      const color = resolveColor(act.colors, plotId, pc?.color);
      if (HISTOGRAM_STYLES.has(pc?.style ?? "")) {
        const raw = res.plots[plotId];
        if (!raw) continue;
        (s as ISeriesApi<"Histogram">).setData(
          filterValid(raw).map((d) => ({ time: d.time as Time, value: d.value, color: d.color ?? color })),
        );
      } else {
        (s as ISeriesApi<"Line">).applyOptions({ color });
      }
    }
  }
}

// ── helpers ───────────────────────────────────────────────────────────────────

function filterValid(data: PlotPoint[]): PlotPoint[] {
  return data.filter((d) => d.value != null && !Number.isNaN(d.value));
}

function toIndicatorBar(b: Bar): IndicatorBar {
  return {
    time: Math.floor(b.ts / 1000),
    open: b.open,
    high: b.high,
    low: b.low,
    close: b.close,
    volume: b.volume ?? 0,
  };
}

/** Per-plot user override wins, then the plot's configured color, then grey. */
function resolveColor(colors: Record<string, string> | undefined, plotId: string, fallback?: string): string {
  return colors?.[plotId] ?? fallback ?? "#888";
}

function clampWidth(w: number): 1 | 2 | 3 | 4 {
  return Math.max(1, Math.min(4, Math.round(w))) as 1 | 2 | 3 | 4;
}

function mapShape(shape: string): "arrowUp" | "arrowDown" | "circle" | "square" {
  if (shape === "arrowUp" || shape === "arrowDown" || shape === "circle" || shape === "square") return shape;
  const l = shape.toLowerCase();
  if (l.includes("up") || l.includes("bull")) return "arrowUp";
  if (l.includes("down") || l.includes("bear")) return "arrowDown";
  return "circle";
}

function buildMarkers(res: IndicatorResult): SeriesMarker<Time>[] {
  const out = (res.markers ?? []).map((m) => ({
    time: m.time as Time,
    position: (m.position ?? "aboveBar") as "aboveBar" | "belowBar" | "inBar",
    shape: mapShape(m.shape ?? "circle"),
    color: m.color ?? "#2196F3",
    text: m.text ?? "",
  }));
  return out as unknown as SeriesMarker<Time>[];
}
