# Changelog

All notable changes to `@getcandlekit/charts` are documented here. The format is
based on [Keep a Changelog](https://keepachangelog.com/) and this project adheres
to [Semantic Versioning](https://semver.org/).

## [Unreleased]

### Added

- **Windowed indicator rendering** — on large histories, streaming-capable
  indicators render only the most recent `sizeBars` points (default 5000) and
  backfill older points automatically when the user pans toward the rendered
  edge (backfill triggers `guardBars` before the edge becomes visible, so
  there is no visible gap; the window never shrinks during a session).
  Motivation: lightweight-charts' `series.update()` cost scales with the
  TOTAL series point count — measured +6.5 ms per live tick with 9 plot
  series × 50k points; windowing returns ticks to the empty-chart floor
  (~8.8 ms → ~2.9 ms per tick in the 50k-bar stress scenario). Configure or
  disable via `new IndicatorController(registry, { renderWindow })`
  (`false` opts out; minor — additive API).
- **Streaming indicator engines** — `IndicatorDef` gains an optional
  `streaming(inputs)` factory returning a `StreamingIndicator`
  (`next(bar)` commits a confirmed bar, `peek(bar)` previews the in-progress
  bar without mutating state). `IndicatorController.onBar` uses it when
  present, dropping live-tick cost from O(history) per indicator to
  O(indicator window) — measured ~39 ms → ~1 ms per tick with 5 active
  indicators on 50k bars. All 9 builtins ship engines, verified value-identical
  to their batch `calculate` by a bar-for-bar parity suite (minor — additive
  API; defs without `streaming` keep the batch fallback).
- **Per-plot indicator colors** — `ActiveIndicator` gains a `colors` map (overrides
  keyed by `PlotConfig.id`); new `IndicatorController.setColors(name, colors)`
  re-styles live series in place without recomputing. The React `<IndicatorPicker>`
  shows a color swatch per plot for active indicators (minor — additive API).

### Changed

- **`IndicatorController` no longer re-maps the full bar history on every
  tick** — the `IndicatorBar` conversion is cached and updated incrementally
  on `onBar` (was O(history) allocations per tick; a measurable GC-pressure
  source on large datasets).

### Fixed

- **RSI warmup matches TradingView** — the first price change is now measured
  between bars 0 and 1 (`ta.change` semantics) instead of prepending a
  synthetic zero change at bar 0. The first defined RSI lands on bar index
  `length` (was `length - 1`, one bar early with a skewed Wilder seed).

## [0.1.0] — Unreleased

Initial public release. Extracted and generalized from a production trading
dashboard into a standalone, framework-agnostic charting toolkit.

### Added

- **Core charting** — `ChartController` over lightweight-charts: candlestick,
  OHLC bars, line, area, and volume series; light/dark themes with full color
  override; responsive auto-sizing; live `updateBar`.
- **Data utilities** — pure `toBars`, `resample`, `floorToBucket` with
  session-aware bucket alignment (`sessionOpenMinutes`); fixed-offset time helpers.
- **Drawing tools** — original, built-in `DrawingEngine` + `DrawingPrimitive` +
  `DrawingController` (a `ChartPlugin`) on lightweight-charts canvas primitives:
  trend line, ray, extended line, horizontal/vertical line, arrow, rectangle,
  circle, Fibonacci retracement; selection, drag, lock, persistence. No
  third-party drawing runtime.
- **Indicators** — `IndicatorRegistry` + `IndicatorController` with an original
  built-in catalog (`createBuiltinRegistry`: SMA, EMA, WMA, VWAP, RSI, MACD,
  Bollinger Bands, ATR, Stochastic); custom indicators via `register`. No
  third-party indicator runtime.
- **Measurement** — Shift-drag `MeasurementController` + `RulerPrimitive` (price,
  percentage, bar-distance, time-delta, risk/reward helper).
- **Replay** — deterministic `ReplayController` with per-day LRU cache,
  prefetch, play/pause/step/seek/speed, and per-bar event hooks.
- **Sync** — multi-group `SyncEngine` (time range, crosshair, interval, cursor,
  symbol, date).
- **Plugin + event system** — `ChartPlugin` / `PluginContext` / typed `EventBus`.
- **React bindings** (`/react`) — `ChartView`, `DrawingToolbar`,
  `IndicatorPicker`, `ReplayControls`, `useChartController`, `useChartApi`.
- ESM + CJS builds with type declarations for both entries (`.` core and
  `./react`); tree-shakeable. `lightweight-charts` is the only external runtime.

[0.1.0]: https://github.com/rohanbeingsocial/candlekit-charts/releases/tag/v0.1.0
