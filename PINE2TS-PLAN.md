# Kế hoạch: Tự xây Pine Script → TypeScript converter (mục tiêu >90%) — 06/2026

Quyết định: bỏ PineTS (AGPL). Tự xây transpiler clean-room, MIT, output là TypeScript thuần mà user đọc/sửa được.

## 1. Định nghĩa lại "90%" cho đúng — đây là quyết định quan trọng nhất

"90% ngôn ngữ Pine" và "90% script thực tế" là hai mục tiêu khác nhau một trời một vực:

- Phân bố sử dụng Pine theo Pareto rất gắt: phần lớn indicator phổ biến chỉ dùng ~25–35 hàm `ta.*`, `math.*`, `input.*`, `plot/plotshape/hline/fill`, if/for, `var`. 
- Cái đuôi dài (arrays/matrices/maps, `request.security`, boxes/tables/labels, `strategy.*`, `varip`, libraries) chiếm ít script nhưng chiếm **~70% effort** nếu đòi hỗ trợ.

**Mục tiêu đo được đề xuất (v1):**
> 90% của corpus "top ~1.000 indicator open-source nhiều like nhất trên TradingView community" convert tự động thành công VÀ output khớp TradingView từng bar trong dung sai 1e-6 (relative) trên bộ golden data.
> Loại trừ khỏi v1: `strategy.*` (backtest), `request.security` (MTF), drawing objects (box/table/label).

Không có harness so sánh từng bar với TradingView thì con số 90% là vô nghĩa — harness phải xây **trước** transpiler.

## 2. Insight kiến trúc then chốt: Pine vốn dĩ là streaming

Execution model của Pine là **bar-by-bar**: script chạy lại trên mỗi nến, mỗi biến là một series, `close[3]` là lookback. Điều này map 1:1 vào kiến trúc indicator **incremental O(1)/tick** mà ta đã chốt ở [CANDLEKIT-PLAN.md](CANDLEKIT-PLAN.md) (hạng mục P1):

- Runtime Pine của ta = chính engine streaming indicator của chart. Một nền tảng, hai mặt: indicator viết tay bằng TS và indicator convert từ Pine **chạy chung một runtime**, cùng được realtime O(1)/tick miễn phí.
- Không phải xây hai hệ thống — đây là lý do hướng này TỐT HƠN nhúng PineTS (PineTS là một runtime ngoại lai chạy cạnh engine của mình).

## 3. Kiến trúc pipeline

```
Pine v5 source
  │
  ▼
[1] Lexer + Parser (chevrotain, TS thuần, clean-room từ docs v5/v6)
  │     AST + vị trí lỗi thân thiện
  ▼
[2] Semantic pass
  │     - suy luận kiểu series/simple, scope, var/varip persistence
  │     - HOIST CALL-SITE: mỗi lời gọi ta.ema(x,20) ở vị trí nguồn
  │       riêng → một instance stateful riêng (trick bắt buộc,
  │       sai cái này là sai hết kết quả)
  ▼
[3] Codegen → TypeScript ĐỌC ĐƯỢC, target runtime nhỏ
  │
  ▼
@finchart/pine-rt (MIT, ~core của transpiler)
  - Series<T> ring buffer, na/nz semantics
  - ta.* (~40 hàm, seed chuẩn TradingView: RMA seed = SMA,
    na-propagation từng hàm)
  - Context bar-by-bar: update(bar) O(1), momentValue cho bar đang chạy
  ▼
Compile (esbuild-wasm trong Worker) → chạy sandbox
  → plot outputs → IndicatorRegistry của candlekit → lightweight-charts
```

### Ví dụ output mong muốn (user sửa được)

```pine
//@version=5
indicator("My RSI")
r = ta.rsi(close, input.int(14, "Length"))
plot(r, color = r > 70 ? color.red : color.blue)
```

```ts
import { defineIndicator, ta, input } from '@finchart/pine-rt'

export default defineIndicator('My RSI', (ctx) => {
  const length = input.int(ctx, 14, { title: 'Length' })
  const rsi = ta.rsi(ctx, 'rsi#1')            // 'rsi#1' = call-site id (hoisted state)

  return (bar) => {
    const r = rsi.update(bar.close, length)
    ctx.plot('plot#1', r, { color: r > 70 ? color.red : color.blue })
  }
})
```

Đây cũng chính là API cho người viết indicator TS tay — converter chỉ là một "người dùng" của API đó.

## 4. Bảng độ khó — cái gì làm, cái gì hoãn

> **Cập nhật 12/06/2026 — đã đo corpus thật ([PINE-CORPUS-REPORT.md](PINE-CORPUS-REPORT.md), 2.947 scripts):**
> arrays và drawing objects chuyển từ v1.5 VÀO v1 (39.3% và ~16% script dùng); danh sách ta.* xác nhận đủ (gap lớn nhất ngoài list chỉ 0.7%); request.security để v1.5 (+7–8 điểm coverage). v1=T3 ≈ 88–89%, v1.5 ≈ 95%.

| Thành phần | Độ khó | v1? | Ghi chú (kèm % corpus indicator v4+) |
|---|---|---|---|
| Parser Pine v5 (subset thực dụng) | Trung bình | ✅ | Không có grammar chính thức (chỉ v2) — clean-room từ reference manual. Chevrotain viết bằng TS, error message tốt. Tuple destructuring bắt buộc (23.9%) |
| Series semantics, `[]`, `var`, na/nz | Khó nhưng xác định | ✅ | history 74.6%, var 66.4% |
| `ta.*` ~55 hàm | Trung bình, **quỷ ở seed** | ✅ | Top: sma/change/highest/ema/lowest/atr/rsi. Gap ngoài list V1 lớn nhất: percentile_nearest_rank 0.7% |
| `input.*` → UI schema | Dễ | ✅ | 93.2% — phổ biến nhất corpus |
| `plot/plotshape/plotchar/hline/fill/bgcolor` | Trung bình | ✅ | fill/bgcolor cần custom primitive trên lightweight-charts |
| for/while, switch, functions user-defined | Trung bình | ✅ | userFn 87.7%, for 32.8%, switch 4%, while 3.6% |
| `array.*`, `varip` | Trung bình | ✅ **(nâng từ v1.5)** | **arrays 39.3%** — giả định cũ "ít gặp" SAI theo data |
| box/table/label/line (drawing objects) | Khó (render) | ✅ **(nâng từ v1.5)** | label 14.3% + line 10.1% + box/table ~6% → +16 điểm coverage |
| `request.security` (MTF) | Khó (data layer + repaint semantics) | ⚠️ v1.5 | 11.1%; một mình nó nâng 88%→95% |
| `matrix.*`, `map.*`, UDT/`method` | Trung bình | ❌ v2 | Tất cả ≤2% |
| `strategy.*` | Rất khó (fill model không có spec) | ❌ v2 | Nhưng 1.849/2.947 script corpus là strategy — thị trường backtest lớn cho sau |
| `import user/library` | Không thể | ❌ | Code library nằm trên server TradingView (0.3% corpus indicator) |

## 5. Lưới đỡ LLM cho phần đuôi (~10% còn lại)

Transpiler deterministic xử lý 90%; script fail thì:
1. Transpiler báo lỗi **chính xác construct nào** không hỗ trợ (vd: `request.security tại dòng 12`).
2. Đẩy qua LLM (Claude) convert sang API `@finchart/pine-rt` — prompt kèm spec API + các pattern chuẩn.
3. **Bắt buộc qua verification harness**: chạy trên golden data, diff từng bar với output TradingView user export. Pass → nhận; fail → hiện diff cho user sửa.

LLM không bao giờ là engine chính — chỉ là fallback có kiểm chứng. Kinh nghiệm ngành: LLM đạt ~60–80% tự động, lỗi điển hình là sai series semantics, đúng chỗ runtime của ta đã giải sẵn nên target API càng chuẩn thì LLM convert càng trúng.

## 6. Verification harness (xây TRƯỚC tiên)

- Bộ golden datasets: 3–5 symbol × 2 timeframe, CSV export từ TradingView (user tự export, tránh vấn đề ToS khi mình scrape).
- Mỗi `ta.*` function: fixture riêng (input → expected từng bar, lấy từ indicator "Export chart data" của TradingView).
- Corpus test: ~100 script phổ biến giai đoạn đầu → chạy CI, báo cáo % convert-OK và % match-OK riêng biệt.
- Dung sai: relative 1e-6 (float64 vs float64 của TradingView), warmup bars được phép `na`.

## 7. Sandbox & an toàn

Code TS sinh ra (và code user sửa) là code tuỳ ý → chạy trong **Web Worker không DOM**, compile bằng esbuild-wasm, giới hạn thời gian/bộ nhớ, không network. (Nâng cấp sau: QuickJS-WASM nếu cần isolation mạnh hơn.)

## 8. Pháp lý

- Clean-room từ tài liệu công khai (reference manual) — đúng cách PineTS/PyneSys đã làm.
- "Pine Script®" là trademark của TradingView: không dùng trong tên sản phẩm (đặt kiểu "PS-compatible script import"), kèm disclaimer không liên kết.
- Không copy grammar/code từ PineTS (AGPL) — kể cả "tham khảo" cũng phải cẩn thận; chỉ đọc docs TradingView + tự thiết kế.

## 9. Effort & roadmap (ghép vào roadmap CANDLEKIT-PLAN)

| Bước | Thời gian | Deliverable |
|---|---|---|
| 1. Harness + golden data | 1–1.5 tuần | CI so sánh từng bar; fixtures cho 10 hàm ta.* đầu |
| 2. Runtime `@finchart/pine-rt` | 3–4 tuần | Series + context + 40 hàm ta.* pass golden test. **Đồng thời chính là streaming engine P1 của chart** |
| 3. Parser + semantic + codegen | 3–4 tuần | Subset v1 (mục 4), error message rõ |
| 4. Tích hợp candlekit + UI | 1.5–2 tuần | Paste → convert → hiện TS → chạy trong Worker → render; input.* tự sinh form |
| 5. Corpus hardening | 2 tuần + liên tục | Chạy 100→1.000 script, sửa lỗi đuôi, LLM fallback + verify loop |

**Tổng: ~11–13 tuần** cho mốc ">90% top indicators". Lưu ý: bước 2 không phải chi phí thêm thuần — nó thay thế hạng mục P1 (streaming indicator engine) đã có sẵn trong kế hoạch, nên chi phí tăng thêm thực so với CANDLEKIT-PLAN chỉ ~6–8 tuần (parser + codegen + hardening).

## 10. Rủi ro chính

1. **Độ chính xác ta.* seed** — rủi ro kỹ thuật số 1; giải bằng golden test từng hàm ngay từ đầu.
2. Corpus 1.000 script lộ ra construct phổ biến ngoài dự kiến (vd nhiều script dùng `request.security` hơn ước tính) → đo corpus SỚM (tuần 1–2) để chốt scope v1 bằng số liệu thật chứ không đoán.
3. Trademark/ToS khi quảng bá tính tương thích — xử lý bằng naming + disclaimer.
4. Phạm vi creep sang strategy/backtest — khoá v1 = indicators only.
