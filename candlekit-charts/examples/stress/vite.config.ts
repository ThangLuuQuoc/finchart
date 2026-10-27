import { resolve } from "node:path";
import { defineConfig } from "vite";
import { candlekitResolve } from "../shared/vite.shared";

export default defineConfig({
  resolve: {
    ...candlekitResolve,
    alias: {
      ...candlekitResolve.alias,
      // consume the pine-rt streaming runtime straight from its TS source
      "@finchart/pine-rt": resolve(__dirname, "../../../finchart/packages/pine-rt/src/index.ts"),
    },
  },
  server: { fs: { strict: false } },
});
