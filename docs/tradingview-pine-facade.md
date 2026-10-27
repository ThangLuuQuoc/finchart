---
name: tradingview-pine-facade
description: TradingView pine-facade API — lấy source code đầy đủ của mọi script open-source trên TradingView bằng cách gọi endpoint nội bộ TV
metadata: 
  node_type: memory
  type: reference
  originSessionId: c5631f49-2f7c-4b81-990f-c3d5509ca272
---

## API pine-facade của TradingView

Endpoint: `https://pine-facade.tradingview.com/pine-facade/get/PUB%3B<script_id>/<version>`

- `PUB%3B` là URL-encode của `PUB;`
- `<script_id>` lấy từ URL script trên TV, ví dụ `XXXX` trong `tradingview.com/script/XXXX-script-name/`
- `<version>` là số version integer, thường bắt đầu từ 1

### Cách dùng thực tế

Khi user paste link script TradingView (ví dụ `https://tradingview.com/script/AbCdEfGh-Volume-Profile/`):
1. Extract script ID: `AbCdEfGh`
2. Fetch: `https://pine-facade.tradingview.com/pine-facade/get/PUB%3BAbCdEfGh/1`
3. Response trả về source Pine Script đầy đủ (dạng JSON hoặc plain text)

### Ứng dụng

- **Corpus mở rộng**: Sau khi có danh sách "top N scripts by likes" từ TV, dùng API này tải source hàng loạt — đã làm với VSA [TANHEF] + Volume Profile [LonesomeTheBlue] tại `pine-corpus/repos/tv-downloads/`
- **User workflow**: User paste link → tự động fetch source → parse → transpile → chạy trên FinChart
- **Không cần đăng nhập** với script open-source (public)

### Scripts đã tải

- VSA [TANHEF] Editor's Pick — `pine-corpus/repos/tv-downloads/vsa-tanhef.pine`
- Volume Profile Fixed Range [LonesomeTheBlue] — `pine-corpus/repos/tv-downloads/vp-fixed-range.pine`
- FIVP [ChartPrime] — đã có trong fixtures

### Lưu ý

- Không phải API công khai chính thức — TV dùng nội bộ cho editor
- Chỉ hoạt động với script "public" / open-source (không phải protected/private)
- Corporate proxy có thể chặn — test trước khi dùng trong production flow
