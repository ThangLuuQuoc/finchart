// Download 50k real BTCUSDT 15m bars from Binance public API → public/data-50k.json
// Format: { symbol, interval, count, bars: [[ts_ms, open, high, low, close, volume], ...] }
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const TARGET = 50_000;
const SYMBOL = "BTCUSDT";
const INTERVAL = "15m";
const API = "https://data-api.binance.vision/api/v3/klines";

const out = [];
let endTime = Date.now();

while (out.length < TARGET) {
  const url = `${API}?symbol=${SYMBOL}&interval=${INTERVAL}&limit=1000&endTime=${endTime}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status}: ${await res.text()}`);
  const klines = await res.json();
  if (klines.length === 0) break;
  // klines: [openTime, open, high, low, close, volume, closeTime, ...] strings
  for (let i = klines.length - 1; i >= 0; i--) {
    const k = klines[i];
    out.push([k[0], +k[1], +k[2], +k[3], +k[4], +k[5]]);
  }
  endTime = klines[0][0] - 1;
  process.stdout.write(`\rfetched ${out.length}/${TARGET}`);
  await new Promise((r) => setTimeout(r, 120)); // stay well under rate limits
}

out.length = Math.min(out.length, TARGET);
out.reverse(); // ascending time
const dir = join(dirname(fileURLToPath(import.meta.url)), "public");
mkdirSync(dir, { recursive: true });
writeFileSync(
  join(dir, "data-50k.json"),
  JSON.stringify({ symbol: SYMBOL, interval: INTERVAL, count: out.length, bars: out }),
);
console.log(`\nsaved ${out.length} bars (${new Date(out[0][0]).toISOString()} → ${new Date(out[out.length - 1][0]).toISOString()})`);
