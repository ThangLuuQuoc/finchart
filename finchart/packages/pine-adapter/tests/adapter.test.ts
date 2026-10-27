/**
 * Bridge tests: Pine source → parse → generate → ts.transpile → module →
 * pineModuleToIndicatorDef → run via the IndicatorDef contract.
 *
 * Relative imports (not the package name) mirror the other finchart packages so
 * the suite runs without workspace symlinks.
 */

import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as ts from 'typescript';

import { pineModuleToIndicatorDef, PineDrawingsPlugin, isDrawingBasedPine, type PineModule, type IndicatorBar } from '../src/index';
import { parse, analyze, generate } from '../../pine-parser/src/index';
import * as PineRT from '../../pine-rt/src/index';
import { Rsi } from '../../pine-rt/src/index';

// ── compile a Pine source string into a runnable module ──────────────────────

function compile(source: string): PineModule {
  const parsed = parse(source);
  expect(parsed.errors, 'parse errors').toEqual([]);
  const sem = analyze(parsed.script!);
  const tsCode = generate(parsed.script!, sem);
  const js = ts
    .transpile(tsCode, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 })
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+(const|let|var|function|class)\b/g, '$1');

  const sandbox: Record<string, unknown> = {
    ...PineRT, NaN, Infinity, Math, isNaN, isFinite, parseInt, parseFloat,
    String, Number, Boolean, JSON, Object, Array, Date, console,
  };
  const fn = new Function(
    ...Object.keys(sandbox),
    `${js}; return { meta, _inputs: typeof _inputs !== 'undefined' ? _inputs : {}, createInstance };`,
  );
  return fn(...Object.values(sandbox)) as PineModule;
}

function makeBars(n: number): IndicatorBar[] {
  const bars: IndicatorBar[] = [];
  let price = 100;
  for (let i = 0; i < n; i++) {
    price *= 1 + Math.sin(i * 0.3) * 0.02;
    const open = price;
    const close = price * (1 + (Math.sin(i * 1.7) - 0.5) * 0.01);
    const high = Math.max(open, close) * 1.005;
    const low = Math.min(open, close) * 0.995;
    bars.push({ time: 1000 + i * 60, open, high, low, close, volume: 1000 + i * 10 });
  }
  return bars;
}

const RSI_SRC = `//@version=5
indicator("Pine RSI", overlay=false)
length = input.int(14, "Length", minval=1)
r = ta.rsi(close, length)
plot(r, title="RSI")
`;

// ── tests ────────────────────────────────────────────────────────────────

describe('pineModuleToIndicatorDef: metadata mapping', () => {
  it('maps name/category/inputs/plots/source', () => {
    const def = pineModuleToIndicatorDef(compile(RSI_SRC));
    expect(def.name).toBe('Pine RSI');
    expect(def.category).toBe('oscillator'); // overlay=false
    expect(def.source).toBe('pine');
    expect(def.tags).toContain('pine');

    const len = def.inputConfig.find(c => c.name === '_inp_length');
    expect(len?.type).toBe('int');
    expect(len?.minval).toBe(1);
    expect(def.defaultInputs._inp_length).toBe(14);

    expect(def.plotConfig.map(p => p.id)).toContain('_plot_1');
  });
});

describe('pineModuleToIndicatorDef: streaming matches pine-rt Rsi', () => {
  it('next() emits RSI equal to the reference bar-for-bar', () => {
    const def = pineModuleToIndicatorDef(compile(RSI_SRC));
    const stream = def.streaming!();
    const ref = new Rsi(14);
    const bars = makeBars(60);

    for (const bar of bars) {
      const out = stream.next(bar);
      const got = out._plot_1 as number;
      const want = ref.next(bar.close);
      if (Number.isNaN(want)) {
        expect(Number.isNaN(got as number)).toBe(true);
      } else {
        expect(Math.abs((got as number) - want)).toBeLessThan(1e-9);
      }
    }
  });

  it('separate instances do not share state', () => {
    const def = pineModuleToIndicatorDef(compile(RSI_SRC));
    const bars = makeBars(40);
    const a = def.streaming!();
    for (const b of bars) a.next(b); // advance instance A fully

    // A fresh instance must reproduce the reference from scratch
    const b2 = def.streaming!();
    const ref = new Rsi(14);
    for (const bar of bars) {
      const got = b2.next(bar)._plot_1 as number;
      const want = ref.next(bar.close);
      if (!Number.isNaN(want)) expect(Math.abs((got as number) - want)).toBeLessThan(1e-9);
    }
  });
});

describe('pineModuleToIndicatorDef: calculate (batch)', () => {
  it('produces a finite plot series', () => {
    const def = pineModuleToIndicatorDef(compile(RSI_SRC));
    const bars = makeBars(50);
    const res = def.calculate(bars);
    const series = res.plots._plot_1!;
    expect(series.length).toBeGreaterThan(30);
    expect(series.every(pt => Number.isFinite(pt.value))).toBe(true);
    expect(series[series.length - 1]!.time).toBe(bars[bars.length - 1]!.time);
  });
});

describe('pineModuleToIndicatorDef: drawing-based (Volume Profile)', () => {
  it('overlay category + runs without throwing + emits boxes', () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pine-parser', 'fixtures', 'diag');
    const src = readFileSync(join(dir, 'vpm-v6-real.pine'), 'utf8');
    const def = pineModuleToIndicatorDef(compile(src));
    expect(def.category).toBe('overlay');

    PineRT.activeDrawings.clear();
    const stream = def.streaming!();
    const bars = Array.from({ length: 1200 }, (_, i) => ({
      time: 1000 + i * 60,
      open: 100 + Math.sin(i * 0.1) * 30, high: 105 + Math.sin(i * 0.1) * 30,
      low: 95 + Math.sin(i * 0.1) * 30, close: 100 + Math.sin(i * 0.1) * 30,
      volume: 1000 + (i % 100),
    }));
    expect(() => {
      for (let i = 0; i < bars.length; i++) {
        if (i === bars.length - 1) stream.peek(bars[i]!);
        else stream.next(bars[i]!);
      }
    }).not.toThrow();
    // drawing-based: boxes accumulate in the global activeDrawings set
    expect(PineRT.activeDrawings.boxes.size).toBeGreaterThan(0);
  });
});

describe('isDrawingBasedPine: routes series vs drawing scripts', () => {
  const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pine-parser', 'fixtures', 'diag');
  it('false for a series script (RSI plots a line)', () => {
    expect(isDrawingBasedPine(compile(RSI_SRC))).toBe(false);
  });
  it('true for Volume Profile (no plot series, draws boxes/lines)', () => {
    const vp = compile(readFileSync(join(dir, 'vpm-v6-real.pine'), 'utf8'));
    expect(isDrawingBasedPine(vp)).toBe(true);
  });
});

describe('PineDrawingsPlugin: replays bars → per-instance drawings', () => {
  const loadVp = () => {
    const dir = join(dirname(fileURLToPath(import.meta.url)), '..', '..', 'pine-parser', 'fixtures', 'diag');
    return compile(readFileSync(join(dir, 'vpm-v6-real.pine'), 'utf8'));
  };
  // Host bars (candlekit shape: epoch ms in `ts`).
  const hostBars = Array.from({ length: 1200 }, (_, i) => ({
    ts: 1_700_000_000_000 + i * 60_000,
    open: 100 + Math.sin(i * 0.1) * 30, high: 105 + Math.sin(i * 0.1) * 30,
    low: 95 + Math.sin(i * 0.1) * 30, close: 100 + Math.sin(i * 0.1) * 30,
    volume: 1000 + (i % 100),
  }));
  const mockCtx = () => {
    let attached: unknown = null;
    const series = {
      attachPrimitive: (p: unknown) => { attached = p; },
      detachPrimitive: () => { attached = null; },
      priceToCoordinate: (p: number) => p,
    };
    const chart = { timeScale: () => ({ timeToCoordinate: () => 0 }) };
    return { ctx: { chart, series, getBars: () => hostBars }, get attached() { return attached; } };
  };

  it('init() replays + builds boxes; instance is per-plugin (no global needed)', () => {
    const m = mockCtx();
    const plugin = new PineDrawingsPlugin(loadVp(), { id: 'vp' });
    expect(plugin.id).toBe('pine-draw:vp');
    plugin.init(m.ctx as never);
    expect(m.attached).toBeTruthy(); // primitive attached to series
    expect(plugin.drawings!.boxes.size).toBeGreaterThan(0);
  });

  it('two plugins keep separate drawing collections (no clobber)', () => {
    const mod = loadVp();
    const a = new PineDrawingsPlugin(mod, { id: 'a' });
    const b = new PineDrawingsPlugin(mod, { id: 'b' });
    a.init(mockCtx().ctx as never);
    b.init(mockCtx().ctx as never);
    expect(a.drawings).not.toBe(b.drawings);
    expect(a.drawings!.boxes.size).toBeGreaterThan(0);
    expect(b.drawings!.boxes.size).toBeGreaterThan(0);
  });

  it('destroy() detaches', () => {
    const m = mockCtx();
    const plugin = new PineDrawingsPlugin(loadVp());
    plugin.init(m.ctx as never);
    expect(m.attached).toBeTruthy();
    plugin.destroy();
    expect(m.attached).toBeNull();
  });
});
