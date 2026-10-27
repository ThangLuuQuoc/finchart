import { parse, analyze, generate } from "../../../finchart/packages/pine-parser/src/index";
import * as ts from 'typescript';
import fs from 'fs';

const pineCode = fs.readFileSync("va-pro.pine", "utf-8");

const parsed = parse(pineCode);
if (parsed.errors.length > 0) {
  console.log("Parser errors:");
  console.dir(parsed.errors, { depth: null });
  process.exit(1);
}

const sem = analyze(parsed.script!);
const tsCode = generate(parsed.script!, sem);

fs.writeFileSync("va-pro.ts", tsCode);

console.log("Generated TS length:", tsCode.length);

const jsCode = ts.transpile(tsCode, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
});

const patchedJs = jsCode.replace(
  /import\s+{([^}]+)}\s+from\s+['"]@finchart\/pine-rt['"];?/g,
  `const {$1} = window.PineRT;`
);

fs.writeFileSync("va-pro.js", patchedJs);

const url = "file:///" + process.cwd().replace(/\\/g, "/") + "/va-pro.js";
try {
  await import(url);
  console.log("JS module loaded successfully!");
} catch (e: any) {
  console.log("Error loading JS module:");
  console.log(e);
}
