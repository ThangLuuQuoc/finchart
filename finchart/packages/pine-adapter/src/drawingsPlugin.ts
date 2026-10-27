/**
 * PineDrawingsPlugin — renders a *drawing-based* Pine indicator (box/line/label,
 * e.g. Volume Profile) onto a candlekit chart pane.
 *
 * Drawing-based Pine scripts produce no plot series, so candlekit's
 * IndicatorController (which renders series) can't show them. This is a separate
 * `ChartPlugin` (Cách A): it owns its own transpiled instance, replays bars to
 * build the per-instance drawing collection (scoped via pine-rt's
 * setActiveDrawings — no global clobber), and paints box/line via a
 * lightweight-charts series primitive.
 *
 * Structurally typed (`any` for chart/series/target like the chart layer's other
 * primitives) so this package needs no candlekit / lightweight-charts import —
 * `controller.use(plugin)` duck-types the ChartPlugin shape.
 */
import type { PineModule } from './index';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Any = any;

/** Bars as candlekit supplies them (epoch ms in `ts`). */
interface HostBar { ts: number; open: number; high: number; low: number; close: number; volume: number; }

interface PluginCtx {
  chart: Any;
  series: Any;
  getBars(): readonly HostBar[];
}

export interface PineDrawingsPluginOptions {
  id?: string;
  inputs?: Record<string, unknown>;
}

const toBar = (b: HostBar) => ({ time: b.ts, open: b.open, high: b.high, low: b.low, close: b.close, volume: b.volume });

/** Canvas primitive: reads the live drawing collection + bars, paints boxes/lines. */
class DrawingsPrimitive {
  private chart: Any = null;
  private series: Any = null;
  requestUpdate: (() => void) | null = null;

  constructor(
    private readonly getDrawings: () => { boxes: Set<Any>; lines: Set<Any>; labels: Set<Any> } | undefined,
    private readonly getBars: () => readonly HostBar[],
  ) {}

  attached(p: Any): void {
    this.chart = p.chart;
    this.series = p.series;
    this.requestUpdate = p.requestUpdate;
  }
  detached(): void { this.chart = null; this.series = null; this.requestUpdate = null; }
  updateAllViews(): void { /* repaint pulls fresh state in draw() */ }

  paneViews(): Any {
    return [{
      zOrder: () => 'normal',
      update: () => {},
      renderer: () => ({ draw: (target: Any) => this.draw(target) }),
    }];
  }

  private draw(target: Any): void {
    const d = this.getDrawings();
    if (!d || !this.series || !this.chart) return;
    const bars = this.getBars();
    const tScale = this.chart.timeScale();
    const series = this.series;

    const xCoord = (val: number, isTime: boolean): number | null => {
      const idx = isTime ? bars.findIndex((b) => b.ts >= val) : Math.floor(val);
      const i = Math.max(0, Math.min(bars.length - 1, idx >= 0 ? idx : bars.length - 1));
      const b = bars[i];
      return b ? tScale.timeToCoordinate((b.ts / 1000) as Any) : null;
    };

    target.useMediaCoordinateSpace(({ context: ctx }: Any) => {
      ctx.save();
      for (const b of d.boxes) {
        const isTime = b.xloc === 'bar_time';
        const x1 = xCoord(b.left, isTime);
        const x2 = xCoord(b.right, isTime);
        const y1 = series.priceToCoordinate(b.top);
        const y2 = series.priceToCoordinate(b.bottom);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        ctx.fillStyle = b.bgcolor || 'rgba(0,0,0,0)';
        ctx.fillRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        if (b.border_color && b.border_color !== 'rgba(0,0,0,0)') {
          ctx.strokeStyle = b.border_color;
          ctx.lineWidth = b.border_width || 1;
          ctx.strokeRect(Math.min(x1, x2), Math.min(y1, y2), Math.abs(x2 - x1), Math.abs(y2 - y1));
        }
      }
      for (const l of d.lines) {
        const isTime = l.xloc === 'bar_time';
        const x1 = xCoord(l.x1, isTime);
        const x2 = xCoord(l.x2, isTime);
        const y1 = series.priceToCoordinate(l.y1);
        const y2 = series.priceToCoordinate(l.y2);
        if (x1 == null || x2 == null || y1 == null || y2 == null) continue;
        ctx.beginPath();
        ctx.moveTo(x1, y1);
        ctx.lineTo(x2, y2);
        ctx.strokeStyle = l.color || '#888';
        ctx.lineWidth = l.width || 1;
        ctx.stroke();
      }
      ctx.restore();
    });
  }
}

export class PineDrawingsPlugin {
  readonly id: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private inst: any = null;
  private prim: DrawingsPrimitive;
  private series: Any = null;

  constructor(private readonly module: PineModule, private readonly opts: PineDrawingsPluginOptions = {}) {
    this.id = 'pine-draw:' + (opts.id ?? module.meta?.name ?? 'pine');
    this.prim = new DrawingsPrimitive(() => this.inst?.drawings, () => this.bars);
  }

  private bars: readonly HostBar[] = [];

  init(ctx: PluginCtx): void {
    this.series = ctx.series;
    this.bars = ctx.getBars();
    this.spawn();
    this.series.attachPrimitive(this.prim);
    this.replay();
  }

  onData(bars: readonly HostBar[]): void {
    this.bars = bars;
    this.spawn(); // fresh instance — rebuild drawings from scratch
    this.replay();
  }

  onBar(_bar: HostBar, bars: readonly HostBar[]): void {
    this.bars = bars;
    if (!this.inst) return;
    const last = bars[bars.length - 1];
    if (last) this.inst.onBar(toBar(last), bars.length, true, true);
    this.prim.requestUpdate?.();
  }

  destroy(): void {
    try { this.series?.detachPrimitive(this.prim); } catch { /* already detached */ }
    this.inst = null;
    this.series = null;
  }

  /** Current drawing collection (boxes/lines/labels) — for hosts/tests. */
  get drawings(): { boxes: Set<Any>; lines: Set<Any>; labels: Set<Any> } | undefined {
    return this.inst?.drawings;
  }

  private spawn(): void {
    this.inst = this.module.createInstance(this.opts.inputs);
  }

  private replay(): void {
    const bars = this.bars;
    for (let i = 0; i < bars.length; i++) {
      this.inst.onBar(toBar(bars[i]!), i + 1, i === bars.length - 1, true);
    }
    this.prim.requestUpdate?.();
  }
}

/** Convenience factory. */
export function pineDrawingsPlugin(module: PineModule, opts?: PineDrawingsPluginOptions): PineDrawingsPlugin {
  return new PineDrawingsPlugin(module, opts);
}
