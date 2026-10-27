import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

export interface FixtureBar {
  ts: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

let cache: FixtureBar[] | null = null;

/** 50,000 real BTCUSDT 15m bars (Binance, 2025-01 → 2026-06). */
export function loadBars(): FixtureBar[] {
  if (cache) return cache;
  const file = join(dirname(fileURLToPath(import.meta.url)), "fixtures", "btcusdt-15m-50k.json");
  const raw = JSON.parse(readFileSync(file, "utf8")) as { bars: number[][] };
  cache = raw.bars.map((b) => ({ ts: b[0], open: b[1], high: b[2], low: b[3], close: b[4], volume: b[5] }));
  return cache;
}
