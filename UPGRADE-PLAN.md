# Kế hoạch nâng cấp trading-vue-js → React + TypeScript (06/2026)

## 1. Hiện trạng (đã khảo sát source sau khi clone)

| Hạng mục | Thực tế |
|---|---|
| Stack | Vue 2.6 + Webpack 5 + Babel, JavaScript thuần (không TS) |
| Kích thước | ~13.600 LOC trong `src/` (~393 KB) |
| Commit cuối | **31/10/2022** — README ghi rõ *[Not Maintained]* |
| Tác giả | Đã viết lại bằng Svelte ([night-vision](https://github.com/project-nv/night-vision)) — nhưng repo đó cũng **chết từ 06/2024**, chưa từng có release |
| Render | Canvas 2D, Vue component chỉ là "shell", logic vẽ nằm trong class JS thuần |
| Dependencies | Vue 2 (EOL), moment.js (khai báo nhưng không dùng trong hot path), hammerjs, hamsterjs — đều cũ |

### Phân rã codebase theo khả năng tái sử dụng

| Nhóm | LOC | Port được? |
|---|---|---|
| Layout math (`layout.js`, `grid_maker.js`, `layout_cnv.js`, `layout_fn.js`) | ~570 | ✅ Pure JS, port nguyên sang TS |
| Canvas primitives (`candle.js`, `volbar.js`, `line.js`, `pin.js`, `seg.js`, `price.js`) | ~500 | ✅ Port nguyên |
| Math/utils (`stuff/`) + time-index mapping | ~1.100 | ✅ Port nguyên |
| Vue components (`.vue`) + mixins | ~4.300 | ❌ Viết lại (gắn chặt `$emit`, `$watch`, `$set`, mixin lifecycle) |
| DataCube + Script Engine + Web Worker (`helpers/`) | ~2.900 | ⚠️ Logic giữ được ~60%, lớp reactivity phải thiết kế lại |
| Overlays built-in | ~1.220 | ⚠️ Thuật toán giữ, khung component viết lại |

**Tỷ lệ thô: ~35% port nguyên, ~25% giữ thuật toán nhưng bọc lại, ~40% viết mới.**

### Điểm yếu hiệu năng của bản gốc

1. **Không dùng `requestAnimationFrame`** — tự chế `FrameAnimation` chạy `setInterval(16ms)` (`src/stuff/frame.js`), không sync với vsync, tốn pin, jank khi tab nền.
2. **Full clear + redraw toàn canvas mỗi frame** (`grid.js` → `clearRect()` rồi vẽ lại grid + mọi overlay), kể cả khi chỉ cursor di chuyển.
3. **Cursor update trên mỗi pixel mousemove** → kéo theo redraw toàn bộ.
4. **Indicator tính theo batch**: range đổi là serialize cả mảng OHLCV gửi qua Web Worker tính lại từ đầu — O(n) mỗi lần thay vì O(1) incremental mỗi tick.
5. Render hoàn toàn trên main thread (worker chỉ chạy script engine).

---

## 2. Hai phương án

### Phương án A — Port 1:1 sang React + TypeScript (tự nuôi engine)

Giữ nguyên kiến trúc (grid/layout/primitives/DataCube), thay Vue shell bằng React hooks, viết lại reactivity bằng Zustand/store thuần.

- ✅ Giữ 100% API & tính hackable (điểm bán hàng gốc của trading-vue-js)
- ✅ Toàn quyền tối ưu (OffscreenCanvas, dirty-rect, WebGL sau này)
- ❌ **Khối lượng lớn**: viết lại ~5.500 LOC + port ~8.000 LOC sang TS, ước tính **3–5 tháng** 1 dev full-time cho parity + test
- ❌ Tự gánh maintenance vĩnh viễn — đúng cái bẫy khiến bản gốc và night-vision chết
- ❌ Hệ tooling/tools vẽ (RangeTool, LineTool, pin/seg) rất nhiều edge case, khó port đúng

### Phương án B — Nền `lightweight-charts` v5 + lớp indicator/overlay riêng ⭐ KHUYẾN NGHỊ

Dùng [TradingView lightweight-charts](https://github.com/tradingview/lightweight-charts) làm render engine, tự xây phần giá trị gia tăng (indicator engine, DataCube-style API, drawing tools) bằng TypeScript.

| Tiêu chí | lightweight-charts v5.2 (04/2026) |
|---|---|
| Cộng đồng | 16.1k★, TradingView chống lưng, release đều (v5.2 ra 04/2026) |
| License | Apache-2.0 (chỉ cần attribution) |
| Bundle | ~61 KB gzip (bản gốc trading-vue.js nặng hơn nhiều) |
| Panes (offchart) | ✅ Có từ v5 — tương đương onchart/offchart của trading-vue-js |
| Custom overlay | ✅ Plugin API chính thức: Series Primitives, Pane Primitives, Custom Series |
| Hiệu năng | Canvas2D + **data conflation** (v5.1) cho dataset lớn, rAF chuẩn |

- ✅ Effort giảm còn **~6–10 tuần**: chỉ xây adapter React + indicator pipeline + drawing tools
- ✅ Render engine được TradingView tối ưu và maintain hộ — đúng tiêu chí "dễ maintain"
- ✅ Cộng đồng React + plugin ecosystem sẵn có
- ⚠️ Mất một phần tính "hackable sâu" (không sửa được core render), bù bằng plugin API
- ⚠️ Drawing tools (trendline, fib...) phải tự viết bằng Primitives API (có example chính thức)

### Phương án C (tham khảo, không khuyến nghị bây giờ)
WebGL/WebGPU (SciChart thương mại, ChartGPU mới nổi) — chỉ đáng làm khi cần >300k điểm hiển thị đồng thời. Với OHLCV thông thường, Canvas2D + conflation là đủ và ít rủi ro hơn nhiều.

---

## 3. Về cinar/indicator — đánh giá thẳng

| | Kết luận |
|---|---|
| **cinar/indicator v2 (Go)** | Sống tốt (push 06/2026), kiến trúc channels/streaming đẹp. **NHƯNG license AGPL-3.0** — nhúng vào sản phẩm closed-source là rủi ro pháp lý. Chỉ dùng nếu backend Go và chấp nhận AGPL (hoặc mua license riêng). |
| **indicatorts (bản TS song song)** | MIT, 52 indicators + 24 strategies + backtest. **Nhược điểm chí tử cho chart realtime: vẫn là API batch (mảng), KHÔNG có streaming/incremental như bản Go v2.** npm release cuối 02/2025 — nhịp chậm. |
| **Khuyến nghị thay thế** | **[trading-signals](https://www.npmjs.com/package/trading-signals)** (TS, streaming `add()` từng tick, v7.4.3 ra 05/2026 — maintain tích cực nhất) hoặc **[@debut/indicators](https://github.com/debut-js/Indicators)** (70+ indicators, `nextValue()`/`momentValue()` cho intra-bar, benchmark nhanh hơn technicalindicators hàng chục lần). |

→ **Chiến lược indicator**: dùng `trading-signals` làm engine chính (streaming, O(1)/tick); nếu cần backtest nặng phía server bằng Go thì dùng cinar/indicator v2 ở backend (cân nhắc AGPL), còn `indicatorts` chỉ là phương án phụ khi cần đồng bộ thuật toán Go↔TS.

---

## 4. Kiến trúc đề xuất (Phương án B)

```
┌─────────────────────────────────────────────────┐
│ React App (TypeScript, Vite)                    │
│ ┌─────────────────────────────────────────────┐ │
│ │ <FinChart/>  — React wrapper component      │ │
│ │  props/ref API mô phỏng TradingVue cũ       │ │
│ └───────────────┬─────────────────────────────┘ │
│                 │                               │
│  ┌──────────────▼───────────┐  ┌─────────────┐  │
│  │ ChartCore                │  │ DataStore   │  │
│  │ lightweight-charts v5    │◄─┤ (Zustand)   │  │
│  │ - candlestick + panes    │  │ DataCube-   │  │
│  │ - custom series/primitives│ │ style API   │  │
│  └──────────────▲───────────┘  └──────▲──────┘  │
│                 │                     │         │
│  ┌──────────────┴───────────┐  ┌──────┴──────┐  │
│  │ DrawingTools (plugins)   │  │ Indicator   │  │
│  │ trendline/fib/measure    │  │ Engine      │  │
│  │ qua Pane Primitives      │  │ trading-    │  │
│  └──────────────────────────┘  │ signals     │  │
│                                │ (+ Worker)  │  │
│                                └─────────────┘  │
└─────────────────────────────────────────────────┘
```

- **Monorepo** (pnpm workspaces): `packages/core` (framework-agnostic), `packages/react`, `packages/indicators`, `apps/demo`.
- **Tooling 2026**: Vite + Vitest + TypeScript strict + ESLint flat config + tsup cho build lib. Bỏ moment.js (dùng `Date`/`Intl` hoặc dayjs nếu cần).
- **Indicator pipeline**: mỗi tick mới → `indicator.add(candle)` O(1) → push thẳng vào series. Tính lại full chỉ khi load history. Khối lượng lớn (backtest, scan) đẩy vào Web Worker.

## 5. Roadmap

| Phase | Thời gian | Nội dung | Deliverable |
|---|---|---|---|
| 0. PoC | 1 tuần | React + lightweight-charts v5: candles + volume + 1 pane RSI + realtime update qua trading-signals | Demo chạy được, đo FPS/memory so với bản Vue cũ |
| 1. Core | 2–3 tuần | `<FinChart/>` wrapper, DataStore API kiểu DataCube (`add/get/set/merge/del` query), theme/skin | Package `@finchart/react` alpha |
| 2. Indicators | 2 tuần | Indicator engine + registry (~20 indicator phổ biến đầu), Web Worker cho batch, legend/settings UI | Pane indicators hoạt động |
| 3. Drawing tools | 2–3 tuần | Trendline, hỗ trợ ray/segment, Fibonacci, range measure — qua Primitives API; serialize/restore state | Tool parity với bản cũ |
| 4. Polish | 1–2 tuần | Docs, ví dụ migrate từ trading-vue-js, benchmark công bố, test E2E (Playwright) | v1.0 |

**Tổng: ~8–10 tuần** (so với 3–5 tháng nếu port toàn bộ engine).

## 6. Hiệu năng kỳ vọng sau nâng cấp

| Chỉ số | trading-vue-js (gốc) | Stack mới | Cơ sở |
|---|---|---|---|
| Frame loop | `setInterval(16ms)` tự chế | `requestAnimationFrame` chuẩn | LWC core |
| Redraw | Full clear + vẽ lại mọi thứ mỗi frame | Vẽ lại theo invalidation, conflation khi zoom out | LWC v5.1 |
| Indicator/tick realtime | O(n) tính lại + serialize qua worker | **O(1)** incremental (`add()`) | trading-signals |
| Dataset lớn (100k+ nến) | Lag rõ (filter + vẽ từng điểm) | Conflation gộp điểm, mượt 60fps | LWC docs |
| Bundle | Vue2 + moment + hammer + hamster | ~61 KB gzip core + indicators tree-shake | bundlephobia |
| Tab nền / pin | setInterval chạy tiếp | rAF tự throttle | trình duyệt |

Ước lượng thực tế: **mượt 60fps ổn định với 100k+ nến, CPU idle giảm mạnh** (không còn vòng lặp 16ms thường trực), thời gian cập nhật indicator mỗi tick từ hàng ms (tính lại cả mảng) xuống microseconds.

## 7. Rủi ro & giảm thiểu

1. **Drawing tools là phần khó nhất** — bản gốc có ~600 LOC pin/seg logic nhiều edge case. → Port lại phần math thuần (`stuff/math.js`: point2line, point2seg... dùng được nguyên), chỉ viết mới lớp tương tác.
2. **Khác biệt API khiến người dùng cũ khó migrate** → giữ DataCube-style query API (`dc.add('onchart', {...})`) làm lớp tương thích.
3. **lightweight-charts không cho sửa core render** → những gì plugin API không làm được (hiếm) thì chấp nhận; đổi lại không phải nuôi 13k LOC engine.
4. **AGPL của cinar/indicator** → không đưa vào frontend; backend Go cân nhắc kỹ với legal.
