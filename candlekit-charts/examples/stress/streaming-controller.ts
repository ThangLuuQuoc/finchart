/**
 * Streaming indicator plugin backed by @finchart/pine-rt — the drop-in
 * replacement for candlekit's batch IndicatorController in this stress test.
 *
 * Realtime semantics (TradingView-style):
 *  - the in-progress bar is PENDING: every tick renders via `peek()` (no state
 *    mutation), so the current bar repaints correctly;
 *  - when a bar with a newer timestamp arrives, the pending bar is committed
 *    once via `next()` and the new bar becomes pending.
 *
 * Per tick this costs one peek per indicator (~µs) instead of recalculating
 * every indicator over the whole history (~ms).
 */
import {
  LineSeries,
  HistogramSeries,
  type ISeriesApi,
  type Time,
  type SeriesDataItemTypeMap,
} from "lightweight-charts";
import type { Bar, ChartPlugin, PluginContext } from "@getcandlekit/charts";
import { Sma, Ema, Bollinger, Rsi, Macd } from "@finchart/pine-rt";

const HIST_UP = "#26a69a";
const HIST_DOWN = "#ef5350";

export interface PlotSpec {
  id: string;
  color: string;
  style?: "line" | "histogram";
  lineWidth?: 1 | 2;
}

export interface StreamingEngineDef {
  name: string;
  overlay: boolean;
  plots: PlotSpec[];
  /** One stateful instance per add() — the transpiler's "call-site instance". */
  create(): {
    next(b: Bar): Record<string, number>;
    peek(b: Bar): Record<string, number>;
  };
}

interface Item {
  def: StreamingEngineDef;
  inst: ReturnType<StreamingEngineDef["create"]>;
  series: Map<string, ISeriesApi<"Line" | "Histogram">>;
  pendingTs: number;
}

export class StreamingIndicatorController implements ChartPlugin {
  readonly id = "streaming-indicators";

  private ctx: PluginContext | null = null;
  private items: Item[] = [];

  /**
   * @param maxSeedPoints cap the number of warmup points pushed into each plot
   * series (indicator state still warms over FULL history — only the rendered
   * tail is capped). Tests whether lightweight-charts' per-update cost scales
   * with total series length.
   */
  constructor(private readonly maxSeedPoints = Infinity) {}

  init(ctx: PluginContext): void {
    this.ctx = ctx;
  }

  destroy(): void {
    const chart = this.ctx?.chart;
    if (chart) {
      for (const it of this.items) {
        for (const s of it.series.values()) {
          try {
            chart.removeSeries(s);
          } catch {
            /* */
          }
        }
      }
    }
    this.items = [];
    this.ctx = null;
  }

  /** Warm over existing history (one-off O(n)), then O(1)/tick forever. */
  add(def: StreamingEngineDef): void {
    const ctx = this.ctx;
    if (!ctx) throw new Error("add() before init()");
    const chart = ctx.chart;

    let paneIndex = 0;
    if (!def.overlay) {
      const pane = chart.addPane();
      pane.setHeight(140);
      paneIndex = chart.panes().length - 1;
    }

    const inst = def.create();
    const bars = ctx.getBars();
    const data: Record<string, SeriesDataItemTypeMap["Line" | "Histogram"][]> = {};
    for (const p of def.plots) data[p.id] = [];

    // Commit all bars except the last; the last bar stays pending (peeked).
    const seedFrom = Math.max(0, bars.length - this.maxSeedPoints);
    let pendingTs = -Infinity;
    for (let i = 0; i < bars.length; i++) {
      const b = bars[i];
      const isLast = i === bars.length - 1;
      const vals = isLast ? inst.peek(b) : inst.next(b);
      if (isLast) pendingTs = b.ts;
      if (i < seedFrom) continue; // state warmed, point not rendered
      const t = (b.ts / 1000) as Time;
      for (const p of def.plots) {
        const v = vals[p.id];
        if (Number.isNaN(v)) continue;
        if (p.style === "histogram") data[p.id].push({ time: t, value: v, color: v >= 0 ? HIST_UP : HIST_DOWN });
        else data[p.id].push({ time: t, value: v });
      }
    }

    const series = new Map<string, ISeriesApi<"Line" | "Histogram">>();
    for (const p of def.plots) {
      const s =
        p.style === "histogram"
          ? chart.addSeries(HistogramSeries, { color: p.color, priceLineVisible: false, lastValueVisible: false }, paneIndex)
          : chart.addSeries(
              LineSeries,
              { color: p.color, lineWidth: p.lineWidth ?? 1, priceLineVisible: false, lastValueVisible: false },
              paneIndex,
            );
      s.setData(data[p.id]);
      series.set(p.id, s);
    }

    this.items.push({ def, inst, series, pendingTs });
  }

  remove(id: string): void {
    const idx = this.items.findIndex((it) => it.def.name === id);
    if (idx === -1) return;
    const it = this.items[idx];
    if (this.ctx && this.ctx.chart) {
      for (const s of it.series.values()) {
        try {
          this.ctx.chart.removeSeries(s);
        } catch {}
      }
    }
    this.items.splice(idx, 1);
  }

  onBar(bar: Bar, bars: readonly Bar[]): void {
    for (const it of this.items) {
      if (bar.ts > it.pendingTs) {
        // previous bar closed — commit it exactly once, then move on
        const prev = bars.length >= 2 ? bars[bars.length - 2] : null;
        if (prev && prev.ts === it.pendingTs) it.inst.next(prev);
        it.pendingTs = bar.ts;
      }
      const vals = it.inst.peek(bar);
      const t = (bar.ts / 1000) as Time;
      for (const p of it.def.plots) {
        const v = vals[p.id];
        if (Number.isNaN(v)) continue;
        const s = it.series.get(p.id)!;
        if (p.style === "histogram") (s as ISeriesApi<"Histogram">).update({ time: t, value: v, color: v >= 0 ? HIST_UP : HIST_DOWN });
        else (s as ISeriesApi<"Line">).update({ time: t, value: v });
      }
    }
  }
}

/** The same 5 indicators the batch stress run used, as streaming defs. */
export function stressDefs(): StreamingEngineDef[] {
  return [
    {
      name: "SMA",
      overlay: true,
      plots: [{ id: "sma", color: "#2962ff", lineWidth: 2 }],
      create() {
        const s = new Sma(20);
        return {
          next: (b) => ({ sma: s.next(b.close) }),
          peek: (b) => ({ sma: s.peek(b.close) }),
        };
      },
    },
    {
      name: "EMA",
      overlay: true,
      plots: [{ id: "ema", color: "#f57c00", lineWidth: 2 }],
      create() {
        const e = new Ema(50);
        return {
          next: (b) => ({ ema: e.next(b.close) }),
          peek: (b) => ({ ema: e.peek(b.close) }),
        };
      },
    },
    {
      name: "Bollinger",
      overlay: true,
      plots: [
        { id: "basis", color: "#ff6d00" },
        { id: "upper", color: "#2196f3" },
        { id: "lower", color: "#2196f3" },
      ],
      create() {
        const bb = new Bollinger(20, 2);
        return {
          next: (b) => bb.next(b.close) as unknown as Record<string, number>,
          peek: (b) => bb.peek(b.close) as unknown as Record<string, number>,
        };
      },
    },
    {
      name: "RSI",
      overlay: false,
      plots: [{ id: "rsi", color: "#7e57c2", lineWidth: 2 }],
      create() {
        const r = new Rsi(14);
        return {
          next: (b) => ({ rsi: r.next(b.close) }),
          peek: (b) => ({ rsi: r.peek(b.close) }),
        };
      },
    },
    {
      name: "MACD",
      overlay: false,
      plots: [
        { id: "hist", color: HIST_UP, style: "histogram" },
        { id: "macd", color: "#2962ff", lineWidth: 2 },
        { id: "signal", color: "#ff6d00" },
      ],
      create() {
        const m = new Macd(12, 26, 9);
        return {
          next: (b) => m.next(b.close) as unknown as Record<string, number>,
          peek: (b) => m.peek(b.close) as unknown as Record<string, number>,
        };
      },
    },
  ];
}
