/**
 * Price-source resolution for indicators that take a `source` input
 * (close / open / hl2 / hlc3 / …). Built-ins resolve a source-name string to an
 * extractor so the same code path serves any source; OHLC-intrinsic indicators
 * (VWAP / ATR / Stochastic) ignore this and read the bar directly.
 */
import type { IndicatorBar } from "./types";

export type SourceExtractor = (b: IndicatorBar) => number;

const EXTRACTORS: Record<string, SourceExtractor> = {
  close: (b) => b.close,
  open: (b) => b.open,
  high: (b) => b.high,
  low: (b) => b.low,
  hl2: (b) => (b.high + b.low) / 2,
  hlc3: (b) => (b.high + b.low + b.close) / 3,
  ohlc4: (b) => (b.open + b.high + b.low + b.close) / 4,
  hlcc4: (b) => (b.high + b.low + b.close * 2) / 4,
  volume: (b) => b.volume,
};

/** Source names offered in the settings dialog dropdown. */
export const SOURCE_OPTIONS = ["close", "open", "high", "low", "hl2", "hlc3", "ohlc4", "volume"];

/** Extractor for a source name; falls back to `close` for unknown/missing. */
export function resolveSource(name: unknown): SourceExtractor {
  return EXTRACTORS[String(name)] ?? EXTRACTORS.close;
}

/** The source name from an inputs map (default `"close"`). */
export function sourceName(inputs: Record<string, unknown> | undefined): string {
  const n = inputs?.source;
  return typeof n === "string" && n in EXTRACTORS ? n : "close";
}
