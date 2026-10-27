/**
 * B1 — off-main-thread batch compute. Exercises both backends:
 *   - mainThreadCompute against the real built-in registry, and
 *   - createWorkerCompute through a FAKE worker that runs the real worker
 *     install logic (installIndicatorWorker) on the other end, so the full
 *     request→compute→response round-trip is covered without a real Worker.
 */
import { describe, it, expect } from "vitest";
import { createBuiltinRegistry } from "../src/indicators/builtin";
import type { IndicatorBar } from "../src/indicators/types";
import { mainThreadCompute, createWorkerCompute, type WorkerLike } from "../src/indicators/compute/batchCompute";
import {
  installIndicatorWorker,
  builtinIndicatorNames,
  type WorkerScope,
  type ComputeRequest,
  type ComputeResponse,
} from "../src/indicators/compute/indicatorWorker";

function makeBars(n: number): IndicatorBar[] {
  return Array.from({ length: n }, (_, i) => {
    const c = 100 + Math.sin(i * 0.1) * 10;
    return { time: 1000 + i * 60, open: c, high: c + 1, low: c - 1, close: c, volume: 1000 + (i % 50) };
  });
}

/** Bridge a client WorkerLike to a worker scope, both delivering async. */
function makeFakeWorker(): { client: WorkerLike; terminated: () => boolean } {
  let terminated = false;
  const client: WorkerLike = {
    onmessage: null,
    onerror: null,
    postMessage: (req: ComputeRequest) => {
      if (terminated) return;
      queueMicrotask(() => scope.onmessage?.({ data: req }));
    },
    terminate: () => {
      terminated = true;
    },
  };
  const scope: WorkerScope = {
    onmessage: null,
    postMessage: (res: ComputeResponse) => {
      queueMicrotask(() => client.onmessage?.({ data: res }));
    },
  };
  installIndicatorWorker(scope);
  return { client, terminated: () => terminated };
}

const firstBuiltin = () => createBuiltinRegistry().list()[0]!.name;

describe("mainThreadCompute", () => {
  it("is sync-flavoured and supports every registered def", () => {
    const reg = createBuiltinRegistry();
    const c = mainThreadCompute(reg);
    expect(c.async).toBe(false);
    expect(c.supports(firstBuiltin())).toBe(true);
    expect(c.supports("NoSuchIndicator")).toBe(false);
  });

  it("computes a finite series matching the registry def", async () => {
    const reg = createBuiltinRegistry();
    const name = firstBuiltin();
    const c = mainThreadCompute(reg);
    const bars = makeBars(60);
    const res = await c.calculate(name, bars);
    const direct = reg.get(name)!.calculate(bars);
    expect(Object.keys(res.plots)).toEqual(Object.keys(direct.plots));
  });

  it("rejects an unknown indicator", async () => {
    const c = mainThreadCompute(createBuiltinRegistry());
    await expect(c.calculate("Nope", makeBars(10))).rejects.toThrow(/unknown/i);
  });
});

describe("createWorkerCompute (fake worker, real worker logic)", () => {
  it("supports built-ins only and round-trips a compute", async () => {
    const { client } = makeFakeWorker();
    const c = createWorkerCompute({ worker: client, supportedNames: builtinIndicatorNames() });
    expect(c.async).toBe(true);
    const name = firstBuiltin();
    expect(c.supports(name)).toBe(true);
    expect(c.supports("PineThing")).toBe(false); // not a built-in → controller falls back

    const bars = makeBars(80);
    const viaWorker = await c.calculate(name, bars);
    const direct = createBuiltinRegistry().get(name)!.calculate(bars);
    expect(Object.keys(viaWorker.plots)).toEqual(Object.keys(direct.plots));
    const k = Object.keys(viaWorker.plots)[0]!;
    expect(viaWorker.plots[k]!.length).toBe(direct.plots[k]!.length);
  });

  it("correlates concurrent requests by id", async () => {
    const { client } = makeFakeWorker();
    const names = builtinIndicatorNames().slice(0, 3);
    const c = createWorkerCompute({ worker: client, supportedNames: builtinIndicatorNames() });
    const bars = makeBars(50);
    const results = await Promise.all(names.map((n) => c.calculate(n, bars)));
    results.forEach((r, i) => {
      const direct = createBuiltinRegistry().get(names[i]!)!.calculate(bars);
      expect(Object.keys(r.plots)).toEqual(Object.keys(direct.plots));
    });
  });

  it("clones bars ONCE across K calls with the same array, re-sends when bars change", async () => {
    let barsMsgs = 0;
    let calcMsgs = 0;
    const fake = makeFakeWorker();
    // Wrap postMessage to count message kinds without disturbing delivery.
    const inner = fake.client.postMessage.bind(fake.client);
    fake.client.postMessage = (msg) => {
      if ((msg as { kind: string }).kind === "bars") barsMsgs++;
      else calcMsgs++;
      inner(msg);
    };
    const names = builtinIndicatorNames();
    const c = createWorkerCompute({ worker: fake.client, supportedNames: names });

    const bars = makeBars(60);
    await Promise.all(names.map((n) => c.calculate(n, bars))); // same array ref
    expect(calcMsgs).toBe(names.length);
    expect(barsMsgs).toBe(1); // bars cloned across the boundary exactly once

    // Same array, unchanged → still no extra bars message.
    await c.calculate(names[0]!, bars);
    expect(barsMsgs).toBe(1);

    // Mutate the last bar in place (what candlekit's bars() does on a tick) → re-send.
    bars[bars.length - 1]!.close += 1;
    await c.calculate(names[0]!, bars);
    expect(barsMsgs).toBe(2);

    // A brand-new array (data refresh) → re-send.
    await c.calculate(names[0]!, makeBars(61));
    expect(barsMsgs).toBe(3);
  });

  it("rejects an unknown indicator from the worker", async () => {
    const { client } = makeFakeWorker();
    const c = createWorkerCompute({ worker: client, supportedNames: ["Ghost"] });
    await expect(c.calculate("Ghost", makeBars(10))).rejects.toThrow(/unknown/i);
  });

  it("dispose() terminates and rejects in-flight + further calls", async () => {
    const { client, terminated } = makeFakeWorker();
    const c = createWorkerCompute({ worker: client, supportedNames: builtinIndicatorNames() });
    const inflight = c.calculate(firstBuiltin(), makeBars(40));
    c.dispose();
    await expect(inflight).rejects.toThrow(/disposed/i);
    expect(terminated()).toBe(true);
    expect(c.supports(firstBuiltin())).toBe(false);
    await expect(c.calculate(firstBuiltin(), makeBars(10))).rejects.toThrow(/disposed/i);
  });
});
