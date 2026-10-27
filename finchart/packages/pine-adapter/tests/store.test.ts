import { describe, it, expect } from 'vitest';
import * as ts from 'typescript';

import { PineIndicatorStore, memoryStorage, type PineModule, type IndicatorDef } from '../src/index';
import { parse, analyze, generate } from '../../pine-parser/src/index';
import * as PineRT from '../../pine-rt/src/index';

// node compile fn (browser would do ts.transpile + Blob import instead)
function compile(source: string): PineModule {
  const parsed = parse(source);
  if (parsed.errors.length) throw new Error('parse: ' + parsed.errors[0]!.msg);
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
  const fn = new Function(...Object.keys(sandbox), `${js}; return { meta, _inputs: typeof _inputs !== 'undefined' ? _inputs : {}, createInstance };`);
  return fn(...Object.values(sandbox)) as PineModule;
}

const RSI = `//@version=5
indicator("My RSI", overlay=false)
length = input.int(14, "Length")
plot(ta.rsi(close, length), title="RSI")
`;
const EMA = `//@version=5
indicator("My EMA", overlay=true)
plot(ta.ema(close, 21), title="EMA")
`;

describe('PineIndicatorStore', () => {
  it('add() compiles, persists, returns a pine IndicatorDef', () => {
    const store = new PineIndicatorStore(compile, memoryStorage());
    const res = store.add(RSI);
    expect(res.ok).toBe(true);
    expect(res.def?.source).toBe('pine');
    expect(res.def?.category).toBe('oscillator');
    expect(res.entry?.name).toBe('My RSI');
    expect(res.entry?.id).toBe('my-rsi');
    expect(store.list()).toHaveLength(1);
  });

  it('rejects invalid source without persisting', () => {
    const store = new PineIndicatorStore(compile, memoryStorage());
    const res = store.add('this is @@ not pine ((');
    expect(res.ok).toBe(false);
    expect(res.error).toBeTruthy();
    expect(store.list()).toHaveLength(0);
  });

  it('dedupes ids for same-named scripts', () => {
    const store = new PineIndicatorStore(compile, memoryStorage());
    store.add(RSI);
    const res2 = store.add(RSI);
    expect(res2.entry?.id).toBe('my-rsi-2');
    expect(store.list()).toHaveLength(2);
  });

  it('remove() drops the entry', () => {
    const store = new PineIndicatorStore(compile, memoryStorage());
    const { entry } = store.add(RSI);
    store.remove(entry!.id);
    expect(store.list()).toHaveLength(0);
  });

  it('buildDefs() compiles all stored scripts', () => {
    const store = new PineIndicatorStore(compile, memoryStorage());
    store.add(RSI);
    store.add(EMA);
    const { defs, errors } = store.buildDefs();
    expect(errors).toHaveLength(0);
    expect(defs.map(d => d.name).sort()).toEqual(['My EMA', 'My RSI']);
    expect(defs.find(d => d.name === 'My EMA')?.category).toBe('overlay');
  });

  it('persists across store instances via shared storage', () => {
    const storage = memoryStorage();
    const s1 = new PineIndicatorStore(compile, storage);
    s1.add(RSI);
    s1.add(EMA);

    // a fresh store reading the same storage sees both, and can rebuild defs
    const s2 = new PineIndicatorStore(compile, storage);
    expect(s2.list()).toHaveLength(2);
    expect(s2.buildDefs().defs).toHaveLength(2);
  });

  it('registerInto() registers defs into a candlekit-style registry', () => {
    const store = new PineIndicatorStore(compile, memoryStorage());
    store.add(RSI);
    store.add(EMA);

    const registered: IndicatorDef[] = [];
    const fakeRegistry = { register: (d: IndicatorDef) => registered.push(d) };
    const { errors } = store.registerInto(fakeRegistry);

    expect(errors).toHaveLength(0);
    expect(registered).toHaveLength(2);
    expect(registered.every(d => d.source === 'pine')).toBe(true);
  });
});
