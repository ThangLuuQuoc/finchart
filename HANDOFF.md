# FinChart — Hand-off tạm (2026-06-15)

> Doc bàn giao nhanh để phiên sau tiếp tục không mất mạch. Chi tiết kiến trúc/quyết định nằm trong các `*-PLAN.md` và memory. Đây là **trạng thái sống** tại thời điểm milestone "v1 transpiler — VP render".

## Backup gần nhất
- `D:\2026\Temp\FinChart-Backups\FinChart_2026-06-15_1034_v1-transpiler-vp-render.zip` (25.3 MB)
- Chạy lại: `.\backup.ps1 -Tag "<mốc>"` (loại trừ node_modules/dist/.git; staging → zip).

## Đang ở đâu (milestone hiện tại)
Pipeline **paste Pine → chạy trên chart** đã thông cho script drawing-based thật:
- `parse → analyze (semantic) → generate (codegen TS) → ts.transpile → Blob import → chạy trên candlekit`.
- **Volume Profile (VPM v6 mtf, © Alpha_Wizard) render được**: 97 boxes + 5 lines, histogram màu hiện đúng trên chart BTC. Verify thật trong browser (preview tools).
- Tests: pine-parser (codegen 16 golden + diag) + pine-rt — xanh.

### 3 bug "màn hình trống" đã sửa (ghi để không tái phạm)
1. **codegen enum-namespace** → emit string literal thay vì identifier trần (`xloc.bar_index`, `format.mintick`, `*.style_solid`, `size.tiny`, position/text/font/barmerge…). `codegen.ts` ~dòng 866.
2. **BarHistory capacity** → đọc `max_bars_back` từ `indicator()` (semantic.ts); cap = `max(historyDepth+10, maxBarsBack, 60)`. Trước đó dynamic-index chỉ set 500 → NaN coords.
3. **★ ROOT CAUSE ★** — sai API LWC v5 trong example primitive: `series.priceScale().priceToCoordinate()` KHÔNG tồn tại → throw mọi box/line. ĐÚNG: `series.priceToCoordinate(price)`. File: `candlekit-charts/examples/pine-transpiler/main.ts` (đã fix 3 chỗ).

## Cách verify lại trong browser
- Server: `launch.json` config `pine-transpiler` (đã đổi port → **5185**, lần restart sau mới áp dụng; phiên này đang reuse **5186**).
- `preview_start("pine-transpiler")` → mở `http://localhost:518x/`.
- Nạp script: `fetch('/@fs/<abs path .pine>')` (vite `fs.strict:false`) → set vào Monaco → bấm Run.
- Kiểm chứng: `window.PineRT.activeDrawings.boxes.size`, `window.__coordTest(price, barIndex)`.
- Script KHÔNG có `plot()` → chỉ render qua `activeDrawings` (PineDrawingsPrimitive vẽ canvas).

## Phase 0 DONE (15/06/2026) — metadata codegen + 4 bug fix
Chi tiết: `INDICATOR-MENU-PLAN.md` (Phase 0) + memory. Tóm tắt:
- ✅ const-hoist `o_volume` (module const lên module scope trước `_inputs`).
- ✅ `var` runtime-init hoãn vào bar đầu (`if(!_varsInit){…}`).
- ✅ stub `chart.*`; source-input defval emit tên series ("close").
- ✅ `meta.inputs` giàu (type/min/max/step/options/group/tooltip/inline) + `meta.plots` (color/lineWidth/style).
- ✅ 27/27 test pass; VP vẫn 97 boxes finite.
- **VSA full**: parse+compile+load OK; chặn ở `data is not defined` = **map/UDT → v2** (KHÔNG còn là bug v1).

## Phase 1 DONE (15/06/2026) — cây cầu Pine → IndicatorDef
- Codegen đổi sang **`createInstance(overrides)` factory**: state (ta instances, var, _hist) + `onBar` trong closure, `_inputs` shadow per-instance. Map 1:1 `streaming(inputs)` candlekit. `meta`+`_inputs` defaults vẫn module-level. Verify browser: RSI "Success!" + line render, settings form đọc meta giàu.
- Package mới **`finchart/packages/pine-adapter`** — `pineModuleToIndicatorDef(mod, opts)` → IndicatorDef (category/inputConfig/plotConfig/defaultInputs/streaming/calculate/source/tags). KHÔNG đụng candlekit/src (mirror type structural).
- 5/5 test: metadata; streaming khớp pine-rt Rsi từng bar; **instance độc lập**; calculate batch; VP overlay sinh boxes. pine-parser 27/27.
- ~~Limitation v1: `peek` mutate state~~ → **FIXED (B3, 16/06)**: codegen peek-mode. Drawing render pane React = follow-on.

## Phase 2 DONE (15/06/2026) — registry hợp nhất + Pine source store
- candlekit `IndicatorDef` thêm `source?`/`tags?`/`description?` (optional; absent=builtin). `indicators-tv` set `source="tv"`. Typecheck candlekit OK.
- `pine-adapter/src/store.ts` — `PineIndicatorStore(compile, storage, opts)`: add/remove/list/buildDefs/registerInto. compile + storage injectable (`memoryStorage`/`localStorageStorage`). 7 test, tổng pine-adapter 12/12.

## Phase 3.1+3.2 DONE (15/06/2026) — IndicatorModal shell + favorites
- `candlekit-charts/src/react/IndicatorModal.tsx` (export qua barrel react) — modal kiểu TradingView: sidebar nhóm (Yêu thích/Gần đây/Chỉ số kỹ thuật/TradingView/Pine của tôi theo `def.source`), tabs (Các chỉ báo/Chiến lược/Hồ sơ/Mô hình; v1 chỉ indicators+patterns có data), search (span toàn bộ), list + ngôi sao favorite + badge cat/PINE/TV + ✓ active. "Thêm Pine script" qua **callback prop `onAddPineScript`** (candlekit KHÔNG import pine-adapter — invariant). Favorites/Recents localStorage (`finchart.ind.favorites`/`.recents`).
- CSS `.ck-im-*` trong styles.css, dùng biến `--ck-*` → tự light/dark theo `[data-theme]`/`.dark`.
- Demo: `examples/indicators/main.tsx` (port 5190, đã npm install) — thêm IndicatorModal + theme toggle. **Verify browser cả light+dark**: sidebar 9 builtin, search lọc đúng, ★→localStorage, ✓ trên EMA/RSI.

## Phase 3.3 DONE (15/06/2026) — "Thêm Pine script" + wiring store (browser)
- `examples/indicators/vite.config.ts`: thêm alias `@finchart/pine-rt|pine-parser|pine-adapter` → src. `compile.ts`: **sync** compile (ts.transpile + new Function + inject PineRT — KHÔNG Blob async, để khớp `onAddPineScript` đồng bộ). `main.tsx`: `PineIndicatorStore(compilePine, localStorageStorage())`, seed 2 Pine (EMA Ribbon overlay + Momentum oscillator), register vào registry builtin, `onAddPineScript = store.add → registry.register → sync`.
- **Verify browser (functional, console sạch)**: "Pine của tôi" = 3 (2 seed + 1 paste runtime "WMA Test"), badge PINE; bật EMA Ribbon → active ✓ trên chart (Pine → indicator thật qua bridge→store→registry→controller); flow "Thêm Pine script" paste→compile→appear chạy hoàn chỉnh, persist localStorage.
- **Caveat tooling**: `preview_screenshot` timeout khi chart có indicator streaming (lightweight-charts rAF liên tục → tool chờ idle quá hạn); page vẫn phản hồi eval, không lỗi. Verify bằng eval assertions thay screenshot.

## Phase 3.4 DONE (15/06/2026) — quick panel + shared prefs (Phase 3 HOÀN TẤT)
- `src/react/indicatorPrefs.ts` — shared store favorites/recents (localStorage + `useSyncExternalStore`), hook `useIndicatorPrefs()`. IndicatorModal refactor dùng store này (bỏ state cục bộ).
- `src/react/IndicatorQuickPanel.tsx` — panel quick-toggle Favorites ∪ Active, nhóm OVERLAYS/OSCILLATORS/PATTERNS, checkbox + ★. Export qua barrel. CSS `.ck-iq-*`.
- Example dùng 2-view: IndicatorModal (trái, catalog) + IndicatorQuickPanel (phải, quick). **Verify browser**: quick panel hiện EMA/RSI active; star MACD trong modal → quick panel cập nhật NGAY (shared store sync). candlekit typecheck OK.

## Phase 4 DONE (15/06/2026) — IndicatorSettingsDialog (Inputs/Style)
- `IndicatorController`: thêm `setStyle(name, plotId, {color,lineWidth,lineStyle,visible})` + `applyStyle` (applyOptions tại chỗ, không recompute); `ActiveIndicator.styles` (types.ts `PlotStyle`); render honor styles (color/lineWidth/visible/lineStyle); preserve styles qua add().
- `src/react/IndicatorSettingsDialog.tsx` (controlled `{name,onClose}`, export barrel) — tab **Đầu vào** (number/dropdown/**source select** close/open/.../volume/color/bool theo InputConfig.type, nhóm theo group) + tab **Kiểu hiển thị** (per-plot color/width/lineStyle/visibility). Gear ⚙ trên row active ở IndicatorModal + IndicatorQuickPanel mở dialog (prop `onOpenSettings`). CSS `.ck-set-*`.
- **Verify browser**: gear EMA → dialog; Length=50 round-trip qua add/getActive; Style tab color+width+lineStyle+visibility, tắt visibility OK; chỉ cảnh báo createRoot HMR (benign). candlekit **63/63 test pass**, typecheck OK.
- ~~Chưa làm (4.3): source plumbing~~ → **DONE (A3, 16/06)**: `src/indicators/source.ts`; 6 indicator dựa-giá (SMA/EMA/WMA/Bollinger/RSI/MACD) thêm input `type:"source"` + dùng nguồn trong calculate & streaming. VWAP/ATR/Stochastic giữ OHLC. 66/66 test. (Pine runtime source→series vẫn để sau.)

## Phase 5 DONE (15/06/2026) — ChartLegend (PLAN HOÀN TẤT)
- `IndicatorController`: `subscribe(listener)` multi-subscriber + `emitChange()` (thay 5 chỗ onChange) + `legendModel()` (per active: shortTitle/paramsLabel/category + plots[{id,color,visible,series}]). Type `LegendEntry`/`LegendPlot` export.
- `src/react/ChartLegend.tsx` (export barrel) — overlay: mỗi indicator 1 dòng shortTitle + params + giá trị live (đọc `controller.getChart().subscribeCrosshairMove` → param.seriesData; fallback last value) + 👁 (setStyle visible toàn plot) + ⚙ (onOpenSettings) + ✕ (remove). CSS `.ck-leg-*`, actions hiện khi hover.
- **Verify browser**: legend hiện EMA(21)=111.10 + RSI(14)=52.04; ✕ xoá RSI → còn EMA (subscribe re-render); ⚙ → mở settings dialog. candlekit 63/63 pass + typecheck OK.

## ✅ INDICATOR-MENU-PLAN HOÀN TẤT (Phase 0–5)
Menu add-indicator kiểu TradingView full + tích hợp Pine + 2-view + settings + legend, light/dark. Demo `examples/indicators` port 5190. 39 test finchart + 63 candlekit.

## A1 DONE (16/06/2026) — Menu vào workspace ChartPanel thật
- `indicatorRegistry.ts`: thêm `setWorkspaceAddPineScript`/`getWorkspaceAddPineScript` (lưu function, candlekit KHÔNG import pine-adapter). Export qua workspace barrel.
- `ChartPanel.tsx`: thay IndicatorPicker bằng `IndicatorModal` (pill) + `ChartLegend` + `IndicatorSettingsDialog` (state settingsName), `onAddPineScript` từ registry handler.
- `examples/workspace`: `pineSetup.ts` (compile sync + PineIndicatorStore + seed 2 + setWorkspaceAddPineScript), vite alias `@finchart/*`, gọi setupWorkspacePine trước setWorkspaceIndicatorRegistry. Port 5191.
- **Verify browser**: workspace 2 pane, sidebar **Chỉ số kỹ thuật 9 · TradingView 398 · Pine của tôi 2**, legend + "Thêm Pine script". candlekit 63/63 + typecheck OK.
- **Bẫy tooling**: preview iframe hay mount ở 0-width → FlexLayout không render pane; fix bằng `window.dispatchEvent(new Event('resize'))` qua eval. KHÔNG phải bug sản phẩm.
- **TODO polish (đã thử & revert)**: render modal/dialog overlay full-window — `createPortal(…, document.body)` **lỗi trong FlexLayout** ("Target container is not a DOM element", nghi duplicate react-dom qua vite alias). Hiện overlay `position:fixed` bị giới hạn trong pane (chật ở split view). Fix đúng sau: dedupe react-dom trong vite, hoặc portal vào 1 overlay-root do ChartView cung cấp (không phải document.body).

## Cherry-pick upstream (16/06/2026) — PointMarker + toState/loadState
So sánh `Temp/candlekit-charts-main` (commit 9424611) vs fork ta: upstream **không cải tiến** ChartController/builtin/types/IndicatorPicker; KHÔNG merge PR streaming của ta; vẫn RSI sai chuẩn TV → **ta đi trước**. Chỉ lấy 2 thứ:
- **PointMarker** (`measurement/PointMarkerController.ts` + `PointMarkerPrimitive.ts` copy verbatim) — Ctrl+click thả marker dọc + recenter + phát event `pointMarker` (sync nhiều pane). Wiring: `index.ts` export, `plugins/types.ts` event, `ChartView.tsx` prop `pointMarker?`, `context.ts` field. Bật trong workspace ChartPanel + demo indicators. **Verify browser: Ctrl+click → marker dọc hiện + recenter.**
- **`toState()`/`loadState()`** trên IndicatorController (kèm `styles` của ta) — serialize/restore bộ indicator (persist setup).
- candlekit 63/63 + typecheck OK. KHÔNG rebase (upstream không có gì khác đáng lấy).
- **Follow-up tùy chọn**: nối `pointMarker` bus → SyncEngine để marker mirror across linked panes (giờ mới per-pane).

## C1 DONE đầy đủ (18/06/2026) — drawing-based Pine route từ menu workspace
- `pine-adapter`: thêm `isDrawingBasedPine(mod)` (meta.plots rỗng sau khi bỏ hline/bgcolor/barcolor/fill → drawing-based). Export qua barrel. +2 test classifier (RSI→false, VP→true).
- candlekit `indicatorRegistry.ts`: `AddPineScriptHandler` thêm tham số `ctx?: PineAttachContext` (`{controller:{use(plugin):unknown}}` — structural, candlekit KHÔNG import pine-adapter, giữ invariant). `ChartPanel.tsx`: bind `apiRef.current.controller` của pane vào handler trước khi truyền IndicatorModal (IndicatorModal vẫn gọi 1-arg, không đổi).
- `examples/workspace/pineSetup.ts`: handler compile-once để phân loại → drawing-based + có ctx → `ctx.controller.use(pineDrawingsPlugin(mod, {id:meta.name}))` gắn vào pane đang mở; series-based → store.add + registry.register (như cũ).
- **Verify**: 17/17 adapter test (gồm classifier 2 chiều); candlekit typecheck sạch; workspace mount **0 console error**. Pixel: FlexLayout 0-width trong headless (innerW/H=0) + LWC rAF chặn screenshot → không chụp được, **tooling không phải bug** (đường `controller.use`→render đã chứng minh ở examples/indicators với VP 97 boxes).

## B1 DONE v1 (18/06/2026) — Web Worker offload cho batch compute built-in
- **Files mới** `src/indicators/compute/`: `indicatorWorker.ts` (worker entry — `createBuiltinRegistry` chạy `def.calculate` theo message; `installIndicatorWorker(scope)` tách ra để test với fake scope; `builtinIndicatorNames()`; self-guard chỉ install khi là worker global) + `batchCompute.ts` (`BatchCompute` interface; `mainThreadCompute(registry)` = sync fallback; `createWorkerCompute({worker,supportedNames})` inject `WorkerLike`, correlate theo id, `onerror`/`dispose` reject in-flight).
- **IndicatorController**: opt `compute?: BatchCompute`. `refresh()` dispatch: async backend → `refreshWithBackend` (pre-await các def `supports()`, unsupported → `def.calculate` main thread; `refreshEpoch++` mỗi refresh, kết quả của epoch cũ bị bỏ → chống stale clobber); sync/absent → `runRefresh` với `getResult=def.calculate` (đường cũ **không đổi hành vi**). 2 call-site calculate trong refresh refactor thành `getResult(...)`. **Invariant giữ**: built-in pure (registry/streaming/source/types/renderWindow KHÔNG import LWC/DOM → worker import được); core không thêm bundler magic (worker INJECT từ app).
- **Barrel**: core `src/index.ts` export `mainThreadCompute/createWorkerCompute/builtinIndicatorNames` + types.
- **Demo** `examples/indicators/main.tsx`: `makeIndicatorCompute()` tạo `new Worker(new URL("../../src/indicators/compute/indicatorWorker.ts", import.meta.url), {type:"module"})` (try/catch → null = fallback sync), truyền `{compute}` vào IndicatorController.
- **Verify**: candlekit typecheck sạch · **73/73 test** (7 batchCompute: sync backend, worker round-trip qua logic thật, concurrent-id correlate, unknown reject, dispose) · browser indicators: EMA+RSI render off-thread (7 canvas, 0 console error, log `[B1] worker`). Worker reply đã được chứng minh (await không resolve thì indicator không render — chúng render).
- **Scope v1 (cố ý)**: chỉ offload **batch `calculate` của built-in**. Streaming tick (`onBar`/`streamTick`) + `makeStream` warm giữ main thread (đã O(window) rẻ; round-trip per-tick sẽ phá lợi đó). Pine/TV → `supports()=false` → main thread. Chưa benchmark đối chứng (A2). **Vite worker URL** dùng path tương đối tới src; nếu đổi vị trí example phải chỉnh.

## A2 DONE (18/06/2026) — benchmark harness + phát hiện B1 lỗ với indicator rẻ
- **Harness** `examples/indicators/b1bench.ts` (`window.__b1bench(opts)` — dev-only, wired trong main.tsx): đo main-thread block của batch recompute, sync backend vs worker, 50k nến deterministic, median 7 run. Metric: syncBlock (jank không B1) · workerMainThread (tax clone bars qua postMessage) · workerWall (off-thread). Drive bằng Claude Preview eval.
- **Phát hiện (số đo, Chromium dev):** clone tax ≈ **11ms/indicator** (mỗi `calculate` re-clone bars). B1 thắng ⟺ Σcompute > ~11ms×K. MACD(1): 23.9→10.5ms (2.3×✓). EMA+RSI+MACD(3): 72.3→32.9 (2.2×✓). **EMA(1): 5→9.9ms (0.51× ✗). 9 built-in: 56→109ms (0.51× ✗).** → **B1 clone-per-request LỖ với nhiều indicator rẻ (ca dashboard phổ biến)**; chỉ thắng khi compute nặng/ít.
- **Kết luận actionable → ĐÃ FIX (clone-once, 18/06):** worker cache bars theo `version` (message `{kind:"bars",version,bars}` gửi 1 lần); request `{kind:"calc",name,version}` chỉ tham chiếu. Client `ensureBars()` re-send chỉ khi ref đổi HOẶC signature đổi (length + last-bar OHLC — bắt mutation in-place của `bars()`). Worker error nếu version mismatch (ordered delivery nên không xảy ra; fallback an toàn). Unit test: đúng 1 message `bars` qua K calls, re-send khi đổi. **Kết quả sau fix:** ALL9 50k → worker main-thread **~0.3ms** vs sync ~250ms (**~700–1000×**); EMA(1) cũng thắng. **B1 net-win mọi cấu hình → bật mặc định OK.** One-time clone ~11ms/data-change còn lại → B2 (transferable SoA) cắt nốt (B2 KHÔNG còn là tiền đề). 8/8 batchCompute test. Chart live (EMA+RSI qua worker) render OK với protocol mới.
- **Đối chứng TV:** không tự động hoá tin cậy được (chart đóng/không inject tick/cross-origin/corp net) — ghi rõ, không bịa số. Report: `candlekit-charts/reports/b1-benchmark.md`.
- `syncLongestTaskMs=0`: longtask PerformanceObserver không fire trong headless preview (tooling); syncBlock (wall quanh vòng sync) vẫn là số block tin cậy.

## E2E pipeline verify (18/06/2026) — paste Pine → chart, qua controller-có-worker
- Harness `window.__pineE2E(src)` + `window.__ctl` trong examples/indicators/main.tsx (dev-only, cạnh `__b1bench`): chạy đúng code path onAddPineScript (store.add + registry.register) rồi `ctl.add(name)` trên controller ĐÃ gắn worker compute.
- **Verify (browser):** paste series RSI Pine → toàn chuỗi parse→analyze→generate→transpile→`pineModuleToIndicatorDef`→register→activate→`refreshWithBackend`. Pine def `supports()=false` → **fallback def.calculate main-thread** (đúng thiết kế B1) → series `_plot_1` với **1486 điểm, giá trị RSI 0-100 hợp lệ** (44–55), legendModel hiện 3 indicator (EMA, RSI builtin, E2E Pine RSI). Phủ chính nhánh async controller + Pine-fallback mà unit test không chạm được. Chỉ cảnh báo createRoot HMR (benign).
- **Lưu ý UI:** preview synthetic click KHÔNG mở được IndicatorModal (`.ck-im-trigger`) — nghi cần pointer event thật / portal; đã drive bằng harness window thay vì click. (Tooling, không phải bug modal — modal chạy tay OK ở các phiên trước.)

## TODO còn lại (out of plan-scope, ghi để nhớ)
- **Pine runtime source→series**: built-in đã xong (A3); riêng Pine `input.source` trong transpiled code chưa map sang series thật.
- ~~**Drawing-based Pine (VP) render trong pane React**~~ → **DONE (C1, 18/06)**: cả cơ chế (PineDrawingsPlugin) lẫn route từ menu workspace. Drawing-based script add từ workspace KHÔNG persist qua reload (không phải IndicatorDef trong store) — chấp nhận v1.
- ~~Pine `peek` mutate state~~ → **DONE (B3)**: codegen sinh `onBar(…, commit=true)`; closure `_commit` → ta call `[_commit?"next":"peek"]`; `_hist` snapshot/restore khi peek (BarHistory thêm snapshot/restore). Var/array/drawing mutations trong peek vẫn commit (chấp nhận — script drawing thường barstate.islast, peek 1 lần). Test: peek idempotent + khớp `Rsi.peek`, commit sau peek khớp `Rsi.next`. 29 pine-parser + 12 adapter + 21 rt.
- **MTF** (timeframe.change…) → VP theo period (v1.5).
- **Wiring vào React workspace ChartPanel** (hiện demo ở examples/indicators).
- **VSA full**: map/UDT (v2).
- **Push PR #1/#2** candlekit (user tự làm).

## Giới hạn v1 (out of scope — đã stub, đừng tưởng là bug)
- **MTF**: `timeframe.change`/`in_seconds` stub (`false`/`86400`), `time(tf,session,tz)`≈bar.time, `request.security`→NaN.
  → Volume Profile theo period chỉ render **developing profile ở bar cuối** (`barstate.islast`), KHÔNG render chuỗi confirmed profiles lịch sử như ảnh TradingView. Đó là v1.5 (cần resample HTF + phát hiện mốc ngày/tuần/tháng từ timestamp; `bar.time` candlekit dùng `.ts`).
- `table`/`linefill`/`polyline`/`strategy` → stub an toàn (`null`), KHÔNG render. Chỉ box/line/label hiện.

## Việc khác còn treo
- **Push PR #1 (feat/streaming-indicators) + PR #2 (feat/windowed-indicator-rendering)** lên candlekit-charts — **user tự push** (máy không có gh/auth). Body + patch sẵn ở `PR-streaming-indicators.md`, `PR2-windowed-rendering.md`, `patches/`.
- KHÔNG đưa `pine-rt` làm dependency upstream (invariant "no third-party indicator runtime").
