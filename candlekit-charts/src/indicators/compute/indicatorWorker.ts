/**
 * Indicator compute Worker (B1 — off-main-thread batch compute).
 *
 * Runs the *built-in* indicator catalog's pure `calculate(bars, inputs)` off the
 * main thread so a full-history recompute (toggle on / data refresh over a large
 * series) doesn't jank the UI. Built-ins only: their math is self-contained MIT
 * (no lightweight-charts, no DOM), so this module imports cleanly in a Worker.
 *
 * Pine / TV (indicators-tv) defs are NOT here — their `calculate` is dynamically
 * compiled / needs a third-party runtime, so the controller keeps those on the
 * main thread (see {@link BatchCompute.supports}).
 *
 * Protocol: main thread posts {@link ComputeRequest}; the worker replies with a
 * matching {@link ComputeResponse} (same `id`). Stateless — every request is a
 * self-contained batch.
 */
import { createBuiltinRegistry } from "../builtin";
import type { IndicatorBar, IndicatorResult } from "../types";

/**
 * Cache the bar series under `version`. Sent once per data change; subsequent
 * {@link CalcRequest}s reference it by version so a 50k-bar array is
 * structured-cloned across the boundary ONCE, not once per indicator (A2 found
 * the per-request clone tax — ~11ms/req — was killing the offload for cheap
 * built-ins). No reply.
 */
export interface BarsMessage {
  kind: "bars";
  version: number;
  bars: IndicatorBar[];
}

/** Compute `name` against the cached bars of `version`. */
export interface CalcRequest {
  kind: "calc";
  id: number;
  name: string;
  version: number;
  inputs?: Record<string, unknown>;
}

export type ComputeRequest = BarsMessage | CalcRequest;

export type ComputeResponse =
  | { id: number; ok: true; result: IndicatorResult }
  | { id: number; ok: false; error: string };

/** Names of built-in indicators this worker can compute. Shared with the client. */
export function builtinIndicatorNames(): string[] {
  return createBuiltinRegistry()
    .list()
    .map((d) => d.name);
}

/**
 * Wire a worker-global scope to the built-in registry. Exported (not just run on
 * import) so it's unit-testable against a fake scope without a real Worker.
 */
export interface WorkerScope {
  onmessage: ((e: { data: ComputeRequest }) => void) | null;
  postMessage(msg: ComputeResponse): void;
}

export function installIndicatorWorker(scope: WorkerScope): void {
  const registry = createBuiltinRegistry();
  let cachedBars: IndicatorBar[] | null = null;
  let cachedVersion = -1;
  scope.onmessage = (e) => {
    const msg = e.data;
    if (msg.kind === "bars") {
      cachedBars = msg.bars;
      cachedVersion = msg.version;
      return;
    }
    const { id, name, version, inputs } = msg;
    if (!cachedBars || version !== cachedVersion) {
      // Ordered single-worker delivery means the matching `bars` always arrives
      // first; a mismatch is a protocol slip — surface it so the caller falls back.
      scope.postMessage({ id, ok: false, error: `stale bars version ${version} (have ${cachedVersion})` });
      return;
    }
    const def = registry.get(name);
    if (!def) {
      scope.postMessage({ id, ok: false, error: `unknown indicator: ${name}` });
      return;
    }
    try {
      const result = def.calculate(cachedBars, inputs);
      scope.postMessage({ id, ok: true, result });
    } catch (err) {
      scope.postMessage({ id, ok: false, error: err instanceof Error ? err.message : String(err) });
    }
  };
}

// When loaded as an actual module Worker, `self` is the DedicatedWorkerGlobalScope.
// Guarded so importing this file on the main thread (e.g. for builtinIndicatorNames)
// is a no-op.
declare const self: WorkerScope & { window?: unknown } & Record<string, unknown>;
if (typeof self !== "undefined" && typeof (self as { window?: unknown }).window === "undefined" && typeof self.postMessage === "function") {
  installIndicatorWorker(self);
}
