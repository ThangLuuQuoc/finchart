# Đánh giá candlekit-charts làm điểm xuất phát + Lộ trình tăng cường + Pine Script (06/2026)

## 1. candlekit-charts là gì (đã clone & khảo sát source)

`@getcandlekit/charts` v0.1.1 — MIT, ~8.400 LOC TypeScript strict, 70 file .ts/.tsx, commit cuối 10/06/2026 (đang active).

**Trùng khớp đáng kinh ngạc với kiến trúc tôi đề xuất ở [UPGRADE-PLAN.md](UPGRADE-PLAN.md)**: core framework-agnostic wrap **lightweight-charts v5** + React bindings tách riêng, build bằng tsup, Vitest, CI Node 18/20/22.

### Đã có sẵn
| Nhóm | Chi tiết |
|---|---|
| Chart | Candles/OHLC/line/area, volume, theme light/dark, crosshair events |
| Drawing tools | **16 tools** (trendline, ray, h/v-line, rect, circle, triangle, channel, arrow, price/date range, **Fib retracement/extension**) — select/drag/reshape/lock, serialize JSON |
| Indicators | 9 built-in (SMA/EMA/WMA/VWAP/BB/RSI/MACD/ATR/Stoch) + registry pluggable + optional catalog **405 indicators** (`lightweight-charts-indicators`) |
| Replay | **Deterministic replay engine** (play/pause/step/speed/seek, LRU cache theo ngày, no look-ahead) — nền tảng tốt cho backtest |
| Multi-chart | SyncEngine (sync range/crosshair/drawing theo group) |
| Workspace | Multi-panel FlexLayout (React), persistence localStorage |
| Feed | Contracts broker-agnostic (HistoricalFeed/RealtimeFeed, TickAggregator, withReconnect) — chưa có adapter cụ thể |
| ML hooks | FeatureGenerator columnar (Worker/WASM-friendly), SignalProvider, PredictionOverlay |

### Điểm yếu / rủi ro
1. **v0.1.1, bus factor = 1** — tác giả tự nhận "vibe-coded, early-stage, pin version". Một người + AI viết trong thời gian ngắn → cần audit kỹ phần tương tác phức tạp (drawing drag/reshape, workspace).
2. **Test mỏng**: 7 file / 489 LOC, chỉ pure logic, không có DOM/interaction test, **không có benchmark hiệu năng** (examples mới ~500 bars).
3. **Indicator engine là batch**: `calculate(bars[])` tính lại toàn bộ; `onBar()` recompute rồi update điểm cuối — chưa phải incremental thật sự O(1)/tick.
4. Không có Web Worker cho indicator; catalog 405 indicators chất lượng chưa kiểm chứng từng cái.
5. Chưa có data adapter thực (Binance, CCXT...), chưa có alerts, chưa có backtest/strategy.

### Kết luận: **Dùng được làm điểm xuất phát** — tiết kiệm ~5–7 tuần so với tự xây từ lightweight-charts trần (drawing tools + replay + workspace là phần tốn công nhất đã có sẵn). Chiến lược an toàn: **fork/vendorize, pin version**, coi như "codebase khởi điểm cần audit" chứ không phải dependency upstream đáng tin.

---

## 2. Cần làm gì thêm — Hiệu năng

| # | Hạng mục | Hiện trạng candlekit | Việc cần làm | Tác động |
|---|---|---|---|---|
| P1 | **Indicator incremental** | Batch `calculate(bars[])`, onBar tính lại | Thay engine bằng streaming (`trading-signals` v7 hoặc pattern `nextValue()`/`momentValue()` của @debut/indicators): mỗi tick O(1), intra-bar update không mutate state | Tick realtime từ O(n) → O(1); CPU giảm mạnh khi nhiều indicator |
| P2 | **Web Worker pipeline** | Không có (chỉ ML contract) | Worker pool cho batch compute (load history, catalog indicators, replay precompute); truyền **typed arrays columnar + transferable** (tận dụng contract FeatureGenerator sẵn có) | Main thread không khựng khi load 100k nến + 10 indicators |
| P3 | **Benchmark harness** | Không có | Playwright + FPS/heap probe: 10k/100k/500k bars, 10 indicators, 50 drawings, replay tốc độ max; chạy trong CI | Chặn regression, có số liệu công bố |
| P4 | **Data store typed-array** | Bars là object array | Cột hoá OHLCV thành Float64Array ring buffer cho hot path (tick aggregation, indicator input), giữ object API ở boundary | Giảm GC churn với feed tick dày |
| P5 | **Drawing layer scale** | Vẽ qua LWC primitives, chưa test nhiều drawings | Spatial index (chỉ hit-test/redraw drawing trong viewport), throttle pointer events bằng rAF | Mượt khi 100+ drawings |
| P6 | Tận dụng **LWC v5.1 conflation** | Mặc định | Bật/verify data conflation khi zoom-out dataset lớn | 60fps với 100k+ nến |

## 3. Cần làm gì thêm — Tính hữu dụng

1. **Data adapters thật**: Binance/Bybit WebSocket + REST history adapter (implement contract HistoricalFeed/RealtimeFeed sẵn có), CSV/Parquet import. Đây là rào cản đầu tiên của mọi người dùng.
2. **Indicator UX**: settings dialog từ `inputConfig` (đã có schema), favorites, templates, lưu layout indicator theo symbol.
3. **Alerts engine**: điều kiện trên series/indicator (cross, threshold), chạy trên cùng streaming engine P1 → alert backtest được bằng replay engine sẵn có.
4. **Strategy/backtest layer**: replay engine deterministic + indicator streaming = 80% nền tảng đã có; thêm order/fill model đơn giản + equity curve + stats (winrate, sharpe, maxDD).
5. **Pine Script support** — xem mục 4, đây là killer feature.
6. Magnet/snap (OHLC snapping khi vẽ), undo/redo cho drawings, export PNG.

---

## 4. Pine Script → chạy trên chart của mình: KHẢ THI, có đường đi rõ

### Tình hình 06/2026

| Phương án | Trạng thái | License | Đánh giá |
|---|---|---|---|
| **PineTS** ([LuxAlgo/PineTS](https://github.com/LuxAlgo/PineTS)) | **LuxAlgo mua lại 01/06/2026**, release v0.9.21 ngày 10/06/2026 — rất active. Chạy Pine v5 source trực tiếp trong browser/Node: transpiler + runtime với đúng series semantics (bar-by-bar, lookback `[]`, `var` persistence), 60+ `ta.*`, `request.security` MTF, `strategy.*` một phần. Demo chính thức render bằng **lightweight-charts** (repo mẫu: [openalgo-pinets](https://github.com/marketcalls/openalgo-pinets)) | **AGPL-3.0 + commercial** | ⭐ Con đường thực tế duy nhất hiện nay. Native Pine input vẫn experimental, v6 partial |
| TradingView charting_library (bản full) | Không chạy Pine — docs ghi rõ, custom indicator phải viết JS | — | Pine chỉ chạy trên tradingview.com |
| PyneSys/PyneCore (Python) | Runtime Apache-2.0 nhưng compiler Pine→Python **closed-source SaaS** | mixed | Bằng chứng: compiler Pine đầy đủ đắt đến mức người ta bán SaaS |
| Tự viết engine | Series semantics + ta.* seed/na-handling + repainting + broker emulator không có spec công khai (chỉ có grammar Pine v2) | — | ❌ Nhiều người-năm, đừng làm |
| LLM-assisted convert | Chưa có benchmark công bố; thực tế ~60–80% tự động rồi sửa tay | — | ✅ Làm lưới đỡ, không làm engine chính |

### Kiến trúc đề xuất: 2 tầng

```
User paste Pine v5 ──► PineTS (transpile + run, Web Worker)
                          │ plot/fill/box data
                          ▼
                    Plot Mapper ──► candlekit IndicatorRegistry
                          │              (overlay/oscillator pane)
                          ▼
                    lightweight-charts series + custom primitives
                    (fill/box/label/table cần plugin tự viết)

Script không qua được PineTS ──► LLM convert sang indicator API native
                                  + harness so output từng bar với
                                  CSV export từ TradingView
```

- **Effort**: 4–8 tuần cho pipeline "paste → parse → run → vẽ" với indicator phổ thông (overlay + oscillator). Strategy/backtest + MTF chuẩn: thêm 1–2 tháng.
- **Kỳ vọng đúng**: "chạy được phần lớn indicator v5 phổ biến" — KHÔNG phải 100% tương thích (strategy fill model và repainting MTF của TradingView không có spec, không bao giờ khớp tuyệt đối). Import library TradingView (`import user/lib`) không làm được (code nằm trên server TV).

### ⚠️ Quyết định license phải chốt TRƯỚC khi kiến trúc khoá vào PineTS
- AGPL-3.0 lây sang web app phân phối ra ngoài → hoặc open-source toàn bộ, hoặc **đàm phán commercial license với LuxAlgo sớm**.
- Giảm rủi ro: bọc PineTS sau một interface `ScriptEngine` riêng (paste-script → series output), để sau này thay engine khác / tầng LLM-convert mà không đụng phần còn lại.

---

## 5. Roadmap điều chỉnh (start từ candlekit-charts)

| Phase | Thời gian | Nội dung |
|---|---|---|
| 0. Audit & PoC | 1 tuần | Fork + pin; chạy demo workspace với data thật; stress 10k–100k bars; audit drawing/workspace code; dựng benchmark harness (P3) |
| 1. Performance core | 2–3 tuần | Streaming indicator engine (P1) + Worker pipeline (P2) + typed-array store (P4); adapter Binance WebSocket đầu tiên |
| 2. Pine PoC | 2 tuần | PineTS trong Worker → Plot Mapper → render 5 indicator Pine phổ biến (song song: hỏi LuxAlgo về commercial license) |
| 3. UX & alerts | 2–3 tuần | Indicator settings UI, alerts engine, magnet/undo-redo, drawing scale (P5) |
| 4. Pine GA + backtest | 3–4 tuần | input.* UI tự sinh, LLM-fallback harness, strategy layer trên replay engine |

**Tổng ~10–13 tuần** cho một sản phẩm vượt trading-vue-js về mọi mặt + tính năng Pine Script mà cả nhánh trading-vue-js lẫn night-vision chưa từng có.
