import { test } from "node:test";
import assert from "node:assert/strict";
import { detectBearFlag, regimePasses } from "../src/lib/patterns.js";
import { STRATEGIES, currentSetup, simulate, stopPrice, targetPrice, rMultiple } from "../src/lib/strategies.js";
import { applyFill } from "../src/lib/paper.js";
import { cleanConfig, sizePosition, summarize } from "../src/lib/bots.js";

const DAY = 86_400_000;
const bar = (i, c, { h = c * 1.005, l = c * 0.995, o = c, v = 1e6 } = {}) => ({ t: Date.UTC(2025, 0, 1) + i * DAY, o, h, l, c, v });

/** 40 flat bars at 120, a 6-bar drop to ~100, then an 8-bar bounce up to ~105. */
function bearFlagBars() {
  const bars = [];
  for (let i = 0; i < 40; i++) bars.push(bar(i, 120));
  [116, 112, 109, 105, 102, 100].forEach((c, k) => bars.push(bar(40 + k, c, { v: 3e6 })));
  [101, 102, 102.5, 103.5, 104, 104.5, 105, 105.5].forEach((c, k) => bars.push(bar(46 + k, c, { v: 9e5 })));
  return bars;
}

/** A steady uptrend of n bars (0.3% a day) with small noise. */
function uptrend(n, start = 100) {
  return Array.from({ length: n }, (_, i) => bar(i, start * 1.003 ** i * (1 + 0.004 * Math.sin(i))));
}

test("bear flag: forming after a drop, breakdown below the flag low", () => {
  const bars = bearFlagBars();
  const f = detectBearFlag(bars);
  assert.equal(f.status, "forming");
  assert.ok(f.pole.drop_pct >= 15);
  assert.ok(f.stop_level > f.breakdown_level);
  assert.ok(f.target_measured_move < f.breakdown_level);
  bars.push(bar(bars.length, f.breakdown_level * 0.97, { v: 4e6 }));
  const b = detectBearFlag(bars);
  assert.equal(b.status, "breakdown");
  assert.equal(b.volume_confirmed, true);
});

test("bear flag strategy: short setup, stop above, target below, short trade simulated in R", () => {
  const st = STRATEGIES.bear_flag_breakdown;
  const bars = bearFlagBars();
  const s = currentSetup(st, bars, st.config.pattern_params);
  assert.equal(s.status, "forming");
  assert.ok(s.stop > s.level && s.target < s.level);
  const cfg = cleanConfig({ strategy: "bear_flag_breakdown" });
  // Break down, then fall to the target
  for (let k = 0; k < 12; k++) bars.push(bar(bars.length, s.level * (0.99 - k * 0.02)));
  const { trades } = simulate(st, bars, cfg, { start: 30 });
  assert.equal(trades[0].side, "short");
  assert.equal(trades[0].reason, "target");
  assert.ok(trades[0].r > 1);
});

test("short helpers: stop above entry, target below, R positive when price falls", () => {
  const st = STRATEGIES.bear_flag_breakdown;
  const stop = stopPrice(st, { level: 100, stop: 105 }, { stop: "pattern" });
  assert.ok(stop > 105);
  assert.equal(targetPrice(st, { target: null }, 100, 105, { target: "r2" }), 90);
  assert.equal(rMultiple(100, 105, 90), 2);
  assert.equal(rMultiple(100, 105, 105), -1);
  assert.equal(sizePosition({ equity: 100_000, buyingPower: 100_000, entry: 100, stop: 105, risk_pct: 1, max_position_pct: 20, direction: "short" }), 200);
  assert.equal(regimePasses("bear", "bull"), false);
  assert.equal(regimePasses("not_bull", "neutral"), true);
});

test("paper shorts: open, add, cover with realized P/L; no selling or shorting across sides", () => {
  let { position } = applyFill(null, { side: "short", qty: 10, price: 100 });
  assert.equal(position.qty, -10);
  ({ position } = applyFill(position, { side: "short", qty: 10, price: 110 }));
  assert.equal(position.qty, -20);
  assert.equal(position.avg_cost, 105);
  const cover = applyFill(position, { side: "buy", qty: 5, price: 95 });
  assert.equal(cover.position.qty, -15);
  assert.equal(cover.realized, 50);
  assert.throws(() => applyFill(cover.position, { side: "buy", qty: 16, price: 95 }), /short 15/);
  assert.throws(() => applyFill(cover.position, { side: "sell", qty: 1, price: 95 }), /buy to cover/);
  assert.throws(() => applyFill({ qty: 5, avg_cost: 10 }, { side: "short", qty: 1, price: 10 }), /before shorting/);
});

test("new high breakout: watches near the 20-day high in an uptrend", () => {
  const st = STRATEGIES.high_breakout;
  const s = currentSetup(st, uptrend(260), st.config.pattern_params);
  assert.ok(s);
  assert.ok(s.level >= s.stop);
  assert.equal(currentSetup(st, uptrend(260).map((b, i, a) => ({ ...a[a.length - 1 - i], t: b.t })), st.config.pattern_params), null); // downtrend: nothing
});

test("oversold bounce: signals after a sharp drop above the 200-day and exits by rule", () => {
  const st = STRATEGIES.rsi2_reversion;
  const bars = uptrend(260);
  const top = bars[bars.length - 1].c;
  [0.97, 0.94].forEach((m, k) => bars.push(bar(bars.length, top * m)));
  const s = currentSetup(st, bars, st.config.pattern_params);
  assert.equal(s.status, "triggered");
  assert.equal(s.exit_rule, "sma5");
  [0.96, 0.99, 1.01].forEach((m) => bars.push(bar(bars.length, top * m)));
  const { trades } = simulate(st, bars, cleanConfig({ strategy: "rsi2_reversion" }), { start: bars.length - 6 });
  assert.equal(trades[0].reason, "rule");
  assert.ok(trades[0].r > 0);
});

test("pullback and squeeze strategies run without errors on trending data", () => {
  for (const key of ["trend_pullback", "squeeze_breakout"]) {
    const st = STRATEGIES[key];
    const r = simulate(st, uptrend(400), cleanConfig({ strategy: key }));
    assert.ok(Array.isArray(r.trades));
  }
});

test("bot config: strategy defaults, filters by direction, legacy bull flag values", () => {
  const bear = cleanConfig({ strategy: "bear_flag_breakdown", market_filter: "not_bear" });
  assert.equal(bear.market_filter, "not_bull"); // long-only filter falls back to the short default
  assert.equal(cleanConfig({ strategy: "rsi2_reversion", entry: { trigger: "intraday" } }).entry.trigger, "close");
  const legacy = cleanConfig({ pattern: "bull_flag", exit: { stop: "flag_low", target: "measured_move" } });
  assert.equal(legacy.strategy, "bull_flag_breakout");
  assert.equal(legacy.exit.stop, "pattern");
  assert.equal(legacy.exit.target, "pattern");
  const s = summarize([{ r: 2, reason: "target", exit_date: "2026-01-02" }, { r: -1, reason: "stop", exit_date: "2026-01-03" }], 1);
  assert.equal(s.total_r, 1);
  assert.equal(s.profit_factor, 2);
});
