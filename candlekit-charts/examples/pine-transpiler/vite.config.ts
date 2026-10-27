import { resolve } from "node:path";
import { defineConfig } from "vite";
import { candlekitResolve } from "../shared/vite.shared";

export default defineConfig({
  resolve: {
    ...candlekitResolve,
    alias: {
      ...candlekitResolve.alias,
      "@finchart/pine-rt": resolve(__dirname, "../../../finchart/packages/pine-rt/src/index.ts"),
      "@finchart/pine-parser": resolve(__dirname, "../../../finchart/packages/pine-parser/src/index.ts"),
    },
  },
  server: { port: 5185, fs: { strict: false } },
});
