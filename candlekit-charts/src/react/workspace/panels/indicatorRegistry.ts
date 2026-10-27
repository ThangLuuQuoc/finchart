/**
 * Shared indicator registry for the built-in ChartPanel.
 *
 * Defaults to candlekit's own MIT catalog. A host can swap in a richer registry
 * (e.g. the 400+ `@getcandlekit/charts/indicators-tv` set) once at startup, before
 * panels mount, so every ChartPanel's Indicators dropdown lists it — without the
 * core panel taking a dependency on any third-party indicator runtime.
 */

import type { IndicatorRegistry } from "../../../indicators/registry";
import { createBuiltinRegistry } from "../../../indicators/builtin";

let registry: IndicatorRegistry | null = null;

/** Override the registry every built-in ChartPanel reads. Call before mount. */
export function setWorkspaceIndicatorRegistry(next: IndicatorRegistry): void {
  registry = next;
}

/** The active registry (built-in catalog by default). */
export function getWorkspaceIndicatorRegistry(): IndicatorRegistry {
  if (!registry) registry = createBuiltinRegistry();
  return registry;
}

/**
 * Per-pane context the handler may use to attach a drawing-based Pine script
 * (e.g. Volume Profile) directly to the calling pane's chart, instead of
 * registering a series IndicatorDef. Structurally typed (`use(plugin)`) so the
 * core panel never imports the Pine toolchain or a ChartPlugin type — keeping
 * the no-third-party-runtime invariant.
 */
export interface PineAttachContext {
  /** The calling pane's chart controller — `use(plugin)` attaches a ChartPlugin. */
  controller: { use(plugin: unknown): unknown };
}

/**
 * Optional "add Pine script" handler the host wires up (compile + register into
 * the workspace registry, or attach a drawing plugin to the pane via `ctx`).
 * Stored as a plain function so the core panel never imports the Pine toolchain
 * — keeping the no-third-party-runtime invariant. When unset, ChartPanel hides
 * the "add Pine script" entry.
 */
export type AddPineScriptHandler = (
  source: string,
  ctx?: PineAttachContext,
) => { ok: boolean; name?: string; error?: string };

let pineHandler: AddPineScriptHandler | null = null;

export function setWorkspaceAddPineScript(handler: AddPineScriptHandler | null): void {
  pineHandler = handler;
}

export function getWorkspaceAddPineScript(): AddPineScriptHandler | null {
  return pineHandler;
}
