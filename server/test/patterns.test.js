import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBullFlag, flagEndingAt, marketRegime, regimePasses } from "../src/lib/patterns.js";

const DAY = 86_400_000;
const bar = (i, c, { h = c * 1.005, l = c * 0.995, o = c, v = 1e6 } = {}) => ({ t: Date.UTC(2026, 0, 1) + i * DAY, o, h, l, c, v });

/** 40 flat bars at 100, a 6-bar pole to ~120, then an 8-bar flag drifting down to ~114. */
function flagBars() {
  const bars = [];
  for (let i = 0; i < 40; i++) bars.push(bar(i, 100));
  [104, 108, 111, 115, 118, 120].forEach((c, k) => bars.push(bar(40 + k, c, { v: 3e6 })));
  [119, 118, 117.5, 116.5, 116, 115.5, 115, 114.5].forEach((c, k) => bars.push(bar(46 + k, c, { v: 9e5 })));
  return bars;
}

test("finds a forming bull flag with pole, flag and levels", () => {
  const r = detectBullFlag(flagBars());
  assert.equal(r.status, "forming");
  assert.ok(r.pole.gain_pct >= 15);
  assert.ok(r.flag.retrace_pct <= 50);
  assert.ok(r.flag.volume_vs_pole < 1);
  assert.ok(r.breakout_level > r.stop_level);
  assert.ok(r.target_measured_move > r.breakout_level);
});

test("flags a breakout when the close clears the flag high on volume", () => {
  const bars = flagBars();
  const flag = flagEndingAt(bars, bars.length - 1);
  bars.push(bar(bars.length, flag.flagHigh * 1.02, { v: 4e6 }));
  const r = detectBullFlag(bars);
  assert.equal(r.status, "breakout");
  assert.equal(r.volume_confirmed, true);
  assert.equal(r.breakout_level, Number(flag.flagHigh.toFixed(2)));
});

test("rejects a pullback that gives back too much of the pole", () => {
  const bars = flagBars().slice(0, 46);
  [116, 112, 108, 105, 104].forEach((c, k) => bars.push(bar(46 + k, c)));
  assert.equal(detectBullFlag(bars), null);
});

test("no pole, no flag", () => {
  const bars = [];
  for (let i = 0; i < 80; i++) bars.push(bar(i, 100 + Math.sin(i / 3)));
  assert.equal(detectBullFlag(bars), null);
});

test("market regime: rising SPY is bull, falling is bear", () => {
  const up = Array.from({ length: 260 }, (_, i) => bar(i, 400 + i));
  const down = Array.from({ length: 260 }, (_, i) => bar(i, 660 - i));
  assert.equal(marketRegime(up).state, "bull");
  assert.equal(marketRegime(down).state, "bear");
  assert.equal(regimePasses("bull", "neutral"), false);
  assert.equal(regimePasses("not_bear", "neutral"), true);
  assert.equal(regimePasses("off", "bear"), true);
});
