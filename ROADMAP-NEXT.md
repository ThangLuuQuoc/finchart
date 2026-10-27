# FinChart — Đánh giá vs TradingView Full + Roadmap tiếp theo (2026-06-16)

> Đánh giá trung thực độ phủ tính năng so với TradingView "Full", phân tích khả năng vượt về latency, và kế hoạch giai đoạn tới. Không thổi phồng — ghi rõ chỗ mạnh, chỗ thiếu, và chỗ cần ĐO chứ không tuyên bố.

---

## 1. Độ phủ tính năng vs TradingView Full

**Kết luận ngắn:** Ở lát cắt **"chart core + menu chỉ báo + Pine-as-first-class"** ta đã ~75–85% trải nghiệm. Nhưng **TradingView là cả NỀN TẢNG**, không chỉ thư viện chart — nên tính trên toàn bộ thì **chưa gần** (thiếu drawing tools, chart types lạ, strategies/backtest, alerts, screener, data server, marketplace). Đừng nhầm hai phạm vi này.

| Mảng | TradingView Full | FinChart hiện tại | Ước lượng phủ |
|---|---|---|---|
| Chart core (candle/bar/line/area + volume) | ✓ | ✓ (LWC v5) | ~85% |
| Chart types lạ (Heikin Ashi/Renko/Kagi/PnF/Range/Line Break) | ✓ | ✗ | ~10% |
| **Menu chỉ báo + Settings + Legend (UX)** | ✓ | ✓ (vừa xong Phase 0–5) | **~85%** |
| Built-in indicators | ~400 | 9 native + 405 catalog (lwc-indicators) | breadth OK, độ chuẩn xác catalog thì tuỳ |
| **Pine community scripts (chỉ báo)** | 100k+ | transpiler ~88% **parse**, ~60–70% **render thật** | differentiator độc nhất |
| Pine strategies / backtest | ✓ | ✗ | 0% |
| Alerts | ✓ | ✗ | 0% |
| Replay | ✓ | ✓ (candlekit) | ~70% |
| Multi-chart / layout | ✓ | ✓ (FlexLayout workspace) | ~60% |
| Drawing tools | ~100+ | 16 (MIT gốc) | ~15–20% |
| Watchlist / screener / news / social / marketplace | ✓ | ✗ (đây là platform) | ~0–5% |
| Data feed | ✓ (server riêng) | chỉ contracts (consumer tự cấp) | n/a |

**Điểm khác biệt cốt lõi của ta** (TradingView KHÔNG cho, hoặc khác bản chất):
- **Pine transpiler AOT → JS chạy client**: không cần server TV, không khoá vào nền tảng TV, không AGPL. Đây là thứ không sản phẩm chart open-source nào khác có ở mức này.
- **Toàn bộ là thư viện nhúng được** (MIT) — TradingView Full là SaaS đóng.

**Khoảng trống lớn nhất để "giống TradingView" hơn** (xếp theo giá trị):
1. Pine render thật cao hơn (drawing-based, MTF) → biến ~88% parse thành ~88% **chạy đúng**.
2. Drawing tools breadth (16 → ~40 phổ biến).
3. Strategies/backtest (riêng, lớn).
4. Chart types lạ.

---

## 2. Backend có thể vượt latency của bản gốc không?

**Trả lời thẳng:** Có cơ sở để **ngang hoặc nhanh hơn TradingView ở đúng đường "live tick → cập nhật chỉ báo → vẽ"** cho tập chỉ báo ta hỗ trợ — NHƯNG hiện mới chứng minh được "nhanh hơn cách làm ngây thơ", **chưa đo đối chứng với TV thật**. Phải đo mới được tuyên bố.

**Chỗ ta ĐÃ thắng (đo nội bộ, đã ghi):**
- `pine-rt` streaming O(window)/tick thay vì O(history) batch — 0.19µs vs 27.5ms/tick (~148.000× so với recompute toàn mảng; đây là so với *naive*, không phải TV).
- Windowed series rendering + coalesce rAF: updateBar 39ms → 2.9ms/tick (5 indicator × 50k nến) qua chính IndicatorController.
- **AOT**: Pine → JS native (V8 JIT), không có interpreter bytecode như engine Pine của TV → về lý thuyết thấp hơn overhead diễn dịch.

**Vì sao có cửa thắng TV ở đường hẹp này:** TV chạy Pine qua interpreter (client wasm hoặc server). Ta biên dịch sẵn ra JS + streaming thuần + không round-trip mạng. Với 1 chỉ báo trên dữ liệu live, "tick → pixel" của ta có thể ngắn hơn.

**Vì sao KHÔNG nên hứa "nhanh hơn TV toàn diện":** TV tối ưu nhiều năm, có compute server, xử lý quy mô lớn hơn nhiều. Ta chỉ có cửa ở **subset hỗ trợ, phía client**.

**Bottleneck còn lại (cơ hội tối ưu):**
- Compute chỉ báo chạy trên **main thread** → jank khi nhiều/nặng.
- `bars()` cấp phát mảng object (AoS) → áp lực GC (đã ghi trong benchmark report).
- Pine drawing (box/line) **vẽ lại toàn bộ** mỗi frame, không dirty-region.
- `peek()` hiện **recompute/mutate** mỗi tick (chưa có peek-mode).
- Nhiều series `.update()` rời rạc mỗi tick, chưa batch theo frame.

---

## 3. Kế hoạch tiếp theo — 3 mũi nhọn

### Mũi A — Chứng minh & Đưa vào sản phẩm thật (PROVE + PRODUCTIONIZE)
Biến demo thành sản phẩm + lấy số liệu thật trước khi tối ưu mù.
- **A1. Wire menu vào React workspace `ChartPanel`** (hiện chỉ ở `examples/indicators`). Modal + quick panel + legend + settings + Pine store vào pane thật, persist layout/setup.
- **A2. Benchmark harness** — ✅ **DONE (18/06)**, có phát hiện quan trọng: harness in-browser `examples/indicators/b1bench.ts` (`window.__b1bench`) đo main-thread block sync vs worker (50k nến, median 7 run). **Kết quả: B1 clone-per-request đang LỖ với nhiều indicator rẻ** — clone tax ≈11ms/indicator > compute của built-in rẻ. B1 thắng 2.2–2.3× với indicator nặng (MACD) / ít; THUA 0.5× với 9 built-in hoặc 1 EMA. **Công thức (trước fix): B1 thắng ⟺ Σcompute > ~11ms×K.** → **Fix clone-once ĐÃ LÀM (18/06):** worker cache bars theo version, request `calc` chỉ tham chiếu version (client re-send khi ref/signature đổi). Sau fix: ALL9 → worker main-thread **~0.3ms** vs sync ~250ms (**~700–1000×**), B1 net-win mọi cấu hình → **bật mặc định được**. One-time clone (~11ms/data-change) còn lại để B2 cắt. Report đầy đủ: `candlekit-charts/reports/b1-benchmark.md`. Đối chứng TV: KHÔNG tự động hoá được tin cậy (chart đóng, không inject tick, cross-origin, corp network) — ghi rõ trong report, không bịa số.
- **A3. 4.3 source plumbing**: built-in đọc `inputs.source` thật (close/open/hl2…).

### Mũi B — Latency / hiệu năng (sau khi A2 cho baseline)
- **B1. Web Worker offload** — ✅ **DONE v1 (18/06)**: `BatchCompute` backend (inject như compile/storage). `indicatorWorker.ts` chạy `def.calculate` của **built-in** off-thread (built-in thuần, không LWC/DOM → import sạch trong worker); `createWorkerCompute` (inject WorkerLike, id-correlate, dispose reject in-flight) + `mainThreadCompute` (fallback đồng bộ). IndicatorController thêm opt `compute?`: async backend → `refreshWithBackend` (pre-await supported defs, **epoch-guard** chống stale đè mới, unsupported/Pine/TV → fallback main thread); **không inject = sync path cũ không đổi 1 byte**. 73/73 candlekit test (7 mới: round-trip qua worker logic thật, concurrent-id, dispose). Verify browser examples/indicators: EMA+RSI render off-thread (7 canvas, 0 error — nếu worker không reply thì sẽ không render → đã reply). *Còn lại:* streaming ticks vẫn main thread (đã O(window) rẻ, đẩy qua worker = thêm round-trip — KHÔNG làm); makeStream warm vẫn sync; chưa đo đối chứng (cần A2). *Win chống-jank lớn nhất.*
- **B2. Columnar typed-array bar store (SoA)** thay AoS — ít GC, cache-friendly; bỏ allocate `bars()` mỗi tick. *(Clone-once đã giải quyết tax K× của B1, nên B2 KHÔNG còn là tiền đề.)* SoA + `Transferable` (zero-copy) chỉ còn cắt nốt **~11ms clone 1-lần** khi data đổi — tối ưu incremental, không chặn gì.
- **B3. Codegen "peek-mode"** — ✅ **DONE (16/06)**: `onBar(…,commit)` + closure `_commit` → ta `[_commit?next:peek]` + `_hist` snapshot/restore. peek không mutate (idempotent, khớp ref). Sửa luôn limitation bridge.
- **B4. Compile cache** (IndexedDB theo hash source) — re-add Pine tức thì, không transpile lại.
- **B5. Dirty-region / incremental render** cho Pine drawings (chỉ vẽ box/line đổi).
- **B6. Batch `series.update()` theo rAF** across mọi indicator/pane.

### Mũi C — Độ phủ Pine (biến parse → chạy đúng)
- **C1. Drawing-instance scoping + render VP/VSA trong pane React** — ✅ **DONE đầy đủ (18/06)**: bước 1 scope `activeDrawings`/instance; bước 2 `PineDrawingsPlugin` (Cách A, pine-adapter) replay→instance.drawings→primitive canvas; bước 3 **route từ menu workspace**: `isDrawingBasedPine(mod)` (meta.plots rỗng) → handler `setupWorkspacePine` gọi `ctx.controller.use(pineDrawingsPlugin(mod))` gắn vào pane đang mở, thay vì register IndicatorDef. `AddPineScriptHandler` thêm `ctx?: {controller:{use}}` (structural — candlekit KHÔNG import pine-adapter); ChartPanel bind controller pane vào handler. 17/17 adapter test (gồm classifier 2 chiều). Workspace mount sạch (0 console error); verify pixel vẫn chặn bởi FlexLayout 0-width headless + LWC rAF (tooling, không phải bug).
- **C2. MTF / `request.security`** (v1.5) — VP theo Ngày/Tuần như ảnh TV; cần `bar.time` thật + phát hiện mốc period.
- **C3. `table` / `linefill` render** — dashboard Pine hiện ra.
- **C4. arrays/map/matrix/UDT** (v2) — VSA full + script nâng cao.
- **C5. Pine v6 + `import` libraries**.
- **C6. Strategies / backtest engine** (lớn, riêng — chỉ làm nếu muốn cạnh tranh mảng strategy).

---

## Thứ tự đề xuất
**A trước** (sản phẩm thật + số liệu) → **B3+B1** (peek-mode sửa luôn bug + worker chống jank) → **C1** (drawing Pine render, giá trị thấy ngay) → còn lại theo nhu cầu.

Lý do: A2 cho baseline để mọi tối ưu B đo được; A1 biến công sức Phase 0–5 thành thứ dùng thật; B3 vừa tối ưu vừa trả nợ kỹ thuật; C1 mở khoá lớp script ấn tượng nhất (Volume Profile).

## Nguyên tắc giữ nguyên
- Không để `pine-rt`/`pine-parser`/`pine-adapter` thành dep của `candlekit-charts/src` (bridge ở layer finchart).
- Mọi tuyên bố hiệu năng phải kèm số đo (đừng lặp lại lỗi "nhanh hơn naive" = "nhanh hơn TV").
