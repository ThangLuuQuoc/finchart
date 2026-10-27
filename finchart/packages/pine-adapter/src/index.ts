/**
 * @finchart/pine-adapter
 *
 * Bridges a *transpiled* Pine module (the `{ meta, _inputs, createInstance }`
 * object produced by @finchart/pine-parser → ts.transpile) into a
 * candlekit-charts `IndicatorDef`, so a Pine script shows up in the same
 * registry / menu / settings dialog / legend as the built-in and TradingView
 * indicators.
 *
 * This package is intentionally environment-agnostic: it does NOT compile Pine
 * source itself (that needs ts.transpile + a module loader, which differ between
 * browser and node). The caller compiles to a module first, then calls
 * `pineModuleToIndicatorDef(module)`.
 *
 * Invariant respected: candlekit-charts/src never depends on pine-rt/pine-parser.
 * The adapter lives in the finchart layer and only emits a structurally-
 * compatible `IndicatorDef`.
 */

export {
  PineIndicatorStore,
  memoryStorage,
  localStorageStorage,
} from './store';
export { PineDrawingsPlugin, pineDrawingsPlugin, type PineDrawingsPluginOptions } from './drawingsPlugin';
export type {
  PineScriptEntry,
  PineStorage,
  PineCompileFn,
  AddResult,
  BuildResult,
  RegistryLike,
} from './store';

// ── candlekit IndicatorDef contract (mirrored structurally) ──────────────────

export interface IndicatorBar {
  time: number; // epoch seconds (candlekit unit)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export type StreamValue = number | { value: number; color?: string };

export interface StreamingIndicator {
  next(bar: IndicatorBar): Record<string, StreamValue>;
  peek(bar: IndicatorBar): Record<string, StreamValue>;
}

export interface PlotPoint {
  time: number;
  value: number;
}

export interface IndicatorResult {
  plots: Record<string, PlotPoint[]>;
  markers?: unknown[];
}

export interface InputConfig {
  name: string;
  type?: 'int' | 'float' | 'bool' | 'string' | 'source' | 'color';
  defval?: unknown;
  options?: unknown[];
  title?: string;
  minval?: number;
  maxval?: number;
  step?: number;
  group?: string;
  tooltip?: string;
  inline?: string;
  [key: string]: unknown;
}

export interface PlotConfig {
  id: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  style?: string;
}

export interface HLineConfig {
  price: number;
  color?: string;
  title?: string;
}

export type IndicatorCategory = 'overlay' | 'oscillator' | 'pattern';

export interface IndicatorDef {
  name: string;
  title: string;
  shortTitle: string;
  category: IndicatorCategory;
  calculate: (bars: IndicatorBar[], inputs?: Record<string, unknown>) => IndicatorResult;
  streaming?: (inputs?: Record<string, unknown>) => StreamingIndicator;
  defaultInputs: Record<string, unknown>;
  inputConfig: InputConfig[];
  plotConfig: PlotConfig[];
  hlineConfig: HLineConfig[];
  /** Provenance for the menu's grouping (Phase 2). */
  source?: 'builtin' | 'tv' | 'pine';
  tags?: string[];
}

// ── transpiled Pine module shape (output of pine-parser codegen) ─────────────

export interface PineInputMeta {
  id: string;
  fn: string;
  type?: InputConfig['type'];
  defval?: unknown;
  title?: string | null;
  minval?: number;
  maxval?: number;
  step?: number;
  options?: unknown[];
  group?: string;
  tooltip?: string;
  inline?: string;
}

export interface PinePlotMeta {
  id: string;
  fn: string;
  title?: string;
  color?: string;
  lineWidth?: number;
  style?: string;
}

export interface PineMeta {
  name: string;
  overlay: boolean;
  inputs: PineInputMeta[];
  plots: PinePlotMeta[];
}

export type PineOnBarResult =
  | { plots: Record<string, number>; draw?: unknown[] }
  | Record<string, number>;

export interface PineInstance {
  onBar(bar: IndicatorBar, barIndex: number, isLast: boolean, commit?: boolean): PineOnBarResult;
  /** Per-instance drawing collection (present for drawing-based scripts). */
  drawings?: { boxes: Set<unknown>; lines: Set<unknown>; labels: Set<unknown> };
}

export interface PineModule {
  meta: PineMeta;
  _inputs?: Record<string, unknown>;
  createInstance(overrides?: Record<string, unknown>): PineInstance;
}

export interface AdapterOptions {
  source?: IndicatorDef['source'];
  tags?: string[];
  /** Override the display title (defaults to meta.name). */
  title?: string;
}

// ── bridge ────────────────────────────────────────────────────────────────

/** Plot-family fns that render as a horizontal reference line, not a series. */
const HLINE_FNS = new Set(['hline']);
/** Plot-family fns that don't produce a numeric series (no chart line). */
const NON_SERIES_FNS = new Set(['bgcolor', 'barcolor', 'fill']);

/**
 * True when a transpiled module renders via *drawings* (box/line/label, e.g.
 * Volume Profile) rather than plot series — i.e. it has no series-producing
 * `plot()` after dropping hline/bgcolor/barcolor/fill. Such scripts can't go
 * through {@link pineModuleToIndicatorDef} (IndicatorController renders series);
 * the host attaches a {@link PineDrawingsPlugin} to the pane instead.
 */
export function isDrawingBasedPine(mod: PineModule): boolean {
  const seriesPlots = (mod.meta?.plots ?? []).filter(p => !HLINE_FNS.has(p.fn) && !NON_SERIES_FNS.has(p.fn));
  return seriesPlots.length === 0;
}

function normalizePlots(r: PineOnBarResult): Record<string, number> {
  return r && typeof r === 'object' && 'plots' in r ? (r as { plots: Record<string, number> }).plots : (r as Record<string, number>);
}

function toInputConfig(m: PineInputMeta): InputConfig {
  const c: InputConfig = { name: m.id, type: m.type, defval: m.defval, title: m.title ?? undefined };
  if (m.options) c.options = m.options;
  if (m.minval !== undefined) c.minval = m.minval;
  if (m.maxval !== undefined) c.maxval = m.maxval;
  if (m.step !== undefined) c.step = m.step;
  if (m.group !== undefined) c.group = m.group;
  if (m.tooltip !== undefined) c.tooltip = m.tooltip;
  if (m.inline !== undefined) c.inline = m.inline;
  return c;
}

function toPlotConfig(p: PinePlotMeta): PlotConfig {
  const c: PlotConfig = { id: p.id, title: p.title };
  if (p.color !== undefined) c.color = p.color;
  if (p.lineWidth !== undefined) c.lineWidth = p.lineWidth;
  if (p.style !== undefined) c.style = p.style;
  return c;
}

function shortTitleOf(name: string): string {
  if (name.length <= 14) return name;
  // acronym from word initials, capped
  const acr = name.split(/[\s_]+/).map(w => w[0]).join('').toUpperCase();
  return acr.length >= 2 && acr.length <= 6 ? acr : name.slice(0, 14);
}

/**
 * Wrap a transpiled Pine module as a candlekit IndicatorDef.
 *
 * `streaming(inputs)` builds a fresh stateful instance via `createInstance`, so
 * each mount has isolated ta.* / var / history state.
 *
 * KNOWN LIMITATION (v1): the generated `onBar` always commits state (ta.*.next,
 * _hist.push). `peek` therefore mutates — correct for a single preview per
 * forming bar (replay / data refresh), but repeated live re-peeks on the same
 * bar will advance state. A codegen "peek mode" addresses this later.
 */
export function pineModuleToIndicatorDef(mod: PineModule, opts: AdapterOptions = {}): IndicatorDef {
  const meta = mod.meta;
  const category: IndicatorCategory = meta.overlay ? 'overlay' : 'oscillator';

  const inputConfig = (meta.inputs ?? []).map(toInputConfig);
  const seriesPlots = (meta.plots ?? []).filter(p => !HLINE_FNS.has(p.fn) && !NON_SERIES_FNS.has(p.fn));
  const plotConfig = seriesPlots.map(toPlotConfig);

  // hline(price) → reference line. The constant price isn't carried in meta, so
  // v1 leaves hlineConfig empty; hlines still render as flat plot series.
  const hlineConfig: HLineConfig[] = [];

  const defaultInputs: Record<string, unknown> = {};
  for (const c of inputConfig) defaultInputs[c.name] = c.defval;

  const resolveInputs = (inputs?: Record<string, unknown>) => ({ ...defaultInputs, ...(inputs ?? {}) });

  const streaming = (inputs?: Record<string, unknown>): StreamingIndicator => {
    const inst = mod.createInstance(resolveInputs(inputs));
    let i = 0;
    return {
      // commit=true advances state; peek passes commit=false → non-mutating preview.
      next(bar) { i++; return normalizePlots(inst.onBar(bar, i, false, true)); },
      peek(bar) { return normalizePlots(inst.onBar(bar, i + 1, true, false)); },
    };
  };

  const calculate = (bars: IndicatorBar[], inputs?: Record<string, unknown>): IndicatorResult => {
    const inst = mod.createInstance(resolveInputs(inputs));
    const plots: Record<string, PlotPoint[]> = {};
    for (const p of plotConfig) plots[p.id] = [];
    for (let k = 0; k < bars.length; k++) {
      const b = bars[k]!;
      const out = normalizePlots(inst.onBar(b, k + 1, k === bars.length - 1));
      for (const p of plotConfig) {
        const v = out[p.id];
        if (typeof v === 'number' && Number.isFinite(v)) plots[p.id]!.push({ time: b.time, value: v });
      }
    }
    return { plots };
  };

  return {
    name: meta.name,
    title: opts.title ?? meta.name,
    shortTitle: shortTitleOf(opts.title ?? meta.name),
    category,
    calculate,
    streaming,
    defaultInputs,
    inputConfig,
    plotConfig,
    hlineConfig,
    source: opts.source ?? 'pine',
    tags: opts.tags ?? ['pine'],
  };
}
