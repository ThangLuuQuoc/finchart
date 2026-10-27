/**
 * Làm sạch corpus: megapack hasnocool là trang web scrape —
 * header mô tả + khối số dòng (1..N) + code thật (space = NBSP  )
 * + đuôi "Expand (N lines)". Trích từ dòng //@version đến trước đuôi junk,
 * thay NBSP bằng space thường. File sạch sẵn (//@version trong 5 dòng đầu)
 * được copy nguyên trạng. Output: pine-corpus/cleaned/<repo>/<file>.pine
 */
import { readFileSync, writeFileSync, readdirSync, statSync, mkdirSync } from "node:fs";
import { join, extname, dirname } from "node:path";

const ROOT = join(import.meta.dirname, "repos");
const OUT = join(import.meta.dirname, "cleaned");

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    if (name === ".git") continue;
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else yield p;
  }
}

let kept = 0;
let cleanedCount = 0;
let skipped = 0;

for (const p of walk(ROOT)) {
  const ext = extname(p).toLowerCase();
  if (![".pine", ".pinescript", ".txt", ".ps"].includes(ext)) continue;
  let text;
  try {
    text = readFileSync(p, "utf8");
  } catch {
    skipped++;
    continue;
  }
  const vIdx = text.indexOf("//@version");
  if (vIdx < 0) {
    // script v1 không khai báo version: chỉ giữ nếu có study(/indicator(/strategy(
    if (!/(?:^|\n)\s*(?:study|indicator|strategy)\s*\(/.test(text)) {
      skipped++;
      continue;
    }
  }

  let code = vIdx >= 0 ? text.slice(vIdx) : text;
  // cắt đuôi junk của trang scrape
  code = code.replace(/\nExpand \(\d+ lines?\)[\s\S]*$/, "\n");
  // NBSP và các khoảng trắng unicode khác → space
  const hadNbsp = / /.test(code);
  code = code.replace(/[  -   ]/g, " ");
  // CRLF → LF
  code = code.replace(/\r\n?/g, "\n");

  if (vIdx > 5 || hadNbsp) cleanedCount++;
  kept++;

  const rel = p.slice(ROOT.length + 1).replace(/\.(pinescript|txt|ps)$/i, ".pine");
  const dest = join(OUT, rel);
  mkdirSync(dirname(dest), { recursive: true });
  writeFileSync(dest, code);
}

console.log(`kept ${kept} (cleaned ${cleanedCount}, skipped ${skipped}) → ${OUT}`);
