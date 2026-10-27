/**
 * BatchCompute — pluggable backend for an indicator's full-history
 * `calculate(bars, inputs)` (B1). The {@link IndicatorController} routes its
 * batch recompute through this so the heavy O(history) pass can run off the
 * main thread.
 *
 * Two backends ship:
 *   - {@link mainThreadCompute}: calls the registry directly (the historical,
 *     synchronous behaviour — used as the default and the fallback).
 *   - {@link createWorkerCompute}: posts to an injected Worker for built-in
 *     indicators; everything else reports `supports(name) === false` so the
 *     controller transparently falls back to the main thread.
 *
 * The Worker is INJECTED (like the repo's compile/storage fns) so core stays
 * free of bundler-specific `new Worker(new URL(...))` magic and the client is
 * unit-testable against a fake worker.
 */
import type { IndicatorBar, IndicatorResult } from "../types";
import type { IndicatorRegistry } from "../registry";
import type { ComputeRequest, ComputeResponse } from "./indicatorWorker";

export interface BatchCompute {
  /** True when `calculate` resolves off the main thread. */
  readonly async: boolean;
  /** Whether this backend can compute the named indicator (worker: built-ins only). */
  supports(name: string): boolean;
  /** Compute the full series for `name` over `bars`. Rejects on unknown/failed. */
  calculate(name: string, bars: IndicatorBar[], inputs?: Record<string, unknown>): Promise<IndicatorResult>;
  /** Release the worker (if any). */
  dispose(): void;
}

/** Synchronous backend: the registry on the main thread. Supports every def it holds. */
export function mainThreadCompute(registry: IndicatorRegistry): BatchCompute {
  return {
    async: false,
    supports: (name) => registry.has(name),
    calculate(name, bars, inputs) {
      const def = registry.get(name);
      if (!def) return Promise.reject(new Error(`unknown indicator: ${name}`));
      try {
        return Promise.resolve(def.calculate(bars, inputs));
      } catch (e) {
        return Promise.reject(e instanceof Error ? e : new Error(String(e)));
      }
    },
    dispose() {
      /* nothing to release */
    },
  };
}

/** Minimal structural Worker shape (the browser `Worker` satisfies it). */
export interface WorkerLike {
  postMessage(msg: ComputeRequest): void;
  onmessage: ((e: { data: ComputeResponse }) => void) | null;
  onerror?: ((e: unknown) => void) | null;
  terminate(): void;
}

export interface WorkerComputeOptions {
  /** The compute worker (e.g. `new Worker(new URL("./indicatorWorker.ts", import.meta.url), {type:"module"})`). */
  worker: WorkerLike;
  /** Built-in indicator names the worker can handle (see `builtinIndicatorNames`). */
  supportedNames: Iterable<string>;
}

/**
 * Worker-backed backend. Correlates replies by request id; a worker-level error
 * rejects all in-flight requests so the controller can fall back.
 */
/**
 * Cheap content signature over the bar array. candlekit's `bars()` mutates its
 * cache in place (append one / replace last), so reference equality alone can't
 * tell whether the worker's cached copy is stale — fold in length + last bar's
 * OHLC to catch both the append and the replace-last cases.
 */
function barsSignature(bars: IndicatorBar[]): string {
  const n = bars.length;
  if (n === 0) return "0";
  const l = bars[n - 1]!;
  return `${n}:${l.time}:${l.open}:${l.high}:${l.low}:${l.close}`;
}

export function createWorkerCompute(opts: WorkerComputeOptions): BatchCompute {
  const { worker } = opts;
  const supported = new Set(opts.supportedNames);
  const pending = new Map<number, { resolve: (r: IndicatorResult) => void; reject: (e: Error) => void }>();
  let seq = 0;
  let disposed = false;
  // Bars cache: post the array once per data change, then reference by version.
  let lastBars: IndicatorBar[] | null = null;
  let lastSig = "";
  let barsVersion = 0;

  /** Ensure the worker holds the current bars; return the version to calc against. */
  const ensureBars = (bars: IndicatorBar[]): number => {
    const sig = barsSignature(bars);
    if (bars === lastBars && sig === lastSig) return barsVersion;
    lastBars = bars;
    lastSig = sig;
    barsVersion++;
    worker.postMessage({ kind: "bars", version: barsVersion, bars });
    return barsVersion;
  };

  worker.onmessage = (e) => {
    const msg = e.data;
    const p = pending.get(msg.id);
    if (!p) return;
    pending.delete(msg.id);
    if (msg.ok) p.resolve(msg.result);
    else p.reject(new Error(msg.error));
  };
  if ("onerror" in worker) {
    worker.onerror = (err) => {
      const e = err instanceof Error ? err : new Error("indicator worker error");
      for (const p of pending.values()) p.reject(e);
      pending.clear();
    };
  }

  return {
    async: true,
    supports: (name) => !disposed && supported.has(name),
    calculate(name, bars, inputs) {
      if (disposed) return Promise.reject(new Error("compute worker disposed"));
      const id = ++seq;
      return new Promise<IndicatorResult>((resolve, reject) => {
        pending.set(id, { resolve, reject });
        try {
          const version = ensureBars(bars);
          worker.postMessage({ kind: "calc", id, name, version, inputs });
        } catch (e) {
          pending.delete(id);
          reject(e instanceof Error ? e : new Error(String(e)));
        }
      });
    },
    dispose() {
      disposed = true;
      for (const p of pending.values()) p.reject(new Error("compute worker disposed"));
      pending.clear();
      try {
        worker.terminate();
      } catch {
        /* already gone */
      }
    },
  };
}
