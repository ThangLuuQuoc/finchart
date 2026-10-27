/**
 * Indicator framework contracts. The built-in catalog (`builtin.ts`) implements
 * these shapes directly. They are also kept structurally generic so an
 * externally-shaped indicator definition can be adapted in via `defFromRaw`
 * (see `registry.ts`) without the core depending on any third-party runtime.
 */

export type IndicatorCategory = "overlay" | "oscillator" | "pattern";

/** Bar passed to `calculate`. Time is epoch **seconds** (lightweight-charts unit). */
export interface IndicatorBar {
  time: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface PlotPoint {
  time: number;
  value: number;
  color?: string;
}

export interface PlotConfig {
  id: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  /** "line" (default), "histogram"/"columns" render as a histogram. */
  style?: string;
}

export interface HLineConfig {
  price: number;
  color?: string;
  linewidth?: number;
  linestyle?: "solid" | "dashed" | "dotted";
  title?: string;
}

export interface InputConfig {
  name: string;
  type?: "int" | "float" | "bool" | "string" | "source" | "color";
  defval?: unknown;
  options?: unknown[];
  title?: string;
  [key: string]: unknown;
}

export interface MarkerDef {
  time: number;
  position?: "aboveBar" | "belowBar" | "inBar";
  shape?: string;
  color?: string;
  text?: string;
}

export interface IndicatorResult {
  plots: Record<string, PlotPoint[]>;
  markers?: MarkerDef[];
}

/**
 * A per-plot streaming value: a plain number, or `{ value, color }` when the
 * plot carries a per-point color (e.g. a signed histogram). `NaN` means
 * "warmup / not defined yet" (the batch path's missing point).
 */
export type StreamValue = number | { value: number; color?: string };

/**
 * Incremental engine equivalent to an {@link IndicatorDef.calculate}: feeds on
 * one bar at a time instead of the whole history, so a live tick costs
 * O(indicator window) instead of O(history).
 *
 *  - `next(bar)` commits a CONFIRMED bar and returns the values for it;
 *  - `peek(bar)` returns the values the in-progress bar would have if it
 *    closed now — it never mutates state, so it is safe to call on every tick.
 *
 * Both return values keyed by {@link PlotConfig.id} and MUST equal what
 * `calculate` would produce for the same bars.
 */
export interface StreamingIndicator {
  next(bar: IndicatorBar): Record<string, StreamValue>;
  peek(bar: IndicatorBar): Record<string, StreamValue>;
}

/** A registry entry: metadata + a pure `calculate`. This is the extension point. */
export interface IndicatorDef {
  name: string;
  title: string;
  shortTitle: string;
  category: IndicatorCategory;
  calculate: (bars: IndicatorBar[], inputs?: Record<string, unknown>) => IndicatorResult;
  /**
   * Optional factory for a {@link StreamingIndicator} resolved against the
   * same inputs as `calculate`. When present, `IndicatorController` uses it on
   * live ticks (`onBar`) instead of recalculating over the full history; when
   * absent, the controller falls back to the batch recompute. Toggling and
   * full-data refreshes (`onData`) always go through `calculate`.
   */
  streaming?: (inputs?: Record<string, unknown>) => StreamingIndicator;
  defaultInputs: Record<string, unknown>;
  inputConfig: InputConfig[];
  plotConfig: PlotConfig[];
  hlineConfig: HLineConfig[];
  /**
   * Optional provenance used by the indicator menu to group entries (built-in
   * "Technicals", the TradingView catalog, or user-added Pine scripts). Absent
   * is treated as "builtin". Purely cosmetic — no behavioural effect.
   */
  source?: "builtin" | "tv" | "pine";
  /** Optional search keywords / badges (e.g. "pine", "mtf", "new"). */
  tags?: string[];
  /** Optional one-line description for tooltips. */
  description?: string;
}

/** Per-plot style override (Style tab of the settings dialog). */
export interface PlotStyle {
  color?: string;
  lineWidth?: number;
  lineStyle?: "solid" | "dashed" | "dotted";
  /** `false` hides the plot's series without removing the indicator. */
  visible?: boolean;
}

/** An indicator the user has switched on, with its resolved params. */
export interface ActiveIndicator {
  name: string;
  params: Record<string, unknown>;
  /**
   * Per-plot color overrides keyed by {@link PlotConfig.id}. When a plot has no
   * entry here, rendering falls back to its `PlotConfig.color`, then grey.
   * Kept for backwards-compatibility; `styles[id].color` takes precedence.
   */
  colors: Record<string, string>;
  /** Per-plot richer style overrides (color/width/lineStyle/visibility). */
  styles?: Record<string, PlotStyle>;
}
