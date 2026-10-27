/**
 * Wires the Pine toolchain into the workspace demo (kept OUT of candlekit core,
 * which must not depend on @finchart/*). Compiles Pine → IndicatorDef, seeds a
 * couple of scripts, registers them into the shared workspace registry, and
 * installs the "add Pine script" handler the ChartPanel modal calls.
 */
import * as ts from "typescript";
import { parse, analyze, generate } from "@finchart/pine-parser";
import * as PineRT from "@finchart/pine-rt";
import {
  PineIndicatorStore,
  localStorageStorage,
  isDrawingBasedPine,
  pineDrawingsPlugin,
  type PineModule,
} from "@finchart/pine-adapter";
import { setWorkspaceAddPineScript, type AddPineScriptHandler } from "@getcandlekit/charts/react/workspace";
import type { IndicatorRegistry } from "@getcandlekit/charts";

function compilePine(source: string): PineModule {
  const parsed = parse(source);
  if (parsed.errors.length) throw new Error("Lỗi cú pháp: " + parsed.errors[0]!.msg);
  const sem = analyze(parsed.script!);
  const tsCode = generate(parsed.script!, sem);
  const js = ts
    .transpile(tsCode, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 })
    .replace(/^import\s+.*$/gm, "")
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");
  const sandbox: Record<string, unknown> = {
    ...PineRT, NaN, Infinity, Math, isNaN, isFinite, parseInt, parseFloat,
    String, Number, Boolean, JSON, Object, Array, Date, console,
  };
  const fn = new Function(...Object.keys(sandbox), `${js}; return { meta, _inputs: typeof _inputs !== 'undefined' ? _inputs : {}, createInstance };`);
  return fn(...Object.values(sandbox)) as PineModule;
}

const SEED_RIBBON = `//@version=5
indicator("EMA Ribbon (Pine)", overlay=true)
fast = input.int(8, "Fast", minval=1)
slow = input.int(21, "Slow", minval=1)
plot(ta.ema(close, fast), "Fast", color.aqua, 2)
plot(ta.ema(close, slow), "Slow", color.orange, 2)
`;
const SEED_MOM = `//@version=5
indicator("Momentum (Pine)", overlay=false)
len = input.int(10, "Length", minval=1)
plot(ta.mom(close, len), "Mom", color.purple, 2)
`;

/** Register stored + seeded Pine scripts into `registry` and install the handler. */
export function setupWorkspacePine(registry: IndicatorRegistry): void {
  const store = new PineIndicatorStore(compilePine, localStorageStorage());
  if (store.list().length === 0) {
    store.add(SEED_RIBBON);
    store.add(SEED_MOM);
  }
  for (const def of store.buildDefs().defs) registry.register(def);

  const handler: AddPineScriptHandler = (src, ctx) => {
    // Compile once to classify: drawing-based scripts (no plot series, e.g.
    // Volume Profile) can't become a series IndicatorDef — attach a drawing
    // plugin to the calling pane instead.
    let mod: PineModule;
    try {
      mod = compilePine(src);
    } catch (e) {
      return { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (isDrawingBasedPine(mod)) {
      if (!ctx?.controller) {
        return { ok: false, error: "Script vẽ (drawing-based) cần một pane đang mở để gắn." };
      }
      ctx.controller.use(pineDrawingsPlugin(mod, { id: mod.meta?.name }));
      return { ok: true, name: mod.meta?.name };
    }

    // Series-based: persist + register into the shared workspace registry.
    const r = store.add(src);
    if (r.ok && r.def) registry.register(r.def);
    return { ok: r.ok, name: r.entry?.name, error: r.error };
  };
  setWorkspaceAddPineScript(handler);
}
