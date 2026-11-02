import { test } from "node:test";
import assert from "node:assert/strict";
import { brier, points, calibration, summarize, targetFriday, isLocked, niceStep, marketOdds, etNow, weeklyStrikes } from "../src/lib/forecasts.js";

test("scoring: 50% scores 0, confident and right scores up to +100, confident and wrong down to -300", () => {
  assert.equal(points(0.5, true), 0);
  assert.equal(points(0.5, false), 0);
  assert.equal(points(0.9, true), 96);
  assert.equal(points(0.9, false), -224);
  assert.equal(points(0.01, false), 100);
  assert.ok(Math.abs(brier(0.7, true) - 0.09) < 1e-9);
});

test("summary: points, Brier, accuracy and beating the market", () => {
  const rows = [
    { prob: 0.9, outcome: true, market_prob: 0.6 }, // beat the market
    { prob: 0.3, outcome: true, market_prob: 0.5 }, // worse than the market
    { prob: 0.2, outcome: false, market_prob: 0.4 }, // beat the market
  ];
  const s = summarize(rows);
  assert.equal(s.resolved, 3);
  assert.equal(s.points, points(0.9, true) + points(0.3, true) + points(0.2, false));
  assert.equal(s.accuracy, 66.7);
  assert.equal(s.beat_market_pct, 66.7);
  assert.ok(s.brier < s.market_brier);
  assert.equal(summarize([]).brier, null);
});

test("calibration buckets forecasts by 10% bands", () => {
  const c = calibration([{ prob: 0.72, outcome: true }, { prob: 0.78, outcome: false }, { prob: 0.15, outcome: false }]);
  assert.equal(c.length, 10);
  assert.equal(c[7].n, 2);
  assert.equal(c[7].avg_forecast, 75);
  assert.equal(c[7].happened, 50);
  assert.equal(c[1].happened, 0);
  assert.equal(c[5].n, 0);
});

test("dates: questions resolve this Friday with two sessions left, else next Friday; lock at the open", () => {
  assert.equal(targetFriday("2026-11-02"), "2026-11-06"); // Monday
  assert.equal(targetFriday("2026-11-04"), "2026-11-06"); // Wednesday
  assert.equal(targetFriday("2026-11-05"), "2026-11-13"); // Thursday
  assert.equal(targetFriday("2026-11-07"), "2026-11-13"); // Saturday
  const q = { status: "open", resolve_date: "2026-11-06" };
  assert.equal(isLocked(q, { date: "2026-11-05", minutes: 900 }), false);
  assert.equal(isLocked(q, { date: "2026-11-06", minutes: 569 }), false);
  assert.equal(isLocked(q, { date: "2026-11-06", minutes: 570 }), true);
  assert.equal(isLocked({ ...q, status: "resolved" }, { date: "2026-11-01", minutes: 0 }), true);
  assert.match(etNow().date, /^\d{4}-\d{2}-\d{2}$/);
});

test("market odds: about 50% at the money, higher below the price, lower above it", () => {
  const now = new Date("2026-11-02T15:00:00Z");
  const q = (strike) => ({ strike, resolve_date: "2026-11-06", sigma: 0.4 });
  const atm = marketOdds(q(100), 100, now);
  assert.ok(atm > 0.45 && atm < 0.55);
  assert.ok(marketOdds(q(95), 100, now) > 0.75);
  assert.ok(marketOdds(q(110), 100, now) < 0.1);
  assert.equal(marketOdds(q(100), null, now), null);
  assert.equal(niceStep(30), 1);
  assert.equal(niceStep(150), 5);
  assert.equal(niceStep(400), 10);
  assert.equal(niceStep(1500), 50);
});

test("weekly strikes sit near the price and about 0.6 expected moves either side", () => {
  const ks = weeklyStrikes(755.72, 0.15, 4 / 365); // SPY-like: expected move about $11.9
  assert.equal(ks.length, 3);
  assert.ok(ks.every((k) => Math.abs(k - 755.72) < 12));
  const q = (strike) => ({ strike, resolve_date: "2026-11-06", sigma: 0.15 });
  const odds = ks.map((k) => marketOdds(q(k), 755.72, new Date("2026-11-02T20:00:00Z")));
  assert.ok(odds.some((p) => p > 0.65 && p < 0.85) && odds.some((p) => p > 0.15 && p < 0.35));
});
