import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from '../src/index';
import { analyze } from '../src/semantic';
import { generate } from '../src/codegen';
import * as PineRT from '../../pine-rt/src/index';
import * as ts from 'typescript';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures', 'diag');

/** Strip types exactly like the browser compiler (examples/pine-transpiler/compiler.ts). */
function strip(tsCode: string): string {
  const js = ts.transpile(tsCode, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 });
  // Strip import/export keywords so it runs inside new Function()
  return js
    .replace(/^import\s+.*$/gm, '')
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, '')
    .replace(/\bexport\s+(const|let|var|function|class)\b/g, '$1');
}

const TARGET = process.env.DIAG_FILE || 'vpm-v6-real.pine';

describe('DIAG: vpm-v6 generate + run', () => {
  it('prints generated TS and runs over synthetic bars', () => {
    const src = readFileSync(join(dir, TARGET), 'utf8');
    const parsed = parse(src);
    console.log('PARSE errors:', JSON.stringify(parsed.errors));
    expect(parsed.errors).toEqual([]);

    const sem = analyze(parsed.script!);
    const ts = generate(parsed.script!, sem);
    console.log('\n========== GENERATED TS ==========\n' + ts + '\n========== END ==========\n');

    // Build sandbox
    const sandbox: any = { ...PineRT, NaN, Infinity, Math, isNaN, isFinite, parseInt, parseFloat, String, Number, Boolean, JSON, Object, Array, Date, console };
    const js = strip(ts);
    let module: any;
    let inst: any;
    try {
      const fn = new Function(...Object.keys(sandbox), `${js}; return { createInstance, meta, _inputs };`);
      module = fn(...Object.values(sandbox));
      inst = module.createInstance();
    } catch (e: any) {
      console.log('COMPILE/EVAL ERROR:', e.message);
      throw e;
    }

    console.log('maxBarsBack:', sem.maxBarsBack, 'historyDepth:', sem.historyDepth);

    // Synthetic bars — 4000 to exceed the old 510 BarHistory cap and a 3000-bar profile loop
    const bars = Array.from({ length: 4000 }, (_, i) => ({
      time: 1000 + i * 60, open: 100 + Math.sin(i * 0.1) * 50, high: 105 + Math.sin(i * 0.1) * 50,
      low: 95 + Math.sin(i * 0.1) * 50, close: 100 + Math.sin(i * 0.1) * 50, volume: 1000 + (i % 100),
    }));

    PineRT.activeDrawings.clear();
    const hist = new PineRT.BarHistory(100);
    let runtimeError: string | null = null;
    let firstErrorBar = -1;
    for (let i = 0; i < bars.length; i++) {
      hist.push(bars[i]);
      try {
        inst.onBar(bars[i], i + 1, i === bars.length - 1);
      } catch (e: any) {
        if (!runtimeError) { runtimeError = e.message; firstErrorBar = i; }
      }
    }

    console.log('RUNTIME ERROR:', runtimeError, '@ bar', firstErrorBar);
    console.log('DRAWINGS boxes:', PineRT.activeDrawings.boxes.size, 'lines:', PineRT.activeDrawings.lines.size);
    const firstBox = [...PineRT.activeDrawings.boxes][0] as any;
    const firstLine = [...PineRT.activeDrawings.lines][0] as any;
    if (firstBox) console.log('first box top/bottom finite?', Number.isFinite(firstBox.top), Number.isFinite(firstBox.bottom), 'top=', firstBox.top, 'bottom=', firstBox.bottom);
    if (firstLine) console.log('first line y1/y2 finite?', Number.isFinite(firstLine.y1), Number.isFinite(firstLine.y2), 'y1=', firstLine.y1);
    // Drawings must exist AND have finite coordinates (NaN coords → skipped by renderer → blank chart)
    expect(PineRT.activeDrawings.boxes.size).toBeGreaterThan(0);
    if (firstBox) {
      expect(Number.isFinite(firstBox.top), 'box.top must be finite (else renderer skips it)').toBe(true);
      expect(Number.isFinite(firstBox.bottom)).toBe(true);
    }
  });
});
