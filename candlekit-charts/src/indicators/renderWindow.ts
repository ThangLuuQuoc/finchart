/**
 * Windowed rendering policy for indicator plot series.
 *
 * lightweight-charts' `series.update()` cost scales with the TOTAL number of
 * points in the series, not the visible count (measured: 9 plot series ×
 * 50k points ≈ +6.5 ms per live tick; capping the rendered tail brought a
 * tick back to the empty-chart floor). So on large histories, streaming
 * indicators render only the most recent `sizeBars` points and lazily
 * backfill older ones when the user pans toward the rendered edge.
 *
 * Policy (pure functions; the controller wires them to chart events):
 *  - the window starts at the last `sizeBars` bars;
 *  - when fewer than `guardBars` rendered bars remain to the left of the
 *    visible range, the window extends left by `expandBars` past the visible
 *    edge — so backfill happens BEFORE the user can see the gap;
 *  - the window never shrinks during a session (no thrash; a full-history
 *    pan simply converges to today's render-everything behavior).
 *
 * `-Infinity` as a start time means "everything is rendered".
 */

export interface RenderWindowOptions {
  /** Points initially rendered per plot series. Default 5000. */
  sizeBars?: number;
  /** Backfill triggers when fewer than this many rendered bars remain left of the view. Default 250. */
  guardBars?: number;
  /** How far past the visible edge each backfill extends. Default 2500. */
  expandBars?: number;
}

export interface RenderWindowConfig {
  sizeBars: number;
  guardBars: number;
  expandBars: number;
}

export const DEFAULT_RENDER_WINDOW: RenderWindowConfig = {
  sizeBars: 5000,
  guardBars: 250,
  expandBars: 2500,
};

/** `false` disables windowing; `undefined`/partial merges over the defaults. */
export function resolveRenderWindow(opt?: RenderWindowOptions | false): RenderWindowConfig | null {
  if (opt === false) return null;
  const cfg = { ...DEFAULT_RENDER_WINDOW, ...(opt ?? {}) };
  if (cfg.sizeBars <= 0 || cfg.guardBars < 0 || cfg.expandBars <= 0) return null;
  return cfg;
}

/** Index of the first element with `time >= t` (array ascending by time). */
export function lowerBoundByTime(points: readonly { time: number }[], t: number): number {
  if (t === -Infinity) return 0;
  let lo = 0;
  let hi = points.length;
  while (lo < hi) {
    const mid = (lo + hi) >> 1;
    if (points[mid].time < t) lo = mid + 1;
    else hi = mid;
  }
  return lo;
}

/** Render-start time for a fresh data set: last `sizeBars` bars, or everything. */
export function initialRenderStart(bars: readonly { time: number }[], cfg: RenderWindowConfig): number {
  if (bars.length <= cfg.sizeBars) return -Infinity;
  return bars[bars.length - cfg.sizeBars].time;
}

/**
 * New render-start time needed to keep `guardBars` of slack between the
 * rendered edge and the visible edge, or `null` when no extension is needed.
 * Never moves the start to the right (the window only grows).
 */
export function nextRenderStart(
  bars: readonly { time: number }[],
  currentStart: number,
  visibleFromSec: number,
  cfg: RenderWindowConfig,
): number | null {
  if (currentStart === -Infinity || bars.length === 0) return null;
  const startIdx = lowerBoundByTime(bars, currentStart);
  const visIdx = lowerBoundByTime(bars, visibleFromSec);
  if (visIdx - startIdx >= cfg.guardBars) return null;
  const newIdx = Math.max(0, visIdx - cfg.expandBars);
  const t = newIdx === 0 ? -Infinity : bars[newIdx].time;
  return t < currentStart ? t : null;
}
