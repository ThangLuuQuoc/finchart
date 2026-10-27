import * as ts from "typescript";

export async function compileAndLoad(tsCode: string): Promise<any> {
  // 1. Transpile TS to JS
  // We target ES2022 to keep modern features but strip types
  const jsCode = ts.transpile(tsCode, {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ES2022,
  });

  // 2. Replace the module import with window.PineRT
  // The codegen outputs: import { Sma, Rsi, ... } from '@finchart/pine-rt';
  // We rewrite this to: const { Sma, Rsi, ... } = window.PineRT;
  const patchedJs = jsCode.replace(
    /import\s+{([^}]+)}\s+from\s+['"]@finchart\/pine-rt['"];?/g,
    `const {$1} = window.PineRT;`
  );

  // 3. Create a Blob URL and dynamically import it
  const blob = new Blob([patchedJs], { type: "text/javascript" });
  const url = URL.createObjectURL(blob);

  try {
    const module = await import(/* @vite-ignore */ url);
    return module;
  } finally {
    URL.revokeObjectURL(url);
  }
}
