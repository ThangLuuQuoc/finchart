# Benchmark: candlekit-charts với 50.000 nến THẬT — 11/06/2026

## Thiết lập

| | |
|---|---|
| Data | **50.000 nến BTCUSDT 15m thật từ Binance** (06/01/2025 → 11/06/2026), tải bằng [download-data.mjs](candlekit-charts/examples/stress/download-data.mjs) |
| Trang test | [candlekit-charts/examples/stress/](candlekit-charts/examples/stress/main.ts) — tự động chạy 7 phase, kết quả vào `window.__BENCH` |
| Môi trường | Chrome 134 headed (Playwright), viewport 1600×900, 12 cores, Windows 10 |
| Cấu hình chart | Candlestick + volume, 5 indicators (SMA20, EMA50, Bollinger 20/2, RSI14, MACD 12/26/9 → 9 plot series), 100 drawings (trendline/rect/fib/ray/hline) |
| Lưu ý | Phải chạy trong cửa sổ hiển thị thật — webview ẩn bị browser dừng `requestAnimationFrame`, benchmark không chạy được |

Ảnh: [candlekit-stress-50k-2026-06-11T09-26-04-342Z.png](candlekit-stress-50k-2026-06-11T09-26-04-342Z.png)

## Kết quả

| Phép đo | Kết quả | Đánh giá |
|---|---|---|
| Fetch + parse 50k bars (2.9MB JSON) | 51 ms | ✅ |
| `setData` 50k (sync / đến lúc vẽ xong) | 170 ms / 282 ms | ✅ Tốt |
| **Pan sweep toàn dataset (chỉ chart)** | **60.1 fps**, p95 17.7ms, 0 long frame | ✅ Hoàn hảo — LWC core rất khoẻ |
| Add SMA / EMA / Bollinger / RSI / MACD | 91 / 82 / 202 / 260 / 403 ms | ⚠️ Chấp nhận được (một lần), nhưng chậm |
| **Pan với 5 indicators** | **59.4 fps**, p95 19.8ms, 0 long frame | ✅ Pan không trigger recalc |
| **Zoom cycles với 5 indicators** | **30.8 fps**, p95 41.4ms, 127 long frames | ⚠️ Autoscale 11 series × 50k điểm mỗi frame |
| Commit 100 drawings | 0.4 ms | ✅ |
| Pan + indicators + 100 drawings | 59.5 fps, 1 long frame | ✅ Drawing layer ổn |
| **Live ticks 30/s, 5 indicators** | **`updateBar` avg 39.2ms, p95 54.9ms, max 87ms** | 🔴 **Thảm hoạ** |
| **FPS trong lúc nhận ticks** | **1.2 fps** (frame avg 867ms, max 2.447ms) | 🔴 **UI đóng băng hoàn toàn** |
| Heap | 4 → 52 (data) → 291 (indicators) → 382 → **704 MB** (sau 8s ticks) | 🔴 GC churn nghiêm trọng |

## Phân tích

### Phần khoẻ: render engine
lightweight-charts v5 xử lý 50k nến + 9 plot series + 100 drawings ở **60fps khi pan** — khẳng định chọn nền LWC là đúng, và drawing layer của candlekit không phải vấn đề. Zoom còn 31fps là điểm trừ nhẹ (autoscale toàn bộ series mỗi frame) nhưng vẫn dùng được.

### Phần gãy: indicator engine khi realtime — đúng chỗ đã dự đoán
Bằng chứng nằm ở [IndicatorController.ts](candlekit-charts/src/indicators/IndicatorController.ts) `onBar()`:

1. **Mỗi tick** gọi `def.calculate(bars, params)` trên **toàn bộ 50k bars** cho **từng indicator** (5 lần) — dù chỉ cần giá trị của nến cuối.
2. Trước đó `this.bars()` **map lại toàn bộ 50k object** (đổi ts ms→s) — allocate 50k object/tick.
3. `filterValid()` filter lại toàn bộ mảng kết quả mỗi plot.

Hệ quả đo được: 39ms/tick × 30 tick/s = **1.17 giây công việc mỗi giây** → main thread bão hoà, UI 1.2fps, heap phồng 704MB do rác allocation (GC chạy liên tục). Ngay cả ở 1 tick/s, mỗi tick 39ms vẫn đảm bảo rớt ít nhất 2 frame — không đạt chuẩn realtime cho bất kỳ sàn crypto nào (BTCUSDT ~5–20 trades/s).

### Ngưỡng sử dụng thực tế của candlekit nguyên bản
- ✅ Chart tĩnh / cập nhật theo phút, ≤ 2 indicators, ≤ 20k bars: ổn.
- 🔴 Realtime tick-level với nhiều indicators trên dataset lớn: **không dùng được nếu chưa sửa engine**.

## Việc phải làm (xác nhận lại CANDLEKIT-PLAN P1/P4 bằng số liệu)

| Fix | Kỳ vọng | Cơ sở |
|---|---|---|
| **P1 — Streaming indicator engine** (`nextValue()` O(1)/tick thay vì `calculate(50k)`) | 39ms/tick → **~vài µs/tick** (~10.000×); UI giữ 60fps ở mọi tick rate thực tế | Pine-runtime/trading-signals pattern; đây cũng chính là runtime của kế hoạch Pine→TS |
| **P4 — Bỏ re-map `bars()` mỗi tick** (cache mảng convert, hoặc typed-array store) | Cắt 50k allocations/tick → heap ổn định thay vì 704MB/8s | Đo heap ở trên |
| Zoom: throttle autoscale / precompute min-max (LWC conflation) | 31fps → 55–60fps | Phase 5 |
| Batch init trong Worker (MACD 403ms hiện chặn main thread) | First-load không khựng | Phase 3 |

## Cập nhật cùng ngày: @finchart/pine-rt — fix P1 đã được chứng minh bằng số

Đã xây xong nền streaming engine ([finchart/packages/pine-rt](finchart/packages/pine-rt/src/index.ts)): SMA, EMA, RMA, WMA, Stdev, Change, Highest/Lowest, TrueRange, RSI, MACD, Bollinger, ATR, Stochastic — `next()` O(window)/tick + `peek()` intra-bar không mutate state, seed chuẩn TradingView (EMA/RMA seed bằng SMA, leading-na skipping, RSI dùng change-na-bar-0).

**Kiểm chứng (21/21 tests pass):**
- Golden harness: streaming == batch reference độc lập **từng bar trên 50k nến thật**, khớp cả warmup index (NaN ↔ NaN), tolerance 1e-9.
- Seed tests tính tay theo định nghĩa TradingView.
- Phát hiện trong quá trình đối chiếu: **candlekit RSI lệch chuẩn TradingView** (fake change=0 ở bar đầu → RSI sớm 1 bar + sai seed) — builtin.ts:219.

**Benchmark cùng kịch bản 5 indicators × 50k bars (Node, cùng máy):**

| | Batch-recalc/tick (pattern candlekit) | pine-rt streaming | Cải thiện |
|---|---|---|---|
| Mỗi tick | **27.5 ms** | **next: 0.19 µs · peek: 0.36 µs** | **~148.000×** |
| Warm toàn bộ history | 1.040ms (tổng add 5 indicators trong browser) | **19.2 ms** | ~50× |

→ Ở mức 0.2µs/tick, indicator engine biến mất khỏi profile — 30 ticks/s × 5 indicators tốn ~0.003% frame budget thay vì 117%. UI sẽ giữ 60fps ở mọi tick rate thực tế.

## Vòng 2 (12/06/2026): Tích hợp pine-rt vào chart — bóc tách trọn chuỗi bottleneck

Đã viết [StreamingIndicatorController](candlekit-charts/examples/stress/streaming-controller.ts) (ChartPlugin thay thế, dùng pine-rt `peek()` mỗi tick / `next()` khi nến đóng) và thêm các mode đo: `?engine=batch|streaming|none`, `&coalesce=1` (gộp tick theo frame), `&trim=1` (series indicator chỉ render 2k điểm cuối, state vẫn warm đủ 50k), `&only=ticks`.

### Lưu ý phương pháp đo quan trọng
Chrome **throttle `requestAnimationFrame` về 1Hz khi cửa sổ bị che** (kể cả không minimize) — máy đang được dùng nên nhiều run headed bị nhiễm frame ~1000ms. Các số FPS vòng 2 dưới đây đo **headless** (không có occlusion; FPS = throughput thuần không vsync, so sánh nội bộ với nhau là công bằng). Số sync (ms/tick) không bị ảnh hưởng bởi throttle.

### Kết quả live ticks 30/s, 50k bars, 5 indicators (9 plot series)

| Cấu hình | updateBar (sync) | FPS during ticks | Ghi chú |
|---|---|---|---|
| Batch (candlekit gốc, headed run sạch) | 39.2 ms | 1.2 | indicator math 27ms + LWC ~10ms |
| Streaming pine-rt (series 50k điểm) | 7.75–10.3 ms | 7.8 | math ~0; còn lại là LWC update |
| Streaming + **trim series 2k điểm** | **1.23 ms** | **31.7** | = floor của chart trống |
| Floor: chart trống (chỉ candle+volume) | 1.26 ms | 47.4 | giới hạn của LWC ở viewport 1600×900 |

Thời gian add 5 indicators: batch 1.037ms → streaming 311ms → streaming+trim **38ms** (27×).

### Chuỗi bottleneck — cả ba tầng đã được định lượng

1. **Indicator math O(n)/tick** (27ms) → pine-rt streaming: **~0** (0.19µs đo Node). ✅ Giải xong.
2. **LWC `series.update()` tốn O(tổng-số-điểm-series) mỗi lần data đổi**, không phải O(phần hiển thị) — phát hiện mới quan trọng: 9 series × 50k điểm ≈ +6.5ms/update; trim còn 2k điểm → biến mất. ✅ Giải pháp production: **windowed series rendering** — giữ ~2–5k điểm gần nhất trong series LWC, backfill khi user pan về quá khứ (cùng pattern với chunk-loading của DataCube cũ).
3. **Raster 3 panes + 11 series**: floor 47fps headless throughput; với coalesce 1 update/frame + GPU thật → 60fps display là khả thi. Tối ưu thêm nếu cần: gộp oscillator panes, OffscreenCanvas.

→ Kiến trúc khuyến nghị cho FinChart: **pine-rt streaming + coalesce theo rAF + windowed series**. Cả ba đều đã có proof-of-concept chạy được trong stress page.

Ảnh: [candlekit-stress-streaming-trim-2026-06-12T01-41-29-406Z.png](candlekit-stress-streaming-trim-2026-06-12T01-41-29-406Z.png)

## Tái chạy

```powershell
cd candlekit-charts/examples/stress
npm install
npm run dev -- --port 5199
# mở http://localhost:5199 trong cửa sổ HIỂN THỊ (không minimize) — tự chạy ~45s
# kết quả: bảng bên phải + window.__BENCH + console
```
