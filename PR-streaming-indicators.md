# PR draft: feat(indicators): streaming engines for O(window) live ticks

> Branch local: `feat/streaming-indicators` trong `candlekit-charts/` (commit `5c79b53`).
> Patch file: `patches/0001-feat-indicators-streaming-engines-for-O-window-live-.patch`
> Target: `rohanbeingsocial/candlekit-charts` → `main`

## Cách mở PR (chạy một lần)

```powershell
winget install GitHub.cli          # cài gh (nếu chưa có)
gh auth login                      # đăng nhập GitHub (interactive, 1 lần)
cd D:\2026\Temp\FinChart\candlekit-charts
gh repo fork rohanbeingsocial/candlekit-charts --remote --remote-name fork
git push -u fork feat/streaming-indicators
gh pr create --repo rohanbeingsocial/candlekit-charts --base main `
  --title "feat(indicators): streaming engines for O(window) live ticks" `
  --body-file ..\PR-streaming-indicators.md
```

(Nếu không muốn dùng gh: fork trên web → `git remote add fork <url-fork>` → push → mở PR trên web, dán phần body bên dưới.)

---

## PR body (dán từ đây xuống)

### Problem

`IndicatorController.onBar` recalculates every active indicator over the **full bar history** on each live tick — O(history) per indicator per tick — and `bars()` re-maps the whole history into new `IndicatorBar` objects on every call.

Measured on 50,000 real BTCUSDT 15m bars with 5 active indicators (SMA, EMA, Bollinger, RSI, MACD), Chrome, live feed at 30 ticks/s:

- `updateBar` cost: **~39 ms per tick** → main thread saturated, UI at ~1 fps
- Heap grew 52 MB → 704 MB in 8 seconds of ticking (GC churn from the per-tick re-map + recalc allocations)

### Change

1. **Optional `streaming(inputs)` factory on `IndicatorDef`** returning a `StreamingIndicator`:
   - `next(bar)` commits a confirmed bar — O(indicator window), independent of history length;
   - `peek(bar)` previews the in-progress bar **without mutating state** (safe on every intra-bar tick).

   `IndicatorController.onBar` uses it when present: the in-progress bar is previewed via `peek()` and committed exactly once via `next()` when a newer bar arrives. Defs without `streaming` keep the existing batch fallback — fully additive, no breaking changes. Toggling / `onData` still go through `calculate` (unchanged).

2. **Self-contained streaming engines for all 9 builtins** (`src/indicators/streaming.ts`) — original MIT code, no third-party runtime (invariant #3). A parity suite (`tests/streaming-indicators.test.ts`) verifies each engine produces values **identical to its batch `calculate`** bar-for-bar (same warmup start, 1e-9 tolerance), plus peek-never-mutates and commit-on-rollover tests.

3. **Cached `IndicatorBar` conversion** — `bars()` now appends/replaces the last element incrementally on ticks instead of re-mapping the whole history (O(history) allocations per tick eliminated).

4. **RSI warmup fixed to TradingView semantics** — the first change is measured bars 0→1 (`ta.change` is na on bar 0) instead of prepending a synthetic zero change. First defined RSI lands on bar index `length` (was `length − 1`, one bar early with a skewed Wilder seed). Covered by a hand-computed test.

### Results (same scenario as above)

| | before | after |
|---|---|---|
| `updateBar` with 5 indicators on 50k bars | ~39 ms/tick | **~1–9 ms/tick**¹ |
| Indicator math per tick | O(history) ×5 | O(window) ×5 (sub-µs) |
| Per-tick allocations | O(history) re-map | O(1) |

¹ the remaining cost is lightweight-charts' own `series.update()` pipeline, which scales with total series point count — orthogonal to this change.

### Checklist

- [x] `npm run typecheck` ✅
- [x] `npm run lint` ✅
- [x] `npm run test` ✅ (52 tests, incl. new parity suite)
- [x] `npm run build` ✅
- [x] CHANGELOG.md updated (Added / Changed / Fixed)
- [x] No new runtime deps; original MIT code only

### Notes for reviewers

- The parity suite intentionally locks streaming engines to the batch implementations — any future change to a builtin's math must update both, and the test tells you immediately.
- The RSI fix changes output values (one-bar shift + seed). If you prefer to gate it, it can be split into its own PR — say the word and I'll separate it.
- Possible follow-ups (separate PRs): windowed series rendering for large datasets (lightweight-charts `series.update` cost scales with total series length — measured ~+12 ms/frame with 9 × 50k-point series), and a rAF tick-coalescing helper on `ChartController`.
