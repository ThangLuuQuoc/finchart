/**
 * Pine Script corpus analyzer — đo tần suất construct/hàm trên corpus GitHub
 * để chốt scope transpiler v1 bằng số liệu thật.
 *
 * Cách đo: regex trên source đã strip string-literals + comments (không phải
 * parser thật — đủ cho thống kê tần suất; giới hạn ghi trong report).
 *
 * Usage: node analyze.mjs > corpus-summary.txt   (json chi tiết: corpus-stats.json)
 */
import { readFileSync, writeFileSync, readdirSync, statSync } from "node:fs";
import { join, extname } from "node:path";

const ROOT = join(import.meta.dirname, "repos");

// ── thu thập file ───────────────────────────────────────────────────────────
function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const p = join(dir, name);
    const st = statSync(p);
    if (st.isDirectory()) yield* walk(p);
    else yield p;
  }
}

const files = [];
for (const p of walk(ROOT)) {
  const ext = extname(p).toLowerCase();
  if (![".pine", ".pinescript", ".txt", ".ps"].includes(ext)) continue;
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    continue;
  }
  // .txt phải thực sự là Pine
  if (ext === ".txt" && !/\/\/@version|(?:^|\n)\s*(?:study|indicator|strategy)\s*\(/.test(text)) continue;
  if (text.length < 40) continue;
  files.push({ path: p.slice(ROOT.length + 1), text });
}

// ── chuẩn hoá: strip strings + comments ─────────────────────────────────────
function stripped(text) {
  return text
    .split("\n")
    .map((line) => {
      let out = "";
      let inStr = null;
      for (let i = 0; i < line.length; i++) {
        const c = line[i];
        if (inStr) {
          if (c === "\\") {
            i++;
            continue;
          }
          if (c === inStr) inStr = null;
          continue;
        }
        if (c === '"' || c === "'") {
          inStr = c;
          out += '""'; // giữ vị trí đối số
          continue;
        }
        if (c === "/" && line[i + 1] === "/") break; // comment
        out += c;
      }
      return out;
    })
    .join("\n");
}

// ── map tên hàm v2–v4 → namespace v5 ────────────────────────────────────────
const V4_TA = new Set(
  `sma ema wma vwma swma alma rma hma rsi stoch atr tr sar cci cmo mfi mom roc obv bb bbw kc kcw dmi wpr
   highest lowest highestbars lowestbars valuewhen barssince crossover crossunder cross change rising falling
   cum stdev dev variance correlation linreg percentile_linear_interpolation percentile_nearest_rank percentrank
   pivothigh pivotlow vwap cog supertrend median mode range tsi accdist iii nvi pvi pvt wad wvad falling tema`.split(/\s+/).filter(Boolean),
);
const V4_MATH = new Set(
  `max min abs pow sqrt log log10 exp floor ceil round sign avg sin cos tan asin acos atan todegrees toradians random sum`.split(/\s+/),
);
const V4_OTHER = { security: "request.security", financial: "request.financial", quandl: "request.quandl", tostring: "str.tostring", tonumber: "str.tonumber" };

// ── ta.* core set đề xuất cho v1 (từ PINE2TS-PLAN, sẽ đối chiếu với data) ────
const V1_TA = new Set(
  `sma ema rma wma vwma hma alma swma rsi macd atr tr stoch stdev dev variance highest lowest highestbars lowestbars
   change mom roc cci mfi obv vwap crossover crossunder cross barssince valuewhen pivothigh pivotlow sar supertrend
   linreg correlation cum falling rising median bb bbw kc kcw dmi wpr cog tsi percentrank`.split(/\s+/).filter(Boolean),
);

const PLOT_FNS = new Set("plot plotshape plotchar plotarrow plotcandle plotbar hline fill bgcolor barcolor alertcondition alert".split(" "));

// ── phân tích từng file ─────────────────────────────────────────────────────
const NS_RE = /\b([a-z_][a-z0-9_]*)\.([a-zA-Z_][\w]*)/g;
const CALL_RE = /\b([a-zA-Z_][\w]*)\s*\(/g;

const scripts = [];
for (const f of files) {
  const s = stripped(f.text);
  const verM = f.text.match(/\/\/@version\s*=\s*(\d+)/);
  const version = verM ? +verM[1] : 1;

  const decl = /(?:^|\n)\s*indicator\s*\(/.test(s) ? "indicator"
    : /(?:^|\n)\s*strategy\s*\(/.test(s) ? "strategy"
    : /(?:^|\n)\s*library\s*\(/.test(s) ? "library"
    : /(?:^|\n)\s*study\s*\(/.test(s) ? "indicator"
    : "unknown";

  const ns = new Map(); // "ta.sma" -> count
  for (const m of s.matchAll(NS_RE)) {
    const key = `${m[1]}.${m[2]}`;
    ns.set(key, (ns.get(key) ?? 0) + 1);
  }

  const bare = new Map();
  for (const m of s.matchAll(CALL_RE)) bare.set(m[1], (bare.get(m[1]) ?? 0) + 1);

  // hàm ta theo nghĩa v5 (gộp v4 bare names)
  const taFns = new Set();
  for (const k of ns.keys()) if (k.startsWith("ta.")) taFns.add(k.slice(3));
  if (version <= 4) for (const k of bare.keys()) if (V4_TA.has(k)) taFns.add(k);

  const usesNs = (prefix) => [...ns.keys()].some((k) => k.startsWith(prefix + "."));
  const features = {
    version,
    decl,
    ta: [...taFns],
    taOutsideV1: [...taFns].filter((t) => !V1_TA.has(t)),
    math: usesNs("math") || (version <= 4 && [...bare.keys()].some((k) => V4_MATH.has(k))),
    str: usesNs("str") || (version <= 4 && (bare.has("tostring") || bare.has("tonumber"))),
    array: usesNs("array"),
    matrix: usesNs("matrix"),
    map: usesNs("map"),
    request: usesNs("request") || (version <= 4 && bare.has("security")),
    lineObj: usesNs("line") || bare.has("line"),
    labelObj: usesNs("label") || bare.has("label"),
    boxObj: usesNs("box"),
    tableObj: usesNs("table"),
    polyline: usesNs("polyline"),
    strategyNs: usesNs("strategy"),
    importLib: /(?:^|\n)\s*import\s+[\w/]+/.test(s),
    udt: /(?:^|\n)type\s+[A-Z]\w*/.test(s),
    method: /(?:^|\n)method\s+\w+/.test(s),
    varKw: /\bvar\s+\w/.test(s),
    varip: /\bvarip\s+\w/.test(s),
    forLoop: /\bfor\s+\w+\s*=/.test(s) || /\bfor\s+\[/.test(s),
    whileLoop: /\bwhile\b/.test(s),
    switchKw: /\bswitch\b/.test(s),
    ifKw: /\bif\b/.test(s),
    ternary: /\?[^:]*:/.test(s.replace(/\n/g, " ")),
    userFn: /=>\s/.test(s),
    history: /[\w\)\]]\s*\[/.test(s),
    tuple: /\[\s*\w+\s*,[^\]]*\]\s*=/.test(s),
    plots: [...bare.keys()].filter((k) => PLOT_FNS.has(k)),
    inputs: bare.has("input") || usesNs("input"),
  };
  scripts.push({ path: f.path, ...features });
}

// ── thống kê ───────────────────────────────────────────────────────────────
const seg = (pred) => scripts.filter(pred);
const segments = {
  all: seg(() => true),
  "v2-v3": seg((x) => x.version <= 3),
  v4: seg((x) => x.version === 4),
  v5: seg((x) => x.version === 5),
  v6: seg((x) => x.version === 6),
  "v4plus-indicators": seg((x) => x.version >= 4 && x.decl === "indicator"),
};

function pct(n, d) {
  return d ? ((100 * n) / d).toFixed(1) + "%" : "-";
}

function constructTable(list) {
  const keys = [
    "inputs", "history", "ternary", "ifKw", "varKw", "userFn", "forLoop", "math", "str",
    "tuple", "switchKw", "request", "array", "labelObj", "lineObj", "whileLoop", "tableObj",
    "boxObj", "strategyNs", "varip", "udt", "method", "importLib", "matrix", "map", "polyline",
  ];
  const rows = keys.map((k) => {
    const n = list.filter((x) => (Array.isArray(x[k]) ? x[k].length > 0 : !!x[k])).length;
    return [k, n, pct(n, list.length)];
  });
  rows.sort((a, b) => b[1] - a[1]);
  return rows;
}

function taRanking(list, topN = 60) {
  const count = new Map();
  for (const x of list) for (const t of x.ta) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

// coverage theo tier (trên segment indicator v4+)
function coverage(list) {
  const tiers = {
    "T1 core (decl+plot+input+ta-V1+math/str+ctrl-flow)": (x) =>
      x.decl === "indicator" && !x.importLib && !x.udt && !x.method &&
      x.taOutsideV1.length === 0 && !x.array && !x.matrix && !x.map && !x.request &&
      !x.lineObj && !x.labelObj && !x.boxObj && !x.tableObj && !x.polyline && !x.strategyNs && !x.varip,
    "T2 = T1 + array + varip + ta-mở-rộng": (x) =>
      x.decl === "indicator" && !x.importLib && !x.udt && !x.method &&
      !x.matrix && !x.map && !x.request &&
      !x.lineObj && !x.labelObj && !x.boxObj && !x.tableObj && !x.polyline && !x.strategyNs,
    "T3 = T2 + line/label/box/table": (x) =>
      x.decl === "indicator" && !x.importLib && !x.udt && !x.method &&
      !x.matrix && !x.map && !x.request && !x.polyline && !x.strategyNs,
    "T4 = T3 + request.* (MTF)": (x) =>
      x.decl === "indicator" && !x.importLib && !x.udt && !x.method && !x.matrix && !x.map && !x.polyline && !x.strategyNs,
    "T5 = T4 + UDT/method": (x) =>
      x.decl === "indicator" && !x.importLib && !x.matrix && !x.map && !x.polyline && !x.strategyNs,
    "T6 = T5 + strategy.* (cả decl strategy)": (x) => !x.importLib && !x.matrix && !x.map && !x.polyline && x.decl !== "library",
  };
  return Object.entries(tiers).map(([name, pred]) => {
    const n = list.filter(pred).length;
    return [name, n, pct(n, list.length)];
  });
}

// ta ngoài V1 phổ biến nhất (để cân nhắc thêm vào v1)
function taGapRanking(list, topN = 30) {
  const count = new Map();
  for (const x of list) for (const t of x.taOutsideV1) count.set(t, (count.get(t) ?? 0) + 1);
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, topN);
}

// ── output ─────────────────────────────────────────────────────────────────
const out = [];
const p = (s = "") => out.push(s);

p(`# Pine corpus stats — ${new Date().toISOString().slice(0, 10)}`);
p(`Files analyzed: ${scripts.length}`);
p();
p(`## Segments`);
for (const [name, list] of Object.entries(segments)) {
  const decls = {};
  for (const x of list) decls[x.decl] = (decls[x.decl] ?? 0) + 1;
  p(`- ${name}: ${list.length} scripts (${Object.entries(decls).map(([k, v]) => `${k}:${v}`).join(", ")})`);
}

for (const segName of ["v5", "v6", "v4", "v4plus-indicators"]) {
  const list = segments[segName];
  if (!list.length) continue;
  p();
  p(`## [${segName}] constructs (% of ${list.length} scripts)`);
  for (const [k, n, pc] of constructTable(list)) p(`  ${k.padEnd(12)} ${String(n).padStart(5)}  ${pc}`);
}

p();
const ind45 = segments["v4plus-indicators"];
p(`## ta.* ranking — v4+ indicators (${ind45.length} scripts), v4 bare names mapped to v5`);
for (const [fn, n] of taRanking(ind45)) p(`  ta.${fn.padEnd(36)} ${String(n).padStart(5)}  ${pct(n, ind45.length)}  ${V1_TA.has(fn) ? "" : "  << NGOÀI V1"}`);

p();
p(`## ta.* NGOÀI V1 phổ biến nhất (ứng viên bổ sung)`);
for (const [fn, n] of taGapRanking(ind45)) p(`  ta.${fn.padEnd(36)} ${String(n).padStart(5)}  ${pct(n, ind45.length)}`);

p();
p(`## Coverage simulation — v4+ indicator scripts (${ind45.length})`);
for (const [name, n, pc] of coverage(ind45)) p(`  ${pc.padStart(6)}  (${n})  ${name}`);

const v5ind = scripts.filter((x) => x.version >= 5 && x.decl === "indicator");
p();
p(`## Coverage simulation — v5/v6 indicator scripts only (${v5ind.length})`);
for (const [name, n, pc] of coverage(v5ind)) p(`  ${pc.padStart(6)}  (${n})  ${name}`);

writeFileSync(join(import.meta.dirname, "corpus-stats.json"), JSON.stringify({ scripts }, null, 1));
console.log(out.join("\n"));
