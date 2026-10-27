import { resolve } from "node:path";
import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import { candlekitResolve } from "../shared/vite.shared";

export default defineConfig({
  plugins: [react()],
  resolve: {
    ...candlekitResolve,
    alias: {
      ...candlekitResolve.alias,
      "@finchart/pine-rt": resolve(__dirname, "../../../finchart/packages/pine-rt/src/index.ts"),
      "@finchart/pine-parser": resolve(__dirname, "../../../finchart/packages/pine-parser/src/index.ts"),
      "@finchart/pine-adapter": resolve(__dirname, "../../../finchart/packages/pine-adapter/src/index.ts"),
    },
  },
  server: { fs: { strict: false } },
});
