# PR #2 draft: feat(indicators): windowed rendering for streaming indicator series

> Branch local: `feat/windowed-indicator-rendering` (commit `c11d4e6`), **stack trên `feat/streaming-indicators`** (PR #1).
> Patch: `patches/0001-feat-indicators-windowed-rendering-for-streaming-ind.patch`
> Mở PR #2 với base = nhánh PR #1 (stacked), hoặc đợi PR #1 merge rồi rebase lên main.

## Lệnh (sau khi đã `gh auth login` và push PR #1)

```powershell
cd D:\2026\Temp\FinChart\candlekit-charts
git push -u fork feat/windowed-indicator-rendering
gh pr create --repo rohanbeingsocial/candlekit-charts --base feat/streaming-indicators `
  --title "feat(indicators): windowed rendering for streaming indicator series" `
  --body-file ..\PR2-windowed-rendering.md
```

---

## PR body (dán từ đây xuống)

> Stacked on #<PR1>: builds on the streaming engines (`Managed.stream`, `streamTick`).

### Problem

lightweight-charts' `series.update()` cost scales with the **total point count of the series**, not the visible count. Measured on 50k bars: each live tick cost ~+6.5 ms across 9 indicator plot series even though only ~300 bars were on screen. An experiment capping the rendered tail to 2k points returned per-tick cost to the empty-chart floor (~1.2 ms), confirming the mechanism.

### Change

Streaming-capable indicators now render only the most recent `sizeBars` points (default 5000) per plot series, and **backfill older points automatically** when the user pans toward the rendered edge:

- Pure window policy in `src/indicators/renderWindow.ts` (unit-tested): backfill triggers `guardBars` (default 250) before the rendered edge becomes visible — the user never sees a gap; each extension reaches `expandBars` (default 2500) past the visible edge; **the window never shrinks during a session**, so a full-history pan simply converges to today's render-everything behavior (no regression path).
- `IndicatorController` keeps the full computed points per plot (`Managed.plotAll`) as the backfill source, updated in place as bars close on the streaming path; window extension re-applies the longer slice via `setData`.
- Configure or opt out: `new IndicatorController(registry, { renderWindow: { sizeBars, guardBars, expandBars } | false })`. Batch-only defs (no `streaming`) are untouched and keep full `setData`.

### Results (50k bars, 5 indicators, 30 ticks/s, headless Chrome)

| | per-tick `updateBar` | throughput FPS during ticks |
|---|---|---|
| streaming only (PR #1) | ~8.8 ms | 7.5 |
| streaming + windowed (this PR) | **~2.9 ms** | **22.9** |
| empty-chart floor | ~1.3 ms | 47 |

Backfill verified by programmatically panning to the first bar of a 50k-bar history — all indicator plots (overlay + oscillator panes) fully drawn at the far-left edge.

### Checklist

- [x] `npm run typecheck` / `lint` / `test` (63 tests) / `build` ✅
- [x] CHANGELOG.md updated
- [x] Pure logic unit-tested (`tests/render-window.test.ts`); DOM path validated via example run per repo convention
- [x] Additive only — default behavior visually identical; `renderWindow: false` restores exact current behavior

### Notes for reviewers

- Default ON with `sizeBars: 5000` is a judgment call — happy to flip to opt-in if you prefer conservatism over out-of-the-box perf.
- After a window extension `setData`, the in-progress bar's point can be ~1 tick stale until the next `update()` lands (≤ one tick interval); extension only happens when panning left, away from the live edge.
- Possible follow-up: apply the same policy to the main candle/volume series in `ChartController` (the remaining ~1.3 ms floor) — left out to keep this PR focused on the measured indicator-series cost.
