/**
 * Acceptance targets: 2 script Volume Profile (primary) phải parse sạch;
 * VSA TANHEF + library là stretch target (dùng import/UDT/method — scope sau)
 * nên chỉ log trạng thái, không fail suite.
 */

import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { parse } from "../src/index";

const dir = join(dirname(fileURLToPath(import.meta.url)), "..", "fixtures", "targets");
const load = (f: string) => readFileSync(join(dir, f), "utf8");

describe("primary targets parse cleanly", () => {
  it("Volume Profile Fixed Range [LonesomeTheBlue] (v5)", () => {
    const r = parse(load("vp-fixed-range.pine"));
    expect(r.errors).toEqual([]);
    expect(r.script!.statements.length).toBeGreaterThan(10);
  });

  it("Fibo Levels with Volume Profile [ChartPrime] (v5)", () => {
    const r = parse(load("fivp-chartprime.pine"));
    expect(r.errors).toEqual([]);
    expect(r.script!.statements.length).toBeGreaterThan(10);
  });
});

describe("stretch targets (log-only)", () => {
  for (const f of ["vsa-tanhef.pine", "vsa-library.pine"]) {
    it(`${f} status`, () => {
      const r = parse(load(f));
      console.log(`[stretch] ${f}: ${r.errors.length === 0 ? "PARSE OK" : `error @ line ${r.errors[0].line}: ${r.errors[0].message}`}`);
      expect(true).toBe(true);
    });
  }
});

describe("micro cases", () => {
  const ok = (src: string) => {
    const r = parse(src);
    expect(r.errors, src).toEqual([]);
    return r.script!;
  };

  it("declarations & assignment forms", () => {
    ok(`//@version=5
indicator("t")
x = 1
var float y = na
varip int z = 0
color c = color.rgb(1, 2, 3)
array<float> xs = array.new_float()
y := y + 1
z += 2
[a, b] = ta.macd(close, 12, 26, 9)
plot(x)
`);
  });

  it("if / for / while / switch blocks + as expression", () => {
    ok(`//@version=5
indicator("t")
f(x) => x * 2
g(simple int len, float src = close) =>
    s = 0.0
    for i = 0 to len - 1 by 1
        s := s + src[i]
    s / len
v = if close > open
    1
else if close < open
    -1
else
    0
w = switch
    close > open => "up"
    => "down"
while v > 0
    break
plot(f(close) + g(14))
`);
  });

  it("ternary chains, history, tuples, named args, method chains", () => {
    ok(`//@version=5
indicator("t")
hl = high - low
k = hl > hl[1] ? hl[2] : nz(hl[3], 0)
ln = line.new(bar_index, high, bar_index + 1, low, color = color.new(#ff0000, 50), width = 2)
line.set_x2(ln, bar_index + 10)
arr = array.new<float>(0)
array.push(arr, close)
m = arr.size() > 0 ? arr.get(0) : na
plot(m)
`);
  });
});
