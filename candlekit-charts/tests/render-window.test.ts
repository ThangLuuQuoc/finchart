import { describe, it, expect } from "vitest";
import {
  DEFAULT_RENDER_WINDOW,
  resolveRenderWindow,
  lowerBoundByTime,
  initialRenderStart,
  nextRenderStart,
} from "../src/indicators/renderWindow";

const bars = Array.from({ length: 10_000 }, (_, i) => ({ time: 1_000_000 + i * 60 }));
const timeAt = (i: number) => bars[i].time;

describe("resolveRenderWindow", () => {
  it("false disables, undefined gives defaults, partials merge", () => {
    expect(resolveRenderWindow(false)).toBeNull();
    expect(resolveRenderWindow()).toEqual(DEFAULT_RENDER_WINDOW);
    expect(resolveRenderWindow({ sizeBars: 100 })).toEqual({ ...DEFAULT_RENDER_WINDOW, sizeBars: 100 });
  });

  it("rejects nonsensical configs", () => {
    expect(resolveRenderWindow({ sizeBars: 0 })).toBeNull();
    expect(resolveRenderWindow({ expandBars: -5 })).toBeNull();
  });
});

describe("lowerBoundByTime", () => {
  it("finds the first index with time >= t", () => {
    expect(lowerBoundByTime(bars, timeAt(0))).toBe(0);
    expect(lowerBoundByTime(bars, timeAt(0) - 1)).toBe(0);
    expect(lowerBoundByTime(bars, timeAt(500))).toBe(500);
    expect(lowerBoundByTime(bars, timeAt(500) + 1)).toBe(501);
    expect(lowerBoundByTime(bars, timeAt(9999) + 1)).toBe(10_000);
    expect(lowerBoundByTime(bars, -Infinity)).toBe(0);
    expect(lowerBoundByTime([], 5)).toBe(0);
  });
});

describe("initialRenderStart", () => {
  it("renders everything when the history fits in the window", () => {
    expect(initialRenderStart(bars.slice(0, 100), { sizeBars: 100, guardBars: 10, expandBars: 50 })).toBe(-Infinity);
  });

  it("starts at the last sizeBars bars otherwise", () => {
    const cfg = { sizeBars: 5000, guardBars: 250, expandBars: 2500 };
    expect(initialRenderStart(bars, cfg)).toBe(timeAt(5000));
  });
});

describe("nextRenderStart", () => {
  const cfg = { sizeBars: 5000, guardBars: 250, expandBars: 2500 };
  const start = timeAt(5000); // initial window = bars 5000..9999

  it("no extension while the view stays well inside the window", () => {
    expect(nextRenderStart(bars, start, timeAt(7000), cfg)).toBeNull();
    expect(nextRenderStart(bars, start, timeAt(5000 + 250), cfg)).toBeNull(); // exactly guard slack
  });

  it("extends expandBars past the visible edge when slack < guard", () => {
    const visible = timeAt(5100); // only 100 bars of slack
    expect(nextRenderStart(bars, start, visible, cfg)).toBe(timeAt(5100 - 2500));
  });

  it("extends even when the view is already left of the window", () => {
    expect(nextRenderStart(bars, start, timeAt(3000), cfg)).toBe(timeAt(500));
  });

  it("clamps to the full history (−Infinity) at the left end", () => {
    expect(nextRenderStart(bars, timeAt(3000), timeAt(1000), cfg)).toBe(-Infinity);
  });

  it("never moves the start right and is a no-op when everything is rendered", () => {
    expect(nextRenderStart(bars, -Infinity, timeAt(0), cfg)).toBeNull();
    // a later visible edge must not shrink the window
    expect(nextRenderStart(bars, timeAt(500), timeAt(9000), cfg)).toBeNull();
  });

  it("converges: applying the result again needs no further extension", () => {
    const visible = timeAt(5100);
    const newStart = nextRenderStart(bars, start, visible, cfg)!;
    expect(nextRenderStart(bars, newStart, visible, cfg)).toBeNull();
  });
});
