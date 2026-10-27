import { StrictMode, useMemo, useState, useEffect } from "react";
import { createRoot } from "react-dom/client";
import { ChartView, IndicatorModal, IndicatorQuickPanel, IndicatorSettingsDialog, ChartLegend, IndicatorController, createBuiltinRegistry } from "@getcandlekit/charts/react";
import "@getcandlekit/charts/styles.css";
import { generateBars, createWorkerCompute, builtinIndicatorNames, type BatchCompute } from "@getcandlekit/charts";
import { PineIndicatorStore, localStorageStorage, pineDrawingsPlugin } from "@finchart/pine-adapter";
import { compilePine } from "./compile";
import { runB1Bench } from "./b1bench";

// A2 harness: callable from the page (Claude Preview / Playwright) to get B1 numbers.
// eslint-disable-next-line @typescript-eslint/no-explicit-any
(window as any).__b1bench = runB1Bench;
// @ts-expect-error ?raw text import resolved by Vite
import vpSource from "../../../finchart/packages/pine-parser/fixtures/diag/vpm-v6-real.pine?raw";

// Seeded so "Pine của tôi" is populated on first run.
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

/**
 * B1 — off-main-thread batch compute. Build the indicator worker once (Vite
 * resolves the module Worker via `new URL(..., import.meta.url)`). On failure
 * (no Worker support, bundling issue) we return null and the controller falls
 * back to the synchronous main-thread path.
 */
function makeIndicatorCompute(): BatchCompute | null {
  try {
    const worker = new Worker(new URL("../../src/indicators/compute/indicatorWorker.ts", import.meta.url), { type: "module" });
    const compute = createWorkerCompute({ worker, supportedNames: builtinIndicatorNames() });
    // eslint-disable-next-line no-console
    console.log("[B1] indicator compute: worker (off-main-thread, built-ins)");
    return compute;
  } catch (e) {
    console.warn("[B1] indicator worker unavailable, falling back to main thread", e);
    return null;
  }
}

function App() {
  const data = useMemo(() => generateBars(1500), []);
  const [theme, setTheme] = useState<"dark" | "light">("dark");
  const [settingsName, setSettingsName] = useState<string | null>(null);

  // Drawing-based Pine (Volume Profile) rendered via PineDrawingsPlugin (Cách A).
  const vpModule = useMemo(() => {
    try { return compilePine(vpSource as string); } catch (e) { console.error("VP compile failed", e); return null; }
  }, []);

  useEffect(() => {
    document.documentElement.classList.toggle("dark", theme === "dark");
    document.documentElement.setAttribute("data-theme", theme);
  }, [theme]);

  const { indicators, onAddPineScript } = useMemo(() => {
    const registry = createBuiltinRegistry();
    const store = new PineIndicatorStore(compilePine, localStorageStorage());

    if (store.list().length === 0) {
      store.add(SEED_RIBBON);
      store.add(SEED_MOM);
    }
    for (const def of store.buildDefs().defs) registry.register(def);

    const ctl = new IndicatorController(registry, { compute: makeIndicatorCompute() ?? undefined });
    ctl.add("EMA", { length: 21 });
    ctl.add("RSI", { length: 14 });

    const onAddPineScript = (src: string) => {
      const r = store.add(src);
      if (r.ok && r.def) registry.register(r.def);
      return { ok: r.ok, name: r.entry?.name, error: r.error };
    };

    // E2E harness: run the real paste-Pine → register → activate path against
    // this worker-enabled controller, then read back the legend so a Preview
    // session can assert the pipeline (incl. the worker fallback for Pine defs).
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__pineE2E = (src: string) => {
      const r = onAddPineScript(src);
      if (r.ok && r.name) ctl.add(r.name);
      return r;
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    (window as any).__ctl = ctl;
    return { indicators: ctl, onAddPineScript };
  }, []);

  return (
    <div style={{ padding: 12 }}>
      <div style={{ display: "flex", alignItems: "center", gap: 12, marginBottom: 8 }}>
        <strong>Indicator menu demo</strong>
        <button type="button" onClick={() => setTheme((t) => (t === "dark" ? "light" : "dark"))}>
          {theme === "dark" ? "☀ Light" : "\u{1F319} Dark"}
        </button>
        <span style={{ color: "#888", fontSize: 13 }}>
          IndicatorModal (catalog + Pine) + IndicatorPicker (quick) — same controller.
        </span>
      </div>
      <div style={{ height: "78vh" }}>
        <ChartView
          data={data}
          indicators={indicators}
          theme={theme}
          pointMarker
          onReady={(api) => {
            // Attach the Volume Profile drawing plugin to the pane (Cách A).
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            if (vpModule) (api.controller as any).use(pineDrawingsPlugin(vpModule as any, { id: "vp-demo" }));
          }}
        >
          <div style={{ position: "absolute", top: 10, left: 10, zIndex: 50 }}>
            <IndicatorModal onAddPineScript={onAddPineScript} onOpenSettings={setSettingsName} />
          </div>
          <div style={{ position: "absolute", top: 52, left: 10, zIndex: 40 }}>
            <ChartLegend onOpenSettings={setSettingsName} />
          </div>
          <div style={{ position: "absolute", top: 10, right: 10, zIndex: 50 }}>
            <IndicatorQuickPanel onOpenSettings={setSettingsName} />
          </div>
          <IndicatorSettingsDialog name={settingsName} onClose={() => setSettingsName(null)} />
        </ChartView>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
