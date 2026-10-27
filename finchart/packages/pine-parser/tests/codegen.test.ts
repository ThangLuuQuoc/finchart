/**
 * End-to-end codegen tests:
 *   Pine source → parse → semantic → codegen → eval() → onBar() → compare with pine-rt reference
 *
 * The generated TypeScript is eval()'d in Node via Function() to avoid needing an extra
 * build step. We stub the pine-rt import by injecting the real classes into the sandbox.
 */

import { describe, it, expect } from 'vitest';
import { parse } from '../src/index';
import { analyze } from '../src/semantic';
import { generate } from '../src/codegen';
import {
  Rsi, Ema, Sma, Macd, Bollinger, Atr,
  Highest, Lowest, Stdev, Change, Rma, Wma, TrueRange,
  NA, na, nz,
  PineArray, BarHistory, PineColor, PineMath, PineStr,
  PineBox, PineLine, PineLabel, createDrawings, setActiveDrawings,
} from '../../pine-rt/src/index';
import type { DrawCmd } from '../../pine-rt/src/index';

// ── sandbox executor ──────────────────────────────────────────────────────────

type OnBarFn = (bar: Bar, barIndex: number, isLast: boolean, hist?: BarHistory) => Record<string, number>;

interface Bar { time: number; open: number; high: number; low: number; close: number; volume: number }

function stripTsForEval(tsSource: string): string {
  let js = tsSource;
  // strip all import lines
  js = js.replace(/^import\s+.*$/gm, '');
  // strip "export type X = ..." and "type X = ..." lines entirely
  js = js.replace(/^(?:export\s+)?type\s+\w.*$/gm, '');
  // strip export keyword from declarations
  js = js.replace(/^export\s+(const|let|var|function)\b/gm, '$1');
  // strip function onBar signature types
  js = js.replace(
    /function\s+onBar\s*\([^)]*\)\s*:\s*[^{]*/,
    'function onBar(bar, barIndex, isLast, commit = true) ',
  );
  // strip function parameter type annotations: (name: Type, ...) → (name, ...)
  js = js.replace(/function\s+(\w+)\s*\(([^)]*)\)/g, (match, name, params) => {
    if (name === 'onBar') return match; // already handled
    const cleaned = params.replace(/(\w+)\s*:\s*[^,)]+/g, '$1');
    return `function ${name}(${cleaned})`;
  });
  // strip "?: BarHistory" optional parameter notation
  js = js.replace(/hist\?:\s*\w+/g, 'hist');
  // strip variable type annotations: const/let/var name: Type = value
  // Handle complex types like PineArray<DrawBox | null>, Record<string, number>
  js = js.replace(/\b(const|let|var)\s+(\w+)\s*:\s*(?:[^=;](?!=>))+?(?=\s*[=;])/g, '$1 $2');
  // strip "let _var_X: SomeType =" patterns  
  js = js.replace(/\b(let\s+_var_\w+)\s*:\s*[^=;]+(?=\s*=)/g, '$1');
  // strip generic type params in function/constructor calls: func<Type>(args) → func(args)
  js = js.replace(/(\w+)<[^>]+>\(/g, '$1(');
  return js;
}

function evalGenerated(tsSource: string): { onBar: OnBarFn; meta: Record<string, unknown>; _inputs: Record<string, unknown> } {
  const js = stripTsForEval(tsSource);

  const sandbox = {
    Rsi, Ema, Sma, Macd, Bollinger, Atr, Highest, Lowest,
    Stdev, Change, Rma, Wma, TrueRange,
    NA, na, nz,
    PineArray, BarHistory, PineColor, PineMath, PineStr,
    PineBox, PineLine, PineLabel, createDrawings, setActiveDrawings,
    NaN: NaN, Infinity: Infinity, Math,
    isNaN, isFinite, parseInt, parseFloat, String, Number, Boolean, JSON, Object, Array, Date,
    console,
  };

  const paramNames = Object.keys(sandbox);
  const paramValues = Object.values(sandbox);

  try {
    const fn = new Function(...paramNames, `${js}; return { createInstance, meta, _inputs: typeof _inputs !== 'undefined' ? _inputs : {} };`);
    const mod = fn(...paramValues);
    // createInstance() yields a fresh stateful instance (the candlekit streaming contract)
    const inst = mod.createInstance();
    return { onBar: inst.onBar, meta: mod.meta, _inputs: mod._inputs };
  } catch (e) {
    throw new Error(`eval failed:\n${e}\n\nGenerated JS:\n${js.slice(0, 500)}`);
  }
}

// ── synthetic bar data ────────────────────────────────────────────────────────

function makeBars(n: number): Bar[] {
  const bars: Bar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1 + (Math.sin(i * 0.3) * 0.02);
    const open = price;
    const close = price * (1 + (Math.random() - 0.5) * 0.01);
    const high = Math.max(open, close) * 1.005;
    const low  = Math.min(open, close) * 0.995;
    bars.push({ time: 1000 + i * 60, open, high, low, close, volume: 1000 + i * 10 });
  }
  return bars;
}

// ── test helpers ──────────────────────────────────────────────────────────────

function pipelineParse(source: string) {
  const parsed = parse(source);
  expect(parsed.errors, 'parse errors').toEqual([]);
  const sem = analyze(parsed.script!);
  const ts  = generate(parsed.script!, sem);
  return { sem, ts };
}

function almostEqual(a: number, b: number, tol = 1e-9): boolean {
  if (isNaN(a) && isNaN(b)) return true;
  if (isNaN(a) || isNaN(b)) return false;
  return Math.abs(a - b) <= tol + Math.abs(b) * tol;
}

// ── tests ─────────────────────────────────────────────────────────────────────

describe('codegen: parse → generate → eval smoke', () => {
  it('generates valid JS for minimal indicator', () => {
    const { ts } = pipelineParse(`//@version=5
indicator("Test")
x = close * 2
plot(x)
`);
    expect(ts).toContain('export function createInstance');
    expect(ts).toContain('function onBar');
    expect(ts).toContain('plots');
  });
});

describe('codegen: peek-mode (B3) — non-mutating preview', () => {
  const source = `//@version=5
indicator("RSI Peek", overlay=false)
length = input.int(14, "Length")
r = ta.rsi(close, length)
plot(r, title="RSI")
`;
  const plotVal = (out: Record<string, number>) => out[Object.keys(out)[0]!]!;

  it('generates peek-aware ta call + commit param', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('_commit ? "next" : "peek"');
    expect(ts).toContain('commit = true');
  });

  it('peek is idempotent and matches reference, commit advances correctly', () => {
    const { onBar } = evalGenerated(source ? pipelineParse(source).ts : '');
    const ref = new Rsi(14);
    const bars = makeBars(40);
    const lastIdx = bars.length - 1;

    // Commit all but the last bar.
    for (let i = 0; i < lastIdx; i++) {
      onBar(bars[i]!, i, false, true as never);
      ref.next(bars[i]!.close);
    }

    const forming = bars[lastIdx]!;
    // Peek the forming bar several times — must be stable and == ref.peek.
    const p1 = plotVal(onBar(forming, lastIdx, true, false as never));
    const p2 = plotVal(onBar(forming, lastIdx, true, false as never));
    const p3 = plotVal(onBar(forming, lastIdx, true, false as never));
    expect(p1).toBe(p2);
    expect(p2).toBe(p3);
    expect(almostEqual(p1, ref.peek(forming.close))).toBe(true);

    // Now commit the same bar — must equal ref.next (peeks did NOT advance state).
    const committed = plotVal(onBar(forming, lastIdx, false, true as never));
    expect(almostEqual(committed, ref.next(forming.close))).toBe(true);
  });
});

describe('codegen: rich input/plot metadata (Phase 0)', () => {
  const source = `//@version=5
indicator("Meta Test", overlay=true)
o_sma = "SMA"
o_ema = "EMA"
maType = input.string(o_ema, "MA Type", options=[o_sma, o_ema], group="Moving Average")
len = input.int(20, "Length", minval=1, maxval=200, step=2, group="Moving Average")
src = input.source(close, "Source")
col = input.color(color.red, "Line Color")
useFill = input.bool(true, "Fill")
m = ta.ema(src, len)
plot(m, "MA Line", color.blue, 3, plot.style_line)
plot(volume, "Vol", color.gray, 1, plot.style_histogram)
`;

  it('hoists option consts to module scope before _inputs', () => {
    const { ts } = pipelineParse(source);
    const constIdx = ts.indexOf('const o_ema =');
    const inputsIdx = ts.indexOf('export const _inputs');
    expect(constIdx).toBeGreaterThanOrEqual(0);
    expect(inputsIdx).toBeGreaterThan(constIdx); // consts emitted first
  });

  it('emits InputConfig-shaped meta.inputs with type/options/min/max/step/group', () => {
    const { ts } = pipelineParse(source);
    const { meta } = evalGenerated(ts);
    const inputs = meta.inputs as Array<Record<string, unknown>>;
    const byId = Object.fromEntries(inputs.map(i => [i.id, i]));

    expect(byId._inp_maType.type).toBe('string');
    expect(byId._inp_maType.options).toEqual(['SMA', 'EMA']);
    expect(byId._inp_maType.group).toBe('Moving Average');

    expect(byId._inp_len.type).toBe('int');
    expect(byId._inp_len.minval).toBe(1);
    expect(byId._inp_len.maxval).toBe(200);
    expect(byId._inp_len.step).toBe(2);

    expect(byId._inp_src.type).toBe('source');
    expect(byId._inp_col.type).toBe('color');
    expect(byId._inp_useFill.type).toBe('bool');
  });

  it('emits color/lineWidth/style on meta.plots', () => {
    const { ts } = pipelineParse(source);
    const { meta } = evalGenerated(ts);
    const plots = meta.plots as Array<Record<string, unknown>>;

    const maLine = plots[0];
    expect(maLine.lineWidth).toBe(3);
    expect(maLine.style).toBe('line');
    expect(typeof maLine.color).toBe('string'); // color.blue → hex

    const vol = plots[1];
    expect(vol.style).toBe('histogram');
    expect(vol.lineWidth).toBe(1);
  });
});

describe('codegen: RSI end-to-end golden', () => {
  const source = `//@version=5
indicator("RSI Test", overlay=false)
length = input.int(14, "Length")
r = ta.rsi(close, length)
plot(r, title="RSI")
`;

  it('generates hoisted _rsi_1 instance', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('new Rsi(');
    expect(ts).toContain('_rsi_1');
  });

  it('onBar() output matches pine-rt Rsi reference bar-for-bar', () => {
    const { ts } = pipelineParse(source);
    const { onBar } = evalGenerated(ts);

    const ref = new Rsi(14);
    const bars = makeBars(50);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      const result = onBar(bar, i, i === bars.length - 1);
      const refVal = ref.next(bar.close);

      const plotKey = Object.keys(result)[0];
      const genVal  = plotKey ? result[plotKey]! : NaN;

      expect(almostEqual(genVal, refVal), `bar ${i}: gen=${genVal} ref=${refVal}`).toBe(true);
    }
  });
});

describe('codegen: EMA end-to-end golden', () => {
  const source = `//@version=5
indicator("EMA Test")
len = input.int(20, "Length")
e = ta.ema(close, len)
plot(e)
`;

  it('onBar() matches Ema reference', () => {
    const { ts } = pipelineParse(source);
    const { onBar } = evalGenerated(ts);

    const ref = new Ema(20);
    const bars = makeBars(60);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      const result = onBar(bar, i, false);
      const genVal  = (Object.values(result)[0] as number) ?? NaN;
      const refVal  = ref.next(bar.close);
      expect(almostEqual(genVal, refVal), `bar ${i}: gen=${genVal} ref=${refVal}`).toBe(true);
    }
  });
});

describe('codegen: MACD end-to-end golden', () => {
  const source = `//@version=5
indicator("MACD Test")
[macdLine, signalLine, histLine] = ta.macd(close, 12, 26, 9)
plot(macdLine, title="MACD")
plot(signalLine, title="Signal")
`;

  it('generates Macd instance and tuple destructure', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('new Macd(');
    expect(ts).toContain('macd:');
  });

  it('onBar() macdLine matches Macd reference', () => {
    const { ts } = pipelineParse(source);
    const { onBar } = evalGenerated(ts);

    const ref = new Macd(12, 26, 9);
    const bars = makeBars(80);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      const result = onBar(bar, i, false);
      const refVal = ref.next(bar.close);
      // Find macdLine plot (first plot)
      const genVal = (Object.values(result)[0] as number) ?? NaN;
      expect(almostEqual(genVal, refVal.macd), `bar ${i}: gen=${genVal} ref=${refVal.macd}`).toBe(true);
    }
  });
});

describe('codegen: Bollinger Bands end-to-end', () => {
  const source = `//@version=5
indicator("BB Test")
[upper, basis, lower] = ta.bb(close, 20, 2)
plot(basis)
`;

  it('generates Bollinger and tuple destructure', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('new Bollinger(');
    expect(ts).toContain('basis:');
  });

  it('onBar() basis matches Bollinger reference', () => {
    const { ts } = pipelineParse(source);
    const { onBar } = evalGenerated(ts);

    const ref = new Bollinger(20, 2);
    const bars = makeBars(60);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      const result = onBar(bar, i, false);
      const refVal = ref.next(bar.close);
      const genVal  = (Object.values(result)[0] as number) ?? NaN;
      expect(almostEqual(genVal, refVal.basis), `bar ${i}: gen=${genVal} ref=${refVal.basis}`).toBe(true);
    }
  });
});

describe('codegen: ta.highest / ta.lowest (1-arg form)', () => {
  const source = `//@version=5
indicator("VP test")
bbars = input.int(20, "Bars")
top = ta.highest(bbars)
bot = ta.lowest(bbars)
plot(top - bot)
`;

  it('generates Highest/Lowest with single-arg form', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('new Highest(');
    expect(ts).toContain('new Lowest(');
    expect(ts).toContain('bar.high');
    expect(ts).toContain('bar.low');
  });

  it('onBar() top-bot matches reference', () => {
    const { ts } = pipelineParse(source);
    const { onBar } = evalGenerated(ts);

    const refHigh = new Highest(20);
    const refLow  = new Lowest(20);
    const bars = makeBars(50);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      const result = onBar(bar, i, false);
      const genVal  = (Object.values(result)[0] as number) ?? NaN;
      const refVal  = refHigh.next(bar.high) - refLow.next(bar.low);
      expect(almostEqual(genVal, refVal), `bar ${i}: gen=${genVal} ref=${refVal}`).toBe(true);
    }
  });
});

describe('codegen: ATR end-to-end', () => {
  const source = `//@version=5
indicator("ATR Test")
a = ta.atr(14)
plot(a)
`;

  it('generates Atr with bar.high, bar.low, bar.close', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('new Atr(');
    expect(ts).toContain('bar.high, bar.low, bar.close');
  });

  it('onBar() matches Atr reference', () => {
    const { ts } = pipelineParse(source);
    const { onBar } = evalGenerated(ts);

    const ref = new Atr(14);
    const bars = makeBars(50);

    for (let i = 0; i < bars.length; i++) {
      const bar = bars[i]!;
      const result = onBar(bar, i, false);
      const genVal  = (Object.values(result)[0] as number) ?? NaN;
      const refVal  = ref.next(bar.high, bar.low, bar.close);
      expect(almostEqual(genVal, refVal), `bar ${i}: gen=${genVal} ref=${refVal}`).toBe(true);
    }
  });
});

describe('codegen: var state preserved across bars', () => {
  const source = `//@version=5
indicator("Counter")
var int cnt = 0
cnt := cnt + 1
plot(cnt)
`;

  it('var state increments correctly', () => {
    const { ts } = pipelineParse(source);
    expect(ts).toContain('let _var_cnt');
    const { onBar } = evalGenerated(ts);

    for (let i = 0; i < 10; i++) {
      const bar: Bar = { time: i, open: 1, high: 1, low: 1, close: 1, volume: 1 };
      const result = onBar(bar, i, false);
      const genVal  = (Object.values(result)[0] as number) ?? NaN;
      expect(genVal).toBe(i + 1);
    }
  });
});

import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const _testDir = dirname(fileURLToPath(import.meta.url));

describe('codegen: Volume Profile parse + codegen compile', () => {
  it('VP script generates without throwing and contains PineArray/PineBox', () => {
    const dir = join(_testDir, '..', 'fixtures', 'targets');
    const src = readFileSync(join(dir, 'vp-fixed-range.pine'), 'utf8');

    const { ts } = pipelineParse(src);
    // Must include drawing support
    expect(ts).toContain('PineBox');
    expect(ts).toContain('PineArray');
    expect(ts).toContain('Highest');
    expect(ts).toContain('Lowest');
    // Must contain hoisted instances
    expect(ts).toContain('new Highest(_inputs._inp_bbars)');
    expect(ts).toContain('new Lowest(_inputs._inp_bbars)');
    // Must contain BarHistory for dynamic series indexing
    expect(ts).toContain('_hist');
    expect(ts).toContain('BarHistory');
    // Must contain get_vol function with return statement
    expect(ts).toContain('function get_vol');
    expect(ts).toContain('return nz');
    // Must contain barstate.islast → isLast
    expect(ts).toContain('if (isLast)');
    // Must contain onBar function
    expect(ts).toContain('function onBar');
    // Must contain drawing commands
    expect(ts).toContain('PineBox.new');
    expect(ts).toContain('PineLine.new');
    expect(ts).toContain('PineLabel.new');
    // Codegen should produce valid-looking TypeScript (no syntax issues in generation)
    expect(() => pipelineParse(src)).not.toThrow();
  });
});

describe('codegen: meta extraction', () => {
  it('extracts indicator name and overlay', () => {
    const src = `//@version=5\nindicator("My Ind", overlay=true)\nplot(close)\n`;
    const { sem } = pipelineParse(src);
    expect(sem.scriptName).toBe('My Ind');
    expect(sem.overlay).toBe(true);
  });

  it('extracts input metadata', () => {
    const src = `//@version=5\nindicator("T")\nlength = input.int(14, "Length", minval=1, maxval=100)\nplot(close)\n`;
    const { sem } = pipelineParse(src);
    expect(sem.inputs.has('length')).toBe(true);
    const inp = sem.inputs.get('length')!;
    expect(inp.fn).toBe('input.int');
    expect(inp.pineId).toBe('_inp_length');
  });
});
