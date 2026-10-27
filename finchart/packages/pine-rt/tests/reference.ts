/**
 * Independent BATCH reference implementations (TradingView semantics) used by
 * the golden harness to verify the streaming runtime. Deliberately written
 * array-first with naive window recomputation — a different algorithm shape
 * than the streaming code, so shared mistakes are unlikely.
 *
 * NaN = na. "Leading na skipped" semantics are implemented by compacting the
 * defined values, running the plain reference, and scattering back — exactly
 * mirroring how the streaming primitives consume only valid inputs.
 */

export interface RefBar {
  high: number;
  low: number;
  close: number;
}

const NAN = Number.NaN;

function compactApply(vals: readonly number[], fn: (defined: number[]) => number[]): number[] {
  const defined: number[] = [];
  const map: number[] = [];
  for (let i = 0; i < vals.length; i++) {
    if (!Number.isNaN(vals[i])) {
      defined.push(vals[i]);
      map.push(i);
    }
  }
  const res = fn(defined);
  const out = new Array<number>(vals.length).fill(NAN);
  for (let j = 0; j < res.length; j++) out[map[j]] = res[j];
  return out;
}

/** Plain SMA over a dense array — naive O(n·len) window mean. */
function smaDense(vals: number[], len: number): number[] {
  const out = new Array<number>(vals.length).fill(NAN);
  for (let i = len - 1; i < vals.length; i++) {
    let s = 0;
    for (let j = 0; j < len; j++) s += vals[i - j];
    out[i] = s / len;
  }
  return out;
}

function emaDense(vals: number[], len: number): number[] {
  const out = new Array<number>(vals.length).fill(NAN);
  if (vals.length < len) return out;
  let seed = 0;
  for (let i = 0; i < len; i++) seed += vals[i];
  let prev = seed / len;
  out[len - 1] = prev;
  const k = 2 / (len + 1);
  for (let i = len; i < vals.length; i++) {
    prev = vals[i] * k + prev * (1 - k);
    out[i] = prev;
  }
  return out;
}

function rmaDense(vals: number[], len: number): number[] {
  const out = new Array<number>(vals.length).fill(NAN);
  if (vals.length < len) return out;
  let seed = 0;
  for (let i = 0; i < len; i++) seed += vals[i];
  let prev = seed / len;
  out[len - 1] = prev;
  for (let i = len; i < vals.length; i++) {
    prev = (prev * (len - 1) + vals[i]) / len;
    out[i] = prev;
  }
  return out;
}

export const refSma = (vals: readonly number[], len: number): number[] => compactApply(vals, (d) => smaDense(d, len));
export const refEma = (vals: readonly number[], len: number): number[] => compactApply(vals, (d) => emaDense(d, len));
export const refRma = (vals: readonly number[], len: number): number[] => compactApply(vals, (d) => rmaDense(d, len));

export function refWma(vals: readonly number[], len: number): number[] {
  return compactApply(vals, (d) => {
    const out = new Array<number>(d.length).fill(NAN);
    const denom = (len * (len + 1)) / 2;
    for (let i = len - 1; i < d.length; i++) {
      let acc = 0;
      for (let j = 0; j < len; j++) acc += d[i - j] * (len - j);
      out[i] = acc / denom;
    }
    return out;
  });
}

export function refStdev(vals: readonly number[], len: number): number[] {
  return compactApply(vals, (d) => {
    const out = new Array<number>(d.length).fill(NAN);
    for (let i = len - 1; i < d.length; i++) {
      let mean = 0;
      for (let j = 0; j < len; j++) mean += d[i - j];
      mean /= len;
      let v = 0;
      for (let j = 0; j < len; j++) {
        const dd = d[i - j] - mean;
        v += dd * dd;
      }
      out[i] = Math.sqrt(v / len);
    }
    return out;
  });
}

/** TradingView RSI: change is na on bar 0; first RSI lands at index `len`. */
export function refRsi(closes: readonly number[], len: number): number[] {
  const n = closes.length;
  const up = new Array<number>(n).fill(NAN);
  const dn = new Array<number>(n).fill(NAN);
  for (let i = 1; i < n; i++) {
    const ch = closes[i] - closes[i - 1];
    up[i] = Math.max(ch, 0);
    dn[i] = Math.max(-ch, 0);
  }
  const g = refRma(up, len);
  const l = refRma(dn, len);
  const out = new Array<number>(n).fill(NAN);
  for (let i = 0; i < n; i++) {
    if (Number.isNaN(g[i]) || Number.isNaN(l[i])) continue;
    if (l[i] === 0) out[i] = g[i] === 0 ? NAN : 100;
    else out[i] = 100 - 100 / (1 + g[i] / l[i]);
  }
  return out;
}

export function refMacd(
  closes: readonly number[],
  fast: number,
  slow: number,
  sig: number,
): { macd: number[]; signal: number[]; hist: number[] } {
  const ef = refEma(closes, fast);
  const es = refEma(closes, slow);
  const macd = closes.map((_, i) => ef[i] - es[i]); // NaN-propagating
  const signal = refEma(macd, sig);
  const hist = macd.map((m, i) => m - signal[i]);
  return { macd, signal, hist };
}

export function refBollinger(
  closes: readonly number[],
  len: number,
  mult: number,
): { basis: number[]; upper: number[]; lower: number[] } {
  const basis = refSma(closes, len);
  const dev = refStdev(closes, len);
  return {
    basis,
    upper: basis.map((b, i) => b + dev[i] * mult),
    lower: basis.map((b, i) => b - dev[i] * mult),
  };
}

export function refAtr(bars: readonly RefBar[], len: number): number[] {
  const tr = bars.map((b, i) => {
    if (i === 0) return b.high - b.low;
    const pc = bars[i - 1].close;
    return Math.max(b.high - b.low, Math.abs(b.high - pc), Math.abs(b.low - pc));
  });
  return refRma(tr, len);
}

export function refStochastic(
  bars: readonly RefBar[],
  kLen: number,
  dLen: number,
): { k: number[]; d: number[] } {
  const n = bars.length;
  const k = new Array<number>(n).fill(NAN);
  for (let i = kLen - 1; i < n; i++) {
    let hi = -Infinity;
    let lo = Infinity;
    for (let j = 0; j < kLen; j++) {
      hi = Math.max(hi, bars[i - j].high);
      lo = Math.min(lo, bars[i - j].low);
    }
    k[i] = hi === lo ? NAN : (100 * (bars[i].close - lo)) / (hi - lo);
  }
  return { k, d: refSma(k, dLen) };
}
