/**
 * Corpus KPI: parse toàn bộ corpus đã clean, báo % parse-OK theo version
 * + top error patterns. Chạy: npm run corpus
 * (qua vitest để có TS resolution; chỉ chạy khi RUN_CORPUS=1)
 */
import { it } from "vitest";
import { readFileSync, readdirSync, statSync, writeFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/index";

const CORPUS = process.env.CORPUS_DIR ?? "D:/2026/Temp/FinChart/pine-corpus/cleaned";

function* walk(dir: string): Generator<string> {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) yield* walk(p);
    else if (p.endsWith(".pine")) yield p;
  }
}

it.runIf(process.env.RUN_CORPUS === "1")(
  "corpus parse KPI",
  () => {
    const byVersion = new Map<number, { ok: number; fail: number }>();
    const errorPatterns = new Map<string, { count: number; sample: string }>();
    const failures: { file: string; v: number; line: number; message: string }[] = [];
    let total = 0;

    for (const p of walk(CORPUS)) {
      const text = readFileSync(p, "utf8");
      const vm = text.match(/\/\/@version\s*=\s*(\d+)/);
      const v = vm ? +vm[1] : 1;
      total++;
      let r;
      try {
        r = parse(text);
      } catch (e) {
        r = { script: null, errors: [{ line: 0, message: `CRASH: ${(e as Error).message}` }] };
      }
      const slot = byVersion.get(v) ?? { ok: 0, fail: 0 };
      if (r.errors.length === 0) slot.ok++;
      else {
        slot.fail++;
        const msg = r.errors[0].message
          .replace(/line \d+: /g, "")
          .replace(/'[^']*'/g, "'_'")
          .slice(0, 90);
        const e = errorPatterns.get(msg) ?? { count: 0, sample: "" };
        e.count++;
        e.sample = `${p.slice(CORPUS.length + 1)}:${r.errors[0].line}`;
        errorPatterns.set(msg, e);
        failures.push({ file: p.slice(CORPUS.length + 1), v, line: r.errors[0].line, message: r.errors[0].message });
      }
      byVersion.set(v, slot);
    }

    const pct = (a: number, b: number) => ((100 * a) / Math.max(1, b)).toFixed(1) + "%";
    const out: string[] = [`\n=== Pine parser corpus KPI — ${total} files ===`];
    let okAll = 0;
    for (const v of [...byVersion.keys()].sort()) {
      const { ok, fail } = byVersion.get(v)!;
      okAll += ok;
      out.push(`  v${v}: ${ok}/${ok + fail} OK (${pct(ok, ok + fail)})`);
    }
    out.push(`  ALL: ${okAll}/${total} OK (${pct(okAll, total)})`);

    const v456 = [4, 5, 6].reduce(
      (s, v) => {
        const x = byVersion.get(v) ?? { ok: 0, fail: 0 };
        return { ok: s.ok + x.ok, n: s.n + x.ok + x.fail };
      },
      { ok: 0, n: 0 },
    );
    out.push(`  v4+v5+v6 (scope chính): ${v456.ok}/${v456.n} OK (${pct(v456.ok, v456.n)})`);

    out.push(`\n=== Top error patterns ===`);
    const top = [...errorPatterns.entries()].sort((a, b) => b[1].count - a[1].count).slice(0, 20);
    for (const [msg, { count, sample }] of top) {
      out.push(`  ${String(count).padStart(4)}  ${msg}\n        vd: ${sample}`);
    }

    writeFileSync(join(dirname(fileURLToPath(import.meta.url)), "corpus-failures.json"), JSON.stringify(failures, null, 1));
    console.log(out.join("\n"));
  },
  300_000,
);
