# FinChart — Phân tầng tính năng (2026-06-16)

> Ai thêm gì, lên trên ai. Ba lớp xếp chồng:
> **lightweight-charts** (engine gốc, TradingView) → **candlekit-charts** (lớp thư viện, MIT) → **FinChart** (những gì *chúng ta* thêm).
>
> Pháp lý/kiến trúc: `lightweight-charts` (Apache-2.0) là **runtime dependency DUY NHẤT** (peer). `candlekit-charts` = MIT, code drawing/indicator gốc, KHÔNG nhúng runtime bên thứ ba. Lớp FinChart (`@finchart/pine-*`) sống **ngoài** `candlekit-charts/src` — chỉ nối qua contract `IndicatorDef` (giữ invariant "no third-party indicator runtime" của candlekit).

```
┌──────────────────────────────────────────────────────────────────────┐
│  LỚP 3 — FinChart (chúng ta)                                            │
│  Pine→TS transpiler · pine-rt streaming · windowed render ·            │
│  menu chỉ báo kiểu TradingView (modal/legend/settings) · pine-adapter  │
├──────────────────────────────────────────────────────────────────────┤
│  LỚP 2 — candlekit-charts (MIT)                                         │
│  ChartController · drawing tools · indicators (batch) · measurement ·  │
│  replay · sync · workspace · feed/ml contracts · React bindings        │
├──────────────────────────────────────────────────────────────────────┤
│  LỚP 1 — lightweight-charts (Apache-2.0, engine render)                │
│  series canvas · scales · crosshair · panes · primitives · pan/zoom    │
└──────────────────────────────────────────────────────────────────────┘
```

---

## LỚP 1 — lightweight-charts (gốc, TradingView)

Engine **chỉ lo render + tương tác cơ bản**. Không có khái niệm drawing tool, indicator, replay, workspace, data source.

| Nhóm | Có sẵn |
|---|---|
| Series | Candlestick, Bar (OHLC), Line, Area, Baseline, Histogram |
| Trục | Time scale + Price scale; autoscale; log/percentage/normal; nhiều price scale (trái/phải) |
| Panes | **Multi-pane (v5)** — `chart.addPane()` (oscillator pane riêng) |
| Phủ lên series | Price lines, series markers (`createSeriesMarkers`) |
| Hiển thị | Crosshair, grid, watermark, theme màu cơ bản (qua options) |
| Tùy biến vẽ | **Primitives API** (`ISeriesPrimitive`/`IPanePrimitive`) — vẽ canvas tùy ý (bitmap coordinate space, DPR-aware) |
| Tương tác | Pan, zoom, kinetic scroll, fit content, set/get visible range |
| Streaming | `series.update()` 1 điểm, `setData()` cả mảng |
| Sự kiện | `subscribeCrosshairMove`, `subscribeClick`, `subscribeVisibleTimeRangeChange` |
| Đơn vị | Time = epoch **giây** |

**KHÔNG có**: drawing tools, indicators, đo lường, replay, multi-chart sync, workspace, data-source, light/dark theme dựng sẵn.

---

## LỚP 2 — candlekit-charts (MIT, thư viện thêm lên LWC)

Biến engine render thành **bộ công cụ charting** framework-agnostic + React bindings. Tất cả code gốc MIT, không thêm runtime bên thứ ba.

| Mảng | candlekit thêm |
|---|---|
| **Chart wrapper** | `ChartController` — biên giới ms↔giây, theme light/dark + override màu, auto-size, `updateBar` live, hook `onBar` cho plugin |
| **Core utils** (pure) | `toBars`, `resample`, `floorToBucket` (session-aware anchor), `applyFixedOffset` |
| **Plugin system** | `EventBus` typed + `ChartPlugin`/`PluginContext` (chart/series/theme/bus/bars) |
| **Drawing tools** | `DrawingEngine` + `DrawingPrimitive` + `DrawingController` — **16 tool gốc** (trend/ray/extended/h-v line/arrow/rectangle/circle/fib + HorizontalRay/CrossLine/Triangle/ParallelChannel/PriceRange/DateRange/FibExtension); chọn/kéo/khóa/**serialize-persist** |
| **Indicators** | `IndicatorRegistry` + `IndicatorController` + catalog gốc **9 built-in** (SMA/EMA/WMA/VWAP/RSI/MACD/Bollinger/ATR/Stochastic); `defFromRaw` adapt def ngoài; render overlay/oscillator-pane/markers; **batch `calculate`** |
| **Catalog mở rộng** | `indicators-tv` (optional) — candlekit chỉ **adapt** (`defFromRaw`) ~**405** def từ package **bên thứ ba** `lightweight-charts-indicators` (tác giả "Odyssée", MIT — KHÔNG phải của TradingView, KHÔNG phải candlekit). Package đó tính bằng **`oakscriptjs`** (Pine v6-compatible TA lib, MIT). Cả hai là **optional peer deps** → core không nhúng; chỉ nạp khi import entry này. ⚠️ Đây thực chất là *third-party indicator runtime* (batch) — khác `@finchart/pine-rt` của ta (streaming, clean-room). Có thể thay dần bằng Pine pipeline của ta sau |
| **Measurement** | `MeasurementController` + `RulerPrimitive` (Shift-drag: giá/%/bar-distance/time-delta/risk-reward) |
| **Point marker** | `PointMarkerController` + `PointMarkerPrimitive` — Ctrl+click "catch point" (upstream mới; ta đã cherry-pick) |
| **Replay** | `ReplayController` — per-day LRU cache, prefetch, play/pause/step/seek/speed, hook per-bar |
| **Sync** | `SyncEngine` đa nhóm (linked charts) |
| **Workspace** | FlexLayout: `PanelRegistry`/`WorkspaceManager`/`LayoutPersistence`/`ChartPanel` (split/resize/add/sync panes) |
| **Data layer** | Contracts broker-agnostic (`MarketDataProvider`/`HistoricalFeed`/`RealtimeFeed`), `TickAggregator`, `withReconnect`, `MockFeed` |
| **ML/AI** | Contracts overlay (`FeatureGenerator`/`SignalProvider`/`MLPlugin`/`PredictionOverlay`) |
| **React** | `ChartView` + `DrawingToolbar`/`IndicatorPicker`/`MeasurementOverlay`/`ReplayControls` + hooks + theme token CSS |

**Hạn chế (trước khi ta thêm)**: indicator chỉ **batch recompute** (O(history)/tick → chậm khi live), không có Pine, menu chỉ là dropdown `IndicatorPicker`, không có legend trên chart, không có settings dialog đầy đủ.

---

## LỚP 3 — FinChart (chúng ta thêm lên candlekit)

Đây là phần khác biệt độc nhất so với mọi fork candlekit khác.

### 3a. Hiệu năng indicator (đóng góp ngược vào candlekit qua PR — branch sẵn, chưa push)
| Thêm | Chi tiết |
|---|---|
| **Streaming engine** | `IndicatorDef.streaming` hook + 9 engine streaming `next()`/`peek()` — O(window)/tick thay O(history). Đo: **0.19µs vs 27.5ms/tick (~148.000×)** so với batch |
| **Windowed render** (`renderWindow.ts`) | Chỉ `setData` phần đuôi nhìn thấy; backfill khi pan trái. updateBar **39ms→2.9ms/tick** (5 ind × 50k nến) |
| **RSI đúng chuẩn TV** | Sửa bug seed của candlekit (upstream vẫn còn sai) |

### 3b. Pine Script → TypeScript (clean-room, thay PineTS/AGPL)
| Package | Vai trò |
|---|---|
| **`@finchart/pine-parser`** | Lexer chevrotain + parser hand-rolled recursive-descent (subset T3); **99% parse-OK** trên corpus 2.5k script v4/v5/v6. Semantic pass (hoist call-site `ta.*` → instance), codegen TS (**factory `createInstance`**, metadata giàu: type/options/min/max/group + plot color/style) |
| **`@finchart/pine-rt`** | Runtime streaming: `PineArray`/`BarHistory`/`PineMath`/`PineStr`/`PineColor` + **drawing objects** `PineBox`/`PineLine`/`PineLabel` + `activeDrawings` + `PineDrawingsPrimitive` (vẽ box/line lên canvas LWC). Golden test khớp từng bar trên 50k nến thật |
| **`@finchart/pine-adapter`** | **Cây cầu** `pineModuleToIndicatorDef()` — biến module Pine đã transpile thành `IndicatorDef` candlekit (có streaming). `PineIndicatorStore` (compile→register, localStorage) |

→ **Paste 1 Pine script → compile (AOT, client) → thành indicator chạy ngay**, không server, không khóa nền tảng. Verify thật: RSI/EMA/Volume Profile render trên chart.

> **⚠️ Note đặt tên (`pine-rt`) — sẽ tách trong tương lai.** Tên `pine-rt` ("Pine runtime") hơi gây hiểu nhầm: nó KHÔNG phải interpreter/engine Pine, mà là **thư viện runtime/stdlib** mà code đã-transpile gọi tới (vai trò như "language runtime library", còn `pine-parser` mới là *trình biên dịch*). Ngoài ra package đang gộp 2 thứ: (a) **TA primitives streaming tổng quát** (Sma/Ema/Rsi/Macd/Atr… — dùng độc lập, không qua Pine; chính là phần đóng góp streaming cho candlekit) + (b) **Pine stdlib** (PineArray/PineColor/drawing objects). **Quyết định: tạm GIỮ tên (A), kế hoạch tương lai = tách (C)** → `@finchart/ta` (TA streaming tổng quát, có thể publish/đóng góp độc lập) + `@finchart/pine-rt` (Pine stdlib, re-export `ta`). Làm khi cần publish phần TA riêng.

### 3c. Làm giàu IndicatorDef trong candlekit (cho menu/dialog/legend)
`source`/`tags`/`description` (gom nhóm menu) · `PlotStyle` + `ActiveIndicator.styles` · `setStyle`/`applyStyle` · `subscribe`/`emitChange` (multi-subscriber) · `legendModel()` · `toState`/`loadState` (kèm styles — cherry-pick + mở rộng).

### 3d. Menu chỉ báo kiểu TradingView "full" (React, light/dark)
| Component | Vai trò |
|---|---|
| **`IndicatorModal`** | Catalog: sidebar nhóm (Yêu thích/Gần đây/Chỉ số kỹ thuật/TradingView 398/Pine của tôi) + tabs + search + badge (PINE/NEW…) + nút "Thêm Pine script" |
| **`IndicatorQuickPanel`** | Panel quick-toggle Favorites + Active (gom theo OVERLAYS/OSCILLATORS) |
| **`IndicatorSettingsDialog`** | 2 tab Đầu vào (number/dropdown/**source**/color/bool theo type, nhóm group) + Kiểu hiển thị (per-plot màu/độ dày/nét/ẩn-hiện) |
| **`ChartLegend`** | Status line trên chart: tên + tham số + **giá trị live** (crosshair) + 👁/⚙/✕ |
| **`indicatorPrefs`** | Store favorites/recents chia sẻ (`useSyncExternalStore`) — modal & quick panel đồng bộ tức thì |

Tích hợp vào **workspace ChartPanel thật** (`setWorkspaceAddPineScript` inject Pine handler — candlekit không phụ thuộc pine-adapter).

### 3e. Hạ tầng đo & nghiên cứu
Stress test 50k nến BTC thật + `BENCHMARK-REPORT.md`; corpus 2.947 Pine script (9 repo) + `PINE-CORPUS-REPORT.md`; phát hiện **API pine-facade** của TradingView (lấy source mọi script open-source).

---

## So với TradingView Full (tóm tắt)
Lát cắt **chart + menu chỉ báo + Pine** ≈ 75–85%. Toàn nền tảng thì chưa (thiếu strategies/backtest, alerts, screener, ~100 drawing tools, chart types lạ). **Khác biệt độc nhất: Pine transpiler AOT chạy client** — xem `ROADMAP-NEXT.md` để biết kế hoạch & phân tích latency.

## Quy ước phân tầng (để không nhầm về sau)
- Tính năng có trong `candlekit-charts/src` **trước** công việc Pine/menu của ta (drawing/replay/sync/workspace/feed/ml/measurement/PointMarker) = **Lớp 2** (kể cả phần "Kimi" + "post-Kimi" + cherry-pick từ upstream).
- Streaming/windowed/RSI-fix tuy nằm trong `candlekit-charts/src` nhưng **do ta viết** (đóng góp PR) = **Lớp 3a**.
- Mọi thứ trong `finchart/packages/*` = **Lớp 3**.
