# Kế hoạch: Menu Add-Indicator kiểu TradingView "full" (React workspace)

> Mục tiêu: nâng `IndicatorPicker` React của candlekit thành trải nghiệm gần TradingView — search + nhóm + favorites/recents, **dialog Settings 2 tab (Inputs/Style)**, **legend trên chart** có nút eye/gear/x, và **gộp Pine script đã transpile vào chung menu** dưới nhóm "My Pine scripts".
>
> Surface: `candlekit-charts/src/react` + `src/react/workspace` (sản phẩm thật). Giữ `examples/pine-transpiler` đồng bộ để test transpiler nhanh.
> Ngày lập: 2026-06-15. Bám theo code đã map (xem cuối doc: "Hiện trạng code").

---

## Bức tranh tổng & feature lõi

Hai hệ indicator đang **rời nhau**:
- **Core React** `IndicatorController` + `IndicatorPicker` chạy trên `IndicatorDef` (registry 9 built-in + ~405 TV qua `indicators-tv`). Render series/pane, KHÔNG biết canvas drawings.
- **Pine-transpiler** (vanilla DOM) — `meta + onBar + _inputs` → `StreamingIndicatorController`; có `PineDrawingsPrimitive` vẽ box/line.

**Feature sát thủ = cây cầu**: biến output pine-parser thành một `IndicatorDef` (có `streaming`) để Pine script xuất hiện chung menu, chung dialog Settings, chung legend với built-in/TV. Mọi thứ khác (favorites/dialog/legend) xây trên `IndicatorDef` nên Pine và built-in dùng chung 1 UI.

```
Pine source ──parse→analyze→generate──► JS module {meta, onBar, _inputs}
                                              │
                                  pineToIndicatorDef()  ◄── CẦU NỐI (Phase 1)
                                              │
                                              ▼
                                        IndicatorDef  ──register──► IndicatorRegistry
                                              │                          │
                              (cùng shape với built-in + TV) ────────────┘
                                              │
                  IndicatorController.add/remove/setColors/setStyle
                                              │
              ┌───────────────┬──────────────┴───────────────┐
        IndicatorPicker   SettingsDialog                 ChartLegend
        (Phase 3)         (Phase 4)                       (Phase 5)
```

---

## Phase 0 — Tiền đề: làm giàu metadata codegen (pine-parser)

Không có bước này thì dialog Settings và bridge thiếu dữ liệu (type input, options dropdown, min/max/step, màu/style plot). Đồng thời sửa bug đang chặn VSA.

**0.1 — Sửa bug const-hoist `o_volume is not defined`** *(đang chặn acceptance VSA)*
- Vấn đề: const option (`o_volume = "📊Volume"`) dùng làm defval `input.string(o_volume,…)` → lift vào `_inputs` ở module scope nhưng const lại emit trong `onBar()`.
- Fix: `semantic.ts` thu thập **top-level const literal/đơn giản** (init không phụ thuộc bar/series); `codegen.ts` emit chúng **trước** `_inputs` ở module scope, bỏ khai báo lại trong `onBar`.
- File: `finchart/packages/pine-parser/src/semantic.ts`, `src/codegen.ts` (block `// ── inputs ──` ~216 + emit body ~573).

**0.2 — Mở rộng `InputInfo`** (semantic.ts:70) thêm: `optionsExpr: Expr[] | null`, `groupExpr`, `tooltipExpr`, `inlineExpr`, `stepExpr`. Bắt từ named args của `input.*` trong `tryExtractInput()` (~184).

**0.3 — Map `fn → type` + emit đủ field vào `meta.inputs`** (codegen.ts:264). Hiện chỉ `{id,fn,defval,title}`. Thêm: `type` (`input.int`→`"int"`, `.float`→`"float"`, `.bool`→`"bool"`, `.string`→`"string"`/`"source"` nếu defval là series, `.color`→`"color"`), `minval/maxval/step`, `options[]`, `group`, `tooltip`, `inline`. → khớp `InputConfig` của candlekit.

**0.4 — Emit `color/style/linewidth` vào `meta.plots`** (codegen.ts:275). Parse args của `plot()`/`plotshape`/`hline`: `color`, `style` (`plot.style_line`/`_histogram`/`_columns`), `linewidth`. Suy ra pane (overlay vs separate) từ `meta.overlay` + có phải oscillator.

**0.5 — Tests pine-parser**: golden cho input giàu metadata (dropdown options, group, source) + plot màu/style; chạy lại VSA diag (kỳ vọng hết `o_volume`).

**Deliverable**: `meta.inputs[]` và `meta.plots[]` đủ giàu để map 1-1 sang `InputConfig`/`PlotConfig`.

---

## Phase 1 — Cây cầu Pine → IndicatorDef (CORE)

**1.1 — `pineToIndicatorDef(source | compiledModule): IndicatorDef`**
- Vị trí đề xuất: package mới `finchart/packages/pine-adapter` (giữ candlekit không phụ thuộc pine-rt — tôn trọng invariant "no third-party indicator runtime"; adapter sống ở app/finchart layer, KHÔNG vào `candlekit-charts/src`).
- Map: `meta.name`→`name/title/shortTitle`; `meta.overlay`→`category` (`overlay`|`oscillator`); `meta.inputs`→`inputConfig[]` (dùng `type`/`defval`/`options`/min/max/step từ Phase 0); `meta.plots`→`plotConfig[]` (id/title/color/style/lineWidth); `_inputs`→`defaultInputs`.
- `streaming(inputs)`: trả `{ next(bar), peek(bar) }` bọc `onBar` + `BarHistory(depth)` + reset `activeDrawings` mỗi instance. Áp `inputs` vào module `_inputs` trước khi chạy.
- `calculate(bars, inputs)`: batch fallback (chạy onBar tuần tự) cho `onData`.

**1.2 — Drawings trong pane React** (cho VP/VSA vẽ box/line)
- Port `PineDrawingsPrimitive` (từ example main.ts) thành primitive tái dùng, gắn vào series của pane khi Pine indicator được add; đọc `activeDrawings` của **instance đó** (cần namespacing drawings theo instance — hiện `activeDrawings` là global Set → phải scope theo indicator id để nhiều Pine cùng lúc không đè nhau).
- API tọa độ LWC v5: `series.priceToCoordinate` (đã chốt từ bug root-cause).
- **Quyết định phạm vi**: v1 cầu nối ưu tiên **plot-based** Pine (RSI/EMA…) chạy ngay; **drawing-based** (VP) là 1.2 follow-on vì cần scope activeDrawings + render canvas trong IndicatorController.

**1.3 — Tests**: RSI Pine qua bridge khớp built-in RSI từng bar; VP Pine qua bridge sinh boxes.

**Deliverable**: 1 dòng `registry.register(pineToIndicatorDef(src))` là Pine script vào chung hệ.

> **✅ DONE (15/06/2026)** — `finchart/packages/pine-adapter`, export `pineModuleToIndicatorDef(mod, opts)`. Codegen đã đổi sang `createInstance(overrides)` factory (state + onBar trong closure, `_inputs` shadow per-instance) → map 1:1 `streaming(inputs)` của candlekit. 5/5 test: metadata mapping; streaming khớp pine-rt Rsi từng bar; **instance độc lập không share state**; calculate batch; VP overlay chạy + sinh boxes. RSI verify thật trong browser (createInstance path, "Success!" + line render). **Limitation v1**: generated `onBar` luôn commit state → `peek` mutate (đúng cho 1-preview/bar; live re-peeks cần codegen "peek mode" sau). Drawing render trong pane React (scope `activeDrawings` theo instance) = 1.2 follow-on.

---

## Phase 2 — Registry hợp nhất + Pine source store

**2.1 — Phân loại nguồn**: thêm (backwards-compat) vào `IndicatorDef`: `source?: "builtin" | "tv" | "pine"`, `tags?: string[]`, `description?: string`. Built-in/TV set sẵn; Pine = `"pine"`.
- File: `candlekit-charts/src/indicators/types.ts`.

**2.2 — Pine source store** (`finchart` app layer): localStorage lưu danh sách `{id, name, source}` Pine scripts user đã thêm. Khi khởi động: compile tất cả → `pineToIndicatorDef` → register vào registry dùng cho workspace.
- Tích hợp `setWorkspaceIndicatorRegistry(createFullIndicatorRegistry() + pine scripts)`.

**2.3 — API store**: `addPineScript(src)`, `removePineScript(id)`, `listPineScripts()`. Compile lỗi → trả error hiển thị trên UI.

**Deliverable**: built-in + TV + Pine cùng 1 registry; Pine persist qua reload.

> **✅ DONE (15/06/2026)**:
> - candlekit `IndicatorDef` thêm `source?`/`tags?`/`description?` (optional, backwards-compat; absent=builtin). `indicators-tv` set `def.source="tv"`. candlekit typecheck OK.
> - `pine-adapter/src/store.ts` — `PineIndicatorStore(compile, storage, opts)`: `add()` (compile+persist, trả def hoặc error), `remove()`, `list()`, `buildDefs()` (compile all, gom lỗi), `registerInto(registry)` (structural, không import candlekit). Compile + storage **injectable**: node dùng new Function, browser dùng ts.transpile+Blob; `memoryStorage()` (test) + `localStorageStorage(key)` (browser).
> - 7 test store: add/persist/dedupe-id/remove/buildDefs/cross-instance-persist/registerInto. Tổng pine-adapter 12/12.

---

## Phase 3 — Modal Add-Indicator kiểu TradingView "full" (KHÔNG phải dropdown)

> **Spec visual đã chốt** (xem mockup widget phiên 2026-06-15): **modal** giữa màn (overlay mờ nền), KHÔNG dùng dropdown nhỏ hiện tại. Layout 2 cột + search + tabs + badge + footer. **Bắt buộc light & dark mode** (theo theme token candlekit). Label tiếng Việt.

> **Kiến trúc 2-view đã chốt (15/06/2026):** panel checkbox OVERLAYS/OSCILLATORS hiện có trong candlekit (xem ảnh demo của user) KHÔNG bị bỏ — nó là **view quick-toggle** thứ hai, song song với modal. Cả hai bind CÙNG một `IndicatorController` (không nhân đôi state — đây là cách TradingView thật làm: panel/legend nhỏ + modal catalog lớn).
> - **Panel checkbox** → thu hẹp nguồn data thành **"Favorites + Đang active"** (thay vì liệt kê toàn bộ registry — sẽ vỡ với 405 TV + Pine). Giữ gần như nguyên, chỉ đổi nguồn list. Ghim ★ ở modal → hiện ở panel.
> - **Modal** → catalog đầy đủ (browse/search/add/Pine/badge). Mở bằng nút "+ Indicators".
> - Settings dialog (Phase 4) + legend (Phase 5) cũng là view trên cùng controller.

Component mới `src/react/IndicatorModal.tsx` (thay/đứng cạnh `IndicatorPicker.tsx`; nút toolbar mở modal). Bố cục:

```
┌─ Chỉ báo, chỉ số và chiến lược ──────────────── 🌙  ✕ ─┐
│ 🔍 Tìm kiếm                                             │
├──────────────────┬──────────────────────────────────────┤
│ CÁ NHÂN          │ [Các chỉ báo] Chiến lược Hồ sơ Mô hình│  ← tabs
│  Tập lệnh của tôi│ TÊN TẬP LỆNH                          │
│  Pine đã thêm    │ ☆ RSI tương đối                       │
│ TÍCH HỢP SẴN     │ ☆ MACD                                │
│ ▸Chỉ số Kỹ thuật │ ★ Volume Profile        [PINE]        │  ← favorite + badge
│  TradingView(405)│ ☆ Volume Spread Analysis [PINE][MTF]  │
│ CỘNG ĐỒNG        │ ☆ Aroon Oscillator      [NEW]         │
│  Biên tập/Hàng đầu│ ☆ Chandelier Exit       [BETA]        │
├──────────────────┴──────────────────────────────────────┤
│ Nhấn ★ để ghim Yêu thích          [+ Thêm Pine script]  │  ← footer
└──────────────────────────────────────────────────────────┘
```

**3.1 — Sidebar trái phân nhóm** (thay tab phẳng cũ):
- `CÁ NHÂN`: "Tập lệnh của tôi" / "Pine đã thêm" (nhóm `source:"pine"`).
- `TÍCH HỢP SẴN`: "Chỉ số Kỹ thuật" (9 built-in) / "TradingView (405)" (catalog).
- `CỘNG ĐỒNG`: Biên tập viên chọn / Hàng đầu / Xu hướng — **v2** (cần community Pine corpus); v1 ẩn hoặc placeholder.

**3.2 — Tabs phải**: Các chỉ báo / Chiến lược / Hồ sơ / Mô hình. v1 chỉ "Các chỉ báo" có data (map `category`); Chiến lược=strategy Pine (v2), Mô hình=pattern category. Tab rỗng hiện trạng thái trống.

**3.3 — List rows**: tên (i18n VI) + **badge** (`PINE`/`MTF`/`NEW`/`BETA`/`UPDATED` từ `tags`) + **ngôi sao favorite** trái. Click row = add ngay. Hỗ trợ light/dark qua CSS var theme. **Virtualize** khi >100 mục (rủi ro #4).

**3.4 — Favorites + Recents**: ★ lưu localStorage `finchart.ind.favorites`; add → đẩy `finchart.ind.recents` (~8). Hiện thành nhóm đầu sidebar khi có.

**3.5 — "Thêm Pine script"** (footer): mở modal con (textarea/Monaco-lite) → paste → `addPineScript` (Phase 2) → compile → register → list refresh, vào "Pine đã thêm". Lỗi compile hiện inline.

**3.6 — Search**: lọc toàn bộ nhóm theo title/shortTitle/tags, realtime (JS, không gọi lại model).

**3.7 — Theming light/dark**: dùng CSS variable theme của candlekit (`styles.css`), KHÔNG hardcode màu. Modal + overlay + badge phải đọc được ở cả 2 nền (mental test: nền near-black mọi chữ vẫn rõ).

**3.8 — i18n**: chuỗi VI hóa qua bảng map (chuẩn bị cho EN sau). Toolbar tooltip "Chỉ báo, chỉ số và chiến lược".

**3.9 — Gear mỗi row (khi đã active)**: mở SettingsDialog (Phase 4).

**Deliverable**: modal add giống TradingView, light/dark, Pine ngồi chung nhóm "Pine đã thêm".

---

## Phase 4 — Dialog Settings (tab Inputs / Style)

Component mới `src/react/IndicatorSettingsDialog.tsx` (modal), mở từ gear (picker) hoặc legend.

**4.1 — Tab Inputs** — render theo `InputConfig.type`:
- `int`/`float` → number + step/min/max
- `string` + `options[]` → **dropdown**
- `source` → **dropdown** `close/open/high/low/hl2/hlc3/ohlc4/volume`
- `bool` → checkbox
- `color` → color picker
- Nhóm theo `group`, hiện `tooltip`.
- Apply: `indicators.add(name, { ...params, [k]: v })` (đã re-mount đúng).

**4.2 — Tab Style** — mỗi `plotConfig`: màu (color picker), độ rộng (1–4), kiểu (solid/dashed/dotted hoặc line/histogram), toggle visibility. + hlines.
- Cần thêm vào `IndicatorController`: `setStyle(name, plotId, {color,width,style,visible})` + lưu trên `ActiveIndicator` (mở rộng `colors` → `styles`). File: `src/indicators/IndicatorController.ts` (API ~227) + render (~313).

**4.3 — Source plumbing (core)**: built-in indicators hiện tính trên `close`. Cho `calculate`/`streaming` nhận `inputs.source` chọn series nguồn. File `src/indicators/builtin.ts` + `streaming.ts`. (TV catalog phần lớn không khai báo source → chỉ built-in + Pine hưởng đủ.)

**Deliverable**: dialog Inputs/Style đầy đủ, áp cho built-in + Pine; TV ở mức cơ bản.

> **✅ DONE (15/06/2026)** — `IndicatorController.setStyle`+`applyStyle`+`ActiveIndicator.styles`(`PlotStyle`); `src/react/IndicatorSettingsDialog.tsx` (tab Đầu vào: number/dropdown/source/color/bool theo type+group; tab Kiểu hiển thị: per-plot color/width/lineStyle/visible). Gear ⚙ ở modal+quick panel (prop `onOpenSettings`). Verify browser (Length round-trip, visibility), candlekit 63/63. **Chưa: 4.3 source plumbing** (built-in chưa đọc inputs.source) = TODO.

---

## Phase 5 — Legend / status line trên chart

Component `src/react/ChartLegend.tsx` — overlay góc trên-trái mỗi pane.

**5.1 — Mỗi indicator active 1 dòng**: tên (shortTitle) + tham số rút gọn + **giá trị live** tại crosshair/bar cuối + controls: 👁 ẩn/hiện · ⚙ mở Settings · ✕ remove.
**5.2 — Nguồn dữ liệu**: `IndicatorController` expose `activeNames()` + giá trị plot mới nhất + visibility. Cần hook đọc value theo crosshair (subscribe `chart.subscribeCrosshairMove`).
**5.3 — Visibility**: 👁 gọi `setStyle(..., {visible})` (Phase 4.2) ẩn series nhưng giữ tính toán.

**Deliverable**: legend tương tác như TradingView, dùng chung cho built-in/TV/Pine.

> **✅ DONE (15/06/2026)** — `IndicatorController.subscribe()`+`emitChange()`+`legendModel()` (LegendEntry/LegendPlot); `src/react/ChartLegend.tsx` (shortTitle+params+giá trị live qua `getChart().subscribeCrosshairMove`+seriesData/fallback last; 👁 setStyle-visible / ⚙ onOpenSettings / ✕ remove). Verify browser (EMA/RSI values, ✕ remove, ⚙ dialog), candlekit 63/63.
>
> ## ✅ PLAN HOÀN TẤT (Phase 0–5). TODO ngoài scope ghi ở HANDOFF.md/memory: 4.3 source plumbing · drawing-based Pine render pane React · Pine peek-mode · MTF (v1.5) · wiring workspace ChartPanel · VSA map/UDT (v2).

---

## Thứ tự thực thi & phụ thuộc

```
Phase 0 (metadata + bug fix)         ← nền, làm trước
   └─► Phase 1 (bridge)              ← cần meta giàu
         └─► Phase 2 (registry+store)
               └─► Phase 3 (picker UI)   ─┐
Phase 4 (settings dialog) ────────────────┼─► dùng IndicatorDef chung
Phase 5 (legend) ─────────────────────────┘
```
- Phase 4 & 5 chỉ cần `IndicatorDef` chuẩn → có thể làm song song sau Phase 1, không bắt buộc chờ Phase 3.
- **Lát cắt dọc demo sớm**: 0.1+0.3 (đủ type) → 1.1 (bridge plot-based) → register 1 Pine RSI vào picker hiện tại → thấy Pine trong menu React ngay (chưa cần dialog/legend).

---

## Rủi ro & điểm cần quyết

1. **`activeDrawings` global** → nhiều Pine drawing cùng lúc đè nhau. Phải scope theo instance id trước khi cho VP chạy trong workspace (Phase 1.2). Plot-based không vướng.
2. **Drawings trong IndicatorController**: controller hiện chỉ quản series/pane, không canvas. Bridge VP cần gắn primitive riêng → cân nhắc tách "Pine indicator" thành plugin riêng thay vì nhét vào IndicatorController.
3. **Metadata TV catalog nghèo**: ~405 def TV qua `defFromRaw` thường thiếu options/source/style → dialog Inputs/Style với TV chủ yếu là number+color. Chấp nhận; built-in + Pine hưởng đủ.
4. **Hiệu năng menu 400+ mục**: cần virtualize list hoặc lazy theo nhóm khi mở.
5. **Invariant candlekit**: KHÔNG để `pine-rt`/`pine-parser` thành dependency của `candlekit-charts/src`. Bridge + store sống ở `finchart`/app layer hoặc example; chỉ `IndicatorDef` (đã là contract mở) đi vào.

---

## Hiện trạng code (tham chiếu nhanh)

**Candlekit core**
- `src/indicators/types.ts:90` `IndicatorDef` {name,title,shortTitle,category,calculate,streaming?,defaultInputs,inputConfig,plotConfig,hlineConfig}. `InputConfig{name,type?,defval?,options?,title?}`. `PlotConfig{id,title?,color?,lineWidth?,style?}`. `ActiveIndicator{name,params,colors}`.
- `src/indicators/registry.ts:10` register/list/byCategory + `defFromRaw`.
- `src/indicators/builtin.ts:386` 9 built-in (SMA/EMA/WMA/VWAP/Bollinger/RSI/MACD/ATR/Stochastic).
- `src/indicators/IndicatorController.ts:227` add/remove/toggle/clear/setColors; onBar streaming, multi-pane (overlay→main, oscillator→pane 140px, pattern→markers).
- `src/indicators-tv/index.ts` `createFullIndicatorRegistry()` + `setWorkspaceIndicatorRegistry`.
- `src/react/IndicatorPicker.tsx:33` dropdown: search + tabs + ParamRow(int/float/bool/string-select)+ColorRow inline.
- `src/react/workspace/panels/ChartPanel.tsx:113` tạo IndicatorController từ `getWorkspaceIndicatorRegistry()`.

**Pine pipeline**
- `pine-parser/src/codegen.ts:216/264/275` emit `_inputs` + `meta.inputs{id,fn,defval,title}` + `meta.plots{id,fn,title}` (THIẾU type/options/min/max/step/color/style — Phase 0).
- `pine-parser/src/semantic.ts:70` `InputInfo{varName,pineId,fn,defvalExpr,titleExpr,minExpr,maxExpr}` (THIẾU options/group/tooltip/inline — Phase 0).
- `examples/pine-transpiler/main.ts:211` `renderSettingsForm` (bool/int/float/text; THIẾU dropdown/color), `:262` `mountIndicator`→`StreamingIndicatorController`.
- `examples/stress/streaming-controller.ts:34` `StreamingEngineDef{name,overlay,plots,create()→{next,peek}}`, `PlotSpec{id,color,style?,lineWidth?}`.

**Bug đang mở**: `o_volume is not defined` (VSA) — Phase 0.1.
