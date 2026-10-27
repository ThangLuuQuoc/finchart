import * as ts from 'typescript';

const tsCode = `
import { Rsi, NA, na, nz } from '@finchart/pine-rt';

// ── inputs ──
export const _inputs = {
  _inp_length: 14, // input.int(14, "RSI Length")
  _inp_up_color: '#4CAF50', // input.color('#4CAF50', "Up Color")
  _inp_down_color: '#FF4136', // input.color('#FF4136', "Down Color")
};

export const meta = { name: "test", overlay: false, inputs: [], plots: [] };
export function onBar() { return {}; }
`;

const jsCode = ts.transpile(tsCode, {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.ES2022,
});

const patchedJs = jsCode.replace(
  /import\s+{([^}]+)}\s+from\s+['"]@finchart\/pine-rt['"];?/g,
  `const {$1} = window.PineRT;`
);

console.log("Original js:");
console.log(jsCode);
console.log("\nPatched js:");
console.log(patchedJs);

try {
  new Function(patchedJs); // this will syntax check, except for `export` syntax
} catch (e) {
  console.log("Syntax error inside:", e.message);
}
