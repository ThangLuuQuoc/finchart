# Báo cáo đo corpus Pine Script — 12/06/2026

Mục tiêu: chốt scope transpiler Pine→TS v1 bằng tần suất construct/hàm trên script thực tế (thay vì ước đoán trong [PINE2TS-PLAN.md](PINE2TS-PLAN.md)).

## Corpus

**2.947 scripts** từ 9 GitHub repos (clone tại `pine-corpus/repos/`, analyzer: [analyze.mjs](pine-corpus/analyze.mjs), số liệu thô: `corpus-stats.json` / `corpus-summary.txt`):

| Nguồn chính | Scripts | Đặc điểm |
|---|---|---|
| hasnocool/tradingview-pine-scripts | 1.805 | Megapack mirror script cộng đồng TV thật (có cả LuxAlgo, ChartPrime) — v4/v5, nặng strategy |
| mihakralj/pinescript | 410 | v6 thuần, chất lượng cao (một tác giả) |
| everget, capissimo, f13end | 478 | v2–v4, indicator kinh điển |
| ricardosantos79, Alorse, Arun, harryguiacorn | 254 | v4/v5 libraries + strategies + indicators |

Phân khúc: 1.037 indicator / 1.849 strategy / 60 library. **Segment mục tiêu: 749 indicator v4+ (trong đó 532 v5/v6).**

### Giới hạn phương pháp (đọc trước khi dùng số)
- Đo bằng regex trên source đã strip string/comment — không phải parser; sai số nhỏ ở các pattern lắt léo.
- Corpus GitHub ≠ "top TradingView theo like" — thiên về script được mirror; megapack nặng strategy.
- Segment v6 gần như một tác giả (mihakralj) → số v6 phản ánh style một người, chỉ dùng tham khảo.

## Phát hiện chính

### 1. ⚠️ Giả định sai trong plan: ARRAYS không hiếm
Plan cũ xếp `array.*` vào v1.5 ("ít gặp trong top indicators"). Thực tế: **39.3%** indicator v4+ dùng arrays (v5: 17.4%, v6: 45%). Đây chính là blocker lớn nhất giữa T1→T2 trong mô phỏng coverage. **→ arrays phải vào v1.**

### 2. ✅ Danh sách ta.* của plan gần như hoàn hảo
Top hàm: sma (13.9%), change (13.8%), highest (12.3%), ema (11.6%), lowest (11.1%), atr (10.9%), rsi (8.1%), crossover/under (~7%), cum (6.4%), stdev (5.2%), hma (4.4%), rma (4.1%), pivothigh/low (4%)... Hàm NGOÀI danh sách V1 phổ biến nhất chỉ là `percentile_nearest_rank` (**0.7%**) — thêm ~5 hàm là đóng toàn bộ khoảng trống ta.*. Khoảng 55 hàm ta.* là đủ.

### 3. Drawing objects quan trọng hơn dự kiến
label 14.3%, line 10.1%, box 3.3%, table 3.1% (table = dashboard style LuxAlgo). Thêm nhóm này nâng coverage 72% → 88%. **→ line/label/box/table vào v1** (render qua LWC primitives — đây là effort render, không phải effort ngôn ngữ).

### 4. request.security = 11.1%
Đúng như plan dự kiến (khó, hoãn được) — nhưng là khác biệt giữa 88% và 96%. → v1.5.

### 5. Yên tâm hoãn: tất cả ≤4%
switch 4%, while 3.6%, matrix 2%, method 1.3%, UDT 0.9%, varip 0.3%, import library 0.3%, map/polyline ~0%. (switch/while vẫn nên hỗ trợ vì rẻ ở tầng parser.)

### 6. Core ngôn ngữ xác nhận đúng
inputs 93.2%, user functions 87.7% (`=>`), history `[]` 74.6%, if 73%, ternary 70%, math.* 70.5%, var 66.4%, **tuple destructuring 23.9%** (bắt buộc trong parser), for 32.8%, str.* 17.4%.

## Mô phỏng coverage (script "đạt" = không dùng construct ngoài scope)

| Scope tích luỹ | v4+ indicators (749) | v5/v6 indicators (532) |
|---|---|---|
| T1: core + plot/input + ta-V1 + math/str + control-flow | 44.9% | 47.9% |
| T2 = T1 + **array** + varip + ta đầy đủ | 72.1% | 82.9% |
| **T3 = T2 + line/label/box/table** | **87.9%** | **89.1%** |
| T4 = T3 + request.* (MTF) | 96.4% | 94.9% |
| T5 = T4 + UDT/method | 97.6% | 96.6% |
| Trần (loại import-library, matrix, map) | ~97.6% | ~96.6% |

## Quyết định scope (cập nhật PINE2TS-PLAN)

- **v1 = T3**: parser core (if/for/while/switch/ternary/user-fn/tuple/history/var/varip) + ~55 hàm `ta.*` + `math.*`/`str.*` cơ bản + `input.*` + plot family + `array.*` + **line/label/box/table** → **~88–89% indicator scripts**.
- **v1.5 = + `request.security`** (dạng phổ biến: symbol/tf/expr, không lookahead exotic) → **~95%**, vượt mục tiêu 90%.
- **v2**: strategy.* (1.849 scripts trong corpus là strategy — thị trường lớn cho backtest sau này), UDT/method, matrix.
- **Không làm**: import library (code nằm trên server TV — đúng kết luận cũ), polyline, map.

Thay đổi so với plan cũ: **arrays và drawing objects chuyển từ v1.5 vào v1** (data bắt buộc); bù lại `request.security` yên tâm để v1.5 vì một mình nó đã +7–8 điểm %.

## Tái sử dụng corpus
Corpus này (2.947 file đã phân loại version/construct trong `corpus-stats.json`) chính là **bộ test đầu vào cho parser**: chạy parse-only trên toàn bộ, đo % parse-OK theo từng giai đoạn — dùng làm KPI tuần cho giai đoạn 3-4 của PINE2TS-PLAN.
