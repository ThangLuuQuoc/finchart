import { useEffect, useState, type CSSProperties } from "react";
import { useChartApi } from "./context";
import type { LegendPlot } from "../indicators/IndicatorController";

/**
 * On-chart status line (TradingView legend): one row per active indicator with
 * its short name, compact params, live value(s) at the crosshair, and inline
 * controls — eye (toggle visibility), gear (open settings), ✕ (remove).
 * Subscribes to the controller's active-set changes and the chart's crosshair.
 */
export interface ChartLegendProps {
  className?: string;
  style?: CSSProperties;
  /** Open the settings dialog for an indicator (gear). */
  onOpenSettings?: (name: string) => void;
}

const fmt = (v: number): string =>
  Number.isFinite(v) ? (Math.abs(v) >= 1000 ? v.toFixed(0) : v.toFixed(2)) : "—";

export function ChartLegend({ className, style, onOpenSettings }: ChartLegendProps) {
  const { controller, indicators } = useChartApi();
  const [, force] = useState(0);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const [param, setParam] = useState<any>(null);

  useEffect(() => {
    if (!indicators) return;
    return indicators.subscribe(() => force((n) => n + 1));
  }, [indicators]);

  useEffect(() => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const chart: any = (controller as any)?.getChart?.();
    if (!chart) return;
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const handler = (p: any) => setParam(p);
    chart.subscribeCrosshairMove(handler);
    return () => chart.unsubscribeCrosshairMove(handler);
  }, [controller]);

  if (!indicators) return null;
  const entries = indicators.legendModel();
  if (entries.length === 0) return null;

  const valueFor = (p: LegendPlot): number => {
    if (!p.series) return NaN;
    if (param?.seriesData) {
      const d = param.seriesData.get(p.series);
      if (d && typeof d.value === "number") return d.value;
    }
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const data: any[] = (p.series as any).data?.() ?? [];
      const last = data[data.length - 1];
      if (last && typeof last.value === "number") return last.value;
    } catch {
      /* */
    }
    return NaN;
  };

  return (
    <div className={className ?? "ck-leg"} style={style}>
      {entries.map((e) => {
        const allVisible = e.plots.every((p) => p.visible);
        return (
          <div key={e.name} className={`ck-leg-row${allVisible ? "" : " ck-leg-row--hidden"}`}>
            <span className="ck-leg-name">{e.shortTitle}</span>
            {e.paramsLabel && <span className="ck-leg-params">{e.paramsLabel}</span>}
            {e.plots.map((p) => (
              <span key={p.id} className="ck-leg-val" style={{ color: p.color }}>{fmt(valueFor(p))}</span>
            ))}
            <span className="ck-leg-actions">
              <button
                type="button"
                className="ck-leg-btn"
                title={allVisible ? "Ẩn" : "Hiện"}
                onClick={() => { for (const p of e.plots) indicators.setStyle(e.name, p.id, { visible: !allVisible }); }}
              >{allVisible ? "👁" : "⦰"}</button>
              {onOpenSettings && (
                <button type="button" className="ck-leg-btn" title="Cài đặt" onClick={() => onOpenSettings(e.name)}>⚙</button>
              )}
              <button type="button" className="ck-leg-btn ck-leg-btn--del" title="Xoá" onClick={() => indicators.remove(e.name)}>✕</button>
            </span>
          </div>
        );
      })}
    </div>
  );
}
