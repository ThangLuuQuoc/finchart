/**
 * Browser-side Pine → runnable module compiler (synchronous).
 *
 * Mirrors the finchart test harness: parse → analyze → generate TS →
 * ts.transpile → strip import/export → new Function() with the pine-rt runtime
 * injected. Synchronous (no Blob/dynamic-import), so it can back the modal's
 * `onAddPineScript` callback directly.
 */
import * as ts from "typescript";
import { parse, analyze, generate } from "@finchart/pine-parser";
import * as PineRT from "@finchart/pine-rt";
import type { PineModule } from "@finchart/pine-adapter";

export function compilePine(source: string): PineModule {
  const parsed = parse(source);
  if (parsed.errors.length) {
    throw new Error("Lỗi cú pháp: " + parsed.errors[0]!.msg);
  }
  const sem = analyze(parsed.script!);
  const tsCode = generate(parsed.script!, sem);

  const js = ts
    .transpile(tsCode, { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 })
    .replace(/^import\s+.*$/gm, "")
    .replace(/^export\s+\{[^}]*\}\s*;?\s*$/gm, "")
    .replace(/\bexport\s+(const|let|var|function|class)\b/g, "$1");

  const sandbox: Record<string, unknown> = {
    ...PineRT,
    NaN, Infinity, Math, isNaN, isFinite, parseInt, parseFloat,
    String, Number, Boolean, JSON, Object, Array, Date, console,
  };
  const fn = new Function(
    ...Object.keys(sandbox),
    `${js}; return { meta, _inputs: typeof _inputs !== 'undefined' ? _inputs : {}, createInstance };`,
  );
  return fn(...Object.values(sandbox)) as PineModule;
}
