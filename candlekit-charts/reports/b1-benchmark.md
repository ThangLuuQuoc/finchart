# B1 Web-Worker offload — measured (A2)

> Numbers, not claims. Produced by the in-browser harness
> [`examples/indicators/b1bench.ts`](../examples/indicators/b1bench.ts) (`window.__b1bench(opts)`),
> driven via a Claude Preview session on the `indicators` Vite app. Chromium,
> dev build, 50 000 deterministic bars (`generateBars`), median of 7 runs after a
> warm pass. Numbers are machine-relative — the **ratios** are the takeaway, not
> the absolute ms.

## What was measured

For a full-history batch recompute of K built-in indicators over N bars:

| Metric | Meaning |
|---|---|
| **syncBlock** | main-thread time the synchronous path blocks = the jank B1 aims to remove |
| **workerMainThread** | main-thread time the worker path costs = K × structured-clone of `bars` through `postMessage` (the **offload tax**) + result apply |
| **workerWall** | wall-clock until all K results return (off-thread compute + clone) |
| reduction | `syncBlock / workerMainThread` — >1 means B1 removes jank; <1 means B1 makes it worse |

## Results (50 000 bars, median of 7)

| Indicators | K | syncBlock (ms) | workerMainThread (ms) | workerWall (ms) | reduction | verdict |
|---|---|---|---|---|---|---|
| MACD | 1 | 23.9 | 10.5 | 151.6 | **2.28×** | B1 wins |
| EMA + RSI + MACD | 3 | 72.3 | 32.9 | 253.2 | **2.20×** | B1 wins |
| EMA | 1 | 5.0 | 9.9 | 59.4 | **0.51×** | **B1 loses** |
| all 9 built-ins | 9 | 56.1 | 109.2 | 228.8 | **0.51×** | **B1 loses** |

## The finding

**The offload tax is ~10–12 ms per request** — that's the cost of
structured-cloning a 50 000-bar AoS array across the `postMessage` boundary, and
the current `BatchCompute` API pays it **once per indicator** (bars are re-cloned
for every `calculate` call).

So B1 is a net main-thread win **iff** the synchronous compute it removes exceeds
the clone tax it adds:

```
B1 wins  ⟺  Σ compute(indicator) ＞ ~11 ms × K
```

- **Heavy / few indicators** (MACD, or a 3-pack dominated by MACD) → compute
  dwarfs the clone tax → **2.2–2.3× less main-thread blocking**. Real win.
- **Many cheap indicators** (9 built-ins, most are O(n) single-pass like
  EMA/SMA costing <5 ms each) → K clones (≈110 ms) cost **more** than computing
  all of them on the main thread (≈56 ms) → **B1 roughly doubles the jank**.

The common dashboard case — several light overlays — fell in the *losing*
bucket. This is what motivated the **clone-once** fix below (which resolves it).

> `syncLongestTaskMs` came back `0` — the `longtask` PerformanceObserver did not
> fire in the headless preview context. The `syncBlock` timing (wall around the
> synchronous loop) is the reliable block measurement and is unaffected.

## Fix shipped — clone `bars` once (clone-once)

The tax was `K × clone`, not `K × compute`. We collapsed the `K×`: the worker now
caches the bar array under a **version**, posted once per data change; each
`calculate` sends only a tiny `{kind:"calc", name, version}` message referencing
it. The client re-sends `bars` only when the array reference *or* a cheap content
signature (length + last bar OHLC, to catch `bars()`' in-place tick mutation)
changes. (`indicatorWorker.ts` + `batchCompute.ts`; unit test asserts exactly 1
`bars` message across K calls, re-send on change.)

### Results after clone-once (50 000 bars, median, ALL 9 built-ins)

| | before (clone-per-request) | after (clone-once) |
|---|---|---|
| worker main-thread block | **109 ms** (loses to 56 ms sync) | **~0.1–0.4 ms** |
| sync main-thread block | ~250 ms* | ~250 ms* |
| reduction | 0.51× (worse) | **~700–1000×** |

*Steady-state `workerMainThread` excludes the bars clone because the bars are
already cached — i.e. it's the **toggle-an-indicator / recompute-same-bars** cost,
the common case, now ~0 ms on the main thread.

\*The sync absolute (~250 ms for 9 indicators on this headless dev Chromium) is
machine-relative and noisier than the first table's 56 ms cold reading; the
within-run sync-vs-worker ratio is the signal.

**One-time cost:** the first compute after a data change still pays a single
structured-clone of `bars` (~11 ms for 50k bars), then every subsequent recompute
over those bars is ~0 ms main-thread. So even worst-case (data just changed):
~11 ms vs ~250 ms ≈ 22× win; steady-state ≈ 1000×.

**Verdict: B1 + clone-once is a decisive net win across all configurations,
including many cheap indicators.** Built-in offload can be enabled by default.

### Still worth doing (B2)

The remaining ~11 ms one-time clone is a structured-clone of AoS objects. **B2 —
columnar SoA + `Transferable`** (post bar columns as `Float64Array`s and *transfer*
the buffers, zero-copy) would drive even that to ~0. No longer a prerequisite for
B1 to win (clone-once already fixed that) — just an incremental cut of the
one-time cost.

## On comparing against TradingView (the other half of A2)

A rigorous automated "tick→pixel on TV vs us" was **not** done, and is not
reliably automatable:

- TV's chart is closed — no hook to inject a known tick or read when the
  corresponding pixel commits.
- Cross-origin: we can't read `performance`/long-task entries off the TV page
  from our harness.
- The corporate network blocks several market endpoints (see project memory),
  so a stable TV data feed for an apples-to-apples symbol/timeframe isn't a given
  here.

What *is* sound is the above: instrumenting **our** pipeline precisely, because we
control the code. A TV number, if needed, would be a **manual** stopwatch/Frame-
timeline observation, reported as such — not a harness output. We will not
publish a "faster than TV" claim without that, per the roadmap's measurement
rule.
